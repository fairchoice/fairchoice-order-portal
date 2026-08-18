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
  if (warehouseStage === "Cannot Supply") return warehouseStage;
  if (action?.actionType === "NextSup" || action?.actionType === "PartialBuy") {
    return "Next Supplier";
  }
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

export function isLivePreOrderDemandOrder(order = {}) {
  return LIVE_PREORDER_DEMAND_STATUSES.has(String(order?.status || "").trim());
}
