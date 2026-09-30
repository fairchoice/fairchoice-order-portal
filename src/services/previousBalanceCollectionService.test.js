import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildPreviousBalanceRpcParams } from "./previousBalanceCollectionService.js";

const writerMigrationUrl = new URL(
  "../../supabase/migrations/20260723120000_canonical_payment_writer_and_ledger_sync.sql",
  import.meta.url
);
const reconciliationMigrationUrl = new URL(
  "../../supabase/migrations/20260723122000_legacy_customer_payment_reconciliation.sql",
  import.meta.url
);

test("previous-balance parameters preserve account and branch while rejecting caller-supplied collector identity", () => {
  const params = buildPreviousBalanceRpcParams({
    customerAccountId: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
    customerBranchId: "8f598571-db45-424b-9d23-1fe2fba98d78",
    amount: 43,
    paymentMethod: "Cash",
    paymentDate: "2026-07-22T01:23:39.892083Z",
    payerName: "Vijay",
    collectorName: "nisstaj_admin",
    collectorStaffId: "c935885a-9512-47da-866a-99c8428a826f",
    collectorRole: "Super Admin",
    notes: "Driver previous balance collection - Cash",
    paymentIntentId: "80ca425d-0665-5aaf-93fd-d63a73476d08",
  });

  assert.equal(params.p_customer_account_id, "7a673fb8-e01d-4165-8c12-3d243f5eb7b3");
  assert.equal(params.p_customer_branch_id, "8f598571-db45-424b-9d23-1fe2fba98d78");
  assert.equal(params.p_amount, 43);
  assert.equal(params.p_payment_source, "PREVIOUS_BALANCE_COLLECTION");
  assert.equal(params.p_payment_reference, "PREVIOUS_BALANCE");
  assert.equal(
    params.p_idempotency_key,
    "previous-balance-collection:80ca425d-0665-5aaf-93fd-d63a73476d08"
  );
  assert.equal(params.p_collector_staff_id, undefined);
  assert.equal(params.p_collector_role, undefined);
});

test("canonical writer is idempotent and creates one linked ledger payment", async () => {
  const sql = await readFile(writerMigrationUrl, "utf8");
  assert.match(sql, /post_canonical_customer_payment_v1/);
  assert.match(sql, /sync_canonical_payment_to_customer_ledger_v1/);
  assert.match(sql, /customer_ledger_canonical_payment_unique_idx/);
  assert.match(sql, /on conflict \(central_payment_id\)/);
  assert.match(sql, /return jsonb_build_object\(\s*'duplicate', true/);
});

test("reviewed historical migration rejects ambiguous and inactive rows", async () => {
  const sql = await readFile(reconciliationMigrationUrl, "utf8");
  assert.match(sql, /'VOIDED_OR_INACTIVE'/);
  assert.match(sql, /'AMBIGUOUS'/);
  assert.match(sql, /legacy_duplicate_count/);
  assert.match(sql, /classification not in \('MATCHED', 'MISSING'\)/);
  assert.match(sql, /customer_payment_legacy_migrations_source_unique/);
  assert.match(sql, /'legacy-customer-ledger:' \|\| v_ledger_id::text/);
});

test("future payment flows contain no direct browser ledger insert", async () => {
  const [driverSource, customerOrderSource, ledgerServiceSource] = await Promise.all([
    readFile(new URL("../pages/AdminSetup/Driver.jsx", import.meta.url), "utf8"),
    readFile(new URL("../pages/CustomerOrder.jsx", import.meta.url), "utf8"),
    readFile(new URL("./customerLedger.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(driverSource, /\.from\("customer_ledger"\)\s*\.insert/);
  assert.doesNotMatch(customerOrderSource, /\.from\("customer_ledger"\)\s*\.insert/);
  assert.doesNotMatch(ledgerServiceSource, /\.from\("customer_ledger"\)\s*\.insert/);
  assert.match(driverSource, /postCanonicalCustomerPayment/);
  assert.match(customerOrderSource, /postCanonicalCustomerPayment/);
  assert.match(ledgerServiceSource, /postPreviousBalanceCollection/);
});

test("review-only row 221 repair remains unexecuted and has no stored secret", async () => {
  const reviewSql = await readFile(
    new URL("../../supabase/review/repair_customer_ledger_221_review_only.sql", import.meta.url),
    "utf8"
  );
  assert.match(reviewSql, /where l\.id = 221/);
  assert.match(reviewSql, /legacy-customer-ledger:221/);
  assert.match(reviewSql, /rollback;/);
  assert.doesNotMatch(reviewSql, /p_owner_password\s*=>\s*'[^']+'/);
});
