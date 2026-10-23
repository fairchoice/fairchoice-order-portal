import { supabase } from "./supabase.js";
import {
  getActiveStockLocations,
  getCountryLocationStock,
  normalizeInventoryCountry,
  resolveOrderInventoryCountry,
} from "./locationStock.js";
import { isLivePreOrderDemandOrder } from "./preOrderSupplyAllocation.js";
import { loadPreOrderSupplyHistory } from "./preOrderSupplyHistory.js";

export const LEGACY_UNALLOCATED_COUNTRY = "Legacy / Unallocated";
export const PURCHASE_PLANNING_COUNTRIES = Object.freeze([
  "England",
  "Wales",
  LEGACY_UNALLOCATED_COUNTRY,
]);
export const PURCHASE_STATUSES = Object.freeze([
  "All",
  "Needs Ordering",
  "Already Bought",
  "Pre-Order Outstanding",
  "No Action",
]);

export const COUNTED_SALES_STATUSES = new Set([
  "delivered",
  "confirmed",
  "delivery confirmed",
  "completed",
]);

const OPEN_ORDER_STATUSES = ["Received", "In Progress", "Warehouse Packing"];
const PAGE_SIZE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_SALE_LINE_STATUSES = new Set([
  "cannot supply",
  "cancelled",
  "deleted",
  "removed",
  "need supplier",
  "pre order",
  "pre-order",
  "preorder",
  "next supplier",
  "supply needed",
]);
const INACTIVE_INVOICE_LINE_STATUSES = new Set(["removed", "cancelled", "deleted"]);
const OUTSTANDING_PREORDER_STATUSES = new Set([
  "need supplier",
  "pre order",
  "pre-order",
  "preorder",
  "next supplier",
  "supply needed",
]);

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const displayText = (value, fallback = "") => String(value || "").trim() || fallback;
const numeric = (value) => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};
const roundedQuantity = (value) => Math.round((numeric(value) + Number.EPSILON) * 1000) / 1000;

export function getPurchasePlanningPeriods(now = new Date()) {
  const end = new Date(now);
  const endMs = end.getTime();
  return {
    now: end,
    last7Start: new Date(endMs - 7 * DAY_MS),
    previous7Start: new Date(endMs - 14 * DAY_MS),
    last14Start: new Date(endMs - 14 * DAY_MS),
    last30Start: new Date(endMs - 30 * DAY_MS),
  };
}

export function classifyPurchasePlanningDate(value, now = new Date()) {
  const timestamp = new Date(value).getTime();
  const periods = getPurchasePlanningPeriods(now);
  const nowMs = periods.now.getTime();
  if (!Number.isFinite(timestamp) || timestamp > nowMs) {
    return { last7: false, previous7: false, last14: false, last30: false };
  }
  return {
    last7: timestamp >= periods.last7Start.getTime(),
    previous7:
      timestamp >= periods.previous7Start.getTime() &&
      timestamp < periods.last7Start.getTime(),
    last14: timestamp >= periods.last14Start.getTime(),
    last30: timestamp >= periods.last30Start.getTime(),
  };
}

export function isPurchasePlanningSalesOrder(order = {}) {
  return COUNTED_SALES_STATUSES.has(normalizeText(order.status));
}

export function getPurchasePlanningSaleDate(order = {}) {
  return (
    order.deliveredAt ||
    order.delivered_at ||
    order.delivery_confirmed_at ||
    order.confirmed_at ||
    order.updated_at ||
    order.created_at ||
    null
  );
}

export function getPurchasePlanningProductKey(item = {}) {
  const productId = item.productId || item.product_id || item.product?.id || item.products?.id;
  if (productId) return `id:${productId}`;
  const productCode = item.productCode || item.product_code || item.sku || item.code;
  if (productCode) return `code:${normalizeText(productCode)}`;
  const legacyId = item.dbId || item.order_item_id || item.itemId || item.id;
  return legacyId ? `legacy:${legacyId}` : "";
}

export function getFulfilledProductContribution(item = {}) {
  // Keep this gate aligned with centralInvoiceEngine.isActiveInvoiceLine without
  // importing the browser-oriented invoice module into the pure Node test path.
  const invoiceQty = numeric(item.qty ?? item.quantity ?? item.pickedQty ?? item.picked_qty);
  const invoiceStatus = normalizeText(item.sourceStatus || item.source_status || item.status);
  if (invoiceQty <= 0) return null;
  if (item.includeInPicking === false || item.include_in_picking === false) return null;
  if (INACTIVE_INVOICE_LINE_STATUSES.has(invoiceStatus)) return null;
  const sourceStatus = normalizeText(
    item.sourceStatus || item.source_status || item.status,
  );
  if (EXCLUDED_SALE_LINE_STATUSES.has(sourceStatus)) return null;

  const orderedQty = Math.max(0, numeric(item.qty ?? item.quantity));
  const pickedValue = item.pickedQty ?? item.picked_qty;
  const suppliedQty =
    pickedValue === null || pickedValue === undefined || pickedValue === ""
      ? orderedQty
      : Math.min(orderedQty, Math.max(0, numeric(pickedValue)));
  if (suppliedQty <= 0) return null;

  const replacementId = item.replacementProductId || item.replacement_product_id;
  const isUnmaterializedReplacement =
    normalizeText(item.pickingAction || item.picking_action) === "replace" && replacementId;
  const contribution = isUnmaterializedReplacement
    ? {
        ...item,
        productId: replacementId,
        product_id: replacementId,
        productCode:
          item.replacementProductCode || item.replacement_product_code || item.productCode,
        product_code:
          item.replacementProductCode || item.replacement_product_code || item.product_code,
        productName:
          item.replacementProductName || item.replacement_product_name || item.productName,
        product_name:
          item.replacementProductName || item.replacement_product_name || item.product_name,
      }
    : item;

  const productKey = getPurchasePlanningProductKey(contribution);
  if (!productKey) return null;
  return {
    productKey,
    productId: contribution.productId || contribution.product_id || null,
    productCode: displayText(contribution.productCode || contribution.product_code),
    productName: displayText(
      contribution.productName || contribution.product_name || contribution.name,
      "Unnamed Product",
    ),
    quantity: roundedQuantity(suppliedQty),
  };
}

const metricKey = (productKey, country) => `${productKey}::${country || "Unassigned"}`;

const getOrCreateMetric = (map, key, seed = {}) => {
  if (!map.has(key)) {
    map.set(key, {
      soldLast7: 0,
      soldPrevious7: 0,
      soldLast14: 0,
      soldLast30: 0,
      preOrderBoughtQty: 0,
      preOrderIncomingQty: 0,
      preOrderOutstandingQty: 0,
      preOrderPurchases: [],
      ...seed,
    });
  }
  return map.get(key);
};

export function aggregateDeliveredProductSales(orders = [], now = new Date()) {
  const result = new Map();
  for (const order of orders) {
    if (!isPurchasePlanningSalesOrder(order)) continue;
    const saleDate = getPurchasePlanningSaleDate(order);
    const periods = classifyPurchasePlanningDate(saleDate, now);
    if (!periods.last30) continue;
    const country = resolveOrderInventoryCountry(order) || "Unassigned";

    for (const item of order.order_items || order.items || []) {
      const contribution = getFulfilledProductContribution(item);
      if (!contribution) continue;
      const key = metricKey(contribution.productKey, country);
      const metric = getOrCreateMetric(result, key, {
        ...contribution,
        country,
      });
      if (periods.last7) metric.soldLast7 += contribution.quantity;
      if (periods.previous7) metric.soldPrevious7 += contribution.quantity;
      if (periods.last14) metric.soldLast14 += contribution.quantity;
      metric.soldLast30 += contribution.quantity;
    }
  }
  return result;
}

const orderNumberOf = (order = {}) => order.order_number || order.orderId || order.orderNumber;
const orderItemIdOf = (item = {}) => item.id || item.dbId || item.order_item_id;

function buildOpenOrderLookups(orders = []) {
  const byItemKey = new Map();
  const byOrderItem = new Map();
  const byOrder = new Map();
  for (const order of orders) {
    const orderNumber = displayText(orderNumberOf(order));
    const country = resolveOrderInventoryCountry(order) || "Unassigned";
    if (orderNumber) byOrder.set(orderNumber, { order, country });
    for (const item of order.order_items || order.items || []) {
      const itemId = displayText(orderItemIdOf(item));
      if (orderNumber && itemId) {
        const value = { order, item, country };
        byItemKey.set(`${orderNumber}:${itemId}`, value);
        byOrderItem.set(`${orderNumber}:${itemId}`, value);
      }
    }
  }
  return { byItemKey, byOrderItem, byOrder };
}

const isDeliveryConfirmedEvent = (event = {}) =>
  Boolean(event.deliveryConfirmed || event.deliveryConfirmedAt) ||
  ["delivered", "delivery confirmed", "confirmed delivered", "completed"].includes(
    normalizeText(event.orderStatus),
  );

export function getActivePreOrderPurchaseEvents(events = []) {
  const recalledClientIds = new Set();
  const recalledEventIds = new Set();
  for (const event of events) {
    if (event.actionType !== "Recall") continue;
    if (event.recalledClientActionId) recalledClientIds.add(String(event.recalledClientActionId));
    if (event.recalledEventId) recalledEventIds.add(String(event.recalledEventId));
  }

  return events.filter((event) => {
    if (!["Buy", "PartialBuy"].includes(event.actionType)) return false;
    if (recalledClientIds.has(String(event.clientActionId || ""))) return false;
    if (recalledEventIds.has(String(event.id || ""))) return false;
    return !isDeliveryConfirmedEvent(event);
  });
}

export function aggregateActivePreOrderPurchases(
  events = [],
  openOrders = [],
  { deliveryStateReliable = true } = {},
) {
  const result = new Map();
  const lookups = buildOpenOrderLookups(openOrders);
  for (const event of getActivePreOrderPurchaseEvents(events)) {
    const orderNumber = displayText(event.orderId || event.order_number);
    const itemId = displayText(event.itemId || event.order_item_id);
    const linked =
      lookups.byItemKey.get(displayText(event.itemKey)) ||
      lookups.byOrderItem.get(`${orderNumber}:${itemId}`) ||
      lookups.byOrder.get(orderNumber);
    const country = linked?.country || "Unassigned";
    const productKey = getPurchasePlanningProductKey({
      productId: event.productId,
      productCode: event.productCode || event.metadata?.itemSnapshot?.productCode,
      order_item_id: event.itemId,
    });
    if (!productKey) continue;
    const quantity = Math.max(0, numeric(event.quantity));
    if (quantity <= 0) continue;
    const key = metricKey(productKey, country);
    const metric = getOrCreateMetric(result, key, {
      productKey,
      productId: event.productId || null,
      productCode: displayText(
        event.productCode || event.metadata?.itemSnapshot?.productCode,
      ),
      productName: displayText(event.productName, "Unnamed Product"),
      country,
    });
    metric.preOrderBoughtQty += quantity;
    metric.preOrderIncomingQty += deliveryStateReliable ? quantity : 0;
    metric.preOrderPurchases.push({
      id: event.id || event.clientActionId,
      date: event.boughtAt || event.timestamp || null,
      supplierId: event.supplierId || null,
      supplierName: displayText(event.supplierName, "Supplier not recorded"),
      quantity,
      orderNumber,
      customerName: displayText(event.customerName),
      branchName: displayText(event.branchName),
      action: event.actionType,
      changedBy: displayText(event.userName, "Not recorded"),
    });
  }
  return result;
}

export function aggregateOutstandingPreOrders(openOrders = []) {
  const result = new Map();
  for (const order of openOrders) {
    if (!isLivePreOrderDemandOrder(order)) continue;
    const country = resolveOrderInventoryCountry(order) || "Unassigned";
    for (const item of order.order_items || order.items || []) {
      const status = normalizeText(item.sourceStatus || item.source_status || item.status);
      if (!OUTSTANDING_PREORDER_STATUSES.has(status)) continue;
      const quantity = Math.max(0, numeric(item.qty ?? item.quantity));
      if (quantity <= 0) continue;
      const productKey = getPurchasePlanningProductKey(item);
      if (!productKey) continue;
      const key = metricKey(productKey, country);
      const metric = getOrCreateMetric(result, key, {
        productKey,
        productId: item.productId || item.product_id || null,
        productCode: displayText(item.productCode || item.product_code),
        productName: displayText(item.productName || item.product_name || item.name),
        country,
      });
      metric.preOrderOutstandingQty += quantity;
    }
  }
  return result;
}

export function calculatePurchaseTrend(soldLast7 = 0, soldPrevious7 = 0) {
  const current = numeric(soldLast7);
  const previous = numeric(soldPrevious7);
  const difference = roundedQuantity(current - previous);
  if (previous === 0) {
    return {
      label: current > 0 ? "Higher" : "Similar",
      direction: current > 0 ? "up" : "same",
      percentage: current > 0 ? null : 0,
      trendQty: difference,
    };
  }
  const percentage = ((current - previous) / previous) * 100;
  if (percentage > 10) {
    return { label: "Higher", direction: "up", percentage, trendQty: difference };
  }
  if (percentage < -10) {
    return { label: "Lower", direction: "down", percentage, trendQty: difference };
  }
  return { label: "Similar", direction: "same", percentage, trendQty: difference };
}

export function calculatePurchaseSuggestion({
  soldLast7 = 0,
  soldPrevious7 = 0,
  soldLast14,
  soldLast30 = 0,
  currentStock = 0,
  preOrderBoughtQty = 0,
  preOrderIncomingQty,
  preOrderOutstandingQty = 0,
  preOrderBoughtAlreadyInStock = false,
  purchaseCycleDays = 7,
  leadDays = 3,
  safetyDays = 2,
  fastLineThreshold14 = 14,
  fastLineBufferQty = 2,
} = {}) {
  // The planning signal is the most recent 14 days only.
  // If soldLast14 is not supplied, rebuild it from the two real 7-day buckets.
  const recent14 = soldLast14 === undefined
    ? Math.max(0, numeric(soldLast7) + numeric(soldPrevious7))
    : Math.max(0, numeric(soldLast14));
  const dailyDemand = recent14 / 14;
  const weeklyAverage = dailyDemand * 7;
  const targetDays = Math.max(1, numeric(purchaseCycleDays) + numeric(leadDays) + numeric(safetyDays));
  const outstandingDemand = Math.max(0, numeric(preOrderOutstandingQty));
  const fastLine = recent14 >= Math.max(1, numeric(fastLineThreshold14));
  const fastLineBuffer = fastLine ? Math.max(0, numeric(fastLineBufferQty)) : 0;
  const targetStock = Math.ceil(dailyDemand * targetDays + outstandingDemand + fastLineBuffer);

  // Pre-Order Supply Buy/PartialBuy changes the allocated order line to In Stock,
  // but does not increment product_location_stock. Active bought units are therefore
  // incoming once. If that workflow changes later, the flag prevents double subtraction.
  const reliableIncomingQty = preOrderIncomingQty === undefined
    ? preOrderBoughtQty
    : preOrderIncomingQty;
  const incomingQty = preOrderBoughtAlreadyInStock
    ? 0
    : Math.max(0, numeric(reliableIncomingQty));
  const availableQty = Math.max(0, numeric(currentStock)) + incomingQty;
  const suggestedOrderQty = Math.ceil(Math.max(0, targetStock - availableQty));

  return {
    recent14,
    dailyDemand,
    weeklyAverage,
    targetDays,
    fastLine,
    fastLineBuffer,
    targetStock,
    incomingQty,
    availableQty,
    suggestedOrderQty,
  };
}

const hasLegacyGlobalStock = (product = {}) =>
  product.stock !== null &&
  product.stock !== undefined &&
  product.stock !== "" &&
  Number.isFinite(Number(product.stock));

const productCountryRows = (product = {}) => {
  const countries = new Set();
  for (const locationStock of Object.values(product.locationStocks || {})) {
    if (locationStock?.active === false) continue;
    const country = normalizeInventoryCountry(locationStock?.country);
    if (country) countries.add(country);
  }
  if (countries.size === 0) {
    const legacyQty = Number(product.stock);
    if (hasLegacyGlobalStock(product) && legacyQty >= 0) {
      return [LEGACY_UNALLOCATED_COUNTRY];
    }
    if (product.availableInEngland !== false && product.available_in_england !== false) {
      countries.add("England");
    }
    if (product.availableInWales !== false && product.available_in_wales !== false) {
      countries.add("Wales");
    }
  }
  if (countries.size === 0) countries.add("Unassigned");
  return [...countries];
};

const mergeMetric = (target, source) => {
  if (!source) return target;
  target.soldLast7 += numeric(source.soldLast7);
  target.soldPrevious7 += numeric(source.soldPrevious7);
  target.soldLast14 += numeric(source.soldLast14);
  target.soldLast30 += numeric(source.soldLast30);
  target.preOrderBoughtQty += numeric(source.preOrderBoughtQty);
  target.preOrderIncomingQty += numeric(source.preOrderIncomingQty);
  target.preOrderOutstandingQty += numeric(source.preOrderOutstandingQty);
  target.preOrderPurchases.push(...(source.preOrderPurchases || []));
  return target;
};

export function buildPurchasePlanningRows({
  products = [],
  sales = new Map(),
  purchases = new Map(),
  outstanding = new Map(),
  sourceStatus = {},
} = {}) {
  const rows = [];
  const consumedMetricKeys = new Set();
  const countriesByProductKey = new Map();

  for (const map of [sales, purchases, outstanding]) {
    for (const metric of map.values()) {
      if (!metric?.productKey || !metric?.country) continue;
      if (!countriesByProductKey.has(metric.productKey)) {
        countriesByProductKey.set(metric.productKey, new Set());
      }
      countriesByProductKey.get(metric.productKey).add(metric.country);
    }
  }

  const availability = {
    salesAvailable: sourceStatus.salesAvailable !== false,
    preorderOutstandingAvailable: sourceStatus.preorderOutstandingAvailable !== false,
    preorderHistoryAvailable: sourceStatus.preorderHistoryAvailable !== false,
    preorderIncomingAvailable: sourceStatus.preorderIncomingAvailable !== false,
  };

  for (const product of products) {
    const productKey = getPurchasePlanningProductKey({
      ...product,
      productId: product.productId || product.product_id || product.id,
    });
    if (!productKey) continue;
    const codeKey = product.productCode || product.product_code
      ? `code:${normalizeText(product.productCode || product.product_code)}`
      : "";
    const countries = new Set(productCountryRows(product));
    for (const key of [productKey, codeKey].filter(Boolean)) {
      for (const country of countriesByProductKey.get(key) || []) countries.add(country);
    }

    const hasCanonicalStock = Object.values(product.locationStocks || {}).some(
      (stock) => stock?.active !== false && normalizeInventoryCountry(stock?.country),
    );
    const hasLegacyStock = !hasCanonicalStock && hasLegacyGlobalStock(product);
    const active = product.active !== false;

    for (const country of countries) {
      const metric = {
        soldLast7: 0,
        soldPrevious7: 0,
        soldLast14: 0,
        soldLast30: 0,
        preOrderBoughtQty: 0,
        preOrderIncomingQty: 0,
        preOrderOutstandingQty: 0,
        preOrderPurchases: [],
      };
      for (const key of [metricKey(productKey, country), codeKey && metricKey(codeKey, country)].filter(Boolean)) {
        mergeMetric(metric, sales.get(key));
        mergeMetric(metric, purchases.get(key));
        mergeMetric(metric, outstanding.get(key));
        consumedMetricKeys.add(key);
      }
      const stock = country === LEGACY_UNALLOCATED_COUNTRY && hasLegacyStock
        ? {
            qty: Math.max(0, numeric(product.stock)),
            locationName: "Legacy global inventory; country allocation pending",
            legacyFallback: true,
          }
        : country === "Unassigned" || hasLegacyStock
          ? null
          : getCountryLocationStock(product, country);
      const currentStock = stock ? numeric(stock.qty) : 0;
      const suggestion = calculatePurchaseSuggestion({
        soldLast7: metric.soldLast7,
        soldPrevious7: metric.soldPrevious7,
        soldLast14: metric.soldLast14,
        soldLast30: metric.soldLast30,
        currentStock,
        preOrderBoughtQty: metric.preOrderBoughtQty,
        preOrderIncomingQty: metric.preOrderIncomingQty,
        preOrderOutstandingQty: metric.preOrderOutstandingQty,
        preOrderBoughtAlreadyInStock: false,
      });
      const trend = calculatePurchaseTrend(metric.soldLast7, metric.soldPrevious7);
      rows.push({
        rowKey: `${productKey}:${country}`,
        productKey,
        productId: product.id || null,
        active,
        productState: active ? "Active Product" : "Inactive Product",
        productCode: displayText(product.productCode || product.product_code),
        productName: displayText(product.name || product.product_name, "Unnamed Product"),
        mainCategory: displayText(product.category || product.main_category),
        subCategory: displayText(product.subCategory || product.sub_category),
        brand: displayText(product.brand),
        series: displayText(product.series),
        supplierId: product.supplierId || product.supplier_id || null,
        supplierName: displayText(product.supplierName || product.supplier_name, "Not assigned"),
        country,
        currentStock,
        stockLocationId: stock?.locationId || null,
        stockLocationName: stock?.locationName || "",
        inventoryCompatibility: Boolean(stock?.legacyFallback),
        soldLast7: roundedQuantity(metric.soldLast7),
        soldPrevious7: roundedQuantity(metric.soldPrevious7),
        soldLast14: roundedQuantity(metric.soldLast14),
        soldLast30: roundedQuantity(metric.soldLast30),
        dailyDemand14: suggestion.dailyDemand,
        weeklyAverage: suggestion.weeklyAverage,
        targetDays: suggestion.targetDays,
        fastLine: suggestion.fastLine,
        fastLineBuffer: suggestion.fastLineBuffer,
        preOrderBoughtQty: roundedQuantity(metric.preOrderBoughtQty),
        preOrderOutstandingQty: roundedQuantity(metric.preOrderOutstandingQty),
        targetStock: suggestion.targetStock,
        incomingQty: suggestion.incomingQty,
        suggestedOrderQty: active ? suggestion.suggestedOrderQty : 0,
        trend: trend.label,
        trendDirection: trend.direction,
        trendPercentage: trend.percentage,
        trendQty: trend.trendQty,
        preOrderPurchases: metric.preOrderPurchases.sort(
          (left, right) => new Date(right.date || 0) - new Date(left.date || 0),
        ),
        ...availability,
        suggestionAvailable:
          !active || (availability.salesAvailable && availability.preorderIncomingAvailable),
      });
    }
  }

  const remainingKeys = new Set([...sales.keys(), ...purchases.keys(), ...outstanding.keys()]);
  for (const key of remainingKeys) {
    if (consumedMetricKeys.has(key)) continue;
    const seed = sales.get(key) || purchases.get(key) || outstanding.get(key);
    if (!seed) continue;
    const metric = mergeMetric(
      mergeMetric(mergeMetric({ soldLast7: 0, soldPrevious7: 0, soldLast14: 0, soldLast30: 0, preOrderBoughtQty: 0, preOrderIncomingQty: 0, preOrderOutstandingQty: 0, preOrderPurchases: [] }, sales.get(key)), purchases.get(key)),
      outstanding.get(key),
    );
    const suggestion = calculatePurchaseSuggestion({
      soldLast7: metric.soldLast7,
      soldPrevious7: metric.soldPrevious7,
      soldLast14: metric.soldLast14,
      soldLast30: metric.soldLast30,
      currentStock: 0,
      preOrderBoughtQty: metric.preOrderBoughtQty,
      preOrderIncomingQty: metric.preOrderIncomingQty,
      preOrderOutstandingQty: metric.preOrderOutstandingQty,
    });
    const trend = calculatePurchaseTrend(metric.soldLast7, metric.soldPrevious7);
    rows.push({
      rowKey: `${seed.productKey}:${seed.country}:historical`,
      productKey: seed.productKey,
      productId: seed.productId || null,
      active: null,
      productState: "Product master record unavailable",
      productCode: seed.productCode || "",
      productName: seed.productName || "Historical product",
      mainCategory: "",
      subCategory: "",
      brand: "",
      series: "",
      supplierId: null,
      supplierName: "Not assigned",
      country: seed.country || "Unassigned",
      currentStock: 0,
      stockLocationId: null,
      stockLocationName: "Product master record unavailable",
      inventoryCompatibility: false,
      soldLast7: roundedQuantity(metric.soldLast7),
      soldPrevious7: roundedQuantity(metric.soldPrevious7),
      soldLast14: roundedQuantity(metric.soldLast14),
      soldLast30: roundedQuantity(metric.soldLast30),
      dailyDemand14: suggestion.dailyDemand,
      weeklyAverage: suggestion.weeklyAverage,
      targetDays: suggestion.targetDays,
      fastLine: suggestion.fastLine,
      fastLineBuffer: suggestion.fastLineBuffer,
      preOrderBoughtQty: roundedQuantity(metric.preOrderBoughtQty),
      preOrderOutstandingQty: roundedQuantity(metric.preOrderOutstandingQty),
      targetStock: suggestion.targetStock,
      incomingQty: suggestion.incomingQty,
      suggestedOrderQty: suggestion.suggestedOrderQty,
      trend: trend.label,
      trendDirection: trend.direction,
      trendPercentage: trend.percentage,
      trendQty: trend.trendQty,
      preOrderPurchases: metric.preOrderPurchases,
      ...availability,
      suggestionAvailable:
        availability.salesAvailable && availability.preorderIncomingAvailable,
    });
  }
  return rows;
}

export const emptyPurchasePlanningFilters = Object.freeze({
  search: "",
  supplier: "All",
  mainCategory: "All",
  subCategory: "All",
  brand: "All",
  series: "All",
  country: "All",
  purchaseStatus: "All",
});

export function updatePurchasePlanningHierarchy(filters, field, value) {
  const next = { ...filters, [field]: value };
  if (field === "mainCategory") {
    next.subCategory = "All";
    next.brand = "All";
    next.series = "All";
  } else if (field === "subCategory") {
    next.brand = "All";
    next.series = "All";
  } else if (field === "brand") {
    next.series = "All";
  }
  return next;
}

const uniqueOptions = (rows, field) =>
  [...new Set(rows.map((row) => displayText(row[field])).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

export function getPurchasePlanningFilterOptions(rows = [], filters = emptyPurchasePlanningFilters) {
  const mainRows = rows;
  const subRows = rows.filter(
    (row) => filters.mainCategory === "All" || row.mainCategory === filters.mainCategory,
  );
  const brandRows = subRows.filter(
    (row) => filters.subCategory === "All" || row.subCategory === filters.subCategory,
  );
  const seriesRows = brandRows.filter(
    (row) => filters.brand === "All" || row.brand === filters.brand,
  );
  return {
    suppliers: uniqueOptions(rows, "supplierName"),
    mainCategories: uniqueOptions(mainRows, "mainCategory"),
    subCategories: uniqueOptions(subRows, "subCategory"),
    brands: uniqueOptions(brandRows, "brand"),
    series: uniqueOptions(seriesRows, "series"),
  };
}

export function reconcilePurchasePlanningFilters(
  rows = [],
  filters = emptyPurchasePlanningFilters,
) {
  const next = { ...filters };
  const includes = (options, value) => value === "All" || options.includes(value);

  let options = getPurchasePlanningFilterOptions(rows, next);
  if (!includes(options.suppliers, next.supplier)) next.supplier = "All";
  if (!includes(options.mainCategories, next.mainCategory)) {
    next.mainCategory = "All";
    next.subCategory = "All";
    next.brand = "All";
    next.series = "All";
    return next;
  }

  options = getPurchasePlanningFilterOptions(rows, next);
  if (!includes(options.subCategories, next.subCategory)) {
    next.subCategory = "All";
    next.brand = "All";
    next.series = "All";
    return next;
  }

  options = getPurchasePlanningFilterOptions(rows, next);
  if (!includes(options.brands, next.brand)) {
    next.brand = "All";
    next.series = "All";
    return next;
  }

  options = getPurchasePlanningFilterOptions(rows, next);
  if (!includes(options.series, next.series)) next.series = "All";
  return next;
}

export function getPurchasePlanningStatus(row = {}) {
  if (numeric(row.suggestedOrderQty) > 0) return "Needs Ordering";
  if (numeric(row.preOrderBoughtQty) > 0) return "Already Bought";
  if (numeric(row.preOrderOutstandingQty) > 0) return "Pre-Order Outstanding";
  return "No Action";
}

export function matchesPurchasePlanningStatus(row = {}, status = "All") {
  if (status === "All") return true;
  if (status === "Needs Ordering") return numeric(row.suggestedOrderQty) > 0;
  if (status === "Already Bought") return numeric(row.preOrderBoughtQty) > 0;
  if (status === "Pre-Order Outstanding") return numeric(row.preOrderOutstandingQty) > 0;
  if (status === "No Action") {
    return numeric(row.suggestedOrderQty) === 0 && numeric(row.preOrderOutstandingQty) === 0;
  }
  return false;
}

export function filterPurchasePlanningRows(rows = [], filters = emptyPurchasePlanningFilters) {
  const search = normalizeText(filters.search);
  return rows.filter((row) => {
    if (
      search &&
      ![row.productCode, row.productName, row.brand, row.series].some((value) =>
        normalizeText(value).includes(search),
      )
    ) return false;
    if (filters.supplier !== "All" && row.supplierName !== filters.supplier) return false;
    if (filters.mainCategory !== "All" && row.mainCategory !== filters.mainCategory) return false;
    if (filters.subCategory !== "All" && row.subCategory !== filters.subCategory) return false;
    if (filters.brand !== "All" && row.brand !== filters.brand) return false;
    if (filters.series !== "All" && row.series !== filters.series) return false;
    if (filters.country !== "All" && row.country !== filters.country) return false;
    if (!matchesPurchasePlanningStatus(row, filters.purchaseStatus)) return false;
    return true;
  });
}

export function sortPurchasePlanningRows(rows = []) {
  return [...rows].sort(
    (left, right) =>
      numeric(right.suggestedOrderQty) - numeric(left.suggestedOrderQty) ||
      numeric(right.soldLast7) - numeric(left.soldLast7) ||
      left.productName.localeCompare(right.productName) ||
      left.country.localeCompare(right.country),
  );
}

export function summarizePurchasePlanningRows(rows = []) {
  return {
    productsSold: new Set(
      rows.filter((row) => row.soldLast7 > 0).map((row) => row.productKey),
    ).size,
    unitsSoldLast7: rows.reduce((sum, row) => sum + numeric(row.soldLast7), 0),
    preOrderUnitsBought: rows.reduce((sum, row) => sum + numeric(row.preOrderBoughtQty), 0),
    productsNeedingReview: rows.filter((row) => row.suggestedOrderQty > 0).length,
  };
}

export function paginatePurchasePlanningRows(rows = [], page = 1, pageSize = 50) {
  const safePageSize = [25, 50, 100].includes(Number(pageSize)) ? Number(pageSize) : 50;
  const pageCount = Math.max(1, Math.ceil(rows.length / safePageSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const startIndex = (safePage - 1) * safePageSize;
  return {
    rows: rows.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    pageCount,
    total: rows.length,
    start: rows.length === 0 ? 0 : startIndex + 1,
    end: Math.min(startIndex + safePageSize, rows.length),
  };
}

const ORDER_ITEM_COLUMNS = [
  "id",
  "order_id",
  "product_id",
  "product_code",
  "product_name",
  "qty",
  "picked_qty",
  "source_status",
  "include_in_picking",
  "picking_ordered_qty",
  "picking_in_stock_qty",
  "picking_pre_order_qty",
  "picking_replaced_qty",
  "picking_action",
  "replacement_product_id",
  "replacement_product_code",
  "replacement_product_name",
].join(",");

// The local migration chain guarantees these order columns. Optional legacy
// confirmation/country aliases are intentionally resolved only when supplied
// to pure helpers; selecting an unverified column would fail the whole report.
const ORDER_COLUMNS = [
  "id",
  "order_number",
  "status",
  "delivered_at",
  "updated_at",
  "created_at",
  "customer_country",
].join(",");

async function loadPagedOrders({ statuses = null, since = null } = {}) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from("orders")
      .select(`${ORDER_COLUMNS}, order_items(${ORDER_ITEM_COLUMNS})`)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (statuses) query = query.in("status", statuses);
    if (since) {
      query = query.or(
        [
          `delivered_at.gte.${since}`,
          `updated_at.gte.${since}`,
          `created_at.gte.${since}`,
        ].join(","),
      );
    }
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < PAGE_SIZE) break;
  }
  return rows;
}


export async function loadPurchaseReceiptHistory({ days = 90 } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(days) || 90) * DAY_MS).toISOString();
  const { data, error } = await supabase.from("stock_receipts").select("id,product_id,supplier_name,invoice_number,purchase_type,qty_received,cost_price,total_cost,source_type,received_date").gte("received_date", since).order("received_date", { ascending: false });
  if (error) throw error;
  return data || [];
}
export function attachPurchaseReceiptHistory(rows = [], receipts = []) {
  const byProduct = new Map();
  for (const receipt of receipts || []) { const key = String(receipt.product_id || ""); if (!key) continue; if (!byProduct.has(key)) byProduct.set(key, []); byProduct.get(key).push(receipt); }
  return rows.map((row) => {
    const history = byProduct.get(String(row.productId || "")) || []; const now = Date.now();
    const within = (r, days) => { const t = new Date(r.received_date || 0).getTime(); return Number.isFinite(t) && t >= now - days * DAY_MS; };
    const sumQty = (list) => roundedQuantity(list.reduce((sum, r) => sum + Math.max(0, numeric(r.qty_received)), 0));
    const main = history.filter((r) => normalizeText(r.purchase_type) === "supplier invoice"); const topup = history.filter((r) => normalizeText(r.purchase_type) !== "supplier invoice");
    return { ...row, receiptHistory: history, supplierPurchased30: sumQty(main.filter((r) => within(r, 30))), supplierPurchased90: sumQty(main.filter((r) => within(r, 90))), topUpReceived30: sumQty(topup.filter((r) => within(r, 30))), topUpReceived90: sumQty(topup.filter((r) => within(r, 90))) };
  });
}
export async function loadPurchasePlanningLocations() { return getActiveStockLocations(); }
export async function bookPurchaseStockIn({ productId, locationId, quantity, supplierName = "", invoiceNumber = "", costPrice = 0, purchaseType = "Supplier Invoice", notes = "" } = {}) {
  const qty = Number(quantity); const cost = Number(costPrice || 0);
  if (!productId) throw new Error("Select a product."); if (!locationId) throw new Error("Select a stock location."); if (!Number.isFinite(qty) || qty <= 0) throw new Error("Received quantity must be more than zero.");
  const { data: existing, error: stockReadError } = await supabase.from("product_location_stock").select("id,qty,low_stock_alert").eq("product_id", productId).eq("location_id", locationId).maybeSingle(); if (stockReadError) throw stockReadError;
  const stockBefore = numeric(existing?.qty); const stockAfter = roundedQuantity(stockBefore + qty);
  const { data: receipt, error: receiptError } = await supabase.from("stock_receipts").insert({ product_id: productId, supplier_name: displayText(supplierName), invoice_number: displayText(invoiceNumber), purchase_type: purchaseType, payment_method: "Account", qty_received: qty, cost_price: cost, vat_applicable: false, vat_percent: 0, total_cost: roundedQuantity(qty * cost), notes: displayText(notes), source_type: "Purchase Planning Stock In", received_date: new Date().toISOString() }).select("id").single(); if (receiptError) throw receiptError;
  const { error: locationError } = await supabase.from("product_location_stock").upsert({ product_id: productId, location_id: locationId, qty: stockAfter, low_stock_alert: numeric(existing?.low_stock_alert), updated_at: new Date().toISOString() }, { onConflict: "product_id,location_id" }); if (locationError) throw locationError;
  const { error: movementError } = await supabase.from("stock_movements").insert({ product_id: productId, movement_type: "STOCK_IN", qty, stock_before: stockBefore, stock_after: stockAfter, note: `Purchase Planning Stock In${invoiceNumber ? ` / ${invoiceNumber}` : ""}` }); if (movementError) throw movementError;
  const { error: layerError } = await supabase.from("inventory_layers").insert({ product_id: productId, stock_receipt_id: receipt.id, purchase_type: purchaseType, supplier_name: displayText(supplierName), invoice_number: displayText(invoiceNumber), qty_received: qty, qty_remaining: qty, cost_price: cost, vat_applicable: false, vat_percent: 0, total_cost: roundedQuantity(qty * cost), received_date: new Date().toISOString() }); if (layerError) throw layerError;
  return { receiptId: receipt.id, stockBefore, stockAfter };
}

export async function loadPurchasePlanningReport({
  products = [],
  user,
  now = new Date(),
  sourceLoaders = {},
} = {}) {
  const hasInjectedLoaders = ["sales", "outstanding", "history"].every(
    (key) => typeof sourceLoaders[key] === "function",
  );
  if (!supabase && !hasInjectedLoaders) {
    throw new Error("Supabase is not configured for Purchase Planning.");
  }
  const periods = getPurchasePlanningPeriods(now);
  const loadSales = sourceLoaders.sales || (() =>
    loadPagedOrders({ since: periods.last30Start.toISOString() }));
  const loadOutstanding = sourceLoaders.outstanding || (() =>
    loadPagedOrders({ statuses: OPEN_ORDER_STATUSES }));
  const loadHistory = sourceLoaders.history || (() => loadPreOrderSupplyHistory(user));
  const [salesResult, outstandingResult, historyResult] = await Promise.allSettled([
    loadSales(),
    loadOutstanding(),
    loadHistory(),
  ]);

  const salesOrders = salesResult.status === "fulfilled" ? salesResult.value : [];
  const openOrders = outstandingResult.status === "fulfilled" ? outstandingResult.value : [];
  const historyPayload = historyResult.status === "fulfilled" ? historyResult.value : null;
  const historyEvents = historyPayload?.events || [];
  const historyVersion = historyPayload?.sourceVersion || "v2";
  const historyAvailable =
    historyResult.status === "fulfilled" && historyPayload?.available !== false;
  const sourceStatus = {
    salesAvailable: salesResult.status === "fulfilled",
    preorderOutstandingAvailable: outstandingResult.status === "fulfilled",
    preorderHistoryAvailable: historyAvailable,
    preorderIncomingAvailable:
      historyAvailable && historyVersion !== "v1",
  };
  const warnings = [];
  if (!sourceStatus.salesAvailable) warnings.push("Recent sales are unavailable.");
  if (!sourceStatus.preorderOutstandingAvailable) {
    warnings.push("Current Pre-Order demand is unavailable.");
  }
  if (!sourceStatus.preorderHistoryAvailable) {
    warnings.push("Pre-Order purchase history is unavailable.");
  } else if (!sourceStatus.preorderIncomingAvailable) {
    warnings.push("Legacy Pre-Order history cannot reliably determine incoming stock.");
  } else if (historyPayload?.warning) {
    warnings.push(historyPayload.warning);
  }

  // TODO: a future migration should add a SELECT-only Purchase Planning history
  // RPC protected by access_reports. The Warehouse history RPC must retain
  // page.warehouse and must not be broadened for report users.

  const sales = aggregateDeliveredProductSales(salesOrders, now);
  const purchases = aggregateActivePreOrderPurchases(historyEvents, openOrders, { deliveryStateReliable: sourceStatus.preorderIncomingAvailable });
  const outstanding = aggregateOutstandingPreOrders(openOrders);
  let receiptHistory = []; let locations = [];
  try { [receiptHistory, locations] = await Promise.all([loadPurchaseReceiptHistory({ days: 90 }), loadPurchasePlanningLocations()]); } catch (historyError) { warnings.push("Stock receipt history or locations could not be loaded."); }
  const baseRows = buildPurchasePlanningRows({ products, sales, purchases, outstanding, sourceStatus });
  return { rows: attachPurchaseReceiptHistory(baseRows, receiptHistory), locations, sourceStatus, preOrderWarning: warnings.join(" "), loadedAt: new Date().toISOString() };
}

export function safeCsvText(value) {
  const text = String(value ?? "");
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

const csvTextCell = (value) => `"${safeCsvText(value).replace(/"/g, '""')}"`;
const csvNumericCell = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
};

export function buildPurchasePlanningCsv(rows = []) {
  const headers = [
    "Product Code", "Product Name", "Main Category", "Sub Category", "Brand", "Series",
    "Supplier", "Country", "Current Stock", "Sold Last 7 Days", "Sold Previous 7 Days",
    "Sold Last 14 Days", "Sold Last 30 Days", "Weekly Average", "Trend", "Pre-Order Bought",
    "Pre-Order Outstanding", "Suggested Order Qty",
  ];
  const headerLine = headers.map(csvTextCell).join(",");
  const lines = rows.map((row) => [
    csvTextCell(row.productCode),
    csvTextCell(row.productName),
    csvTextCell(row.mainCategory),
    csvTextCell(row.subCategory),
    csvTextCell(row.brand),
    csvTextCell(row.series),
    csvTextCell(row.supplierName),
    csvTextCell(row.country),
    csvNumericCell(row.currentStock),
    csvNumericCell(row.salesAvailable === false ? null : row.soldLast7),
    csvNumericCell(row.salesAvailable === false ? null : row.soldPrevious7),
    csvNumericCell(row.salesAvailable === false ? null : row.soldLast14),
    csvNumericCell(row.salesAvailable === false ? null : row.soldLast30),
    csvNumericCell(row.salesAvailable === false ? null : row.weeklyAverage.toFixed(1)),
    csvTextCell(row.salesAvailable === false
      ? "Unavailable"
      : `${row.trend} ${row.trendQty >= 0 ? "+" : ""}${row.trendQty}`),
    csvNumericCell(row.preorderHistoryAvailable === false ? null : row.preOrderBoughtQty),
    csvNumericCell(
      row.preorderOutstandingAvailable === false ? null : row.preOrderOutstandingQty,
    ),
    csvNumericCell(row.suggestionAvailable === false ? null : row.suggestedOrderQty),
  ].join(","));
  return [headerLine, ...lines].join("\r\n");
}
