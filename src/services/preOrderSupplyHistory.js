import { supabase } from "./supabase.js";
import { getFcSessionState } from "./fcSession.js";

const safeUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const normalizeEvent = (row = {}) => ({
  id: row.id,
  itemKey: row.item_key,
  orderId: row.order_number,
  itemId: row.order_item_id,
  actionType: row.action_type,
  productId: row.product_id,
  productName: row.product_name,
  supplierId: row.supplier_id,
  supplierName: row.supplier_name,
  customerId: row.customer_id,
  customerName: row.customer_name,
  quantity: Number(row.quantity || 0),
  previousQty: Number(row.previous_qty || 0),
  remainingQty: row.remaining_qty == null ? undefined : Number(row.remaining_qty),
  previousStatus: row.previous_status,
  newStatus: row.new_status,
  addedItemId: row.added_order_item_id,
  userId: row.changed_by_staff_id,
  userName: row.changed_by_name,
  timestamp: row.created_at,
  batchId: row.batch_id,
  boughtAt: row.bought_at,
  clientActionId: row.client_action_id,
  branchName: row.metadata?.branchName || null,
  recalledClientActionId: row.metadata?.recalledClientActionId || null,
  recalledEventId: row.metadata?.recalledEventId || null,
  metadata: row.metadata || {},
  orderStatus: row.order_status || row.metadata?.orderStatus || null,
  deliveryConfirmedAt:
    row.delivery_confirmed_at || row.metadata?.deliveryConfirmedAt || null,
  deliveryConfirmed: Boolean(
    row.delivery_confirmed || row.metadata?.deliveryConfirmed || false,
  ),
  syncStatus: "synced",
});

const sessionArgs = (user) => {
  const session = getFcSessionState(user);
  if (!session.valid) throw new Error("A valid Fair Choice staff session is required.");
  return session;
};

export async function loadPreOrderSupplyHistory(user, { pageSize = 500, maxPages = 20 } = {}) {
  const session = sessionArgs(user);
  let beforeCreatedAt = null;
  let beforeId = null;
  const rows = [];
  let rpcName = "fc_list_preorder_supply_events_v2";

  for (let page = 0; page < maxPages; page += 1) {
    let result = await supabase.rpc(rpcName, {
      p_username: session.username,
      p_session_token: session.token,
      p_before_created_at: beforeCreatedAt,
      p_before_id: beforeId,
      p_page_size: pageSize,
    });

    if (result.error && rpcName === "fc_list_preorder_supply_events_v2" && ["42883", "PGRST202"].includes(result.error.code)) {
      rpcName = "fc_list_preorder_supply_events_v1";
      result = await supabase.rpc(rpcName, {
        p_username: session.username,
        p_session_token: session.token,
        p_before_created_at: beforeCreatedAt,
        p_before_id: beforeId,
        p_page_size: pageSize,
      });
    }

    const { data, error } = result;
    if (error) {
      if (["42883", "PGRST202"].includes(error.code)) {
        return {
          history: {},
          events: [],
          available: false,
          sourceVersion: "unavailable",
          warning: "Permanent Pre-order Supply history is awaiting migration.",
        };
      }
      throw error;
    }

    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    const last = chunk[chunk.length - 1];
    beforeCreatedAt = last.created_at;
    beforeId = last.id;
  }

  const latest = {};
  for (const row of rows) {
    if (!row.item_key || latest[row.item_key] !== undefined) continue;
    latest[row.item_key] = row.action_type === "Recall" ? null : normalizeEvent(row);
  }

  return {
    history: Object.fromEntries(Object.entries(latest).filter(([, value]) => value !== null)),
    events: rows.map(normalizeEvent),
    available: true,
    sourceVersion: rpcName === "fc_list_preorder_supply_events_v1" ? "v1" : "v2",
    warning:
      rpcName === "fc_list_preorder_supply_events_v1"
        ? "Delivery-aware history is awaiting the latest migration."
        : "",
  };
}

export async function recordPreOrderSupplyEvent(action = {}, user) {
  const session = sessionArgs(user);
  const event = {
    item_key: action.itemKey,
    order_number: action.orderId,
    order_item_id: action.itemId || null,
    added_order_item_id: action.addedItemId || null,
    action_type: action.actionType,
    product_id: action.productId || null,
    product_name: action.productName || null,
    supplier_id: action.supplierId || null,
    supplier_name: action.supplierName || null,
    customer_id: action.customerId || null,
    customer_name: action.customerName || null,
    quantity: Number(action.quantity || 0),
    previous_qty: Number(action.previousQty || 0),
    remaining_qty:
      action.remainingQty === undefined ? null : Number(action.remainingQty || 0),
    previous_status: action.previousStatus || null,
    new_status: action.newStatus || null,
    client_action_id: action.clientActionId || safeUuid(),
    batch_id: action.batchId || null,
    metadata: {
      itemSnapshot: action.itemSnapshot || null,
      changes: action.changes || null,
      branchName: action.branchName || null,
      allocation: action.quantity || 0,
      supplierAttempt: {
        supplierId: action.supplierId || null,
        supplierName: action.supplierName || null,
        actionType: action.actionType || null,
      },
      recalledClientActionId: action.recalledClientActionId || null,
      recalledEventId: action.recalledEventId || null,
    },
  };
  const { data, error } = await supabase.rpc("fc_record_preorder_supply_event_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_event: event,
  });
  if (error) throw error;
  return normalizeEvent(Array.isArray(data) ? data[0] : data);
}
