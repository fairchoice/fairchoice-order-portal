import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260804090000_full_business_security_hardening_phase1.sql",
  "utf8",
);
const loginPage = fs.readFileSync("src/pages/AdminSetup/LoginPage.jsx", "utf8");
const paymentService = fs.readFileSync("src/services/canonicalPaymentService.js", "utf8");

test("phase 1 removes plaintext authentication and public owner password checks", () => {
  assert.match(migration, /set password = null/i);
  assert.match(migration, /fc_login_v2/i);
  assert.doesNotMatch(migration, /coalesce\([^\n]*password[^\n]*\)\s*<>\s*p_password/i);
  assert.match(migration, /revoke all on function public\.fc_require_owner_approval\(text,text\) from anon, authenticated/i);
});

test("phase 1 enforces persistent lockout and idle session expiration", () => {
  assert.match(migration, /fc_login_security_state/i);
  assert.match(migration, /failed_attempts/i);
  assert.match(migration, /locked_until/i);
  assert.match(migration, /idle_expires_at/i);
  assert.match(migration, /auth_version/i);
});

test("phase 1 removes public access to legacy login and payment writers", () => {
  assert.match(migration, /revoke all on function public\.fc_login_v1\(text,text\) from anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.post_canonical_customer_payment_v1/i);
  assert.match(migration, /grant execute on function public\.post_canonical_customer_payment_v2/i);
});

test("payment v2 validates customer scope and invoice remaining balance", () => {
  assert.match(migration, /Order does not belong to the selected customer scope/i);
  assert.match(migration, /Invoice does not belong to the selected customer scope/i);
  assert.match(migration, /Duplicate invoice allocation is not permitted/i);
  assert.match(migration, /Allocation exceeds the invoice remaining balance/i);
});

test("clients use hardened RPCs", () => {
  assert.match(loginPage, /fc_login_v2/);
  assert.doesNotMatch(loginPage, /fc_login_v1/);
  assert.match(paymentService, /post_canonical_customer_payment_v2/);
  assert.doesNotMatch(paymentService, /p_collector_staff_id/);
  assert.doesNotMatch(paymentService, /p_collector_role/);
});
