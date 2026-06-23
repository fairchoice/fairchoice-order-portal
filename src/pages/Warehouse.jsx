import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../services/supabase";
import { hasPermission, requirePermission } from "../utils/permissions";
import { logAction } from "../utils/auditLog";
import { formatCurrency } from "../utils/currency";

/*
  Warehouse Page
  --------------------------------------------------
  Purpose:
  - Show orders currently in "Warehouse Packing"
  - Allow warehouse to remove unavailable items from print/picking
  - Print customer document:
      EX VAT / Admin Offer      => SALES INVOICE with NOT PAID stamp
      Server / Manager Offer    => ORDER FORM - NOT AN INVOICE
  - Print delivery note
  - Assign driver
  - Confirm order ready for driver
*/

export default function Warehouse({
  orders = [],
  changeOrderStatus,
  updateOrderItem,
  updateOrderExtraFields,
}) {
  const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
  const [drivers, setDrivers] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  // Reusable button style
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  const [assignedDrivers, setAssignedDrivers] = useState({});

  const getOrderId = (order) => order.orderId || order.order_number;
  const getDriverName = (order) => order.driverName || order.driver_name;

  /*
    Company information for invoice print.
    Future change:
    If you later want to control this from Supabase, replace this object
    with data from a company_settings table.
  */
  const LOGO_URL =
    "https://naobitwzrkovmwvzvgvf.supabase.co/storage/v1/object/public/product-images/Logo.png";

  const COMPANY = {
    name: "Fair Choice Cash and Carry Ltd",
    address1: "177 Pant Yr Heol, Panty Yr heol",
    address2: "Neath, SA11 2HB",
    country: "United Kingdom",
    telephone: "07491116595",
    email: "info@fairchoice.co.uk",
    registration: "Registered in England and Wales No. 16350457",
    vatNumber: "GB 489728125",
    registeredAddress: "177 Pant Yr Heol, Neath, SA11 2HB",
    logo: LOGO_URL,
  };

  /*
    Load active drivers from Supabase.
  */
const fetchDrivers = async () => {
  const { data, error } = await supabase
    .from("login_users")
    .select("id, username, role, active")
    .eq("role", "Driver")
    .eq("active", true)
    .order("username");

  if (error) {
    console.error("Driver load error:", error);
    return;
  }

  setDrivers(data || []);
};

  useEffect(() => {
    fetchDrivers();
  }, []);

  /*
    Show active warehouse and driver-ready orders.
  */
  const warehouseOrders = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    return orders
      .filter((order) =>
        ["Warehouse Packing", "Ready For Driver"].includes(order.status)
      )
      .filter((order) =>
        statusFilter === "All" ? true : order.status === statusFilter
      )
      .filter((order) => {
        if (!search) return true;

        return (
          String(order.orderId || order.order_number || "")
            .toLowerCase()
            .includes(search) ||
          String(order.companyName || order.company_name || "")
            .toLowerCase()
            .includes(search)
        );
      })
      .sort((a, b) => {
        const aDate = new Date(a.createdAt || a.created_at || 0).getTime();
        const bDate = new Date(b.createdAt || b.created_at || 0).getTime();
        return bDate - aDate;
      });
  }, [orders, searchTerm, statusFilter]);

  const warehousePackingCount = orders.filter(
    (order) => order.status === "Warehouse Packing"
  ).length;
  const readyForDriverCount = orders.filter(
    (order) => order.status === "Ready For Driver"
  ).length;
  const allWarehouseCount = warehousePackingCount + readyForDriverCount;

  /*
    Expand/collapse warehouse order card.
  */
  const toggleExpanded = (orderId) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  /*
    Printable items:
    includeInPicking === false means the item was removed/cannot supply.
    It will not appear on invoice/order form/delivery note.
  */
  const getPrintableItems = (order) =>
    (order.items || []).filter((item) => item.includeInPicking !== false);

  /*
    Money format helper.
  */
  const money = formatCurrency;

  /*
    Product quantity helper.
    Supports different possible field names from your order object.
  */
  const getLineQty = (item) =>
    Number(item.pickedQty ?? item.qty ?? item.quantity ?? 0);

  /*
    Product price helper.
    Supports different possible field names from your order object.
  */
  const getLinePrice = (item) =>
    Number(item.price ?? item.unitPrice ?? item.selectedPrice ?? 0);

  /*
    Product line total helper.
    If lineTotal exists, use it.
    Otherwise calculate qty x price.
  */
  const getLineTotal = (item) => {
    const qty = getLineQty(item);
    const price = getLinePrice(item);

    return Number(item.lineTotal ?? item.line_total ?? qty * price ?? 0);
  };

  /*
    Invoice/order totals.
    Total Lines = number of printable product lines.
    Total Quantity = total cartons/units.
    Net Total = product line totals.
    VAT Total = order VAT if available.
    Grand Total = order total if available, otherwise net + VAT.
  */
const getInvoiceTotals = (order) => {
  console.log("ORDER", order);
  console.log("VAT TOTAL", order.vatTotal);
  console.log("TOTAL VAT", order.totalVat);
  console.log("VAT", order.vat);
  console.log("TOTAL", order.total);

  const printableItems = getPrintableItems(order);

  const totalLines = printableItems.length;

  const totalQuantity = printableItems.reduce(
    (sum, item) => sum + getLineQty(item),
    0
  );

  const netTotal = printableItems.reduce((sum, item) => {
    const qty = getLineQty(item);
    const price = getLinePrice(item);

    const net = Number(item.net_total ?? item.netTotal ?? qty * price);

    return sum + net;
  }, 0);

  const savedGrandTotal = Number(order.total ?? order.final_total ?? 0);

  const calculatedVat =
    savedGrandTotal > netTotal
      ? savedGrandTotal - netTotal
      : printableItems.reduce((sum, item) => {
          const qty = getLineQty(item);
          const price = getLinePrice(item);
          const net = Number(item.net_total ?? item.netTotal ?? qty * price);
          const vatPercent = Number(item.vat_percent ?? item.vatPercent ?? 20);

          return sum + (net * vatPercent) / 100;
        }, 0);

  const grandTotal = netTotal + calculatedVat;

  return {
    totalLines,
    totalQuantity,
    netTotal,
    vatTotal: calculatedVat,
    grandTotal,
  };
};

  /*
    Decide whether to print invoice or order form.
    EX VAT / Admin Offer => Invoice
    Server / Manager Offer => Order Form - Not Invoice
  */
  const printCustomerDocument = async (order) => {
  if (!requirePermission(loggedInUser, "can_print", "You cannot print orders.")) return;

  printOrderForm(order);
  await logAction({
    user: loggedInUser,
    action_type: "Printed picking list",
    page_module: "Warehouse",
    order_id: order.orderId,
    old_value: null,
    new_value: "Customer Document",
  });
};

  /*
    SALES INVOICE
    --------------------------------------------------
    Used for EX VAT and Admin Offer.
    Includes:
    - Company header
    - Logo
    - VAT column
    - Total Net / VAT / Total
    - NOT PAID watermark and text
    - Company footer
  */
  const printInvoice = (order) => {
  const printableItems = getPrintableItems(order);
  const totals = getInvoiceTotals(order);

  const invoiceNumber = order.invoiceNumber || order.orderId || "-";
  const dueDate = order.dueDate || "-";

  const rawInvoiceDate =
    order.createdAt ||
    order.created_at ||
    order.invoiceDate ||
    order.invoice_date ||
    order.orderDate ||
    order.order_date;

  const invoiceDate =
    rawInvoiceDate && !isNaN(new Date(rawInvoiceDate).getTime())
      ? new Date(rawInvoiceDate).toLocaleDateString("en-GB")
      : new Date().toLocaleDateString("en-GB");

  const rows = printableItems
    .map((item) => {
      const qty = getLineQty(item);
      const price = getLinePrice(item);
      const net = getLineTotal(item);
      const vatPercent = Number(item.vatPercent ?? item.vat_percent ?? 20);

      return `
        <tr>
          <td class="product-code">
            ${item.productCode || item.product_code || ""}
          </td>

          <td class="desc-col">
            ${item.name || item.productName || ""}
          </td>

          <td class="qty-col">${qty.toFixed(2)}</td>
          <td class="price-col">${price.toFixed(2)}</td>
          <td class="vat-col">${vatPercent.toFixed(2)}</td>
          <td class="net-col">${net.toFixed(2)}</td>
        </tr>
      `;
    })
    .join("");

    const html = `
      <html>
        <head>
          <title>Invoice - ${invoiceNumber}</title>

          <style>
            @page { size: A4; margin: 10mm; }

            body {
              font-family: Arial, sans-serif;
              font-size: 11px;
              color: #000;
              margin: 0;
            }

            .page {
              position: relative;
              min-height: 277mm;
            }

            .unpaid-stamp {
              position: fixed;
              top: 43%;
              left: 50%;
              transform: translate(-50%, -50%) rotate(-25deg);
              font-size: 72px;
              font-weight: 900;
              color: rgba(220, 38, 38, 0.16);
              border: 6px solid rgba(220, 38, 38, 0.22);
              padding: 16px 36px;
              z-index: 0;
            }

            .content {
              position: relative;
              z-index: 1;
            }

            .top {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              border-bottom: 1px solid #000;
              padding-bottom: 8px;
            }

            .company {
              line-height: 1.35;
            }

            .logo {
              height: 82px;
              max-width: 190px;
              object-fit: contain;
            }

            .section {
              margin-top: 16px;
            }

            .invoice-grid {
              display: grid;
              grid-template-columns: 1fr 210px;
              gap: 20px;
              align-items: start;
            }

            .title {
              font-size: 22px;
              font-weight: 800;
              text-align: center;
              margin-bottom: 12px;
            }

            .box-title {
              font-weight: 700;
              margin-bottom: 5px;
            }

            .details-row {
              display: grid;
              grid-template-columns: 95px 1fr;
              margin-bottom: 4px;
            }

            table {
              width: 100%;
              border-collapse: collapse;
            }

            th {
              background: #e5e7eb;
              font-weight: 700;
            }

            @media print {
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 18px;
              table-layout: fixed;
              font-size: 11px;
            }

            th {
              background-color: #d9e2f3 !important;
              color: #000 !important;
              font-size: 11.5px;
              font-weight: 700;
              padding: 5px;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }

            thead,
            thead tr {
              background-color: #d9e2f3 !important;
            }

            td {
              border: none;
              padding: 4px 5px;
              font-size: 11px;
            }

           .product-code {
            text-align: left;
            font-size: 11px;
            font-weight: 400;
             width: 60px;
          }

          .desc-col {
             text-align: left !important;
            font-size: 11px;
            font-weight: 400;
            padding-left: 0;
            width: 320px;
          }

          .qty-col {
            text-align: center;
            font-size: 11px;
             width: 55px;
          }

          .price-col,
          .vat-col,
          .net-col {
            text-align: right;
            font-size: 11px;
             width: 70px;
          }

          

          

            .center { text-align: center; }
            .right { text-align: right; }

            .summary-area {
              margin-top: 16px;
              display: grid;
              grid-template-columns: 1fr 260px;
              gap: 20px;
              align-items: start;
            }

            .qty-box {
              margin-top: 46px;
              font-size: 13px;
              font-weight: 700;
              line-height: 1.8;
            }

            .summary-box {
              border: 1px solid #000;
            }

            .summary-row {
              display: grid;
              grid-template-columns: 1fr 100px;
              border-bottom: 1px solid #000;
            }

            .summary-row:last-child {
              border-bottom: none;
            }

            .summary-label,
            .summary-value {
              padding: 6px;
            }

            .summary-label {
              font-weight: 700;
            }

            .summary-value {
              text-align: right;
            }

            .grand {
              font-size: 14px;
              font-weight: 900;
            }

            .payment-status {
              margin-top: 18px;
              font-size: 28px;
              font-weight: 900;
              text-align: center;
              color: #b91c1c;
            }

            .deliver {
              margin-top: 22px;
              line-height: 1.45;
            }

            .footer {
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              border-top: 1px solid #000;
              padding-top: 8px;
              font-size: 10px;
              line-height: 1.35;
            }

            .page-no {
              text-align: right;
              margin-top: 6px;
            }
          </style>
        </head>

        <body>
          <div class="page">
            <div class="unpaid-stamp">NOT PAID</div>

            <div class="content">
              <div class="top">
                <div class="company">
                  <strong>${COMPANY.name}</strong><br />
                  ${COMPANY.address1}<br />
                  ${COMPANY.address2}<br />
                  ${COMPANY.country}<br />
                  Telephone: ${COMPANY.telephone}<br />
                  Email ${COMPANY.email}
                </div>

                <img src="${COMPANY.logo}" class="logo" />
              </div>

              <div class="section invoice-grid">
                <div>
                  <div class="box-title">Invoice To:</div>
                 <div>${order.companyName || order.company_name || "-"}</div>
                  <div>${order.branchName || order.branch_name || order.shopName || order.shop_name || ""}</div>
                  <div>${order.deliveryAddress || order.delivery_address || order.address || ""}</div>
                  <div>${order.postcode || order.post_code || order.branchPostcode || order.branch_postcode || ""}</div>
                </div>

                <div>
                  <div class="title">SALES INVOICE</div>

                  <div class="details-row">
                    <strong>Invoice Date</strong>
                    <span>${invoiceDate}</span>
                  </div>

                  <div class="details-row">
                    <strong>Due Date</strong>
                    <span>${dueDate}</span>
                  </div>

                  <div class="details-row">
                    <strong>Customer Code</strong>
                    <span>${order.customerCode || order.companyName || "-"}</span>
                  </div>

                  <div class="details-row">
                    <strong>Invoice Number</strong>
                    <span>${invoiceNumber}</span>
                  </div>
                </div>
              </div>

              <div class="section">
                <table>
                  <thead>
                    <th class="th-product" style="width:90px;">
                        Code
                      </th>

                      <th class="th-product">
                        Description
                      </th>

                      <th style="width:55px;">
                        Qty
                      </th>

                      <th style="width:70px;">
                        Price
                      </th>

                      <th style="width:55px;">
                        VAT %
                      </th>

                      <th style="width:75px;">
                        Net
                      </th>
                  </thead>

                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>

              <div class="summary-area">
                <div class="qty-box">
                  <div>Total Quantity&nbsp;&nbsp;&nbsp; ${totals.totalQuantity}</div>
                  <div>Total Lines&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${totals.totalLines}</div>
                </div>

                <div class="summary-box">
                  <div class="summary-row">
                    <div class="summary-label">Total Net</div>
                    <div class="summary-value">${money(totals.netTotal)}</div>
                  </div>

                  <div class="summary-row">
                    <div class="summary-label">Total VAT</div>
                    <div class="summary-value">${money(totals.vatTotal)}</div>
                  </div>

                  <div class="summary-row grand">
                    <div class="summary-label">TOTAL</div>
                    <div class="summary-value">${money(totals.grandTotal)}</div>
                  </div>

                  <div class="summary-row">
                    <div class="summary-label">Amount Paid</div>
                    <div class="summary-value">${money(0)}</div>
                  </div>

                  <div class="summary-row">
                    <div class="summary-label">Amount Due</div>
                    <div class="summary-value">${money(totals.grandTotal)}</div>
                  </div>
                </div>
              </div>

              <div class="payment-status">NOT PAID</div>

              <div class="deliver">
                <div class="box-title">Deliver To:</div>
               <div>${order.companyName || order.company_name || "-"}</div>
              <div>${order.branchName || order.branch_name || order.shopName || order.shop_name || ""}</div>
              <div>${order.deliveryAddress || order.delivery_address || order.address || ""}</div>
              <div>${order.postcode || order.post_code || order.branchPostcode || order.branch_postcode || ""}</div>
                            </div>
            </div>

            <div class="footer">
              ${COMPANY.registration} , VAT Registration Number ${COMPANY.vatNumber}<br />
              Registered Address ${COMPANY.registeredAddress}
              <div class="page-no">Page 1 of 1</div>
            </div>
          </div>

          <script>
            window.print();
          </script>
        </body>
      </html>
    `;

    const w = window.open("", "_blank");

    if (!w) {
      alert("Popup blocked. Please allow popups to print invoice.");
      return;
    }

    w.document.write(html);
    w.document.close();
  };

  

  /*
    ORDER FORM - NOT AN INVOICE
    --------------------------------------------------
    Used for Server Offer and Manager Offer.
    Same general layout as invoice, but:
    - No FairChoice header
    - No logo
    - No footer
    - No VAT column
    - No NOT PAID stamp
  */

    const printOrderForm = (order) => {
  const printableItems = getPrintableItems(order);


  const totals = getInvoiceTotals(order);

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleDateString()
    : new Date().toLocaleDateString();

  const rows = printableItems
    .map((item) => {
      const qty = getLineQty(item);
      const price = getLinePrice(item);
      const net = getLineTotal(item);
      const vatPercent = Number(item.vatPercent || item.vat_percent || 0);

     return `
          <tr>
            <td class="product-code">
              ${item.productCode || item.product_code || ""}
            </td>

            <td class="desc-col">
              ${item.name || item.productName || ""}
            </td>

            <td class="qty-col">
              ${qty.toFixed(2)}
            </td>

            <td class="price-col">
              ${price.toFixed(2)}
            </td>

            <td class="net-col">
              ${net.toFixed(2)}
            </td>
          </tr>
          `;
    })
    .join("");

  const html = `
    <html>
      <head>
        <title>Order Form - ${order.orderId}</title>

        <style>
          @page { size: A4; margin: 10mm; }

          body {
            font-family: Arial, sans-serif;
            font-size: 11px;
            color: #000;
            margin: 0;
          }

          .page {
            min-height: 277mm;
          }

          .main-title {
            text-align: center;
            font-size: 24px;
            font-weight: 900;
            margin-bottom: 2px;
          }

          .sub-title {
            text-align: center;
            font-size: 18px;
            font-weight: 900;
            margin-bottom: 20px;
          }

          .invoice-grid {
            display: grid;
            grid-template-columns: 1fr 210px;
            gap: 20px;
            align-items: start;
          }

          .box-title {
            font-weight: 700;
            margin-bottom: 5px;
          }

          .details-row {
            display: grid;
            grid-template-columns: 95px 1fr;
            margin-bottom: 4px;
          }

                @media print {
                  * {
                    -webkit-print-color-adjust: exact !important;
                    print-color-adjust: exact !important;
                  }
                }

                table {
                  width: 100%;
                  border-collapse: collapse;
                  margin-top: 18px;
                  table-layout: fixed;
                  font-size: 11px;
                }

                th {
                  background-color: #d9e2f3 !important;
                  color: #000 !important;
                  font-size: 11.5px;
                  font-weight: 700;
                  padding: 5px;
                  -webkit-print-color-adjust: exact !important;
                  print-color-adjust: exact !important;
                }

                thead,
                thead tr {
                  background-color: #d9e2f3 !important;
                }

                td {
                  border: none;
                  padding: 4px 5px;
                  font-size: 11px;
                }

              .th-code {
                width: 90px;
                
              }

              .th-desc {
                width: auto;
                
              }

             .th-qty,
            .qty-col {
              width: 55px;
              text-align: center;
             }

              .th-price,
                .price-col {
                  width: 70px;
                  text-align: center;
                }

                .th-vat,
                .vat-col {
                  width: 55px;
                  text-align: center;
                }

                            .th-net,
                .net-col {
                  width: 75px;
                  text-align: center;
                }

              .desc-col {
                font-size: 11px;
                font-weight: 400;
              }

              .product-code {
                 font-size: 11px;
                font-weight: 400;
              }
          .center {
            text-align: center;
          }

          .right {
            text-align: right;
          }

          .summary-area {
            margin-top: 16px;
            display: grid;
            grid-template-columns: 1fr 260px;
            gap: 20px;
            align-items: start;
          }

          .qty-box {
            margin-top: 28px;
            font-size: 13px;
            font-weight: 700;
            line-height: 1.8;
          }

          .summary-box {
            border: 1px solid #000;
          }

          .summary-row {
            display: grid;
            grid-template-columns: 1fr 100px;
            border-bottom: 1px solid #000;
          }

          .summary-row:last-child {
            border-bottom: none;
          }

          .summary-label,
          .summary-value {
            padding: 6px;
          }

          .summary-label {
            font-weight: 700;
          }

          .summary-value {
            text-align: right;
          }

          .grand {
            font-size: 14px;
            font-weight: 900;
          }

          .deliver {
            margin-top: 28px;
            line-height: 1.45;
          }
        </style>
      </head>

      <body>
        <div class="page">
          <div class="main-title">ORDER FORM</div>
          <div class="sub-title">NOT AN INVOICE</div>

          <div class="invoice-grid">
            <div>
              <div class="box-title">Customer:</div>
              <div>${order.companyName || order.company_name || "-"}</div>
              <div>${order.branchName || order.branch_name || order.shopName || order.shop_name || ""}</div>
              <div>${order.deliveryAddress || order.delivery_address || order.address || ""}</div>
              <div>${order.postcode || order.post_code || order.branchPostcode || order.branch_postcode || ""}</div>
            </div>

            <div>
              <div class="details-row">
                <strong>Order Date</strong>
                <span>${orderDate}</span>
              </div>

              <div class="details-row">
                <strong>Customer Code</strong>
                <span>${order.customerCode || order.companyName || "-"}</span>
              </div>

              <div class="details-row">
                <strong>Order Number</strong>
                <span>${order.orderId || "-"}</span>
              </div>
            </div>
          </div>

          <table>
          <thead>
            <tr>
              <th class="th-code">Code</th>
              <th class="th-desc">Description</th>
              <th class="th-qty">Qty</th>
              <th class="th-price">Price</th>
              <th class="th-net">Net</th>
            </tr>
          </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>

          <div class="summary-area">
            <div class="qty-box">
              <div>Total Quantity&nbsp;&nbsp;&nbsp; ${totals.totalQuantity}</div>
              <div>Total Lines&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${totals.totalLines}</div>
            </div>

            <div class="summary-box">
              <div class="summary-row grand">
                <div class="summary-label">TOTAL</div>
                <div class="summary-value">${money(totals.netTotal)}</div>
              </div>
            </div>
          </div>

          <div class="deliver">
            <div class="box-title">Deliver To:</div>
            <div>${order.companyName || "-"}</div>
            <div>${order.branchName || order.shopName || ""}</div>
            <div>${order.deliveryAddress || order.address || ""}</div>
            <div>${order.postcode || ""}</div>
          </div>
        </div>

        <script>
          window.print();
        </script>
      </body>
    </html>
  `;

  const w = window.open("", "_blank");

  if (!w) {
    alert("Popup blocked. Please allow popups to print order form.");
    return;
  }

  w.document.write(html);
  w.document.close();
};

  /*
    Delivery Note
    --------------------------------------------------
    Used by driver/customer delivery confirmation.
    No prices shown here.
  */
  const printDeliveryNote = (order) => {
  const items = getPrintableItems(order);

  const totalLines = items.length;

  const totalQty = items.reduce(
    (sum, item) => sum + Number(getLineQty(item) || 0),
    0
  );

  const rows = items
    .map(
      (item) => `
        <tr>
          <td>${item.name || item.productName || item.product_name || "-"}</td>
          <td style="text-align:center;">${getLineQty(item)}</td>
        </tr>
      `
    )
    .join("");

  const html = `
    <html>
      <head>
        <title>Delivery Note - ${order.orderId}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 24px;
            font-size: 14px;
            color: #000;
          }

          h1 {
            text-align: center;
            font-size: 22px;
            margin-bottom: 20px;
          }

          .info {
            margin-bottom: 16px;
            line-height: 1.7;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 18px;
            table-layout: fixed;
          }

          th {
            background: #e5e7eb;
            font-weight: 700;
          }

          th,
          td {
            border: 1px solid #000;
            padding: 4px 5px;
          }

          .totals {
            margin-top: 16px;
            font-weight: bold;
            line-height: 1.7;
          }

          .signatures {
            margin-top: 60px;
            display: flex;
            justify-content: space-between;
            gap: 40px;
          }

          .signature {
            flex: 1;
            border-top: 1px solid #000;
            padding-top: 8px;
            text-align: center;
          }
        </style>
      </head>

      <body>
        <h1>Delivery Note</h1>

        <div class="info">
          <div><strong>Company:</strong> ${order.companyName || "-"}</div>
          <div><strong>Order Number:</strong> ${order.orderId}</div>
          <div><strong>Driver:</strong> ${order.driverName || "-"}</div>
          <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th style="text-align:center;">Picked Qty</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="totals">
          <div>Total Lines: ${totalLines}</div>
          <div>Total Quantity: ${totalQty}</div>
        </div>

        <div class="signatures">
          <div class="signature">Driver Signature</div>
          <div class="signature">Customer Signature</div>
        </div>

        <script>
          window.print();
        </script>
      </body>
    </html>
  `;

  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    alert("Popup blocked. Please allow popups to print delivery note.");
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();
};
  /*
    Export supplier issue summary.
  */
  const exportSupplierIssues = () => {
    const supplierIssueItems = warehouseOrders.flatMap((order) =>
      order.items
        .filter((item) =>
          ["Need Supplier", "Cannot Supply"].includes(
            item.sourceStatus
          )
        )
        .map((item) => ({
          product: item.name,
          qty: getLineQty(item),
          status: item.sourceStatus,
        }))
    );

    if (supplierIssueItems.length === 0) {
      alert("No supplier issue items to export.");
      return;
    }

    const grouped = {};

    supplierIssueItems.forEach((item) => {
      const key = item.product;

      if (!grouped[key]) {
        grouped[key] = {
          Product: item.product,
          Qty: 0,
          Status: item.status,
        };
      }

      grouped[key].Qty += item.qty;
    });

    const exportData = Object.values(grouped);
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Supplier Summary");
    XLSX.writeFile(workbook, "supplier-issues-summary.xlsx");
  };

  /*
    Assign driver to order.
  */
 const assignDriver = async (order, driverName) => {
  const orderId = getOrderId(order);

  setAssignedDrivers((prev) => ({
    ...prev,
    [orderId]: driverName,
  }));

 await updateOrderExtraFields(orderId, {
    driver_name: driverName,
  });
};

const updateWarehouseItem = async (order, item, changes) => {
  if (
    !requirePermission(
      loggedInUser,
      "can_move_to_warehouse",
      "You cannot update warehouse order status."
    )
  ) {
    return;
  }

  await updateOrderItem(order.orderId, item.dbId, changes);
  await logAction({
    user: loggedInUser,
    action_type: "Status changed",
    page_module: "Warehouse",
    order_id: order.orderId,
    product_id: item.productId || item.id,
    old_value: item.sourceStatus || "In Stock",
    new_value: changes,
  });
};

const printProtectedOrderForm = async (order) => {
  if (!requirePermission(loggedInUser, "can_print", "You cannot print orders.")) return;

  printOrderForm(order);
  await logAction({
    user: loggedInUser,
    action_type: "Printed picking list",
    page_module: "Warehouse",
    order_id: order.orderId,
    old_value: null,
    new_value: "Order Form",
  });
};

const printProtectedInvoice = async (order) => {
  if (!requirePermission(loggedInUser, "can_print", "You cannot print orders.")) return;

  printInvoice(order);
  await logAction({
    user: loggedInUser,
    action_type: "Printed picking list",
    page_module: "Warehouse",
    order_id: order.orderId,
    old_value: null,
    new_value: "Invoice",
  });
};

const printProtectedDeliveryNote = async (order) => {
  if (!requirePermission(loggedInUser, "can_print", "You cannot print delivery notes.")) return;

  printDeliveryNote(order);
  await logAction({
    user: loggedInUser,
    action_type: "Printed delivery note",
    page_module: "Warehouse",
    order_id: order.orderId,
    old_value: null,
    new_value: "Delivery Note",
  });
};

const backToReceived = async (order) => {
  if (
    !requirePermission(
      loggedInUser,
      "can_move_to_warehouse",
      "You cannot move warehouse orders."
    )
  ) {
    return;
  }

  await changeOrderStatus(order.orderId, "Received");
  await logAction({
    user: loggedInUser,
    action_type: "Back to received",
    page_module: "Warehouse",
    order_id: order.orderId,
    old_value: order.status,
    new_value: "Received",
  });
};

const confirmForDriver = async (order) => {
  if (
    !requirePermission(
      loggedInUser,
      "can_move_to_warehouse",
      "You cannot confirm orders for driver."
    )
  ) {
    return;
  }

  const orderId = order.orderId || order.order_number;

  const driverName =
    assignedDrivers[orderId] ||
    order.driverName ||
    order.driver_name;

  if (!driverName) {
    alert("Please assign a driver first.");
    return;
  }

  await updateOrderExtraFields(orderId, {
    driver_name: driverName,
  });

  await changeOrderStatus(orderId, "Ready For Driver");
  await logAction({
    user: loggedInUser,
    action_type: "Confirmed for driver",
    page_module: "Warehouse",
    order_id: orderId,
    old_value: order.status,
    new_value: "Ready For Driver",
  });
};

  const renderWarehouseCard = (order) => {
    const orderId = getOrderId(order);
    const pickingQty = getPrintableItems(order).reduce(
      (sum, item) => sum + getLineQty(item),
      0
    );
    const orderValue = Number(
      order.finalTotal ||
        order.final_total ||
        order.total ||
        order.orderTotal ||
        order.order_total ||
        0
    );
    const isReadyForDriver = order.status === "Ready For Driver";

    return (
      <div key={orderId} className="bg-white border rounded-2xl p-3">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h3 className="font-bold text-base">
              {orderId} | {order.companyName || order.company_name || "No company"}
            </h3>
            <p className="text-sm font-semibold text-slate-700">
              {pickingQty} Items | {money(orderValue)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <button
              onClick={() => toggleExpanded(orderId)}
              className={`bg-blue-600 text-white ${btn}`}
            >
              {expandedOrders[orderId] ? "Hide" : "View Order"}
            </button>

            {hasPermission(loggedInUser, "can_print") && (
              <button
                onClick={() => printPickingList(order)}
                className={`bg-black text-white ${btn}`}
              >
                Picking List
              </button>
            )}

            {hasPermission(loggedInUser, "can_print") && (
              <button
                onClick={() => printProtectedDeliveryNote(order)}
                className={`bg-slate-800 text-white ${btn}`}
              >
                Delivery Note
              </button>
            )}

            <select
              value={assignedDrivers[orderId] ?? getDriverName(order) ?? ""}
              onChange={(e) => assignDriver(order, e.target.value)}
              className="border rounded-lg px-3 py-1.5 text-xs font-semibold"
              disabled={isReadyForDriver}
            >
              <option value="">Assign Driver</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.username}>
                  {driver.username}
                </option>
              ))}
            </select>

            {!isReadyForDriver && hasPermission(loggedInUser, "can_move_to_warehouse") && (
              <button
                onClick={() => confirmForDriver(order)}
                className={`bg-green-700 text-white ${btn}`}
              >
                Ready For Driver
              </button>
            )}
          </div>
        </div>

        {expandedOrders[orderId] && (
          <div className="mt-3 space-y-3">
            <div className="hidden md:grid grid-cols-[1fr_70px_140px_170px] border-b font-bold text-xs text-slate-600 px-3 py-2">
              <div>Product</div>
              <div className="text-center">Qty</div>
              <div className="text-center">Status</div>
              <div className="text-right">Action</div>
            </div>

            {order.items.map((item) => {
              const sourceStatus = item.sourceStatus || "In Stock";
              const isInStock = sourceStatus === "In Stock";
              const isCannotSupply = sourceStatus === "Cannot Supply";
              const needsSupplier = !isInStock && !isCannotSupply;

              return (
                <div
                  key={item.id}
                  className={`grid grid-cols-1 md:grid-cols-[1fr_70px_140px_170px] gap-2 md:gap-0 items-center border rounded-lg px-3 py-2 text-sm ${
                    item.includeInPicking === false ? "opacity-50 bg-slate-50" : ""
                  }`}
                >
                  <div className="font-medium truncate pr-3">{item.name}</div>

                  <div className="text-center font-semibold">
                    {getLineQty(item)}
                  </div>

                  <div
                    className={`text-center font-semibold ${
                      isCannotSupply
                        ? "text-red-600"
                        : needsSupplier
                        ? "text-amber-600"
                        : "text-green-700"
                    }`}
                  >
                    {sourceStatus === "Need Supplier" ? "Pre-Order" : sourceStatus}
                  </div>

                  <div className="text-right">
                    {!isReadyForDriver &&
                      hasPermission(loggedInUser, "can_move_to_warehouse") && (
                        <>
                          {isCannotSupply ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm("Mark this item as Available?")) return;

                                updateWarehouseItem(order, item, {
                                  sourceStatus: "In Stock",
                                  includeInPicking: true,
                                  pickedQty: Number(item.qty || 0),
                                });
                              }}
                              className={`bg-green-600 text-white ${btn}`}
                            >
                              Available
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (!window.confirm("Mark this item as Cannot Supply?")) return;

                                updateWarehouseItem(order, item, {
                                  sourceStatus: "Cannot Supply",
                                  includeInPicking: false,
                                  pickedQty: 0,
                                });
                              }}
                              className={`bg-red-600 text-white ${btn}`}
                            >
                              Cannot Supply
                            </button>
                          )}
                        </>
                      )}
                  </div>
                </div>
              );
            })}

            {!isReadyForDriver && hasPermission(loggedInUser, "can_move_to_warehouse") && (
              <div className="border-t pt-3 flex justify-end">
                <button
                  onClick={() => backToReceived(order)}
                  className={`bg-slate-500 text-white ${btn}`}
                >
                  Back To Received
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const warehousePackingOrders = warehouseOrders.filter(
    (order) => order.status === "Warehouse Packing"
  );
  const readyForDriverOrders = warehouseOrders.filter(
    (order) => order.status === "Ready For Driver"
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <h2 className="text-xl font-bold">Warehouse</h2>

        <div className="flex flex-wrap gap-2">
          {[
            ["All", `All (${allWarehouseCount})`],
            ["Warehouse Packing", `Warehouse Packing (${warehousePackingCount})`],
            ["Ready For Driver", `Ready For Driver (${readyForDriverCount})`],
          ].map(([status, label]) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                statusFilter === status
                  ? "bg-blue-700 text-white"
                  : "bg-white border text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border rounded-2xl p-3">
        <label className="block text-xs font-bold text-slate-500 mb-1">
          Search
        </label>
        <input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Order number or customer name"
          className="w-full border rounded-xl px-3 py-2 text-sm"
        />
      </div>

      {warehouseOrders.length === 0 && (
        <div className="bg-slate-50 border rounded-2xl p-4 text-sm">
          No warehouse orders.
        </div>
      )}

      {(statusFilter === "All" || statusFilter === "Warehouse Packing") &&
        warehousePackingOrders.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-700">
              Warehouse Packing
            </h3>
            {warehousePackingOrders.map(renderWarehouseCard)}
          </section>
        )}

      {(statusFilter === "All" || statusFilter === "Ready For Driver") &&
        readyForDriverOrders.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-extrabold text-slate-700">
              Ready For Driver
            </h3>
            {readyForDriverOrders.map(renderWarehouseCard)}
          </section>
        )}
    </div>
  );
}

