import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../services/supabase";

export default function Warehouse({
  orders = [],
  changeOrderStatus,
  updateOrderItem,
  updateOrderExtraFields,
}) {
  const [drivers, setDrivers] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  const fetchDrivers = async () => {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("active", true)
      .order("name");

    if (error) {
      console.error("Driver load error:", error);
      return;
    }

    setDrivers(data || []);
  };

  useEffect(() => {
    setStartDate("");
    setEndDate("");
    fetchDrivers();
  }, []);

  const warehouseOrders = useMemo(() => {
    return orders.filter((order) => {
      const correctStatus = order.status === "Warehouse Packing";
      if (!correctStatus) return false;

      if (!startDate && !endDate) return true;

      const orderDate = new Date(order.createdAt);

      if (startDate && orderDate < new Date(startDate)) return false;

      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (orderDate > end) return false;
      }

      return true;
    });
  }, [orders, startDate, endDate]);

  const toggleExpanded = (orderId) => {
    setExpandedOrders((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const printDeliveryNote = (order) => {
    const rows = order.items
      .filter((item) => item.includeInPicking !== false)
      .map(
        (item) => `
          <tr>
            <td>${item.name}</td>
            <td style="text-align:center;">${item.pickedQty ?? item.qty}</td>
          </tr>
        `
      )
      .join("");

    const html = `
      <html>
        <head>
          <title>Delivery Note - ${order.orderId}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; font-size: 14px; color: #000; }
            h1 { text-align: center; font-size: 22px; margin-bottom: 20px; }
            .info { margin-bottom: 16px; line-height: 1.7; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #000; padding: 8px; text-align: left; }
            th { background: #f1f5f9; }
            .signature { margin-top: 50px; border-top: 1px solid #000; padding-top: 8px; width: 45%; }
            .signatures { display: flex; justify-content: space-between; gap: 30px; margin-top: 60px; }
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
            <tbody>${rows}</tbody>
          </table>

          <div class="signatures">
            <div class="signature">Driver Signature</div>
            <div class="signature">Customer Signature</div>
          </div>

          <script>window.print();</script>
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

  const exportSupplierIssues = () => {
  const supplierIssueItems = warehouseOrders.flatMap((order) =>
    order.items
      .filter((item) =>
        ["Different Supplier", "Need Supplier", "Cannot Supply"].includes(
          item.sourceStatus
        )
      )
      .map((item) => ({
        product: item.name,
        qty: Number(item.pickedQty ?? item.qty ?? 0),
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
  const assignDriver = async (order, driverName) => {
    await updateOrderExtraFields(order.orderId, {
      driver_name: driverName,
    });
  };

  return (
    <div className="p-4">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold">Warehouse</h2>
          <p className="text-xs text-slate-500">
            Pack orders, print delivery note, assign driver, then confirm for driver.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-end">
          <button
            type="button"
            onClick={() => {
              setStartDate("");
              setEndDate("");
            }}
            className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
          >
            Clear Filters
          </button>

          <div>
            <label className="text-xs font-bold">Start Date</label>
            <input
              type="date"
              className="block border rounded-lg px-2 py-1.5 text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-bold">End Date</label>
            <input
              type="date"
              className="block border rounded-lg px-2 py-1.5 text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <button
            onClick={exportSupplierIssues}
            className={`bg-orange-600 text-white ${btn}`}
          >
            Export Supplier Issues
          </button>
        </div>
      </div>

      {warehouseOrders.length === 0 && (
        <div className="bg-slate-50 border rounded-2xl p-4 text-sm">
          No warehouse orders.
        </div>
      )}

      <div className="space-y-3">
        {warehouseOrders.map((order) => (
  <div key={order.orderId} className="bg-white border rounded-2xl p-3">
    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
      <div>
              <h3 className="font-bold text-lg">
            {order.orderId} | {order.companyName}
            <span className="ml-3 text-green-600 font-extrabold">
              | {order.status}
            </span>
          </h3>
            <p className="text-xs text-slate-500 mt-1">
            {order.createdAt} | {String(order.priceMode).toUpperCase()} |{" "}
            {order.items.length} Items | Picking:{" "}
            {order.items.reduce(
              (sum, item) => sum + Number(item.pickedQty ?? item.qty),
              0
            )}{" "}
            | £{Number(order.total || 0).toFixed(2)}
          </p>
      </div>

      <div className="flex flex-wrap gap-2 items-start">
        <button
          onClick={() => toggleExpanded(order.orderId)}
          className={`bg-blue-600 text-white ${btn}`}
        >
          {expandedOrders[order.orderId] ? "Hide" : "View"}
        </button>
      </div>
    </div>

            {expandedOrders[order.orderId] && (
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
                        item.includeInPicking === false
                          ? "opacity-50 bg-slate-50"
                          : ""
                      }`}
                    >
                      <div className="font-medium truncate pr-3">{item.name}</div>

                      <div className="text-center font-semibold">
                        {item.pickedQty ?? item.qty}
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
                        {sourceStatus}
                      </div>

                      <div className="flex justify-end gap-2">
                        {isInStock && (
                          <button
                            type="button"
                            onClick={() =>
                              updateOrderItem(order.orderId, item.id, {
                                sourceStatus: "Cannot Supply",
                                includeInPicking: false,
                              })
                            }
                            className={`bg-red-600 text-white ${btn}`}
                          >
                            Remove
                          </button>
                        )}

                        {!isInStock && (
                          <button
                            type="button"
                            onClick={() =>
                              updateOrderItem(order.orderId, item.id, {
                                sourceStatus: "In Stock",
                                includeInPicking: true,
                              })
                            }
                            className={`bg-green-600 text-white ${btn}`}
                          >
                            Available
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="border-t pt-3 flex flex-col md:flex-row md:items-center md:justify-end gap-2">
                  <button
                    onClick={() => printDeliveryNote(order)}
                    className={`bg-slate-800 text-white ${btn}`}
                  >
                    Print Delivery Note
                  </button>

                  <button
                    onClick={() => changeOrderStatus(order.orderId, "Received")}
                    className={`bg-slate-500 text-white ${btn}`}
                  >
                    Back To Received
                  </button>

                  <select
                    value={order.driverName || ""}
                    onChange={(e) => assignDriver(order, e.target.value)}
                    className="border rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="">Assign Driver</option>
                    {drivers.map((driver) => (
                      <option key={driver.id} value={driver.name}>
                        {driver.name}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => {
                      if (!order.driverName) {
                        alert("Please assign a driver first.");
                        return;
                      }

                      changeOrderStatus(order.orderId, "Ready For Driver");
                    }}
                    className={`bg-green-700 text-white ${btn}`}
                  >
                    Confirm For Driver
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}