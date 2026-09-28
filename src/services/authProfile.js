export function mergePermissions(role, savedPermissions) {
  void role;
  return { ...(savedPermissions || {}) };
}

export function normalizeStaffRole(role) {
  const normalized = String(role || "")
    .trim()
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  if (normalized === "superadmin") return "Super Admin";
  if (["admin", "administrator", "backofficeadmin"].includes(normalized)) return "Admin";
  if (normalized === "salesrep" || normalized === "salesrepresentative") return "Sales Rep";
  if (normalized === "accounts") return "Accounts";
  if (normalized === "accountant") return "Accountant";
  if (normalized === "warehouse") return "Warehouse";
  if (normalized === "driver") return "Driver";
  if (normalized === "brandpartner" || normalized === "partner") return "Brand Partner";
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
  const role = normalizeStaffRole(profile.role);
  if (!["Admin", "Super Admin", "Brand Partner"].includes(role)) {
    return { allowed: false, reason: "Back Office access is restricted to authorised staff." };
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
