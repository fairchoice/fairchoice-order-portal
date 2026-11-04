import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL(
  "../../supabase/migrations/20260731120000_weekly_collector_identity_short_expense_references.sql",
  import.meta.url,
);
const migration = fs.readFileSync(migrationPath, "utf8");
const expensesUi = fs.readFileSync(
  new URL("../pages/AdminSetup/Expenses.jsx", import.meta.url),
  "utf8",
);
const integration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731100000_supplier_payment_accounting_integration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("new expense references use the short uppercase unambiguous format", () => {
  assert.match(migration, /'E-'\s*\|\|\s*to_char\(p_payout_date, 'YYMMDD'\)/);
  assert.match(migration, /v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'/);
  assert.match(migration, /for v_character in 1\.\.6 loop/);
});

test("reference collisions retry the unique insert safely", () => {
  assert.match(migration, /for v_attempt in 1\.\.8 loop[\s\S]*when unique_violation then/);
  assert.match(migration, /get stacked diagnostics v_constraint_name = constraint_name/);
  assert.match(migration, /v_constraint_name <> 'business_payouts_reference_uidx'/);
  assert.match(migration, /Could not allocate a unique expense reference after 8 attempts/);
  assert.doesNotMatch(migration, /max\s*\(/i);
});

test("historical references are not rewritten and searches accept either format", () => {
  assert.doesNotMatch(migration, /update\s+public\.business_payouts/i);
  assert.match(expensesUi, /row\.payout_reference/);
  assert.match(expensesUi, /\.includes\(term\)/);
});

test("the stored payout reference propagates to every automatic accounting effect", () => {
  assert.match(integration, /v_payout\.payout_reference/g);
  assert.match(integration, /insert into public\.supplier_credit_transactions[\s\S]*v_payout\.payout_reference/);
  assert.match(integration, /insert into public\.staff_cash_expenses[\s\S]*v_payout\.payout_reference/);
  assert.match(integration, /insert into public\.financial_transactions[\s\S]*v_before\.payout_reference/);
  assert.match(integration, /financial_audit_log/);
});

test("new handovers persist a nullable stable staff identity", () => {
  assert.match(migration, /add column if not exists collector_staff_id uuid/);
  assert.match(migration, /references public\.staff_users\(id\)[\s\S]*on delete restrict/);
});
