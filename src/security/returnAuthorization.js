import { FC_PERMISSIONS, hasFcPermission } from "./fcPermissions.js";

export function normalizeReturnSessionRole(user = {}) {
  return String(user.role || user.access_level || user.staff_role || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const hasRoleAndPermission = (user, roles, permission) =>
  roles.includes(normalizeReturnSessionRole(user)) && hasFcPermission(user, permission);

export const canViewReturns = (user) =>
  hasRoleAndPermission(
    user,
    ["admin", "superadmin", "warehouse", "salesrep", "salesrepresentative"],
    FC_PERMISSIONS.RETURNS_VIEW,
  );

export const canApproveReturns = (user) =>
  hasRoleAndPermission(
    user,
    ["admin", "superadmin", "warehouse"],
    FC_PERMISSIONS.RETURNS_APPROVE,
  );

export const canReverseReturns = (user) =>
  hasRoleAndPermission(
    user,
    ["admin", "superadmin"],
    FC_PERMISSIONS.RETURNS_REVERSE,
  );

export const canReconcileReturns = (user) =>
  hasRoleAndPermission(
    user,
    ["admin", "superadmin"],
    FC_PERMISSIONS.RETURNS_RECONCILE,
  );
