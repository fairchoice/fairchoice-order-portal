import { useState } from "react";
import { hasPermission, requirePermission } from "../utils/permissions";
import { logAction } from "../utils/auditLog";
import { formatCurrency } from "../utils/currency";
import { getPriceModeLabel, getProductPriceForMode } from "../utils/pricing";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import { supabase } from "../services/supabase";
import { FC_PERMISSIONS } from "../security/fcPermissions";

import { calculateDocumentTotals } from "../utils/documentTotals";


export default function AdminOrders({
  orders = [],
  products = [],
  expandedOrders = {},
  toggleOrderExpanded = () => {},
  printPickingList = () => {},
  updateOrderItem = () => {},
  addOrderItem = () => {},
  changeOrderStatus = () => {},
  fetchOrders = async () => {},
  pricingSettings = {},
  openPickingOrder = async () => {},
} = {}) {
  const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
  
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  const [showArchive, setShowArchive] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All");
  const [stableItemOrders, setStableItemOrders] = useState({});

  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [productSearch, setProductSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [addQty, setAddQty] = useState(1);
  const [editedQty, setEditedQty] = useState({});

  const [editedStatus] = useState({});
  const [refreshFilters, setRefreshFilters] = useState({});

  const [customerFilter, setCustomerFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [countryFilter, setCountryFilter] = useState("All");

  const receivedOrders = orders.filter(
    (order) => order.status === "Received" || order.status === "In Progress"
  );

  const parseOrderDate = (value) => {
  if (!value) return null;

  const text = String(value).split(",")[0].trim();
  const [day, month, year] = text.split("/");

  if (!day || !month || !year) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return new Date(Number(year), Number(month) - 1, Number(day));
};

  const archiveOrders = orders.filter((order) => order.status === "Archived");

  let visibleOrders = showArchive ? archiveOrders : receivedOrders;

visibleOrders = visibleOrders.filter((order) => {
  const customerName = String(
    order.customer_name ||
    order.customerName ||
    order.companyName ||
    ""
  ).toLowerCase();

  const rawDate =
    order.created_at ||
    order.createdAt ||
    order.orderDate ||
    "";

  const orderDate = parseOrderDate(rawDate);

  if (
    customerFilter &&
    !customerName.includes(customerFilter.toLowerCase())
  ) {
    return false;
  }

  if (countryFilter !== "All") {
    const country = String(
      order.customer_country ||
        order.customerCountry ||
        order.branch_country ||
        order.branchCountry ||
        order.delivery_country ||
        order.country ||
        ""
    ).toLowerCase();
    if (!country.includes(countryFilter.toLowerCase())) return false;
  }

  if (dateFrom && orderDate) {
    const from = new Date(dateFrom + "T00:00:00");
    if (orderDate < from) return false;
  }

  if (dateTo && orderDate) {
    const to = new Date(dateTo + "T23:59:59");
    if (orderDate > to) return false;
  }

  return true;
});

  if (!showArchive && statusFilter !== "All") {
    visibleOrders = visibleOrders.filter(
      (order) => order.status === statusFilter
    );
  }

  const findOrder = (orderId) => orders.find((order) => order.orderId === orderId);

  const initialOrderItemSort = (items = []) =>
    [...items].sort((a, b) => {
      const statusRank = {
        "In Stock": 1,
        "Need Supplier": 2,
        "Pre-Order": 2,
        "Pre Order": 2,
        "Cannot Supply": 3,
      };
      const aRank = statusRank[a.sourceStatus] || 99;
      const bRank = statusRank[b.sourceStatus] || 99;
      if (aRank !== bRank) return aRank - bRank;
      const aGroup = `${a.series || ""} ${a.brand || ""} ${a.subCategory || a.sub_category || ""} ${a.category || ""} ${a.productName || a.name || ""}`.toLowerCase();
      const bGroup = `${b.series || ""} ${b.brand || ""} ${b.subCategory || b.sub_category || ""} ${b.category || ""} ${b.productName || b.name || ""}`.toLowerCase();
      return aGroup.localeCompare(bGroup);
    });

  const captureStableOrderItems = (order = {}) => {
    const key = String(order.orderId || "");
    const itemKey = (item) => String(item.dbId || item.id || item.productId || item.product_id || "");
    setStableItemOrders((previous) => previous[key]
      ? previous
      : { ...previous, [key]: initialOrderItemSort(order.items || []).map(itemKey) });
  };

  const getStableOrderItems = (orderId, items = []) => {
    const key = String(orderId || "");
    const itemKey = (item) => String(item.dbId || item.id || item.productId || item.product_id || "");
    const snapshot = stableItemOrders[key] || initialOrderItemSort(items).map(itemKey);
    const byId = new Map(items.map((item) => [itemKey(item), item]));
    const result = snapshot.map((id) => byId.get(id)).filter(Boolean);
    const known = new Set(snapshot);
    const additions = items.filter((item) => !known.has(itemKey(item)));
    if (additions.length) {
      const additionIds = initialOrderItemSort(additions).map(itemKey);
      result.push(...additionIds.map((id) => byId.get(id)).filter(Boolean));
    }
    return result;
  };

  const putBackToReceived = async (orderId) => {
    if (
      !requirePermission(
        loggedInUser,
        FC_PERMISSIONS.ORDERS_STATUS_CHANGE,
        "You cannot change this order status."
      )
    ) {
      return;
    }

    const order = findOrder(orderId);
    await changeOrderStatus(orderId, "Received");
    await logAction({
      user: loggedInUser,
      action_type: "Status changed",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Received",
    });
  };

  const moveToWarehouse = async (orderId) => {
    if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_STATUS_CHANGE, "You cannot move orders to warehouse.")) return;

    const ok = window.confirm("Move this order to Warehouse Packing?");
    if (!ok) return;

    const order = findOrder(orderId);
    await changeOrderStatus(orderId, "Warehouse Packing");
    await logAction({
      user: loggedInUser,
      action_type: "Moved to warehouse",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Warehouse Packing",
    });
  };

  const archiveOrder = async (orderId) => {
    if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_ARCHIVE, "You cannot archive orders.")) return;

    const ok = window.confirm(`Archive order ${formatDisplayOrderId(orderId)}?`);
    if (!ok) return;

    const order = findOrder(orderId);
    await changeOrderStatus(orderId, "Archived");
    await fetchOrders();
    await logAction({
      user: loggedInUser,
      action_type: "Order archived",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Archived",
    });
  };

  const cancelOrder = async (orderId) => {
    if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_CANCEL, "You cannot cancel orders.")) return;

    const reason = window.prompt("Reason for cancellation?");
    if (!reason) return;

    const order = findOrder(orderId);
    await changeOrderStatus(orderId, "Cancelled");
    await logAction({
      user: loggedInUser,
      action_type: "Order cancelled",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Cancelled",
    });
  };

  const restoreOrder = async (orderId) => {
    if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_ARCHIVE, "You cannot restore orders.")) return;

    const ok = window.confirm("Restore this order back to Received Orders?");
    if (!ok) return;

    const order = findOrder(orderId);
    await changeOrderStatus(orderId, "Received");
    await logAction({
      user: loggedInUser,
      action_type: "Status changed",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Received",
    });
  };

  const deleteArchivedOrder = async (orderId) => {
    if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_DELETE, "You cannot permanently delete orders.")) return;

    const ok = window.confirm(
      `Permanently delete archived order ${formatDisplayOrderId(orderId)}? This cannot be undone.`
    );
    if (!ok) return;

    const order = findOrder(orderId);
    const orderDbId = order?.dbId || order?.id;

    if (orderDbId) {
      await supabase.from("order_items").delete().eq("order_id", orderDbId);
    }

    const deleteMatch = `order_number.eq.${orderId}${orderDbId ? `,id.eq.${orderDbId}` : ""}`;
    const { error } = await supabase
      .from("orders")
      .delete()
      .or(deleteMatch);

    if (error) {
      alert("Could not delete archived order: " + error.message);
      return;
    }

    await logAction({
      user: loggedInUser,
      action_type: "Archived order deleted",
      page_module: "Received Orders",
      order_id: orderId,
      old_value: order?.status,
      new_value: "Deleted",
    });
    await fetchOrders();
  };

  const openAddItemModal = (order) => {
  if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_ITEMS_CHANGE, "You cannot add products to orders.")) return;

  setSelectedOrder(order);
  setProductSearch("");
  setSelectedProduct(null);
  setAddQty(1);
  setShowAddItemModal(true);
};

const filteredProducts = products.filter((p) => {
  const search = productSearch.toLowerCase();

  return (
    String(p.name || p.productName || p.product_name || "").toLowerCase().includes(search) ||
    String(p.productCode || p.product_code || "").toLowerCase().includes(search) ||
    String(p.brand || "").toLowerCase().includes(search) ||
    String(p.series || "").toLowerCase().includes(search)
  );
});

const confirmAddItem = async () => {
  if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_ITEMS_CHANGE, "You cannot add products to orders.")) return;
  if (!selectedOrder || !selectedProduct) return;


  const priceMode = selectedOrder.priceMode || selectedOrder.price_mode || "vat";
  const country = selectedOrder.customer_country || selectedOrder.country || "";
  const price = getProductPriceForMode(
  selectedProduct,
  priceMode,
  country,
  pricingSettings
);

  const newItem = {
    id: crypto.randomUUID(),
    productId: selectedProduct.id,
    productCode: selectedProduct.productCode || selectedProduct.product_code || "",
    name: selectedProduct.name || selectedProduct.productName || selectedProduct.product_name,
    brand: selectedProduct.brand || "",
    series: selectedProduct.series || "",
    flavour: selectedProduct.flavour || "",
    cartonSize: selectedProduct.cartonSize || selectedProduct.carton_size || "",
    qty: Number(addQty || 1),
    pickedQty: Number(addQty || 1),
    price,
    selectedPrice: price,
    unit_price: price,
    vatRate: selectedProduct.vatRate || selectedProduct.vat_type || selectedProduct.vatType || 20,
    sourceStatus: "In Stock",
    includeInPicking: true,
  };

  await addOrderItem(selectedOrder.orderId, newItem);
  await logAction({
    user: loggedInUser,
    action_type: "Product added to order",
    page_module: "Received Orders",
    order_id: selectedOrder.orderId,
    product_id: selectedProduct.id,
    old_value: null,
    new_value: newItem,
  });

  setShowAddItemModal(false);
};

const printOrderPickingList = async (order) => {
  if (!requirePermission(loggedInUser, "can_print", "You cannot print orders.")) return;

  await printPickingList(order);
  await logAction({
    user: loggedInUser,
    action_type: "Printed picking list",
    page_module: "Received Orders",
    order_id: order.orderId,
    old_value: null,
    new_value: "Picking List",
  });
};

const updatePreparedItem = async (order, item, changes) => {
  if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_RECEIVE, "You cannot receive orders.")) return;

  captureStableOrderItems(order);
  await updateOrderItem(order.orderId, item.dbId, changes);
  await logAction({
    user: loggedInUser,
    action_type: "Status changed",
    page_module: "Received Orders",
    order_id: order.orderId,
    product_id: item.productId || item.id,
    old_value: item.sourceStatus || "In Stock",
    new_value: changes,
  });
};

const getOrderCountry = (order = {}) =>
  order.customer_country || order.customerCountry || order.country || "";

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const hasValidMoney = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

const getSavedOrderItemPrice = (item = {}) => {
  if (hasValidMoney(item.price)) return Number(item.price);
  if (hasValidMoney(item.unit_price)) return Number(item.unit_price);
  if (hasValidMoney(item.unitPrice)) return Number(item.unitPrice);
  if (hasValidMoney(item.selectedPrice)) return Number(item.selectedPrice);
  if (hasValidMoney(item.selected_price)) return Number(item.selected_price);
  return 0;
};

const loadFreshPricingSettings = async () => {
  const { data, error } = await supabase
    .from("pricing_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.warn("Could not load latest pricing settings for price refresh:", error.message);
    return pricingSettings;
  }

  return data || pricingSettings;
};

const getProductDisplayName = (product = {}) =>
  product.name || product.productName || product.product_name || "";

const getProductDisplayCode = (product = {}) =>
  product.productCode || product.product_code || product.code || "";

const getItemDisplayName = (item = {}) =>
  item.productName || item.product_name || item.name || "";

const getItemDisplayCode = (item = {}) =>
  item.productCode || item.product_code || item.code || "";

const getLatestProductForItem = (item = {}) => {
  const itemProductId = item.productId || item.product_id || item.id;
  const itemCode = normalizeText(getItemDisplayCode(item));
  const itemName = normalizeText(getItemDisplayName(item));

  return (products || []).find((product) => {
    const productId = product.id;
    const productCode = normalizeText(getProductDisplayCode(product));
    const productName = normalizeText(getProductDisplayName(product));

    return (
      String(productId) === String(itemProductId) ||
      (itemCode && productCode === itemCode) ||
      (itemName && productName === itemName)
    );
  });
};

const getCatalogBrandForItem = (item = {}) => {
  const latestProduct = getLatestProductForItem(item);
  return latestProduct?.brand || item.brand || "";
};

const getCatalogSeriesForItem = (item = {}) => {
  const latestProduct = getLatestProductForItem(item);
  return latestProduct?.series || item.series || "";
};

const getSelectableProductBrands = () =>
  [
    ...new Set(
      (products || [])
        .map((product) => product.brand)
        .filter((brand) => String(brand || "").trim() !== "")
    ),
  ].sort((a, b) => String(a).localeCompare(String(b)));

const getSelectableProductSeries = () =>
  [
    ...new Set(
      (products || [])
        .map((product) => product.series)
        .filter((series) => String(series || "").trim() !== "")
    ),
  ].sort((a, b) => String(a).localeCompare(String(b)));

const buildPriceRefreshPayload = async (order, item) => {
  const latestProduct = getLatestProductForItem(item);

  if (!latestProduct) {
    return { error: "Product not found in current product database." };
  }

  const priceMode = order.priceMode || order.price_mode || "vat";
  const country = getOrderCountry(order);
  const latestPricingSettings = await loadFreshPricingSettings();
  const price = getProductPriceForMode(
    latestProduct,
    priceMode,
    country,
    latestPricingSettings
  );

  return {
    latestProduct,
    updates: {
      price,
      selectedPrice: price,
      unit_price: price,
      unitPrice: price,
    },
  };
};

const setOrderRefreshFilter = (orderId, field, value) => {
  setRefreshFilters((old) => ({
    ...old,
    [orderId]: {
      ...(old[orderId] || {}),
      [field]: value,
    },
  }));
};

const bulkRefreshOrderPrices = async (order) => {
  if (!requirePermission(loggedInUser, FC_PERMISSIONS.ORDERS_AMOUNT_CHANGE, "You cannot update received order prices.")) return;

  const filter = refreshFilters[order.orderId] || {};
  const brand = normalizeText(filter.brand);
  const series = normalizeText(filter.series);

  if (!brand && !series) {
    alert("Select a brand or series before bulk refreshing prices.");
    return;
  }

  const matchingItems = (order.items || []).filter((item) => {
    const catalogBrand = normalizeText(getCatalogBrandForItem(item));
    const catalogSeries = normalizeText(getCatalogSeriesForItem(item));
    const itemBrand = normalizeText(item.brand);
    const itemSeries = normalizeText(item.series);
    const itemName = normalizeText(getItemDisplayName(item));

    const brandMatches =
      !brand ||
      catalogBrand === brand ||
      itemBrand === brand ||
      itemName.includes(brand);

    const seriesMatches =
      !series ||
      catalogSeries === series ||
      itemSeries === series ||
      itemName.includes(series);

    return brandMatches && seriesMatches;
  });

  if (matchingItems.length === 0) {
    alert("No matching order items found.");
    return;
  }

  if (!window.confirm(`Refresh prices for ${matchingItems.length} matching item(s) in this order?`)) return;

  for (const item of matchingItems) {
    const result = await buildPriceRefreshPayload(order, item);
    if (!result.error) {
      await updateOrderItem(order.orderId, item.dbId, result.updates);
    }
  }

  await fetchOrders();
};

  return (
    <div className="admin-orders-page p-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold">
            {showArchive ? "Archive Orders" : "Received Orders"}
          </h2>
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

      <div className="bg-white border rounded-2xl p-4 mb-4">
  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
    <input
      className="border rounded-lg p-2"
      placeholder="Customer name..."
      value={customerFilter}
      onChange={(e) => setCustomerFilter(e.target.value)}
    />

    <input
      type="date"
      className="border rounded-lg p-2"
      value={dateFrom}
      onChange={(e) => setDateFrom(e.target.value)}
    />

    <input
      type="date"
      className="border rounded-lg p-2"
      value={dateTo}
      onChange={(e) => setDateTo(e.target.value)}
    />

    <select
      className="border rounded-lg p-2 bg-white"
      value={countryFilter}
      onChange={(e) => setCountryFilter(e.target.value)}
    >
      <option value="All">All Countries</option>
      <option value="Wales">Wales</option>
      <option value="England">England</option>
    </select>

    <button
      type="button"
      onClick={() => {
        setCustomerFilter("");
        setDateFrom("");
        setDateTo("");
        setCountryFilter("All");
      }}
      className="bg-slate-800 text-white rounded-lg font-bold"
    >
      Clear
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
          const orderDateTime =
            order.created_at || order.createdAt || order.orderDate || "-";
          const priceMode = order.price_mode || order.priceMode || "-";
          const orderTotals = calculateDocumentTotals(order.items || [], order);
          const totalQty = orderTotals.totalQty;
          const orderNumber =
            order.order_number || order.orderNumber || order.orderId || "-";
          const customerName =
            order.customer_name || order.customerName || order.companyName || "-";
          const branchName = order.branch_name || order.branchName || "";
          const orderTotal = orderTotals.grandTotal;
          const refreshFilter = refreshFilters[order.orderId] || {};
          const orderItemBrands = [
            ...new Set([
              ...getSelectableProductBrands(),
              ...(order.items || []).map((item) => getCatalogBrandForItem(item)),
              ...(order.items || []).map((item) => item.brand),
            ].filter((brand) => String(brand || "").trim() !== "")),
          ].sort((a, b) => String(a).localeCompare(String(b)));

          const orderItemSeries = [
            ...new Set([
              ...getSelectableProductSeries(),
              ...(order.items || []).map((item) => getCatalogSeriesForItem(item)),
              ...(order.items || []).map((item) => item.series),
            ].filter((series) => String(series || "").trim() !== "")),
          ].sort((a, b) => String(a).localeCompare(String(b)));

          return (
            <div key={order.orderId} className="received-order-card bg-white border rounded-2xl p-3">
              <div className="received-card-header grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] gap-2 items-start">
                <div className="order-header-left min-w-0">
                  <div className="order-title font-bold text-lg leading-tight">
                    {formatDisplayOrderId(orderNumber)} | {customerName}
                    {branchName ? ` | ${branchName}` : ""}
                  </div>
                  <div
                    className="order-summary-line mt-1 text-xs leading-tight break-words"
                    style={{ color: "#475569", display: "block" }}
                  >
                    Received: {orderDateTime} | {getPriceModeLabel(priceMode)} |{" "}
                    {formatCurrency(orderTotal)} | Total Qty: {totalQty}
                  </div>
                </div>

                <div className="received-card-top-actions flex flex-wrap gap-2 items-start lg:justify-end">
                  <button
                    onClick={() => toggleOrderExpanded(order.orderId)}
                    className={`bg-blue-600 text-white ${btn}`}
                  >
                    {expandedOrders[order.orderId] ? "Hide" : "View / Prepare"}
                  </button>

                  {!showArchive && (
                    <button
                      onClick={() => openPickingOrder(order)}
                      disabled={
                        order.status === "In Progress" &&
                        order.picking_locked_by &&
                        String(order.picking_locked_by) !== String(loggedInUser?.staff_id || loggedInUser?.id || loggedInUser?.username)
                      }
                      className={`bg-orange-600 text-white disabled:cursor-not-allowed disabled:bg-slate-300 ${btn}`}
                      title={order.picking_locked_by_name ? `Picker: ${order.picking_locked_by_name}` : ""}
                    >
                      {order.picking_status === "Pending" ? "Continue Picking" : "Picking"}
                    </button>
                  )}

                  {!showArchive && hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_ITEMS_CHANGE) && (
                    <button
                      onClick={() => openAddItemModal(order)}
                      className={`bg-green-600 text-white ${btn}`}
                    >
                      Add Product
                    </button>
                  )}
                </div>
              </div>

                {expandedOrders[order.orderId] && (
  <div className="mt-3 received-order-card">
    <div className="mb-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 rounded-xl border bg-slate-50 p-3">
      <select
        className="border rounded-lg px-3 py-2 text-sm"
        value={refreshFilter.brand || ""}
        onChange={(e) => setOrderRefreshFilter(order.orderId, "brand", e.target.value)}
      >
        <option value="">All brands</option>
        {orderItemBrands.map((brand) => (
          <option key={brand} value={brand}>{brand}</option>
        ))}
      </select>

      <select
        className="border rounded-lg px-3 py-2 text-sm"
        value={refreshFilter.series || ""}
        onChange={(e) => setOrderRefreshFilter(order.orderId, "series", e.target.value)}
      >
        <option value="">All series</option>
        {orderItemSeries.map((series) => (
          <option key={series} value={series}>{series}</option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => bulkRefreshOrderPrices(order)}
        className={`bg-indigo-600 text-white ${btn}`}
      >
        Refresh Current Prices
      </button>
    </div>

    <div
      className="received-item-header"
    >
      <div>QNT</div>
      <div>Upt</div>
      <div>Product Name</div>
      <div>Unit</div>
      <div>Status</div>
      <div>Line</div>
      <div>Remove</div>
    </div>

    {getStableOrderItems(order.orderId, order.items).map((item) => {
      const savedLineValue =
  item.net_total ??
  item.netTotal ??
  item.line_total ??
  item.lineTotal;
const hasSavedLineTotal = hasValidMoney(savedLineValue);
const savedLineTotal = hasSavedLineTotal ? Number(savedLineValue) : 0;

const fallbackLineTotal =
  Number(item.qty ?? item.quantity ?? 0) *
  getSavedOrderItemPrice(item);

const lineTotal = hasSavedLineTotal ? savedLineTotal : fallbackLineTotal;
const savedUnitPrice = getSavedOrderItemPrice(item);

      return (
        <div
          key={item.dbId || item.id}
          className={`received-item-row ${
            item.includeInPicking === false ? "opacity-50 bg-slate-50" : ""
          }`}
        >
          <div className="received-qty-cell">
            <input
              type="number"
              min="0"
              className="received-qty-input"
              value={editedQty[item.dbId] ?? item.pickedQty ?? item.qty}
              disabled={!hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_QUANTITY_CHANGE)}
              onChange={(e) =>
                setEditedQty((prev) => ({
                  ...prev,
                  [item.dbId]: Number(e.target.value),
                }))
              }
            />
          </div>
          <div className="received-update-cell">
            {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_QUANTITY_CHANGE) && (
              <button
                onClick={() => {
                  const status =
                    editedStatus[item.dbId] || item.sourceStatus || "In Stock";

                  const qty = Number(
                    editedQty[item.dbId] ?? item.pickedQty ?? item.qty
                  );

                  updatePreparedItem(order, item, {
                    qty,
                    pickedQty:
                      status === "Need Supplier" || status === "Cannot Supply"
                        ? 0
                        : qty,
                    sourceStatus: status,
                    includeInPicking:
                      status === "Need Supplier" || status === "Cannot Supply"
                        ? false
                        : true,
                  });
                }}
                className="received-upt-btn"
              >
                Upt
              </button>
            )}
          </div>
          <div className="received-product-name">
            {Number(item.pickingReplacedQty || item.picking_replaced_qty || 0) > 0 ? (
              <>
                <span>{item.replacementProductName || item.replacement_product_name || item.productName || item.name}</span>
                <small className="block text-[10px] text-slate-500">
                  Replaced: {item.productName || item.name}
                </small>
              </>
            ) : (
              item.productName || item.name
            )}
          </div>
          <div className="received-line-total received-unit-price">{formatCurrency(savedUnitPrice)}</div>
          <div className="received-status-cell">
            <select
              className="received-status-select"
              value={item.sourceStatus || "In Stock"}
              disabled={!hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_AMOUNT_CHANGE)}
              onChange={(e) =>
                updatePreparedItem(order, item, {
                  sourceStatus: e.target.value,
                  includeInPicking:
                    e.target.value === "Need Supplier" ||
                    e.target.value === "Cannot Supply"
                      ? false
                      : true,
                })
              }
            >
              <option value="In Stock">In Stock</option>
              <option value="Need Supplier">Pre-Order</option>
              <option value="Cannot Supply">Cannot Supply</option>
            </select>
          </div>
          <div className="received-line-total received-row-total">{formatCurrency(lineTotal)}</div>
          <div className="received-remove-cell">
            {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_AMOUNT_CHANGE) && (
              <button
                disabled={item.includeInPicking === false}
                onClick={() =>
                  updatePreparedItem(order, item, {
                    sourceStatus: "Cannot Supply",
                    includeInPicking: false,
                    pickedQty: 0,
                    qty: item.qty,
                  })
                }
                className="received-remove-btn"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      );
    })}

                  <div className="flex flex-wrap justify-end gap-2 pt-3">
                    {!showArchive &&
                      order.status === "In Progress" &&
                      hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_STATUS_CHANGE) && (
                      <button
                        onClick={() => putBackToReceived(order.orderId)}
                        className={`bg-slate-500 text-white ${btn}`}
                      >
                        Put Back
                      </button>
                    )}

                    {!showArchive && hasPermission(loggedInUser, "can_print") && (
                      <button
                        onClick={() => printOrderPickingList(order)}
                        className={`bg-black text-white ${btn}`}
                      >
                        Picking List
                      </button>
                    )}

                    {showArchive ? (
                      <div className="flex flex-wrap gap-2">
                        {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_ARCHIVE) && (
                          <button
                            onClick={() => restoreOrder(order.orderId)}
                            className={`bg-green-600 text-white ${btn}`}
                          >
                            Restore
                          </button>
                        )}
                        {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_DELETE) && (
                          <button
                            onClick={() => deleteArchivedOrder(order.orderId)}
                            className={`bg-red-700 text-white ${btn}`}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_ARCHIVE) && (
                        <button
                          onClick={() => archiveOrder(order.orderId)}
                          className={`bg-slate-600 text-white ${btn}`}
                        >
                          Archive
                        </button>
                        )}

                        {hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_CANCEL) && (
                        <button
                          onClick={() => cancelOrder(order.orderId)}
                          className={`bg-red-600 text-white ${btn}`}
                        >
                          Cancel
                        </button>
                        )}
                      </>
                    )}

                    {!showArchive && hasPermission(loggedInUser, FC_PERMISSIONS.ORDERS_STATUS_CHANGE) && (
                      <button
                        onClick={() => moveToWarehouse(order.orderId)}
                        className={`bg-purple-700 text-white ${btn}`}
                      >
                        Ready To Pack
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>


      {showAddItemModal && (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-4 w-full max-w-xl">
      <h3 className="text-lg font-bold mb-3">Add Product</h3>

      <input
        type="text"
        value={productSearch}
        onChange={(e) => setProductSearch(e.target.value)}
        placeholder="Search product..."
        className="w-full border rounded-lg px-3 py-2 mb-3"
      />

      <div className="max-h-60 overflow-auto border rounded-lg mb-3">
       {filteredProducts.slice(0, 100).map((product) => (
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
