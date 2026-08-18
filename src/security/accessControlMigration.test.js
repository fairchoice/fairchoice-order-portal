import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_REGISTERED_PERMISSION_KEYS } from "./accessControlRegistry.js";

const migration = readFileSync(
  new URL("../../supabase/migrations/20260817232018_staff_access_control_registry.sql", import.meta.url),
  "utf8",
);

test("migration registers every centralized page and important-function key", () => {
  for (const key of ALL_REGISTERED_PERMISSION_KEYS) {
    assert.match(migration, new RegExp(`'${key.replaceAll(".", "\\.")}'`));
  }
});

test("migration protects the master account in database triggers and effective permissions", () => {
  assert.match(migration, /v_username\s*=\s*'nisstaj_admin'[\s\S]*all_access/i);
  assert.match(migration, /fc_protect_master_admin_login/i);
  assert.match(migration, /cannot be deactivated/i);
  assert.match(migration, /cannot be deleted/i);
});

test("access-control RPCs require a secure FC session permission and audit changes", () => {
  assert.match(migration, /fc_access_control_snapshot_v1[\s\S]*fc_require_session_permission_v2\(p_username, p_session_token, 'permissions\.manage'\)/i);
  assert.match(migration, /fc_save_staff_access_v1[\s\S]*ACCESS_CONTROL_CHANGED/i);
  assert.match(migration, /old_permissions[\s\S]*new_permissions/i);
});

test("migration is additive and retains legacy login permission JSON", () => {
  assert.doesNotMatch(migration, /drop\s+(?:table|column).*permissions/i);
  assert.match(migration, /Translate legacy JSON flags once/i);
  assert.match(migration, /on conflict\(staff_id, permission_key\) do nothing/i);
});

test("existing Admin workflows and standard staff role entry pages are backfilled", () => {
  assert.match(migration, /cross join public\.fc_permissions[\s\S]*lower\(trim\(l\.role\)\) = 'admin'/i);
  assert.match(migration, /'warehouse','page\.operations\.received_orders'[\s\S]*'warehouse','page\.operations\.pre_order_supply'/i);
  assert.match(migration, /'driver','page\.operations\.driver'/i);
  assert.match(migration, /'salesrep','page\.order\.sales_rep'/i);
});
