import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260803023000_repair_misdirected_driver_today_invoice_allocations.sql",
    import.meta.url,
  ),
  "utf8",
);
const preflightSql = fs.readFileSync(
  new URL(
    "../../supabase/review/20260803_driver_today_invoice_preflight_read_only.sql",
    import.meta.url,
  ),
  "utf8",
);

test("repair uses an allowed rebuild allocation type", () => {
  assert.match(sql, /'rebuild'/);
  assert.doesNotMatch(sql, /'reconciliation'/);
});

test("wrong cross-invoice rebuild allocation is reversed, never deleted", () => {
  assert.match(sql, /allocation_type\s*=\s*'rebuild'/i);
  assert.doesNotMatch(sql, /coalesce\(wrong_order\.grand_total, wrong_order\.order_total, 0\)/i);
  assert.match(sql, /public\.canonical_order_invoice_total\(source_order\.id\)\s*>\s*0/i);
  assert.match(sql, /status\s*=\s*'reversed'/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.customer_payment_allocations/i);
});

test("valid legacy invoices with a zero header are protected by canonical totals", () => {
  assert.match(sql, /public\.canonical_order_invoice_total\(o\.id\)::numeric\s+as\s+invoice_total/i);
  assert.doesNotMatch(sql, /coalesce\(o\.grand_total,\s*o\.order_total,\s*0\)::numeric\s+as\s+invoice_total/i);
  assert.match(sql, /source invoice is not a unique positive-value rebuild target/i);
});

test("read-only preflight classifies canonical historical totals and ambiguity", () => {
  assert.match(preflightSql, /^begin transaction read only;/i);
  assert.match(preflightSql, /public\.canonical_order_invoice_total\(o\.id\)/i);
  assert.match(preflightSql, /VALID LEGACY INVOICE - order header total stale/i);
  assert.match(preflightSql, /AMBIGUOUS - MANUAL REVIEW REQUIRED/i);
  assert.match(preflightSql, /source_order_count\s*<>\s*1/i);
  assert.match(preflightSql, /rollback;\s*$/i);
  assert.doesNotMatch(preflightSql, /\b(?:insert|update|delete|alter|create|drop|truncate)\b/i);
});

test("ambiguous target or source invoices stop the complete transaction", () => {
  assert.match(sql, /having count\(o\.id\)\s*<>\s*1/i);
  assert.match(sql, /canonical target invoice total is zero or unresolved/i);
  assert.match(sql, /a\.allocation_type\s+is\s+distinct\s+from\s+'rebuild'/i);
  assert.match(sql, /raise exception 'Ambiguous TODAY_INVOICE allocation/i);
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
});

test("repair candidates require the exact payment reference, customer, branch and active lifecycle", () => {
  assert.match(sql, /o\.order_number\s*=\s*p\.payment_reference/i);
  assert.match(sql, /o\.customer_account_id\s*=\s*p\.customer_account_id/i);
  assert.match(sql, /coalesce\(o\.customer_branch_id, o\.branch_id[\s\S]*coalesce\(p\.customer_branch_id, p\.branch_id/i);
  assert.match(sql, /p\.source\s*=\s*'DRIVER_DELIVERY_COLLECTION'/i);
  assert.match(sql, /p\.status\s*=\s*'POSTED'/i);
  assert.match(sql, /p\.verification_status\s*=\s*'CONFIRMED'/i);
  assert.match(sql, /payment_applies_to'.*'TODAY_INVOICE'/s);
  assert.match(sql, /p\.voided_at\s+is\s+null/i);
});

test("correct or missing exact-order allocation is created with both stable keys", () => {
  assert.match(sql, /a\.order_number,\s*\n\s*a\.order_id::text/i);
  assert.match(sql, /existing\.invoice_reference\s*=\s*a\.order_number[\s\S]*existing\.invoice_source_id\s*=\s*a\.order_id::text/i);
  assert.match(sql, /DRIVER_TODAY_INVOICE_EXACT_ALLOCATION_REPAIRED/);
});

test("allocation is bounded and rerun remains idempotent", () => {
  assert.match(sql, /least\(a\.payment_remaining, a\.invoice_remaining\)/i);
  assert.match(sql, /not exists\s*\([\s\S]*existing\.payment_id\s*=\s*a\.payment_id/i);
  assert.match(sql, /create temporary table _fc_driver_today_invoice_repairs on commit drop/i);
  assert.match(sql, /create or replace function public\.fc_enforce_driver_today_invoice_allocation_v1/i);
  assert.match(sql, /drop trigger if exists trg_enforce_driver_today_invoice_allocation/i);
});

test("legacy customer_invoice UUIDs are accepted only for the same exact order", () => {
  assert.match(sql, /exact_invoice\.id::text\s*=\s*a\.invoice_source_id/i);
  assert.match(sql, /exact_invoice\.order_id\s*=\s*v_payment\.order_id/i);
  assert.match(sql, /exact_invoice\.invoice_number\s*=\s*v_payment\.payment_reference/i);
});

test("future exact payments require the exact order tuple and reject another FIFO invoice", () => {
  assert.match(sql, /select \* into v_payment/i);
  assert.match(sql, /o\.id\s*=\s*v_payment\.order_id/i);
  assert.match(sql, /o\.order_number\s*=\s*v_payment\.payment_reference/i);
  assert.match(sql, /o\.customer_account_id\s*=\s*v_payment\.customer_account_id/i);
  assert.match(sql, /a\.invoice_source_id\s*=\s*v_payment\.order_id::text/i);
  assert.match(sql, /a\.invoice_reference\s*=\s*v_payment\.payment_reference/i);
  assert.match(sql, /a\.customer_account_id\s*=\s*v_payment\.customer_account_id/i);
  assert.match(sql, /cannot retain an active allocation to another invoice/i);
  assert.match(sql, /deferrable initially deferred/i);
});
