export function hasPermission(user, permissionKey) {
  if (!user) return false;
  if (user.role === "Super Admin" || user.access_level === "Super Admin") return true;
  if (user.role === "Customer" || user.access_level === "Customer") {
    return permissionKey === "access_customer_portal";
  }
  return user.permissions?.[permissionKey] === true;
}

export function requirePermission(
  user,
  permissionKey,
  message = "You do not have permission for this action."
) {
  if (!hasPermission(user, permissionKey)) {
    alert(message);
    return false;
  }
  return true;
}
