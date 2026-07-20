import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLegacyStaffProfile,
  isAdminStaffRole,
  normalizeStaffRole,
  resolveBackOfficeAccess,
} from "./authProfile.js";

test("admin role variants normalize without relying on usernames", () => {
  assert.equal(normalizeStaffRole("Admin"), "Admin");
  assert.equal(normalizeStaffRole("admin"), "Admin");
  assert.equal(normalizeStaffRole("administrator"), "Admin");
  assert.equal(normalizeStaffRole("backoffice_admin"), "Admin");
  assert.equal(normalizeStaffRole("Super Admin"), "Super Admin");
  assert.equal(isAdminStaffRole("Staff"), false);
});

test("legacy staff profile uses login role and exact staff_id without requiring email or auth ID", () => {
  const staff = { id: "staff-1", role: "Staff", active: true, email: "" };
  const profile = buildLegacyStaffProfile(
    {
      id: "login-1",
      username: "nisstaj_admin",
      staff_id: "staff-1",
      role: "Super Admin",
      active: true,
      permissions: {},
    },
    staff
  );

  assert.equal(profile.login_user_id, "login-1");
  assert.equal(profile.staff_id, "staff-1");
  assert.equal(profile.role, "Super Admin");
  assert.equal(profile.email, "");
  assert.equal(resolveBackOfficeAccess(profile).allowed, true);
  assert.match(resolveBackOfficeAccess({ ...profile, role: "Driver" }).reason, /administrators/i);
  assert.match(resolveBackOfficeAccess({ ...profile, staff_id: null }).reason, /not linked/i);
  assert.match(resolveBackOfficeAccess({ ...profile, active: false }).reason, /inactive/i);
});
