import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sql = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260803030000_repair_delivered_legacy_invoice_ledger_rows.sql",
    import.meta.url,
  ),
  "utf8",
);

const executableSql = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

test("legacy delivered invoice repair is bounded to the two reviewed orders", () => {
  assert.match(sql, /ORD-1784144566386/);
  assert.match(sql, /ORD-1784197506132/);
  assert.match(executableSql, /v_target_count <> 2/);
  assert.match(executableSql, /upper\(coalesce\(v_order\.status, ''\)\) <> 'DELIVERED'/);
  assert.match(executableSql, /upper\(coalesce\(v_order\.picking_status, ''\)\) <> 'COMPLETED'/);
  assert.match(executableSql, /for update of o/i);
});

test("repair never mixes the UUID order key with the bigint ledger key", () => {
  assert.doesNotMatch(executableSql, /\border_id\b/i);
  assert.doesNotMatch(executableSql, /existing_invoice\.order_id/i);
  assert.doesNotMatch(executableSql, /invoice\.order_id/i);
  assert.doesNotMatch(executableSql, /inserted_invoice\.order_id/i);
  assert.doesNotMatch(executableSql, /target\.id/i);
  assert.doesNotMatch(executableSql, /\border_id\s*,/i);
  assert.doesNotMatch(executableSql, /::bigint/i);
  assert.match(executableSql, /v_inserted_ledger_id bigint/);
  assert.match(executableSql, /o\.id as source_order_uuid/i);
  assert.match(executableSql, /'source_order_uuid', v_order\.source_order_uuid/i);
});

test("all ledger matching uses the two full textual order fields", () => {
  assert.match(
    executableSql,
    /existing_invoice\.reference_no = v_order\.order_number\s+or existing_invoice\.order_number = v_order\.order_number/i,
  );
  assert.match(
    executableSql,
    /payment\.reference_no = v_order\.order_number\s+or payment\.order_number = v_order\.order_number/i,
  );
  assert.match(
    executableSql,
    /invoice\.reference_no = v_order\.order_number\s+and invoice\.order_number = v_order\.order_number/i,
  );
  assert.doesNotMatch(executableSql, /payment_reference\s*=\s*v_order\.order_number/i);
});

test("optional order columns use JSON access and unsupported shop_name is absent", () => {
  for (const column of [
    "customer_account_id",
    "customer_id",
    "customer_branch_id",
    "branch_id",
    "company_name",
    "branch_name",
    "delivery_branch_name",
    "price_mode",
    "net_total",
    "vat_total",
    "delivered_at",
    "created_at",
  ]) {
    assert.match(executableSql, new RegExp(`to_jsonb\\(o\\)->>'${column}'`));
  }
  assert.doesNotMatch(sql, /shop_name/i);
});

test("invoice insert matches the supported Preview ledger shape", () => {
  const insertMatch = executableSql.match(
    /insert into public\.customer_ledger\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*on conflict do nothing/i,
  );
  assert.ok(insertMatch, "expected one complete customer_ledger insert");

  const columns = insertMatch[1];
  for (const column of [
    "customer_account_id",
    "customer_id",
    "customer_branch_id",
    "branch_id",
    "branch_name",
    "customer_name",
    "entry_type",
    "transaction_type",
    "reference_no",
    "description",
    "debit",
    "credit",
    "amount",
    "payment_amount",
    "invoice_total",
    "invoice_amount",
    "paid_amount",
    "remaining_amount",
    "invoice_status",
    "order_number",
    "delivered_date",
    "invoice_date",
    "source",
  ]) {
    assert.match(columns, new RegExp(`\\b${column}\\b`));
  }
  assert.doesNotMatch(columns, /\border_id\b/i);
  assert.match(insertMatch[2], /'INVOICE',[\s\S]*'INVOICE'/);
  assert.match(insertMatch[2], /'PAID'/);
});

test("invoice accounting values follow existing debit conventions", () => {
  assert.match(
    executableSql,
    /'Invoice',\s*v_order\.repair_invoice_total,\s*0,\s*v_order\.repair_invoice_total,\s*0,\s*v_order\.repair_invoice_total,\s*v_order\.repair_invoice_total,\s*v_order\.repair_invoice_total,\s*0,\s*'PAID'/i,
  );
  assert.match(executableSql, /when coalesce\(o\.grand_total, 0\) > 0 then o\.grand_total\s+else o\.order_total/i);
  assert.match(executableSql, /o\.grand_total as source_grand_total/);
  assert.match(executableSql, /o\.order_total as source_order_total/);
  assert.match(executableSql, /'source_grand_total', v_order\.source_grand_total/);
  assert.match(executableSql, /'source_order_total', v_order\.source_order_total/);
  assert.match(executableSql, /'preserved_net_total', v_order\.source_net_total/);
  assert.match(executableSql, /'preserved_vat_total', v_order\.source_vat_total/);
  assert.doesNotMatch(executableSql, /update\s+public\.orders/i);
});

test("payment coverage is read-only, active, scoped and uses payment_amount", () => {
  assert.match(executableSql, /coalesce\(sum\(payment\.payment_amount\), 0\)/i);
  assert.match(executableSql, /in \('PAYMENT', 'COLLECTION'\)/i);
  assert.match(executableSql, /payment\.voided_at is null/i);
  assert.match(executableSql, /payment\.reversed_at is null/i);
  assert.match(executableSql, /v_payment_row_count = 0/i);
  assert.match(executableSql, /round\(v_payment_total, 2\) < v_order\.repair_invoice_total/i);
  assert.match(executableSql, /'active_payment_row_count', v_payment_row_count/i);
  assert.match(executableSql, /'active_payment_total', round\(v_payment_total, 2\)/i);
  assert.doesNotMatch(executableSql, /insert into public\.customer_payments/i);
  assert.doesNotMatch(executableSql, /insert into public\.customer_payment_allocations/i);
  assert.doesNotMatch(executableSql, /update\s+public\.customer_(?:ledger|payments|payment_allocations)/i);
  assert.doesNotMatch(executableSql, /delete\s+from\s+public\.customer_(?:ledger|payments|payment_allocations)/i);
});

test("repair is transactional and reruns leave exactly one valid invoice", () => {
  assert.match(executableSql, /^begin;$/m);
  assert.match(executableSql, /^commit;$/m);
  assert.equal(
    (executableSql.match(/insert into public\.customer_ledger/gi) || []).length,
    1,
  );
  assert.match(executableSql, /if v_invoice_count = 0 then/i);
  assert.match(executableSql, /on conflict do nothing/i);
  assert.match(executableSql, /if v_invoice_count <> 1 then/i);
  assert.match(executableSql, /if v_valid_invoice_count <> 1 then/i);
  assert.equal(
    (executableSql.match(/into v_invoice_count, v_valid_invoice_count/gi) || []).length,
    1,
    "postcondition must have one non-duplicated count assignment",
  );
  assert.doesNotMatch(
    executableSql,
    /invoice\.reference_no = v_order\.order_number\s+or invoice\.order_number = v_order\.order_number\s*\)\s*and\s*\(/i,
  );
});

test("migration embeds read-only preflight and post-deployment verification", () => {
  assert.match(sql, /READ-ONLY PREVIEW PREFLIGHT/);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /READ-ONLY POST-DEPLOYMENT VERIFICATION/);
  assert.match(sql, /valid_paid_invoice_row_count/);
});
