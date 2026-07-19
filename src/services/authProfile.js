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

export function normalizeStaffRole(role) {
  const normalized = String(role || "")
    .trim()
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  if (normalized === "superadmin") return "Super Admin";
  if (["admin", "administrator", "backofficeadmin"].includes(normalized)) return "Admin";
  if (normalized === "salesrep" || normalized === "salesrepresentative") return "Sales Rep";
  if (normalized === "warehouse") return "Warehouse";
  if (normalized === "driver") return "Driver";
  if (normalized === "customer") return "Customer";
  return String(role || "Staff").trim() || "Staff";
}

export function isAdminStaffRole(role) {
  return ["Admin", "Super Admin"].includes(normalizeStaffRole(role));
}

export function buildLegacyStaffProfile(loginUser, staff) {
  if (!loginUser) throw new Error("The staff login record could not be loaded.");
  if (!loginUser.staff_id) {
    throw new Error("This staff login is not linked to an individual staff record.");
  }
  if (!staff || staff.active === false) {
    throw new Error("The linked staff record is inactive or unavailable.");
  }

  const role = normalizeStaffRole(loginUser.role || staff.role);
  const username = loginUser.username || staff.username || staff.staff_name || "Staff";

  return {
    ...staff,
    id: loginUser.id,
    login_user_id: loginUser.id,
    staff_id: staff.id,
    username,
    email: staff.email || "",
    role,
    staff_role: normalizeStaffRole(staff.role),
    access_level: role,
    permissions: mergePermissions(role, {
      ...(staff.permissions || {}),
      ...(loginUser.permissions || {}),
    }),
    active: loginUser.active !== false && staff.active !== false,
    branch_access: Array.isArray(staff.branch_access) ? staff.branch_access : [],
    customer_account_id: null,
  };
}

export function resolveBackOfficeAccess(profile) {
  if (!profile) return { allowed: false, reason: "The staff profile could not be loaded." };
  if (profile.active === false) return { allowed: false, reason: "This staff account is inactive." };
  if (!profile.login_user_id || !profile.staff_id) {
    return { allowed: false, reason: "This staff login is not linked to an individual staff record." };
  }
  if (!isAdminStaffRole(profile.role)) {
    return { allowed: false, reason: "Back Office access is restricted to active administrators." };
  }

  return { allowed: true, reason: "" };
}

export async function loadAuthenticatedStaffProfile(supabase, session) {
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    throw new Error("The authenticated Supabase user does not have an email address.");
  }

  const { data: staff, error } = await supabase
    .from("staff_users")
    .select("id, staff_name, username, email, role, permissions, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load the staff profile: ${error.message}`);
  }

  if (!staff) {
    throw new Error("Login blocked. No active staff record matches this authenticated email.");
  }

  const role = normalizeStaffRole(staff.role);
  const username = staff.username || staff.staff_name || staff.email || email;

  return {
    id: staff.id,
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
