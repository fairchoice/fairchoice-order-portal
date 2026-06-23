import { supabase } from "../services/supabase";

export async function logAction({
  user,
  user_id = null,
  username = null,
  staff_name = null,
  role_access_level = null,
  action_type,
  page_module,
  order_id = null,
  product_id = null,
  old_value = null,
  new_value = null,
}) {
  if (!user && !user_id && !username) return;

  const { error } = await supabase.from("audit_logs").insert({
    user_id: user_id || user?.id || null,
    username: username || user?.username || null,
    staff_name: staff_name || user?.staff_name || null,
    role_access_level: role_access_level || user?.access_level || user?.role || null,
    action_type,
    page_module,
    order_id,
    product_id,
    old_value,
    new_value,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.warn("Audit log skipped:", error.message);
  }
}