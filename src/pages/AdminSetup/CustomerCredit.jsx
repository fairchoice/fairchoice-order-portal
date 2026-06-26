import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";

export default function CustomerCredit() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [statementRows, setStatementRows] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [showDeliveredOrders, setShowDeliveredOrders] = useState(true);
  const [deliveredOrdersPage, setDeliveredOrdersPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedBranch, setSelectedBranch] = useState("All Branches");
  const [activeTab, setActiveTab] = useState("summary");

  const [editOpeningBalance, setEditOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");

  const isAdmin = true;

function formatCollectionSource(source) {
  if (!source) return "";

  const labels = {
    DRIVER_DELIVERY_COLLECTION: "Driver Delivery",
    DRIVER_PREVIOUS_BALANCE: "Driver Previous Balance",
    SALES_REP_PREVIOUS_BALANCE: "Sales Rep Previous Balance",
    OFFICE_COLLECTION: "Office Collection",
  };

  return labels[source] || source.replaceAll("_", " ");
}

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (selectedCustomer) {
      loadStatement(selectedCustomer);
    }
  }, [selectedCustomer, customers]);

  useEffect(() => {
    setDeliveredOrdersPage(1);
    setHistoryPage(1);
  }, [selectedCustomer, selectedBranch]);

      const loadCustomers = async () => {
        const { data, error } = await supabase
          .from("customer_accounts")
          .select("*")
          .order("account_name");

        if (error) {
          alert("Could not load customers.");
          return;
        }

        setCustomers(data || []);

        if (data?.length && !selectedCustomer) {
          setSelectedCustomer(data[0].account_name);
        }
      };

      const isDeliveredOrderStatus = (status) =>
        ["delivered", "delivery confirmed", "completed"].includes(
          String(status || "").trim().toLowerCase()
        );

      const mapDeliveredOrder = (order) => ({
        dbId: order.id,
        orderId: order.order_number,
        customerName: order.company_name,
        companyName: order.company_name,
        branchName:
          order.delivery_branch_name ||
          order.branch_name ||
          order.branchName ||
          order.shop_name ||
          order.shopName ||
          "",
        deliveryAddress:
          order.delivery_address || order.delivery_postcode || order.postcode || "",
        priceMode: order.price_mode || "vat",
        createdAt: order.created_at,
        status: order.status,
        items: (order.order_items || []).map((item) => ({
          dbId: item.id,
          id: item.product_id,
          productCode: item.product_code || item.code || "",
          product_code: item.product_code || item.code || "",
          name: item.product_name,
          productName: item.product_name,
          qty: Number(item.qty || item.quantity || 0),
          quantity: Number(item.quantity || item.qty || 0),
          selectedPrice: Number(item.price || item.unit_price || 0),
          price: Number(item.price || item.unit_price || 0),
          unit_price: Number(item.unit_price || item.price || 0),
          lineTotal: Number(item.line_total || item.lineTotal || 0),
          line_total: Number(item.line_total || item.lineTotal || 0),
          vatRate: Number(item.vat_percent || item.vatPercent || 20),
          vat_percent: Number(item.vat_percent || item.vatPercent || 20),
          vatTotal: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
          vat_total: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
          sourceStatus: item.source_status || item.status || "In Stock",
          source_status: item.source_status || item.status || "In Stock",
          pickedQty: Number(item.picked_qty || item.qty || item.quantity || 0),
          includeInPicking: item.include_in_picking !== false,
          include_in_picking: item.include_in_picking !== false,
        })),
      });

      const loadDeliveredOrders = async (customer) => {
        if (!customer?.account_name) {
          setDeliveredOrders([]);
          return;
        }

        const { data, error } = await supabase
          .from("orders")
          .select("*, order_items(*)")
          .or(
            `customer_account_id.eq.${customer.id},company_name.eq.${customer.account_name}`
          )
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          console.error("Could not load delivered customer orders:", error);
          setDeliveredOrders([]);
          return;
        }

        setDeliveredOrders(
          (data || [])
            .filter((order) => isDeliveredOrderStatus(order.status))
            .map(mapDeliveredOrder)
        );
      };
     
      const loadStatement = async (customerName) => {
  const customer = customers.find(
    (c) => c.account_name === customerName
  );

  const { data: balanceRow } = await supabase
    .from("customer_opening_balances")
    .select("*")
    .eq("customer_name", customerName)
    .maybeSingle();

  setOpeningBalance(Number(balanceRow?.opening_balance || 0));

  const { data, error } = await supabase
    .from("customer_ledger")
    .select("*")
    .eq("customer_name", customerName)
    .order("created_at", { ascending: true });

  if (error) {
    alert("Could not load customer statement.");
    return;
  }

  setStatementRows(data || []);
  await loadDeliveredOrders(customer);
};
       
  const saveOpeningBalance = async () => {
    if (!selectedCustomer) {
      alert("Please select a customer first.");
      return;
    }

    const { error } = await supabase
      .from("customer_opening_balances")
      .update({
        opening_balance: Number(openingBalanceInput || 0),
      })
      .eq("customer_name", selectedCustomer);

    if (error) {
      alert("Opening balance update failed: " + error.message);
      return;
    }

    setOpeningBalance(Number(openingBalanceInput || 0));
    setEditOpeningBalance(false);
    await loadCustomers();

    alert("Opening balance updated.");
  };

  const printStatement = () => {
    const statement = document.getElementById("statement-print");

    if (!statement) {
      alert("Statement section not found.");
      return;
    }

    const printContents = statement.innerHTML;
    const originalContents = document.body.innerHTML;

    document.body.innerHTML = `
      <div style="padding:20px">
        ${printContents}
      </div>
    `;

    window.print();

    document.body.innerHTML = originalContents;
    window.location.reload();
  };

  const getStatus = (row, balance) => {
    if (row.entry_type === "PAYMENT") return "Payment Received";

    if (row.entry_type === "INVOICE") {
      if (balance <= 0) return "Paid Invoice";
      if (balance < Number(row.debit || 0)) return "Part Paid Invoice";
      return "Unpaid Invoice";
    }

    return "";
  };

  const escapeDocumentText = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const formatDocumentDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
  };

  const getDocumentTitle = (documentType) => {
    if (documentType === "deliveryNote") return "Delivery Note";
    if (documentType === "orderForm") return "Order Form";
    return "Sales Invoice";
  };

  const openOrderDocument = (order, documentType) => {
    const priceMode = order.priceMode || order.price_mode || "";
    const totals = calculateOrderTotals(order.items || [], { priceMode });
    const title = getDocumentTitle(documentType);
    const showPrices = documentType !== "deliveryNote";
    const orderNumber = order.orderId || order.order_number || order.id || "-";
    const customerName = order.companyName || order.customerName || selectedCustomer || "-";
    const branchName = order.branchName || order.branch_name || "";
    const address = order.deliveryAddress || order.delivery_address || "";

    const rows = totals.invoiceItems
      .map((item) => {
        const qty = getOrderItemQty(item);
        const unitPrice = getOrderItemUnitPrice(item);
        const netTotal = getOrderItemNetTotal(item);
        const vatTotal = getOrderItemVatTotal(item);
        const vatRate = Number(item.vatRate ?? item.vat_percent ?? item.vatPercent ?? 20);

        return `
          <tr>
            <td>${escapeDocumentText(item.productCode || item.product_code || "")}</td>
            <td>${escapeDocumentText(item.name || item.productName || item.product_name || "")}</td>
            <td class="right">${qty}</td>
            ${
              showPrices
                ? `
                  <td class="right">${formatCurrency(unitPrice)}</td>
                  <td class="right">${vatRate.toFixed(2)}</td>
                  <td class="right">${formatCurrency(netTotal)}</td>
                  <td class="right">${formatCurrency(vatTotal)}</td>
                `
                : ""
            }
          </tr>
        `;
      })
      .join("");

    const html = `
      <html>
        <head>
          <title>${escapeDocumentText(title)} ${escapeDocumentText(orderNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 28px; color: #111827; }
            h1 { margin: 0 0 8px; text-transform: uppercase; }
            .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0; }
            .box { border: 1px solid #111827; padding: 10px; min-height: 72px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
            th { background: #e5edf8; text-align: left; }
            th, td { border-bottom: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
            .right { text-align: right; }
            .totals { margin-left: auto; margin-top: 18px; width: 280px; border: 1px solid #111827; }
            .totals div { display: flex; justify-content: space-between; padding: 7px 9px; border-bottom: 1px solid #111827; }
            .totals div:last-child { border-bottom: 0; font-weight: 800; }
            .muted { color: #4b5563; font-size: 12px; }
            @media print { body { padding: 18px; } }
          </style>
        </head>
        <body>
          <h1>${escapeDocumentText(title)}</h1>
          <div class="muted">Fair Choice Cash and Carry Ltd</div>

          <div class="meta">
            <div class="box">
              <b>${escapeDocumentText(documentType === "deliveryNote" ? "Deliver To" : "Customer")}</b><br />
              ${escapeDocumentText(customerName)}<br />
              ${branchName ? `${escapeDocumentText(branchName)}<br />` : ""}
              ${escapeDocumentText(address)}
            </div>
            <div class="box">
              <b>Order Number:</b> ${escapeDocumentText(orderNumber)}<br />
              <b>Date:</b> ${escapeDocumentText(formatDocumentDate(order.createdAt || order.created_at))}<br />
              <b>Price Mode:</b> ${escapeDocumentText(String(priceMode || "-").toUpperCase())}<br />
              <b>Total Qty:</b> ${totals.totalQty}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th class="right">Qty</th>
                ${
                  showPrices
                    ? `
                      <th class="right">Price</th>
                      <th class="right">VAT %</th>
                      <th class="right">Net</th>
                      <th class="right">VAT</th>
                    `
                    : ""
                }
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="${showPrices ? 7 : 3}">No supplied items.</td></tr>`}
            </tbody>
          </table>

          ${
            showPrices
              ? `
                <div class="totals">
                  <div><span>Total Net</span><strong>${formatCurrency(totals.netTotal)}</strong></div>
                  <div><span>Total VAT</span><strong>${formatCurrency(totals.vatTotal)}</strong></div>
                  <div><span>Total</span><strong>${formatCurrency(totals.totalAmount)}</strong></div>
                </div>
              `
              : `
                <div class="totals">
                  <div><span>Total Lines</span><strong>${totals.totalLines}</strong></div>
                  <div><span>Total Qty</span><strong>${totals.totalQty}</strong></div>
                </div>
              `
          }

          <script>window.print();</script>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      alert("Popup blocked. Please allow popups to download the document.");
      return;
    }

    win.document.write(html);
    win.document.close();
  };

  const downloadInvoice = async (referenceNo) => {
    const order = deliveredOrders.find((item) => item.orderId === referenceNo);
    if (order) {
      openOrderDocument(order, "invoice");
      return;
    }

    alert("Delivered order document not found for this invoice.");
  };

  let runningBalance = Number(openingBalance || 0);

  const branches = [
    ...new Set(statementRows.map((row) => row.branch_name).filter(Boolean)),
  ];

  const totalOutstanding =
    Number(openingBalance || 0) +
    statementRows.reduce((total, row) => {
      if (row.entry_type === "INVOICE") {
        return total + Number(row.debit || 0);
      }

      if (row.entry_type === "PAYMENT") {
        return total - Number(row.credit || 0);
      }

      return total;
    }, 0);

  const filteredRows =
    selectedBranch === "All Branches"
      ? statementRows
      : statementRows.filter((row) => row.branch_name === selectedBranch);

  const filteredDeliveredOrders =
    selectedBranch === "All Branches"
      ? deliveredOrders
      : deliveredOrders.filter((order) => order.branchName === selectedBranch);

  const deliveredOrdersPageCount = Math.max(
    1,
    Math.ceil(filteredDeliveredOrders.length / DELIVERED_ORDERS_PAGE_SIZE)
  );
  const currentDeliveredOrdersPage = Math.min(
    deliveredOrdersPage,
    deliveredOrdersPageCount
  );
  const paginatedDeliveredOrders = filteredDeliveredOrders.slice(
    (currentDeliveredOrdersPage - 1) * DELIVERED_ORDERS_PAGE_SIZE,
    currentDeliveredOrdersPage * DELIVERED_ORDERS_PAGE_SIZE
  );

  let calculatedHistoryBalance = Number(openingBalance || 0);
  const historyRowsWithBalance = filteredRows.map((row) => {
    const debit = Number(row.debit || 0);
    const credit = Number(row.credit || 0);
    calculatedHistoryBalance += debit - credit;

    return {
      row,
      debit,
      credit,
      balance: calculatedHistoryBalance,
    };
  });
  const historyPageCount = Math.max(
    1,
    Math.ceil(historyRowsWithBalance.length / HISTORY_PAGE_SIZE)
  );
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const paginatedHistoryRows = historyRowsWithBalance.slice(
    (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
    currentHistoryPage * HISTORY_PAGE_SIZE
  );

  const selectedCustomerAccount = customers.find(
    (customer) => customer.account_name === selectedCustomer
  );
  const creditLimit = Number(selectedCustomerAccount?.credit_limit || 0);
  const availableCredit = creditLimit - totalOutstanding;
  const transactionRows = filteredRows.filter((row) => row.entry_type === "PAYMENT");

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h2 className="text-2xl font-bold">Customer Credit</h2>

        <button
          onClick={printStatement}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          Print / Save PDF
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-4 space-y-3">
        <label className="block text-sm font-bold">Customer</label>

        <div className="flex flex-col md:flex-row gap-2">
          <select
            value={selectedCustomer}
            onChange={(e) => {
              setSelectedCustomer(e.target.value);
              setEditOpeningBalance(false);
            }}
            className="border rounded-xl p-3 flex-1"
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.account_name}>
                {customer.account_name}
              </option>
            ))}
          </select>

          {isAdmin && (
            <button
              onClick={() => {
                setOpeningBalanceInput(openingBalance);
                setEditOpeningBalance(true);
              }}
              disabled={!selectedCustomer}
              className="bg-green-600 text-white px-4 py-3 rounded-xl font-bold disabled:bg-slate-300"
            >
              Edit Opening Balance
            </button>
          )}
        </div>

        {branches.length > 1 && (
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="border rounded-xl p-3 w-full"
          >
            <option value="All Branches">All Branches</option>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
        )}

        {editOpeningBalance && (
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="number"
              step="0.01"
              value={openingBalanceInput}
              onChange={(e) => setOpeningBalanceInput(e.target.value)}
              className="border rounded-xl p-3 flex-1"
              placeholder="Opening Balance"
            />

            <button
              onClick={saveOpeningBalance}
              className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
            >
              Save
            </button>

            <button
              onClick={() => setEditOpeningBalance(false)}
              className="bg-slate-500 text-white px-5 py-3 rounded-xl font-bold"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
    {[
  ["summary", "Summary"],
  ["history", "Credit History"],
  ["deliveredOrders", "Delivered Orders"],
  ["transactions", "Transactions"],
].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold ${
              activeTab === key
                ? "bg-blue-700 text-white"
                : "bg-slate-100 text-slate-700 border"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Outstanding Balance</div>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(totalOutstanding)}
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Credit Limit</div>
            <div className="text-2xl font-bold">{formatCurrency(creditLimit)}</div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Available Credit</div>
            <div className="text-2xl font-bold text-green-700">
              {formatCurrency(availableCredit)}
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          {filteredDeliveredOrders.length > 0 && (
            <div className="border rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h3 className="font-bold text-lg">Delivered Orders</h3>

                <button
                  type="button"
                  onClick={() => setShowDeliveredOrders((value) => !value)}
                  className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-bold"
                >
                  {showDeliveredOrders ? "Hide" : "View"}
                </button>
              </div>

              {showDeliveredOrders && (
                <div className="space-y-2">
                {paginatedDeliveredOrders.map((order) => {
                  const orderTotals = calculateOrderTotals(order.items || [], {
                    priceMode: order.priceMode || order.price_mode,
                  });

                  return (
                    <div
                      key={order.dbId || order.orderId}
                      className="border rounded-xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold">
                          {order.orderId || "-"}
                          {order.branchName ? ` | ${order.branchName}` : ""}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDocumentDate(order.createdAt || order.created_at)} |{" "}
                          {String(order.priceMode || "-").toUpperCase()} |{" "}
                          {formatCurrency(orderTotals.totalAmount)} | Total Qty:{" "}
                          {orderTotals.totalQty}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openOrderDocument(order, "invoice")}
                          className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          Download Invoice
                        </button>
                        <button
                          type="button"
                          onClick={() => openOrderDocument(order, "orderForm")}
                          className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          Download Order Form
                        </button>
                        <button
                          type="button"
                          onClick={() => openOrderDocument(order, "deliveryNote")}
                          className="bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          Download Delivery Note
                        </button>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}

              {showDeliveredOrders && deliveredOrdersPageCount > 1 && (
                <div className="flex items-center justify-end gap-2 mt-3 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveredOrdersPage((page) => Math.max(1, page - 1))
                    }
                    disabled={currentDeliveredOrdersPage === 1}
                    className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="font-bold">
                    Page {currentDeliveredOrdersPage} / {deliveredOrdersPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveredOrdersPage((page) =>
                        Math.min(deliveredOrdersPageCount, page + 1)
                      )
                    }
                    disabled={currentDeliveredOrdersPage === deliveredOrdersPageCount}
                    className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === "deliveredOrders" && (
  <div className="space-y-4">
    {filteredDeliveredOrders.length > 0 ? (
      <div className="border rounded-2xl bg-white p-4">
        {/* paste existing Delivered Orders block content here */}
      </div>
    ) : (
      <div className="border rounded-2xl bg-white p-5 text-center text-slate-500">
        No delivered orders found for this customer.
      </div>
    )}
  </div>
)}

          <div id="statement-print" className="overflow-auto border rounded-2xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Reference</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Credit</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>

              <tbody>
                {currentHistoryPage === 1 && (
                  <tr className="border-t bg-blue-50">
                    <td className="p-3">-</td>
                    <td className="p-3">Opening Balance</td>
                    <td className="p-3">Opening Balance</td>
                    <td className="p-3 text-right">{formatCurrency(openingBalance)}</td>
                    <td className="p-3 text-right">-</td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(openingBalance)}
                    </td>
                  </tr>
                )}

                {paginatedHistoryRows.map(({ row, debit, credit, balance }) => {
                  const description =
                    row.entry_type === "INVOICE"
                      ? "Invoice"
                      : row.entry_type === "PAYMENT"
                      ? `Payment${row.payment_type ? ` - ${row.payment_type}` : ""}`
                      : row.entry_type || "Transaction";

                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="p-3">{row.reference_no || "-"}</td>
                      <td className="p-3">{description}</td>
                      <td className="p-3 text-right">{debit ? formatCurrency(debit) : "-"}</td>
                      <td className="p-3 text-right">{credit ? formatCurrency(credit) : "-"}</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(balance)}</td>
                    </tr>
                  );
                })}

                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-5 text-center text-slate-500">
                      No credit history found for this customer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {historyPageCount > 1 && (
              <div className="flex items-center justify-end gap-2 p-3 text-sm border-t">
                <button
                  type="button"
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  disabled={currentHistoryPage === 1}
                  className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-bold">
                  Page {currentHistoryPage} / {historyPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryPage((page) => Math.min(historyPageCount, page + 1))
                  }
                  disabled={currentHistoryPage === historyPageCount}
                  className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "transactions" && (
        <div className="overflow-auto border rounded-2xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Entered By</th>
              </tr>
            </thead>

            <tbody>
              {transactionRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="p-3">{formatCollectionSource(row.collection_source) || row.payment_type || "Payment"}</td>
                  <td className="p-3">{row.reference_no || "-"}</td>
                  <td className="p-3 text-right font-bold text-green-700">
                    {formatCurrency(row.credit)}
                  </td>
                  <td className="p-3">{row.received_by || row.collected_by_name || row.paid_by || "-"}</td>
                </tr>
              ))}

              {transactionRows.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-5 text-center text-slate-500">
                    No transactions found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
