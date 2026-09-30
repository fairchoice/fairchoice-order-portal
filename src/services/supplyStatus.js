const simplifyStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const STATUS_MAP = new Map([
  ["in stock", { key: "IN_STOCK", databaseStatus: "In Stock", group: "In Stock" }],
  ["available", { key: "IN_STOCK", databaseStatus: "In Stock", group: "In Stock" }],
  ["bought", { key: "BOUGHT", databaseStatus: "In Stock", group: "Bought" }],
  ["pre order", { key: "PRE_ORDER", databaseStatus: "Need Supplier", group: "Pre-order" }],
  ["preorder", { key: "PRE_ORDER", databaseStatus: "Need Supplier", group: "Pre-order" }],
  ["need supplier", { key: "PRE_ORDER", databaseStatus: "Need Supplier", group: "Pre-order" }],
  ["supply needed", { key: "PRE_ORDER", databaseStatus: "Need Supplier", group: "Pre-order" }],
  ["next supplier", { key: "NEXT_SUPPLY", databaseStatus: "Next Supplier", group: "Next Supply" }],
  ["next supply", { key: "NEXT_SUPPLY", databaseStatus: "Next Supplier", group: "Next Supply" }],
  ["supplier pending", { key: "NEXT_SUPPLY", databaseStatus: "Next Supplier", group: "Next Supply" }],
  ["cannot supply", { key: "CANNOT_SUPPLY", databaseStatus: "Cannot Supply", group: "Cannot Supply" }],
  ["removed", { key: "CANNOT_SUPPLY", databaseStatus: "Cannot Supply", group: "Cannot Supply" }],
]);

export const SUPPLY_GROUP_ORDER = Object.freeze([
  "In Stock",
  "Pre-order",
  "Next Supply",
  "Cannot Supply",
  "Bought",
]);

export function normalizeSupplyStatus(value) {
  const normalized = simplifyStatus(value);
  return (
    STATUS_MAP.get(normalized) || {
      key: "UNKNOWN",
      databaseStatus: String(value || "").trim(),
      group: String(value || "").trim() || "Unknown",
    }
  );
}

export function isSupplyRecordStatus(value) {
  return ["PRE_ORDER", "NEXT_SUPPLY", "CANNOT_SUPPLY"].includes(
    normalizeSupplyStatus(value).key,
  );
}

export function supplyGroupRank(value) {
  const index = SUPPLY_GROUP_ORDER.indexOf(normalizeSupplyStatus(value).group);
  return index === -1 ? SUPPLY_GROUP_ORDER.length : index;
}

export function groupSupplyItemsFromSnapshot(
  items = [],
  statusSnapshot = new Map(),
  { scopeKey = "", getId, getStatus } = {},
) {
  const resolveId =
    getId ||
    ((item, index) =>
      item?.dbId || item?.id || item?.productId || item?.product_id || index);
  const resolveStatus =
    getStatus ||
    ((item) =>
      item?.sourceStatus || item?.source_status || item?.status || "In Stock");

  return (items || [])
    .map((item, index) => {
      const snapshotKey = `${scopeKey}:${String(resolveId(item, index))}`;
      if (!statusSnapshot.has(snapshotKey)) {
        statusSnapshot.set(snapshotKey, resolveStatus(item));
      }

      return {
        item,
        index,
        rank: supplyGroupRank(statusSnapshot.get(snapshotKey)),
      };
    })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
}
