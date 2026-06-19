import { useState } from "react";

export default function AdminOrders({
  orders = [],
  products = [],
  expandedOrders = {},
  toggleOrderExpanded = () => {},
  printPickingList = () => {},
  updateOrderItem = () => {},
  addOrderItem = () => {},
  changeOrderStatus = () => {},
} = {}) {
  
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  const [showArchive, setShowArchive] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [addQty, setAddQty] = useState(1);
  const [editedQty, setEditedQty] = useState({});

  const [editedStatus, setEditedStatus] = useState({});

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

  const openAddItemModal = (order) => {
  setSelectedOrder(order);
  setProductSearch("");
  setSelectedProduct(null);
  setAddQty(1);
  setShowAddItemModal(true);
};

const filteredProducts = products.filter((p) => {
  const search = productSearch.toLowerCase();

  return (
    p.name?.toLowerCase().includes(search) ||
    p.productName?.toLowerCase().includes(search) ||
    p.productCode?.toLowerCase().includes(search)
  );
});

const confirmAddItem = () => {
  if (!selectedOrder || !selectedProduct) return;

  addOrderItem(selectedOrder.orderId, {
    id: crypto.randomUUID(),
    productId: selectedProduct.id,
    productCode: selectedProduct.productCode || "",
    name: selectedProduct.name || selectedProduct.productName,
    qty: Number(addQty || 1),
    pickedQty: Number(addQty || 1),
    price: Number(
      selectedProduct.selectedPrice ??
      selectedProduct.vatPrice ??
      selectedProduct.cashPrice ??
      0
    ),
    sourceStatus: "In Stock",
    includeInPicking: true,
  });

  setShowAddItemModal(false);
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
  {order.orderId} | {order.companyName}

  {order.branchName && (
    <span className="ml-2 text-blue-700 font-semibold">
      | {order.branchName}
    </span>
  )}

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
          <div className="hidden md:grid grid-cols-[80px_160px_1fr_100px_120px_160px] gap-4 border-b font-bold text-xs text-slate-600 px-6 py-2">
        <div>Qty</div>
        <div>Status</div>
        <div>Product</div>
        <div className="text-center">Price</div>
        <div className="text-center">Line Total</div>
        <div className="text-center">Actions</div>
      </div>

    {order.items.map((item) => {
      const itemPrice = Number(
        item.price ?? item.unitPrice ?? item.selectedPrice ?? 0
      );

      const itemQty = Number(item.pickedQty ?? item.qty ?? 0);
      const lineTotal = itemPrice * itemQty;

      return (
        <div
          key={item.id}
         className={`grid grid-cols-1 md:grid-cols-[80px_160px_1fr_100px_120px_160px] gap-4 items-center border rounded-lg px-6 py-2 text-sm ${
            item.includeInPicking === false ? "opacity-50 bg-slate-50" : ""
          }`}
        >
            <div className="text-center flex items-center justify-center gap-1">
            <input
              type="number"
              min="0"
              className="border rounded-lg px-2 py-1 w-16 text-center text-sm"
              value={editedQty[item.dbId] ?? item.pickedQty ?? item.qty}
              onChange={(e) =>
                setEditedQty((prev) => ({
                  ...prev,
                  [item.dbId]: Number(e.target.value),
                }))
              }
            />

<button
  onClick={() => {
    const status = item.sourceStatus || "In Stock";

    updateOrderItem(order.orderId, item.dbId, {
      qty: Number(editedQty[item.dbId] ?? item.pickedQty ?? item.qty),

      pickedQty:
        status === "Need Supplier" || status === "Cannot Supply"
          ? 0
          : Number(editedQty[item.dbId] ?? item.pickedQty ?? item.qty),

      sourceStatus: status,

      includeInPicking:
        status === "Need Supplier" || status === "Cannot Supply"
          ? false
          : true,
    });
  }}
  className="bg-amber-500 text-white px-2 py-1 rounded text-xs font-bold"
>
  Update
</button>
          </div>

          <div className="text-center">
            <select
              className="border rounded-lg px-2 py-1 text-sm"
              value={item.sourceStatus || "In Stock"}
              onChange={(e) =>
                updateOrderItem(order.orderId, item.dbId, {
                sourceStatus: e.target.value,
                includeInPicking:
                  e.target.value === "Need Supplier" ||
                  e.target.value === "Cannot Supply"
                    ? false
                    : true,
                })
              }
            >
              <option>In Stock</option>
              <option>Need Supplier</option>
              <option>Different Supplier</option>
              <option>Cannot Supply</option>
            </select>
          </div>

          <div className="font-medium truncate pr-3">
            {item.name}            
          </div>

          <div className="text-center font-semibold">
            £{itemPrice.toFixed(2)}
          </div>

          <div className="text-center font-semibold">
            £{lineTotal.toFixed(2)}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() =>
                updateOrderItem(order.orderId, item.id, {
                  includeInPicking: !item.includeInPicking,
                })
              }
              className={`${
                item.includeInPicking === false ? "bg-blue-600" : "bg-red-600"
              } text-white ${btn}`}
            >
              {item.includeInPicking === false ? "Add" : "Remove"}
            </button>

            <button
              onClick={() => openAddItemModal(order)}
              className={`bg-green-600 text-white ${btn}`}
            >
              Add Item
            </button>
          </div>
        </div>
      );
    })}
             

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
      {showAddItemModal && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-4 w-full max-w-xl">
      <h3 className="text-lg font-bold mb-3">Add Item</h3>

      <input
        type="text"
        value={productSearch}
        onChange={(e) => setProductSearch(e.target.value)}
        placeholder="Search product..."
        className="w-full border rounded-lg px-3 py-2 mb-3"
      />

      <div className="max-h-60 overflow-auto border rounded-lg mb-3">
        {filteredProducts.slice(0, 30).map((product) => (
          <button
            key={product.id}
            onClick={() => setSelectedProduct(product)}
            className="w-full text-left px-3 py-2 border-b hover:bg-slate-50"
          >
            {product.name || product.productName}
          </button>
        ))}
      </div>

      {selectedProduct && (
        <div className="border rounded-lg p-3 mb-3">
          <div className="font-semibold">
            {selectedProduct.name || selectedProduct.productName}
          </div>

          <div className="flex items-center gap-3 mt-3">
            <label className="text-sm font-semibold">Qty</label>
            <input
              type="number"
              min="1"
              value={addQty}
              onChange={(e) => setAddQty(Number(e.target.value))}
              className="border rounded-lg px-3 py-2 w-24"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowAddItemModal(false)}
          className={`bg-slate-500 text-white ${btn}`}
        >
          Cancel
        </button>

        <button
          onClick={confirmAddItem}
          className={`bg-green-600 text-white ${btn}`}
        >
          Add To Order
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}