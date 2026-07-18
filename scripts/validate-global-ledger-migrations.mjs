import assert from "node:assert/strict";
import fs from "node:fs";

const files = [
  "supabase/migrations/20260715190000_global_financial_ledger_foundation.sql",
  "supabase/migrations/20260718120000_global_ledger_auto_capture.sql",
  "supabase/migrations/20260718123000_global_ledger_owner_security.sql",
];

const sql = files.map((file) => {
  assert.ok(fs.existsSync(file), `Missing migration: ${file}`);
  const text = fs.readFileSync(file, "utf8");
  assert.ok(text.trim().endsWith(";"), `${file} must end with a semicolon`);
  return text;
}).join("\n").toLowerCase();

for (const required of [
  "create table if not exists public.financial_transactions",
  "create table if not exists public.financial_transaction_archive",
  "create table if not exists public.financial_ledger_events",
  "create or replace view public.global_financial_history",
  "customer_payments_global_ledger_sync",
  "customer_invoices_global_ledger_sync",
  "owner_archive_financial_transactions",
  "owner_restore_financial_transaction",
  "owner_delete_financial_archive",
  "central_payment_require_admin_credentials",
  "revoke execute on function public.archive_financial_transactions",
]) {
  assert.ok(sql.includes(required), `Expected global ledger SQL to include: ${required}`);
}

assert.ok(!/create\s+table\s+if\s+not\s+exists\s+public\.fin\s*$/m.test(sql), "Truncated financial table statement found");
assert.ok(!sql.includes("drop table public.customer_"), "Global ledger migrations must not drop customer source tables");
console.log("Global ledger migration contract validation passed.");
