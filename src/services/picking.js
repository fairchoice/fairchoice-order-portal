import { supabase } from "./supabase";

const requireSupabase = () => {
  if (!supabase) throw new Error("Supabase is not configured.");
};

export const getPickerIdentity = (user = {}) => ({
  id: String(user.staff_id || user.id || user.login_user_id || user.username || "unknown"),
  name: String(user.name || user.full_name || user.username || user.email || "Staff"),
});

export async function claimOrderForPicking(orderNumber, user) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const { data, error } = await supabase.rpc("claim_order_for_picking", {
    p_order_number: orderNumber,
    p_picker_id: picker.id,
    p_picker_name: picker.name,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.claimed) {
    throw new Error(result?.message || "This order is already being picked by another person.");
  }
  return result;
}

export async function savePickingDecision({ orderItemId, action, user, replacement = null }) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const payload = {
    picking_action: action,
    picking_decided_by: picker.id,
    picking_decided_by_name: picker.name,
    picking_decided_at: new Date().toISOString(),
    replacement_product_id: replacement?.id || null,
    replacement_product_code: replacement?.productCode || replacement?.product_code || null,
    replacement_product_name: replacement?.name || replacement?.productName || replacement?.product_name || null,
  };
  const { data, error } = await supabase
    .from("order_items")
    .update(payload)
    .eq("id", orderItemId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function recallPickingDecision(orderItemId) {
  requireSupabase();
  const { data, error } = await supabase
    .from("order_items")
    .update({
      picking_action: null,
      picking_decided_by: null,
      picking_decided_by_name: null,
      picking_decided_at: null,
      replacement_product_id: null,
      replacement_product_code: null,
      replacement_product_name: null,
    })
    .eq("id", orderItemId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function pauseOrderPicking(orderNumber, user) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const { data, error } = await supabase.rpc("pause_order_picking", {
    p_order_number: orderNumber,
    p_picker_id: picker.id,
  });
  if (error) throw error;
  return data;
}

export async function completeOrderPicking(orderNumber, user) {
  requireSupabase();
  const picker = getPickerIdentity(user);
  const { data, error } = await supabase.rpc("complete_order_picking", {
    p_order_number: orderNumber,
    p_picker_id: picker.id,
  });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.completed) throw new Error(result?.message || "Picking could not be completed.");
  return result;
}
