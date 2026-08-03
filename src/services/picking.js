import { supabase } from "./supabase.js";
import { getFcSessionState } from "./fcSession.js";
import { resolveOrderInventoryCountry } from "./locationStock.js";

const requireSupabase = () => { if (!supabase) throw new Error("Supabase is not configured."); };
const requireSession = (user = {}) => {
  const session = getFcSessionState(user);
  if (!session.valid) throw new Error("A valid Fair Choice staff session is required.");
  return session;
};

export const createClientActionId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0,4).join("")}-${hex.slice(4,6).join("")}-${hex.slice(6,8).join("")}-${hex.slice(8,10).join("")}-${hex.slice(10).join("")}`;
};

export const getPickerIdentity = (user = {}) => ({ id: String(user.staff_id || user.id || ""), name: String(user.staff_name || user.name || user.username || "Staff") });
export const getOrderedQty = (item = {}) => Number(item.pickingOrderedQty ?? item.picking_ordered_qty ?? item.qty ?? item.quantity ?? 0);
export const getResolvedQty = (item = {}) => Number(item.pickingInStockQty ?? item.picking_in_stock_qty ?? 0) + Number(item.pickingPreOrderQty ?? item.picking_pre_order_qty ?? 0) + Number(item.pickingReplacedQty ?? item.picking_replaced_qty ?? 0);
export const getRemainingPickingQty = (item = {}) => Math.max(0, getOrderedQty(item) - getResolvedQty(item));

export async function claimOrderForPicking(orderNumber, user) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const { data, error } = await supabase.rpc("claim_order_for_picking", { p_order_number: orderNumber, p_picker_id: picker.id, p_picker_name: picker.name });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.claimed) throw new Error(result?.message || "This order is already being picked by another person.");
  return result;
}

export async function savePickingDecision({ order, orderItemId, action, quantity, user, replacement = null, clientActionId = createClientActionId() }) {
  requireSupabase();
  const session = requireSession(user);
  const inventoryCountry = resolveOrderInventoryCountry(order);
  if (!inventoryCountry && action !== "pre_order") throw new Error("The order inventory country cannot be resolved safely.");
  const { data, error } = await supabase.rpc("fc_apply_picking_quantity_v1", {
    p_username: session.username, p_session_token: session.token, p_order_item_id: orderItemId,
    p_action: action, p_quantity: Number(quantity), p_client_action_id: clientActionId,
    p_inventory_country: inventoryCountry || null,
    p_replacement_product_id: replacement?.id || null,
    p_replacement_product_code: replacement?.productCode || replacement?.product_code || null,
    p_replacement_product_name: replacement?.name || replacement?.productName || replacement?.product_name || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function recallPickingDecision(orderItemId, user) {
  requireSupabase();
  const session = requireSession(user);
  const { data, error } = await supabase.rpc("fc_recall_picking_quantities_v1", { p_username: session.username, p_session_token: session.token, p_order_item_id: orderItemId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function pauseOrderPicking(orderNumber, user) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const { data, error } = await supabase.rpc("pause_order_picking", { p_order_number: orderNumber, p_picker_id: picker.id });
  if (error) throw error;
  return data;
}

export async function completeOrderPicking(orderNumber, user) {
  requireSupabase();
  const session = requireSession(user);
  const { data, error } = await supabase.rpc("complete_order_picking", { p_username: session.username, p_session_token: session.token, p_order_number: orderNumber });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.completed) throw new Error(result?.message || "Picking could not be completed.");
  return result;
}
