import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260729120000_customer_account_reconciliation_rpc_schema_repair.sql",
    import.meta.url
  ),
  "utf8"
);

test("reconciliation schema repair is permission checked and read only", () => {
  assert.match(
    migrationSource,
    /get_customer_account_reconciliation_v1\(\s*p_username text,\s*p_session_token text\s*\)/
  );
  assert.match(migrationSource, /security definer\s+set search_path = public/);
  assert.match(
    migrationSource,
    /fc_require_session_permission\([\s\S]*'customer_credit\.audit_view'/
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.get_customer_account_reconciliation_v1\([\s\S]*\) to anon, authenticated/
  );
  assert.match(migrationSource, /notify pgrst, 'reload schema'/);
  assert.doesNotMatch(
    migrationSource,
    /\b(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.(?:customer_payments|customer_invoices|customer_branch_opening_balances|customer_payment_allocations)\b/i
  );
});

test("reconciliation view excludes inactive payments and reports stored differences", () => {
  assert.match(migrationSource, /payment\.status = 'POSTED'/);
  assert.match(migrationSource, /payment\.voided_at is null/);
  assert.match(migrationSource, /central_payment_archive/);
  assert.match(migrationSource, /calculated_closing_balance/);
  assert.match(migrationSource, /stored_closing_balance/);
  assert.match(migrationSource, /as difference/);
  assert.match(migrationSource, /as reconciled/);
});
