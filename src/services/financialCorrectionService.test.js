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

test("customer credit invoice loader excludes financially voided delivered orders", async () => {
  const source = fs.readFileSync(
    new URL("./centralPaymentService.js", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /order\.financial_status[\s\S]{0,120}!==\s*"VOID"/,
    "delivered order fallback must not resurrect financially voided invoices"
  );
  assert.match(
    source,
    /invoice\.financial_status[\s\S]{0,120}!==\s*"VOID"/,
    "canonical invoice rows must exclude financial voids from Customer Credit"
  );
});

test("canonical invoice sync preserves financial void instead of reissuing delivered invoice", async () => {
  const migration = fs.readFileSync(
    new URL("../../supabase/migrations/20260812231500_keep_financial_void_consistent.sql", import.meta.url),
    "utf8"
  );
  assert.match(migration, /financial_status[\s\S]{0,100}=\s*'VOID'/i);
  assert.match(migration, /status\s*=\s*'CANCELLED'/i);
  assert.match(migration, /recalculate_central_payment_fifo/i);
});

test("emergency duplicate invoice void returns only recorded inventory deductions atomically", () => {
  const migration = fs.readFileSync(
    new URL("../../supabase/migrations/20260812233000_void_duplicate_invoice_restore_inventory.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /update public\.product_location_stock[\s\S]*qty\s*=\s*v_stock_after/i);
  assert.match(migration, /order_item_picking_events[\s\S]*reversed_at\s+is\s+null/i);
  assert.match(migration, /stock_location_id\s+is\s+not\s+null/i);
  assert.match(migration, /movement_type\s*=\s*'SALE'/i);
  assert.match(migration, /movement_type, qty, stock_before, stock_after, note[\s\S]*'VOID_RETURN'/i);
  assert.match(migration, /owner_inventory_reversals/i);
  assert.match(migration, /duplicate_void_inventory_reversed_at/i);
  assert.match(migration, /recalculate_central_payment_fifo/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(orders|order_items|stock_movements)/i);
});

test("duplicate invoice void can safely finish stock return after an older financial-only void", () => {
  const migration = fs.readFileSync(
    new URL("../../supabase/migrations/20260812233000_void_duplicate_invoice_restore_inventory.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /v_financial_already_voided/i);
  assert.match(migration, /if\s+v_financial_already_voided\s+and\s+v_order\.duplicate_void_inventory_reversed_at\s+is\s+not\s+null/i);
  assert.match(migration, /if\s+not\s+v_financial_already_voided\s+then/i);
  assert.match(migration, /COMPLETE_DUPLICATE_INVENTORY_REVERSAL/i);
});

test("invoice void UI clearly warns that stock will be returned", () => {
  const source = fs.readFileSync(
    new URL("../pages/AdminSetup/InvoicesPortal.jsx", import.meta.url),
    "utf8"
  );

  assert.match(source, />Void Invoice</);
  assert.match(source, /This will void the invoice and return its stock to inventory\./);
  assert.match(source, /Void invoice and return stock\?/);
  assert.match(source, /Void invoice and return stock/);
  assert.doesNotMatch(source, /inventory and order quantities unchanged/i);
});

test("duplicate invoice void restores legacy sales to the order country location without guessing", () => {
  const migration = fs.readFileSync(
    new URL("../../supabase/migrations/20260813002000_void_duplicate_invoice_country_inventory_repair.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /fc_resolve_order_inventory_country_v1\(v_order\.id\)/i);
  assert.match(migration, /fc_normalize_inventory_country_v1\(sl\.country\)\s*=\s*v_order_country/i);
  assert.match(migration, /reversal_source = 'LEGACY_COUNTRY_LOCATION'/i);
  assert.match(migration, /v_country_location_count\s*<>\s*1/i);
  assert.match(migration, /expected exactly one active % stock location/i);
  assert.match(migration, /movement_type\s*=\s*'SALE'/i);
  assert.match(migration, /upper\(trim\(coalesce\(sm\.note, ''\)\)\)\s*=\s*upper\(trim\(v_order\.order_number\)\)/i);
});

test("duplicate invoice void validates recorded picking country against order and location country", () => {
  const migration = fs.readFileSync(
    new URL("../../supabase/migrations/20260813002000_void_duplicate_invoice_country_inventory_repair.sql", import.meta.url),
    "utf8"
  );

  assert.match(migration, /fc_normalize_inventory_country_v1\(e\.inventory_country\) is distinct from v_order_country/i);
  assert.match(migration, /v_location_country is distinct from v_order_country/i);
  assert.match(migration, /abort the whole transaction instead of guessing/i);
});
