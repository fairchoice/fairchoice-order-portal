import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731100000_supplier_payment_accounting_integration.sql",
    import.meta.url,
  ),
  "utf8",
);
const expenseServiceSource = fs.readFileSync(
  new URL("./expenses.js", import.meta.url),
  "utf8",
);
const expenseUiSource = fs.readFileSync(
  new URL("../pages/AdminSetup/Expenses.jsx", import.meta.url),
  "utf8",
);
const supplierUiSource = fs.readFileSync(
  new URL("../pages/AdminSetup/SupplierAccounts.jsx", import.meta.url),
  "utf8",
);

function functionSource(functionName) {
  const start = migrationSource.indexOf(
    `create or replace function public.${functionName}(`,
  );
  assert.notEqual(start, -1, `${functionName} must exist`);
  const next = migrationSource.indexOf(
    "\ncreate or replace function public.",
    start + 1,
  );
  return migrationSource.slice(start, next === -1 ? undefined : next);
}

test("migration is additive, transactional, and reloads PostgREST last", () => {
  assert.match(migrationSource, /^\s*--[\s\S]*\nbegin;/);
  assert.doesNotMatch(migrationSource, /\bdrop\s+(?:table|column)\b/i);
  assert.doesNotMatch(migrationSource, /\btruncate\b|\bdelete\s+from\b/i);
  assert.match(
    migrationSource,
    /commit;\s*\n\s*notify pgrst, 'reload schema';\s*$/,
  );
});

test("automatic effects have stable payout foreign keys and unique guards", () => {
  for (const [table, indexName] of [
    ["supplier_credit_transactions", "supplier_credit_business_payout_uidx"],
    ["staff_cash_expenses", "staff_cash_expenses_business_payout_uidx"],
  ]) {
    assert.match(
      migrationSource,
      new RegExp(
        `${table}[\\s\\S]*business_payout_id[\\s\\S]*references public\\.business_payouts\\(id\\)[\\s\\S]*on delete restrict`,
      ),
    );
    assert.match(migrationSource, new RegExp(indexName));
  }
  assert.match(migrationSource, /on conflict \(business_payout_id\)/);
});

test("approval keeps the canonical Global Ledger effect and synchronizes linked effects", () => {
  const source = functionSource("fc_approve_business_payout");
  assert.match(source, /'expenses\.approve'/);
  assert.match(source, /where id = p_payout_id\s+for update/);
  assert.match(source, /source_type = 'business_payouts'/);
  assert.match(source, /transaction_type[\s\S]*'EXPENSE'/);
  assert.match(source, /fc_sync_business_payout_accounting_v1\(/);
  assert.match(
    source,
    /if v_before\.status = 'POSTED'[\s\S]*fc_sync_business_payout_accounting_v1/,
  );
});

test("Supplier Payment posts one linked credit with the expense reference", () => {
  const source = functionSource("fc_sync_business_payout_accounting_v1");
  assert.match(source, /expense_type_code = 'SUPPLIER_PAYMENT'/);
  assert.match(source, /A supplier is required for a Supplier Payment/);
  assert.match(
    source,
    /insert into public\.supplier_credit_transactions[\s\S]*'payment'[\s\S]*v_payout\.amount[\s\S]*v_payout\.payout_reference[\s\S]*'Supplier Payment'/,
  );
  assert.match(source, /business_payout_id[\s\S]*v_payout\.id/);
  assert.match(source, /status <> 'posted'/);
});

test("only staff-paid cash for a Weekly Account collector creates a cash effect", () => {
  const source = functionSource("fc_sync_business_payout_accounting_v1");
  assert.match(source, /payment_method[\s\S]*= 'cash'/);
  assert.match(source, /paid_by_type[\s\S]*'BUSINESS'/);
  assert.match(source, /'Driver'[\s\S]*'Sales Rep'/);
  assert.match(
    source,
    /insert into public\.staff_cash_expenses[\s\S]*'APPROVED'/,
  );
  assert.match(
    source,
    /elsif exists \([\s\S]*public\.staff_cash_expenses[\s\S]*must not have a Weekly Account cash effect/,
  );
});

test("void is idempotent and unwinds all three accounting effects with audit", () => {
  const source = functionSource("fc_void_business_payout");
  assert.match(source, /'expenses\.void'/);
  assert.match(source, /if v_before\.status = 'VOIDED'[\s\S]*return v_before/);
  assert.match(source, /archive_financial_transactions\(/);
  assert.match(
    source,
    /update public\.supplier_credit_transactions[\s\S]*status = 'voided'/,
  );
  assert.match(
    source,
    /update public\.staff_cash_expenses[\s\S]*status = 'VOIDED'/,
  );
  assert.match(source, /'VOID', 'BUSINESS_PAYOUT'/);
  assert.doesNotMatch(source, /\bdelete\b/i);
});

test("automatic supplier payments can only be voided through the expense workflow", () => {
  const source = functionSource("fc_void_supplier_credit_transaction_v1");
  assert.match(source, /'suppliers\.pay'/);
  assert.match(
    source,
    /business_payout_id is not null[\s\S]*Void the original expense/,
  );
  assert.match(
    migrationSource,
    /revoke all on function public\.fc_sync_business_payout_accounting_v1\([\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migrationSource,
    /create policy staff_cash_expenses_insert[\s\S]*with check \(business_payout_id is null\)/,
  );
  assert.match(
    migrationSource,
    /create policy staff_cash_expenses_update[\s\S]*using \(business_payout_id is null\)[\s\S]*with check \(business_payout_id is null\)/,
  );
});

test("Expenses records the current staff identity and UI distinguishes automatic effects", () => {
  assert.match(
    expenseServiceSource,
    /paidByType === "STAFF"[\s\S]*user\.staff_id/,
  );
  assert.match(expenseServiceSource, /linked staff identity is required/);
  assert.match(expenseUiSource, /My collected cash/);
  assert.match(expenseUiSource, /"Void confirmed\."/);
  assert.match(supplierUiSource, /supplierLedgerTypeLabel\(row\)/);
});
