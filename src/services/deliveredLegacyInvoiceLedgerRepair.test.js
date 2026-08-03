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

test("legacy delivered invoice repair is restricted to the two reviewed orders", () => {
  assert.match(sql, /ORD-1784144566386/);
  assert.match(sql, /ORD-1784197506132/);
  assert.match(sql, /v_target_count <> 2/);
  assert.match(sql, /status[\s\S]*DELIVERED/i);
  assert.match(sql, /picking_status[\s\S]*COMPLETED/i);
});

test("repair falls back from zero grand total and preserves the source VAT totals", () => {
  assert.match(
    sql,
    /when coalesce\(o\.grand_total, 0\) > 0 then o\.grand_total[\s\S]*else o\.order_total/i,
  );
  assert.match(sql, /'preserved_net_total', target\.net_total/);
  assert.match(sql, /'preserved_vat_total', target\.vat_total/);
  assert.doesNotMatch(sql, /update\s+public\.orders/i);
});

test("repair creates one paid invoice and never writes a payment", () => {
  assert.equal(
    (sql.match(/insert into public\.customer_ledger/gi) || []).length,
    1,
  );
  assert.match(sql, /'INVOICE',[\s\S]*'INVOICE'/);
  assert.match(sql, /target\.repair_invoice_total,[\s\S]*0,[\s\S]*'PAID'/);
  assert.match(sql, /paid_amount,[\s\S]*remaining_amount,[\s\S]*invoice_status/i);
  assert.doesNotMatch(sql, /insert into public\.customer_payments/i);
  assert.doesNotMatch(sql, /update\s+public\.customer_payments/i);
  assert.doesNotMatch(sql, /update\s+public\.customer_ledger/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.customer_(?:payments|ledger)/i);
});

test("repair copies stable order, customer and branch identifiers without cross-filling them", () => {
  assert.match(sql, /target\.customer_account_id,[\s\S]*target\.customer_branch_id,[\s\S]*target\.branch_id/);
  assert.match(sql, /nullif\(to_jsonb\(target\)->>'customer_id', ''\)::uuid/);
  assert.doesNotMatch(
    sql,
    /coalesce\(nullif\(to_jsonb\(target\)->>'customer_id', ''\)::uuid, target\.customer_account_id\)/,
  );
  assert.match(sql, /target\.id,[\s\S]*target\.order_number/);
  assert.doesNotMatch(
    sql,
    /coalesce\(target\.customer_branch_id, target\.branch_id\),/,
  );
});

test("repair is transactional, idempotent and verifies exactly one invoice per order", () => {
  assert.match(sql, /^begin;$/m);
  assert.match(sql, /^commit;$/m);
  assert.match(sql, /where not exists[\s\S]*existing_invoice/i);
  assert.match(sql, /on conflict do nothing/i);
  assert.match(sql, /v_invoice_count <> 1/);
  assert.match(sql, /v_valid_invoice_count <> 1/);
  assert.match(sql, /READ-ONLY PREVIEW PREFLIGHT/);
  assert.match(sql, /READ-ONLY POST-DEPLOYMENT VERIFICATION/);
});
