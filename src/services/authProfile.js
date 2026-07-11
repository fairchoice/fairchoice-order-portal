const DEFAULT_PERMISSIONS = {
  "Super Admin": {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: true,
    access_sales_rep: true,
    access_customer_portal: true,
    access_customer_setup: true,
    access_product_setup: true,
    access_accounts: true,
    access_reports: true,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: true,
    can_archive_order: true,
    can_edit_pricing: true,
    can_edit_security: true,
  },
  Admin: {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: true,
    access_sales_rep: true,
    access_customer_portal: true,
    access_customer_setup: true,
    access_product_setup: true,
    access_accounts: true,
    access_reports: true,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: true,
    can_archive_order: true,
    can_edit_pricing: true,
    can_edit_security: false,
  },
  Warehouse: {
    access_received_orders: true,
    access_warehouse: true,
    access_driver: false,
    access_sales_rep: false,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
  Driver: {
    access_received_orders: false,
    access_warehouse: false,
    access_driver: true,
    access_sales_rep: false,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: false,
    can_change_order_status_in_progress: false,
    can_add_product_to_order: false,
    can_move_to_warehouse: false,
    can_print: false,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
  "Sales Rep": {
    access_received_orders: false,
    access_warehouse: false,
    access_driver: false,
    access_sales_rep: true,
    access_customer_portal: false,
    access_customer_setup: false,
    access_product_setup: false,
    access_accounts: false,
    access_reports: false,
    can_receive_order: false,
    can_change_order_status_in_progress: false,
    can_add_product_to_order: false,
    can_move_to_warehouse: false,
    can_print: false,
    can_cancel_order: false,
    can_archive_order: false,
    can_edit_pricing: false,
    can_edit_security: false,
  },
};

export function mergePermissions(role, savedPermissions) {
  return {
    ...(DEFAULT_PERMISSIONS[role] || {}),
    ...(savedPermissions || {}),
  };
}

export async function loadAuthenticatedStaffProfile(supabase, session) {
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    throw new Error("The authenticated Supabase user does not have an email address.");
  }

  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("id, staff_name, email, role, permissions, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the staff profile: ${error.message}`);
  }

  if (!staff) {
    throw new Error("Login blocked. No active staff record matches this authenticated email.");
  }

  const role = staff.role || "Staff";
  const username = staff.staff_name || staff.email || email;

  return {
    id: staff.id,
    auth_user_id: session.user.id,
    username,
    email: staff.email || email,
    role,
    access_level: role,
    permissions: mergePermissions(role, staff.permissions),
    staff_id: staff.id,
    staff_name: staff.staff_name || username,
    active: staff.active,
    customer_account_id: null,
  };
}
