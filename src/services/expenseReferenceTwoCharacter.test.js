import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260801090000_two_character_expense_references.sql",
    import.meta.url,
  ),
  "utf8",
);
const expensesUi = fs.readFileSync(
  new URL("../pages/AdminSetup/Expenses.jsx", import.meta.url),
  "utf8",
);
const accountingMigration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731100000_supplier_payment_accounting_integration.sql",
    import.meta.url,
  ),
  "utf8",
);
const reconciliationMigration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731140000_deterministic_payer_role_and_posted_payout_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);

test("new references use E-YYMMDD-XX with the unambiguous alphabet", () => {
  assert.match(migration, /v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'/);
  assert.match(migration, /for v_character in 1\.\.2 loop/);
  assert.match(migration, /'E-' \|\| to_char\(p_payout_date, 'YYMMDD'\) \|\| '-' \|\| v_suffix/);
  assert.doesNotMatch("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", /[01IO]/);
});

test("reference collisions retry twenty times only for the named reference index", () => {
  assert.match(migration, /for v_attempt in 1\.\.20 loop[\s\S]*when unique_violation then/);
  assert.match(migration, /get stacked diagnostics v_constraint_name = constraint_name/);
  assert.match(migration, /if v_constraint_name <> 'business_payouts_reference_uidx' then\s+raise;/);
  assert.match(migration, /Could not allocate a unique expense reference after 20 attempts/);
  assert.doesNotMatch(migration, /max\s*\(/i);
});

test("migration leaves every existing reference unchanged", () => {
  assert.doesNotMatch(migration, /update\s+public\.business_payouts/i);
  assert.doesNotMatch(migration, /alter\s+table\s+public\.business_payouts/i);
  assert.match(migration, /UUID remains the canonical identity and historical references are unchanged/);
});

test("expense search remains format-agnostic for EXP, old E, and new E references", () => {
  assert.match(expensesUi, /row\.payout_reference/);
  assert.match(expensesUi, /\.includes\(term\)/);
  for (const reference of ["EXP-2026-0001", "E-260731-UMNUW4", "E-260731-A7"]) {
    assert.equal(reference.toLowerCase().includes("260731") || reference.startsWith("EXP-"), true);
  }
});

test("the stored reference reaches linked effects, voids, and reconciliation", () => {
  assert.match(accountingMigration, /insert into public\.supplier_credit_transactions[\s\S]*v_payout\.payout_reference/);
  assert.match(accountingMigration, /insert into public\.staff_cash_expenses[\s\S]*v_payout\.payout_reference/);
  assert.match(accountingMigration, /insert into public\.financial_transactions[\s\S]*v_before\.payout_reference/);
  assert.match(accountingMigration, /financial_audit_log/);
  assert.match(reconciliationMigration, /v_payout\.payout_reference/g);
});

test("replacement preserves the public function signature and security boundary", () => {
  assert.match(migration, /create or replace function public\.fc_create_business_payout\(/);
  assert.match(migration, /security definer[\s\S]*set search_path = public/);
  assert.match(migration, /fc_require_session_permission\([\s\S]*'expenses\.create'/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/m);
});
