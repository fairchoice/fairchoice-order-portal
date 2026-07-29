import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIRMED_TEST_SHOP_ACCOUNT_ID,
  assertSafeCleanupEnvironment,
  buildArchiveCandidates,
  buildTestShopDryRunReport,
} from "./testDataCleanup.js";

const account = {
  id: CONFIRMED_TEST_SHOP_ACCOUNT_ID,
  account_name: "Test Shop",
};

test("dry-run excludes Test Shop payments and invoices from expected totals", () => {
  const report = buildTestShopDryRunReport({
    account,
    canonicalPayments: [{
      id: "payment-1",
      amount: 244.15,
      status: "POSTED",
      verification_status: "CONFIRMED",
    }],
    ledgerRows: [{
      id: 1,
      entry_type: "INVOICE",
      debit: 209.56,
    }],
    currentCollectionTotal: 49265.55,
    currentPaymentCount: 123,
    currentPaidCustomerCount: 40,
    legacyOnlyPaymentCount: 5,
  });

  assert.equal(report.database_writes, 0);
  assert.equal(report.collection_total_reduction, 244.15);
  assert.equal(report.invoice_total_reduction, 209.56);
  assert.equal(report.expected_total_collection, 49021.4);
  assert.equal(report.expected_combined_payment_count, 122);
});

test("canonical and legacy copies of one payment are classified once", () => {
  const report = buildTestShopDryRunReport({
    account,
    canonicalPayments: [{
      id: "payment-1",
      amount: 43,
      status: "POSTED",
      verification_status: "CONFIRMED",
      idempotency_key: "legacy-customer-ledger:85",
    }],
    ledgerRows: [{
      id: 85,
      entry_type: "PAYMENT",
      credit: 43,
    }],
  });

  assert.equal(report.payment_count_reduction, 1);
  assert.equal(report.duplicate_report.length, 1);
  assert.equal(report.duplicate_report[0].match_reason, "idempotency_key");
});

test("split allocations are archived but not counted as duplicate payments", () => {
  const report = buildTestShopDryRunReport({
    account,
    canonicalPayments: [{
      id: "payment-1",
      amount: 50,
      status: "POSTED",
      verification_status: "CONFIRMED",
    }],
    allocations: [
      { id: "a1", payment_id: "payment-1", allocated_amount: 20 },
      { id: "a2", payment_id: "payment-1", allocated_amount: 30 },
    ],
  });

  assert.equal(report.payment_count_reduction, 1);
  assert.equal(report.duplicate_report.length, 0);
  assert.equal(report.source_counts.payment_allocations, 2);
});

test("genuine separate same-amount payments remain separate", () => {
  const report = buildTestShopDryRunReport({
    account,
    canonicalPayments: [
      {
        id: "payment-a",
        amount: 15,
        status: "POSTED",
        verification_status: "CONFIRMED",
      },
      {
        id: "payment-b",
        amount: 15,
        status: "POSTED",
        verification_status: "CONFIRMED",
      },
    ],
  });

  assert.equal(report.payment_count_reduction, 2);
  assert.equal(report.duplicate_report.length, 0);
});

test("archived snapshots preserve the original record", () => {
  const original = { id: "p1", amount: 15, notes: "original" };
  const [archive] = buildArchiveCandidates(
    "customer_payments",
    [original],
    CONFIRMED_TEST_SHOP_ACCOUNT_ID
  );
  original.amount = 20;

  assert.equal(archive.record_snapshot.amount, 15);
  assert.equal(archive.cleanup_reason, "Removal of confirmed Test Shop data");
});

test("cleanup planning is idempotent after payments are voided", () => {
  const first = buildTestShopDryRunReport({
    account,
    canonicalPayments: [{
      id: "p1",
      amount: 15,
      status: "POSTED",
      verification_status: "CONFIRMED",
    }],
  });
  const second = buildTestShopDryRunReport({
    account,
    canonicalPayments: [{
      id: "p1",
      amount: 15,
      status: "VOIDED",
      verification_status: "VOIDED",
    }],
  });

  assert.equal(first.payment_count_reduction, 1);
  assert.equal(second.payment_count_reduction, 0);
  assert.equal(second.collection_total_reduction, 0);
});

test("production apply is blocked and dry-run is always allowed", () => {
  assert.equal(assertSafeCleanupEnvironment({ apply: false }), true);
  assert.throws(
    () =>
      assertSafeCleanupEnvironment({
        apply: true,
        databaseUrl: "https://production.supabase.co",
        allowedDatabaseUrl: "https://test.supabase.co",
        allowApply: "true",
      }),
    /Production execution is blocked/
  );
  assert.throws(
    () =>
      assertSafeCleanupEnvironment({
        apply: true,
        databaseUrl: "https://test.supabase.co",
        allowedDatabaseUrl: "https://test.supabase.co",
        allowApply: "",
      }),
    /Apply is blocked/
  );
});
