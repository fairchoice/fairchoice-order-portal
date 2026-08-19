import { getFcSessionState } from "./fcSession.js";
import { supabase } from "./supabase.js";

export const WAREHOUSE_STATUSES = Object.freeze(["In Stock", "Pre-Order", "Cannot Supply"]);

export const emptyWarehouseActivityFilters = Object.freeze({
  dateFrom: "",
  dateTo: "",
  country: "All",
  staff: "All",
  product: "All",
  customer: "All",
  orderNumber: "",
  action: "All",
  oldStatus: "All",
  newStatus: "All",
  supplier: "All",
});

const safeUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidOrNull = (value) => UUID_PATTERN.test(String(value || "").trim()) ? String(value).trim() : null;

export const normalizeWarehouseStatus = (value) => {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (["in stock", "available"].includes(status)) return "In Stock";
  if (["need supplier", "pre order", "preorder", "supply needed", "next supplier"].includes(status)) {
    return "Pre-Order";
  }
  if (status === "cannot supply") return "Cannot Supply";
  return String(value || "").trim();
};

const sessionArgs = (user) => {
  const session = getFcSessionState(user);
  if (!session.valid) throw new Error("A valid Fair Choice staff session is required.");
  return session;
};

export const normalizeWarehouseActivity = (row = {}) => ({
  id: row.id,
  clientActionId: row.client_action_id,
  orderNumber: row.order_number,
  orderId: row.order_id,
  orderItemId: row.order_item_id,
  productId: row.product_id,
  productCode: row.product_code,
  productName: row.product_name,
  quantity: Number(row.quantity || 0),
  customerId: row.customer_id,
  customerName: row.customer_name,
  branchName: row.branch_name,
  country: row.country,
  warehouseLocation: row.warehouse_location,
  oldStatus: normalizeWarehouseStatus(row.old_status),
  newStatus: normalizeWarehouseStatus(row.new_status),
  actionType: row.action_type,
  reason: row.reason,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  staffId: row.changed_by_staff_id,
  staffName: row.changed_by_name,
  staffRole: row.changed_by_role,
  sourceModule: row.source_module,
  referencedEventId: row.referenced_event_id,
  referencedClientActionId: row.referenced_client_action_id,
  timestamp: row.created_at,
  metadata: row.metadata || {},
});

export function buildWarehouseActivityEvent({ order = {}, item = {}, ...activity } = {}) {
  return {
    client_action_id: activity.clientActionId || safeUuid(),
    order_number: order.orderId || order.order_number,
    order_id: uuidOrNull(order.dbId || order.id),
    order_item_id: item.dbId || item.id,
    product_id: uuidOrNull(item.productId || item.product_id || item.product?.id),
    product_code: item.productCode || item.product_code || item.code || null,
    product_name: item.name || item.productName || item.product_name || "Unnamed Product",
    customer_id: uuidOrNull(order.customerAccountId || order.customer_account_id),
    customer_name: order.companyName || order.company_name || order.customerName || null,
    branch_name: order.branchName || order.branch_name || null,
    country:
      order.customer_country || order.customerCountry || order.branch_country ||
      order.branchCountry || order.delivery_country || order.country || null,
    warehouse_location: activity.warehouseLocation || null,
    new_status: normalizeWarehouseStatus(activity.newStatus),
    action_type: activity.actionType,
    reason: activity.reason || null,
    source_module: activity.sourceModule || "Warehouse",
    referenced_event_id: uuidOrNull(activity.referencedEventId),
    referenced_client_action_id: activity.referencedClientActionId || null,
    metadata: activity.metadata || {},
  };
}

export async function recordWarehouseOperationalActivity(activity, user) {
  const session = sessionArgs(user);
  const event = buildWarehouseActivityEvent(activity);
  const { data, error } = await supabase.rpc("fc_record_warehouse_operational_event_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_event: event,
  });
  if (error) throw error;
  return normalizeWarehouseActivity(Array.isArray(data) ? data[0] : data);
}

export async function loadWarehouseOperationalEvents(user, pageSize = 1000) {
  const session = sessionArgs(user);
  const { data, error } = await supabase.rpc("fc_list_warehouse_operational_events_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_page_size: pageSize,
  });
  if (error) {
    if (["42883", "PGRST202"].includes(error.code)) {
      return { events: [], available: false, warning: "Warehouse activity migration is awaiting review." };
    }
    throw error;
  }
  return { events: (data || []).map(normalizeWarehouseActivity), available: true, warning: "" };
}

export async function loadWarehouseActivityReport(user, { dateFrom = "", dateTo = "" } = {}) {
  const session = sessionArgs(user);
  const { data, error } = await supabase.rpc("fc_list_warehouse_activity_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_date_from: dateFrom ? `${dateFrom}T00:00:00` : null,
    p_date_to: dateTo ? `${dateTo}T23:59:59.999` : null,
    p_page_size: 5000,
  });
  if (error) throw error;
  return (data || []).map(normalizeWarehouseActivity);
}

const optionValues = (rows, field) =>
  [...new Set(rows.map((row) => String(row[field] || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));

export function getWarehouseActivityFilterOptions(rows = []) {
  return {
    countries: optionValues(rows, "country"),
    staff: optionValues(rows, "staffName"),
    products: optionValues(rows, "productName"),
    customers: optionValues(rows, "customerName"),
    actions: optionValues(rows, "actionType"),
    oldStatuses: optionValues(rows, "oldStatus"),
    newStatuses: optionValues(rows, "newStatus"),
    suppliers: optionValues(rows, "supplierName"),
  };
}

export function filterWarehouseActivity(rows = [], filters = emptyWarehouseActivityFilters) {
  const matches = (field, expected) => expected === "All" || String(field || "") === expected;
  const orderSearch = String(filters.orderNumber || "").trim().toLowerCase();
  const from = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00`).getTime() : null;
  const to = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999`).getTime() : null;
  return rows.filter((row) => {
    const timestamp = new Date(row.timestamp || 0).getTime();
    return (!from || timestamp >= from) && (!to || timestamp <= to) &&
      matches(row.country, filters.country) && matches(row.staffName, filters.staff) &&
      matches(row.productName, filters.product) && matches(row.customerName, filters.customer) &&
      matches(row.actionType, filters.action) && matches(row.oldStatus, filters.oldStatus) &&
      matches(row.newStatus, filters.newStatus) && matches(row.supplierName, filters.supplier) &&
      (!orderSearch || String(row.orderNumber || "").toLowerCase().includes(orderSearch));
  });
}

export const sumWarehouseActivityQuantity = (rows = []) =>
  rows.reduce((total, row) => total + Number(row.quantity || 0), 0);

export function summarizeWarehouseActivity(rows = []) {
  const count = (oldStatus, newStatus) => rows.filter(
    (row) => row.oldStatus === oldStatus && row.newStatus === newStatus,
  ).length;
  return {
    total: rows.length,
    inStockToPreOrder: count("In Stock", "Pre-Order"),
    inStockToCannotSupply: count("In Stock", "Cannot Supply"),
    preOrderToInStock: count("Pre-Order", "In Stock"),
    preOrderToCannotSupply: count("Pre-Order", "Cannot Supply"),
    cannotSupplyToInStock: count("Cannot Supply", "In Stock"),
    recalls: rows.filter((row) => String(row.actionType || "").startsWith("Recall")).length,
  };
}
