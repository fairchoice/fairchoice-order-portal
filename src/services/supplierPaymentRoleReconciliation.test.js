import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731140000_deterministic_payer_role_and_posted_payout_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);

function functionSource(name) {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  return migration.match(pattern)?.[0] || "";
}

test("collector resolver prefers any active Driver alias over Admin aliases", () => {
  const source = functionSource("fc_resolve_weekly_collector_identity_v1");
  assert.match(source, /lu\.staff_id = su\.id[\s\S]*lu\.active is true/);
  assert.match(
    source,
    /in \('driver', 'salesrep', 'salesrepresentative'\) then 0[\s\S]*case when lu\.id = p_preferred_login_id then 0 else 1 end/,
  );
  assert.match(source, /when 'driver' then 0/);
  assert.match(source, /lower\(lu\.username\),[\s\S]*lu\.id/);
});

test("inactive Driver aliases cannot qualify the staff identity", () => {
  const source = functionSource("fc_resolve_weekly_collector_identity_v1");
  assert.match(source, /where lu\.staff_id = su\.id[\s\S]*and lu\.active is true/);
  assert.doesNotMatch(source, /coalesce\(lu\.active, true\)/i);
});

test("synchronizer keeps staff UUID canonical and uses the deterministic resolver", () => {
  const source = functionSource("fc_sync_business_payout_accounting_v1");
  assert.match(source, /fc_resolve_weekly_collector_identity_v1\([\s\S]*v_payer_staff_id/);
  assert.match(source, /v_collector_type := v_payer\.collector_type/);
  assert.match(
    source,
    /insert into public\.staff_cash_expenses[\s\S]*v_payout\.id,[\s\S]*v_payer\.id/,
  );
  assert.match(source, /coalesce\(v_payer\.staff_name, v_payer\.username\)/);
});

test("supplier and Weekly Account effects retain one-per-payout conflict guards", () => {
  const source = functionSource("fc_sync_business_payout_accounting_v1");
  assert.equal(
    (source.match(/on conflict \(business_payout_id\)/g) || []).length,
    2,
  );
  assert.equal(
    (source.match(/where business_payout_id is not null[\s\S]*?do nothing/g) || [])
      .length,
    2,
  );
  assert.match(source, /linked Supplier Account effect does not match/);
  assert.match(source, /linked Weekly Account effect does not match/);
});

test("reconciliation is payout-scoped, POSTED-only, and dry-run first", () => {
  const source = functionSource(
    "fc_reconcile_posted_business_payout_accounting_v1",
  );
  assert.match(source, /p_payout_id uuid,[\s\S]*p_apply boolean default false/);
  assert.match(source, /v_payout\.status <> 'POSTED'/);
  assert.match(source, /'expenses\.approve'/);
  assert.match(source, /elsif not p_apply then[\s\S]*'READY_TO_APPLY'/);
  assert.match(source, /perform public\.fc_sync_business_payout_accounting_v1/);
});

test("already POSTED payout repair creates both missing linked effects", () => {
  const source = functionSource(
    "fc_reconcile_posted_business_payout_accounting_v1",
  );
  assert.match(
    source,
    /v_supplier_missing :=[\s\S]*supplier_credit_transactions[\s\S]*business_payout_id = v_payout\.id/,
  );
  assert.match(
    source,
    /v_weekly_missing :=[\s\S]*staff_cash_expenses[\s\S]*business_payout_id = v_payout\.id/,
  );
  assert.match(source, /v_status := 'RECONCILED'/);
});

test("unlinked historical economic matches stop repair without guessing", () => {
  const source = functionSource(
    "fc_reconcile_posted_business_payout_accounting_v1",
  );
  assert.match(source, /sct\.business_payout_id is null/);
  assert.match(source, /sce\.business_payout_id is null/);
  assert.match(
    source,
    /if v_supplier_matches > 0 or v_weekly_matches > 0 then[\s\S]*REVIEW_REQUIRED_UNLINKED_MATCH[\s\S]*elsif[\s\S]*perform public\.fc_sync_business_payout_accounting_v1/,
  );
  assert.match(source, /supplier_credit_transaction_ids/);
  assert.match(source, /staff_cash_expense_ids/);
  assert.doesNotMatch(source, /update public\.(supplier_credit_transactions|staff_cash_expenses)/i);
});

test("migration is additive, transactional, and does not expose the resolver", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /revoke all on function public\.fc_resolve_weekly_collector_identity_v1[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.fc_resolve_weekly_collector_identity_v1/,
  );
  assert.match(migration, /grant execute on function public\.fc_reconcile_posted_business_payout_accounting_v1/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
  assert.match(migration, /commit;\s*$/);
});
