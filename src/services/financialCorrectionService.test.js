import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const serviceSource = fs.readFileSync(
  new URL("./financialCorrectionService.js", import.meta.url),
  "utf8"
);
const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260812210000_owner_financial_corrections.sql",
    import.meta.url
  ),
  "utf8"
);

test("financial correction is owner-only and session-authorized", () => {
  assert.match(serviceSource, /isOwnerUser\(currentUser\)/);
  assert.match(serviceSource, /getFcSessionState\(currentUser\)/);
  assert.match(migrationSource, /Only nisstaj_admin may apply financial corrections/);
  assert.match(migrationSource, /fc_require_session_permission/);
});

test("migration is additive and does not auto-correct existing business rows", () => {
  assert.match(migrationSource, /performs no business-data correction/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.orders/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.customer_ledger/i);
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.customer_payments/i);
});

test("duplicate invoice correction preserves operational order state", () => {
  const voidFunction = migrationSource.match(
    /create or replace function public\.void_owner_duplicate_invoice_v1[\s\S]*?\r?\nend;\r?\n\$\$;/i
  )?.[0] || "";

  assert.match(voidFunction, /financial_status\s*=\s*'VOID'/);
  assert.doesNotMatch(voidFunction, /set\s+status\s*=\s*'Cancelled'[^\n]*where\s+id\s*=\s*v_order\.id/i);
  assert.doesNotMatch(voidFunction, /update\s+public\.order_items/i);
  assert.doesNotMatch(voidFunction, /update\s+public\.stock_/i);
  assert.doesNotMatch(voidFunction, /delete\s+from\s+public\.order_items/i);
});

test("invoice correction supports legacy bigint ledger order IDs", () => {
  const invoiceFunctions = migrationSource.match(
    /create or replace function public\.preview_owner_invoice_correction_v1[\s\S]*?create or replace function public\.preview_matched_legacy_payment_v1/i
  )?.[0] || "";

  assert.doesNotMatch(invoiceFunctions, /l\.order_id\s*=\s*v_order\.id/);
  assert.match(invoiceFunctions, /l\.order_id::text\s*=\s*v_order\.id::text/);
  assert.match(invoiceFunctions, /order_id::text\s*=\s*v_order\.id::text/);
});

test("duplicate invoice correction rebuilds financial allocation state", () => {
  assert.match(migrationSource, /customer_payment_allocations[\s\S]*status\s*=\s*'reversed'/i);
  assert.match(migrationSource, /recalculate_central_payment_fifo\(v_order\.customer_account_id\)/i);
  assert.match(migrationSource, /financial_audit_log/i);
  assert.match(migrationSource, /owner_financial_corrections/i);
});

test("legacy payment linking refuses ambiguous and missing matches", () => {
  assert.match(migrationSource, /classification\s*<>\s*'MATCHED'/i);
  assert.match(migrationSource, /candidate_count[\s\S]*<>\s*1/i);
  assert.match(migrationSource, /confidence not in \('CERTAIN', 'HIGH'\)/i);
  assert.match(migrationSource, /central_payment_id\s*=\s*v_payment\.id/i);
});

test("service exposes preview before destructive correction calls", () => {
  assert.match(serviceSource, /previewInvoiceFinancialCorrection/);
  assert.match(serviceSource, /voidDuplicateInvoiceFinancially/);
  assert.match(serviceSource, /previewLegacyPaymentLink/);
  assert.match(serviceSource, /linkMatchedLegacyPayment/);
});
