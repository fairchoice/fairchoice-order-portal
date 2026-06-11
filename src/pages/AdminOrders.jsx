import { useState } from "react";

export default function AdminOrders({
  orders = [],
  expandedOrders = {},
  toggleOrderExpanded = () => {},
  printPickingList = () => {},
  updateOrderItem = () => {},
  changeOrderStatus = () => {},
} = {}) {
  
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  const [showArchive, setShowArchive] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");

  const receivedOrders = orders.filter(
    (order) => order.status === "Received" || order.status === "In Progress"
  );

  const archiveOrders = orders.filter((order) => order.status === "Archived");

  let visibleOrders = showArchive ? archiveOrders : receivedOrders;

  if (!showArchive && statusFilter !== "All") {
    visibleOrders = visibleOrders.filter(
      (order) => order.status === statusFilter
    );
  }

  const startPicking = (orderId) => {
    changeOrderStatus(orderId, "In Progress");
  };

  const moveToWarehouse = (orderId) => {
    const ok = window.confirm("Move this order to Warehouse Packing?");
    if (!ok) return;
    changeOrderStatus(orderId, "Warehouse Packing");
  };

  const archiveOrder = (orderId) => {
    const reason = window.prompt("Reason for archive?");
    if (!reason) return;
    changeOrderStatus(orderId, "Archived");
  };

  const cancelOrder = (orderId) => {
    const reason = window.prompt("Reason for cancellation?");
    if (!reason) return;
    changeOrderStatus(orderId, "Cancelled");
  };

  const restoreOrder = (orderId) => {
    const ok = window.confirm("Restore this order back to Received Orders?");
    if (!ok) return;
    changeOrderStatus(orderId, "Received");
  };

  return (
    <div className="p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold">
            {showArchive ? "Archive Orders" : "Received Orders"}
          </h2>
          <p className="text-sm text-slate-500">
            Prepare picking, then move orders to warehouse for packing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!showArchive && (
            <>
              <button onClick={() => setStatusFilter("All")} className={`bg-blue-600 text-white ${btn}`}>
                All
              </button>
              <button onClick={() => setStatusFilter("Received")} className={`bg-blue-600 text-white ${btn}`}>
                Received
              </button>
              <button onClick={() => setStatusFilter("In Progress")} className={`bg-blue-600 text-white ${btn}`}>
                In Progress
              </button>
            </>
          )}

          <button onClick={() => setShowArchive(false)} className={`bg-slate-700 text-white ${btn}`}>
            Active: {receivedOrders.length}
          </button>

          <button onClick={() => setShowArchive(true)} className={`bg-slate-600 text-white ${btn}`}>
            Archive: {archiveOrders.length}
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {visibleOrders.length === 0 && (
          <div className="bg-slate-50 border rounded-2xl p-4 text-sm">
            No orders found.
          </div>
        )}

        {visibleOrders.map((order) => {
          const printableItems = order.items.filter(
            (item) => item.includeInPicking !== false
          );

          return (
            <div key={order.orderId} className="bg-white border rounded-2xl p-3">
              <div className="flex flex-col lg:flex-row lg:justify-between gap-3">
                <div>
                  <h3 className="font-bold text-lg">
                  {order.orderId}
                  <span className="font-semibold text-base ml-2">
                    | {order.companyName || "No company"}
                  </span>

                  <span className="ml-3 text-green-600 font-extrabold">
                    | {order.status}
                  </span>
                </h3>

                <p className="text-xs text-slate-500">
                  {order.createdAt} | {String(order.priceMode).toUpperCase()} |{" "}
                  {order.items.length} Items | Picking:{" "}
                  {printableItems.length} | £{Number(order.total || 0).toFixed(2)}
                </p>
                </div>

                <div className="flex flex-wrap gap-2 items-start">
                  <button
                    onClick={() => toggleOrderExpanded(order.orderId)}
                    className={`bg-blue-600 text-white ${btn}`}
                  >
                    {expandedOrders[order.orderId] ? "Hide" : "View / Prepare"}
                  </button>

                  {!showArchive && order.status === "Received" && (
                    <button
                      onClick={() => startPicking(order.orderId)}
                      className={`bg-orange-600 text-white ${btn}`}
                    >
                      Start Picking
                    </button>
                  )}

                  {!showArchive && order.status === "In Progress" && (
                    <button
                      onClick={() => changeOrderStatus(order.orderId, "Received")}
                      className={`bg-slate-500 text-white ${btn}`}
                    >
                      Put Back
                    </button>
                  )}

                  {!showArchive && (
                    <button
                      onClick={() => printPickingList(order)}
                      className={`bg-black text-white ${btn}`}
                    >
                      Picking List
                    </button>
                  )}

                  {showArchive ? (
                    <button
                      onClick={() => restoreOrder(order.orderId)}
                      className={`bg-green-600 text-white ${btn}`}
                    >
                      Restore
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => archiveOrder(order.orderId)}
                        className={`bg-slate-600 text-white ${btn}`}
                      >
                        Archive
                      </button>

                      <button
                        onClick={() => cancelOrder(order.orderId)}
                        className={`bg-red-600 text-white ${btn}`}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>

              {expandedOrders[order.orderId] && (
                <div className="mt-3 space-y-1">
                 <div className="hidden md:grid grid-cols-[1fr_80px_180px_120px] border-b font-bold text-xs text-slate-600 px-3 py-2">
                    <div>Product</div>
                    <div className="text-center">Pick Qty</div>
                    <div className="text-center">Status</div>
                    <div className="text-right">Action</div>
                  </div>

                  {order.items.map((item) => (
                    <div
                    key={item.id}
                    className={`grid grid-cols-1 md:grid-cols-[1fr_80px_180px_120px] gap-2 md:gap-0 items-center border rounded-lg px-3 py-2 text-sm ${
                      item.includeInPicking === false
                        ? "opacity-50 bg-slate-50"
                        : ""
                    }`}
                  >
                      <div className="font-medium truncate pr-3">
                        {item.name} x {item.qty}
                      </div>

                      <div className="text-center">
                        <input
                          type="number"
                          min="0"
                          className="border rounded-lg px-2 py-1 w-16 text-center text-sm"
                          value={item.pickedQty ?? item.qty}
                          onChange={(e) =>
                            updateOrderItem(order.orderId, item.id, {
                              pickedQty: Number(e.target.value),
                            })
                          }
                        />
                      </div>

                      <div className="text-center">
                        <select
                          className="border rounded-lg px-2 py-1 text-sm"
                          value={item.sourceStatus || "In Stock"}
                          onChange={(e) =>
                            updateOrderItem(order.orderId, item.id, {
                              sourceStatus: e.target.value,
                            })
                          }
                        >
                          <option>In Stock</option>
                          <option>Need Supplier</option>
                          <option>Different Supplier</option>
                          <option>Cannot Supply</option>
                        </select>
                      </div>

                      <div className="flex justify-end">
                        <button
                          onClick={() =>
                            updateOrderItem(order.orderId, item.id, {
                              includeInPicking: !item.includeInPicking,
                            })
                          }
                          className={`${
                            item.includeInPicking === false
                              ? "bg-blue-600"
                              : "bg-red-600"
                          } text-white ${btn}`}
                        >
                          {item.includeInPicking === false ? "Add" : "Remove"}
                        </button>
                      </div>
                    </div>
                  ))}

                  {!showArchive && (
                    <div className="flex justify-end pt-3">
                      <button
                        onClick={() => moveToWarehouse(order.orderId)}
                        className={`bg-purple-700 text-white ${btn}`}
                      >
                        Ready To Pack
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}