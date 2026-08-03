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

export const LIVE_PREORDER_DEMAND_STATUSES = new Set([
  "Received",
  "In Progress",
  "Warehouse Packing",
]);

export function isLivePreOrderDemandOrder(order = {}) {
  return LIVE_PREORDER_DEMAND_STATUSES.has(String(order?.status || "").trim());
}
