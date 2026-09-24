export function allocateSupplierQuantity(lines = [], totalQuantity = 0, existing = {}) {
  let remaining = Math.max(0, Number(totalQuantity || 0));
  const allocations = {};
  for (const line of lines) {
    const current = Number(existing[line.itemKey]);
    if (Number.isFinite(current) && current >= 0) {
      const allocated = Math.min(current, line.qty, remaining);
      allocations[line.itemKey] = allocated;
      remaining -= allocated;
      continue;
    }
    const allocated = Math.min(line.qty, remaining);
    allocations[line.itemKey] = allocated;
    remaining -= allocated;
  }
  return allocations;
}

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

export function warehouseSupplyStage(value) {
  const status = normalizeStatus(value);
  if (
    [
      "pre order",
      "preorder",
      "need supplier",
      "supply needed",
      // Legacy values written by the old workflow are still unresolved demand.
      "next supplier",
      "next supply",
      "supplier pending",
    ].includes(status)
  ) {
    return "Pre-order";
  }
  if (["cannot supply", "removed"].includes(status)) return "Cannot Supply";
  return null;
}

export function preOrderWorkflowStage(warehouseStatus, action, { pending = false } = {}) {
  const warehouseStage = warehouseSupplyStage(warehouseStatus);
  if (action?.actionType === "Recall") return "Pre-order";
  if (action?.actionType === "NextSup" || action?.actionType === "PartialBuy") {
    return "Next Supplier";
  }
  if (warehouseStage === "Cannot Supply") return warehouseStage;
  if (pending && action?.actionType === "Buy") return "Bought";
  if (pending && action?.actionType === "Remove") return "Cannot Supply";
  return warehouseStage;
}

export function preOrderSupplyItemChanges(
  actionType,
  { quantity = 0, remainingQuantity = 0, restoreQuantity = 0 } = {},
) {
  if (actionType === "Buy") {
    return {
      sourceStatus: "In Stock",
      includeInPicking: true,
      pickedQty: Number(quantity || 0),
    };
  }
  if (actionType === "PartialBuy") {
    return {
      sourceStatus: "Need Supplier",
      includeInPicking: false,
      pickedQty: 0,
      qty: Number(remainingQuantity || 0),
    };
  }
  if (actionType === "NextSup") return null;
  if (actionType === "Available") {
    return { sourceStatus: "In Stock", includeInPicking: true, pickedQty: Number(quantity || 0) };
  }
  if (actionType === "Recall Available") {
    return { sourceStatus: "Cannot Supply", includeInPicking: false, pickedQty: 0 };
  }
  if (actionType === "Remove") {
    return { sourceStatus: "Cannot Supply", includeInPicking: false, pickedQty: 0 };
  }
  if (actionType === "Recall") {
    return {
      sourceStatus: "Need Supplier",
      includeInPicking: false,
      pickedQty: 0,
      qty: Number(restoreQuantity || 0),
    };
  }
  return null;
}

export const LIVE_PREORDER_DEMAND_STATUSES = new Set([
  "Received",
  "In Progress",
  "Warehouse Packing",
]);

export const ACTIVE_PREORDER_SUPPLY_STATUSES = new Set(["Warehouse Packing"]);

export function isLivePreOrderDemandOrder(order = {}) {
  return LIVE_PREORDER_DEMAND_STATUSES.has(String(order?.status || "").trim());
}

export function isActivePreOrderSupplyOrder(order = {}) {
  return ACTIVE_PREORDER_SUPPLY_STATUSES.has(String(order?.status || "").trim());
}

export function isWarehousePreOrderQueueLine(order = {}, displayStatus = "") {
  return isActivePreOrderSupplyOrder(order) && displayStatus === "Pre-order";
}

export function isLivePreOrderSupplyEvent(
  event = {},
  liveItemKeys = new Set(),
  liveItemIds = new Set(),
) {
  if (event.itemKey && liveItemKeys.has(String(event.itemKey))) return true;
  return [event.itemId, event.orderItemId, event.addedItemId]
    .filter(Boolean)
    .some((id) => liveItemIds.has(String(id)));
}

export const PREORDER_SUPPLY_PENDING_KEY = "fairchoice_preorder_supply_pending";

export function filterPendingPreOrderActionsForOrders(actions = [], orders = []) {
  const liveOrderIds = new Set(
    orders
      .filter(isActivePreOrderSupplyOrder)
      .map((order) => String(order.orderId || order.order_number || "")),
  );
  return actions.filter((action) => liveOrderIds.has(String(action.orderId || "")));
}

export function clearPendingPreOrderActionsForOrder(orderId, storage = globalThis.localStorage) {
  if (!storage || !orderId) return;
  let actions;
  try {
    actions = JSON.parse(storage.getItem(PREORDER_SUPPLY_PENDING_KEY) || "[]");
  } catch {
    storage.removeItem(PREORDER_SUPPLY_PENDING_KEY);
    return;
  }
  const remaining = actions.filter(
    (action) => String(action.orderId || "") !== String(orderId),
  );
  if (remaining.length) storage.setItem(PREORDER_SUPPLY_PENDING_KEY, JSON.stringify(remaining));
  else storage.removeItem(PREORDER_SUPPLY_PENDING_KEY);
}
