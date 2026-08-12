import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canApproveReturns,
  canReconcileReturns,
  canReverseReturns,
  canViewReturns,
} from "./returnAuthorization.js";

const migration = fs.readFileSync(
  new URL("../../supabase/migrations/20260812090000_atomic_customer_return_approval.sql", import.meta.url),
  "utf8",
);
const portal = fs.readFileSync(new URL("../pages/AdminSetup/ReturnsPortal.jsx", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../pages/AdminSetup/BackOfficeLayout.jsx", import.meta.url), "utf8");

const profile = (role, effectivePermissions, staffId = "shared-staff") => ({
  role,
  staff_id: staffId,
  effective_permissions: effectivePermissions,
});

test("Warehouse alias can approve while Driver and Sales Rep aliases of the same staff cannot", () => {
  const inherited = { "returns.view": true, "returns.approve": true };
  assert.equal(canApproveReturns(profile("Warehouse", inherited)), true);
  assert.equal(canApproveReturns(profile("Driver", inherited)), false);
  assert.equal(canApproveReturns(profile("Sales Rep", inherited)), false);
});

test("Super Admin alias retains privileged actions while Driver alias of the same staff is denied", () => {
  const inherited = {
    "returns.view": true,
    "returns.approve": true,
    "returns.reverse": true,
    "returns.reconcile": true,
  };
  const superAdmin = profile("Super Admin", inherited, "second-shared-staff");
  const driver = profile("Driver", inherited, "second-shared-staff");
  assert.equal(canApproveReturns(superAdmin), true);
  assert.equal(canReverseReturns(superAdmin), true);
  assert.equal(canReconcileReturns(superAdmin), true);
  assert.equal(canApproveReturns(driver), false);
  assert.equal(canReverseReturns(driver), false);
  assert.equal(canReconcileReturns(driver), false);
});

test("Admin and Warehouse roles without returns.approve are denied", () => {
  assert.equal(canApproveReturns(profile("Admin", {})), false);
  assert.equal(canApproveReturns(profile("Warehouse", {})), false);
});

test("Admin role without returns.reverse or returns.reconcile is denied", () => {
  assert.equal(canReverseReturns(profile("Admin", { "returns.approve": true })), false);
  assert.equal(canReconcileReturns(profile("Admin", { "returns.approve": true })), false);
});

test("Warehouse cannot reverse or reconcile even when staff permissions contain both", () => {
  const inherited = { "returns.reverse": true, "returns.reconcile": true };
  assert.equal(canReverseReturns(profile("Warehouse", inherited)), false);
  assert.equal(canReconcileReturns(profile("Warehouse", inherited)), false);
});

test("Returns visibility uses current alias role and returns.view together", () => {
  assert.equal(canViewReturns(profile("Warehouse", { "returns.view": true })), true);
  assert.equal(canViewReturns(profile("Sales Representative", { "returns.view": true })), true);
  assert.equal(canViewReturns(profile("Sales Rep", {})), false);
  assert.equal(canViewReturns(profile("Driver", { "returns.view": true })), false);
});

test("RPCs derive the current alias role from the validated session actor", () => {
  assert.match(
    migration,
    /fc_require_session_permission\(p_username, p_session_token, 'returns\.approve'\)[\s\S]*v_actor\.staff_role[\s\S]*not in \('admin', 'superadmin', 'warehouse'\)/,
  );
  assert.match(
    migration,
    /fc_require_session_permission\(p_username,p_session_token,'returns\.reverse'\)[\s\S]*v_actor\.staff_role[\s\S]*not in \('admin', 'superadmin'\)/,
  );
  assert.match(
    migration,
    /fc_require_session_permission\(p_username,p_session_token,'returns\.reconcile'\)[\s\S]*v_actor\.staff_role[\s\S]*not in \('admin', 'superadmin'\)/,
  );
  assert.doesNotMatch(migration, /p_role|p_staff_role|p_access_level/);
});

test("permission validation occurs before the alias-role allowlist", () => {
  const approvePermission = migration.indexOf(
    "fc_require_session_permission(p_username, p_session_token, 'returns.approve')",
  );
  const approveRole = migration.indexOf("FC role denied: returns.approve");
  const reversePermission = migration.indexOf(
    "fc_require_session_permission(p_username,p_session_token,'returns.reverse')",
  );
  const reverseRole = migration.indexOf("FC role denied: returns.reverse");
  assert.ok(approvePermission >= 0 && approveRole > approvePermission);
  assert.ok(reversePermission >= 0 && reverseRole > reversePermission);
});

test("Returns UI and navigation use the shared role-and-permission predicates", () => {
  assert.match(portal, /canCurrentLoginApproveReturns\(currentUser\)/);
  assert.match(portal, /canCurrentLoginReverseReturns\(currentUser\)/);
  assert.match(portal, /canCurrentLoginReconcileReturns\(currentUser\)/);
  assert.match(layout, /page === "returnsPortal"[\s\S]*canViewReturns\(user\)/);
});
