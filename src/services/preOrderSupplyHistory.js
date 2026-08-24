import { supabase } from "./supabase.js";
import { getFcSessionState } from "./fcSession.js";
import {
  loadWarehouseOperationalEvents,
  recordWarehouseOperationalActivity,
} from "./warehouseActivity.js";

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
      productCode: action.productCode || null,
      country: action.country || null,
      warehouseLocation: action.warehouseLocation || null,
      reason: action.reason || null,
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

export async function reversePreOrderSupplyForReceivedOrder({
  order,
  user,
  updateOrderItem,
  restorePreOrderSplit,
}) {
  if (!order || typeof updateOrderItem !== "function") return [];
  const orderId = String(order.orderId || order.order_number || "");
  const { events: warehouseEvents } = await loadWarehouseOperationalEvents(user);
  const recalledWarehouseEventIds = new Set(
    warehouseEvents
      .filter((event) => event.actionType === "Recall Available")
      .flatMap((event) => [event.referencedEventId, event.referencedClientActionId])
      .filter(Boolean)
      .map(String),
  );
  const activeAvailabilityEvents = warehouseEvents.filter((event) =>
    String(event.orderNumber || "") === orderId &&
    event.actionType === "Available" &&
    !recalledWarehouseEventIds.has(String(event.id)) &&
    !recalledWarehouseEventIds.has(String(event.clientActionId)),
  );

  for (const event of activeAvailabilityEvents) {
    const item = (order.items || []).find((entry) =>
      String(entry.dbId || entry.id || "") === String(event.orderItemId || ""),
    );
    if (!item || !["in stock", "available"].includes(
      String(item.sourceStatus || item.source_status || item.status || "").trim().toLowerCase(),
    )) continue;
    await recordWarehouseOperationalActivity({
      order,
      item,
      actionType: "Recall Available",
      newStatus: "Cannot Supply",
      sourceModule: "Order Lifecycle",
      reason: "Order moved back to Received",
      referencedEventId: event.id,
      referencedClientActionId: event.clientActionId,
    }, user);
  }

  const { events } = await loadPreOrderSupplyHistory(user);
  const recalledSupplierEventIds = new Set(
    events
      .filter((event) => event.actionType === "Recall")
      .flatMap((event) => [event.recalledEventId, event.recalledClientActionId])
      .filter(Boolean)
      .map(String),
  );
  const activeEvents = events
    .filter((event) =>
      String(event.orderId || "") === orderId &&
      ["Buy", "PartialBuy", "NextSup", "Remove"].includes(event.actionType) &&
      !recalledSupplierEventIds.has(String(event.id)) &&
      !recalledSupplierEventIds.has(String(event.clientActionId)),
    )
    .sort((left, right) =>
      new Date(right.timestamp || 0).getTime() - new Date(left.timestamp || 0).getTime(),
    );
  const reversals = [];

  for (const event of activeEvents) {
    const originalItem = (order.items || []).find((item) =>
      String(item.dbId || item.id || "") === String(event.itemId || ""),
    );
    if (event.actionType !== "NextSup" && !originalItem) {
      throw new Error(`Could not find ${event.productName || "the order item"} to reverse.`);
    }
    if (event.actionType === "PartialBuy" && event.addedItemId) {
      const addedItem = (order.items || []).find((item) =>
        String(item.dbId || item.id || "") === String(event.addedItemId),
      );
      if (!addedItem) throw new Error(`Could not find the bought split for ${event.productName || "the item"}.`);
      if (typeof restorePreOrderSplit === "function") {
        const restored = await restorePreOrderSplit(
          orderId,
          event.itemId,
          event.addedItemId,
          Number(event.previousQty || event.quantity || 0),
        );
        if (restored === false) throw new Error(`Could not reverse split item ${event.productName || ""}.`);
      } else {
        const restored = await updateOrderItem(orderId, event.itemId, {
          sourceStatus: "Need Supplier", includeInPicking: false, pickedQty: 0,
          qty: Number(event.previousQty || event.quantity || 0),
        });
        const cleared = await updateOrderItem(orderId, event.addedItemId, {
          sourceStatus: "Need Supplier", includeInPicking: false, pickedQty: 0, qty: 0,
        });
        if (restored === false || cleared === false) {
          throw new Error(`Could not reverse split item ${event.productName || ""}.`);
        }
      }
    } else if (event.actionType !== "NextSup") {
      const updated = await updateOrderItem(orderId, event.itemId, {
        sourceStatus: "Need Supplier",
        includeInPicking: false,
        pickedQty: 0,
        qty: Number(event.previousQty || event.quantity || 0),
      });
      if (updated === false) throw new Error(`Could not reverse ${event.productName || "order item"}.`);
    }

    reversals.push(await recordPreOrderSupplyEvent({
      ...event,
      id: undefined,
      clientActionId: safeUuid(),
      actionType: "Recall",
      previousStatus:
        event.actionType === "Remove"
          ? "Cannot Supply"
          : event.actionType === "NextSup"
            ? "Next Supplier"
            : "In Stock",
      newStatus: "Pre-Order",
      recalledClientActionId: event.clientActionId,
      recalledEventId: event.id,
      reason: "Order moved back to Received",
      timestamp: new Date().toISOString(),
    }, user));
  }
  return reversals;
}
