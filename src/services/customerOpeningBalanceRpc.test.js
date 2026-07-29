import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260729110000_customer_opening_balance_rpc_schema_repair.sql",
    import.meta.url
  ),
  "utf8"
);

test("opening-balance schema repair matches the frontend named RPC contract", () => {
  assert.match(
    migrationSource,
    /set_customer_opening_balance_v1\(\s*p_username text,\s*p_session_token text,\s*p_customer_account_id uuid,\s*p_customer_branch_id uuid,\s*p_amount numeric,\s*p_reason text\s*\)/
  );
  assert.match(migrationSource, /security definer\s+set search_path = public/);
  assert.match(
    migrationSource,
    /fc_require_session_permission\([\s\S]*'customer_credit\.opening_balance_edit'/
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.set_customer_opening_balance_v1\([\s\S]*\) to anon, authenticated/
  );
  assert.match(migrationSource, /notify pgrst, 'reload schema'/);
});

test("opening-balance upsert keeps one main-account row and accepts null branch scope", () => {
  assert.match(
    migrationSource,
    /where customer_branch_id is null/
  );
  assert.match(
    migrationSource,
    /on conflict \(customer_account_id\) where customer_branch_id is null/
  );
  assert.match(
    migrationSource,
    /customer_branch_id is not distinct from p_customer_branch_id/
  );
  assert.match(migrationSource, /customer_opening_balance_audit/);
  assert.doesNotMatch(migrationSource, /delete from public\.customer_branch_opening_balances/);
});
