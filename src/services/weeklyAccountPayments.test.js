import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { mergeWeeklyAccountPaymentRows } from "./weeklyAccountPayments.js";

test("includes unmatched SALES_REP_COLLECTION legacy rows once", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    legacyPayments: [{
      id: 211,
      entry_type: "PAYMENT",
      customer_account_id: "account-1",
      customer_branch_id: "branch-1",
      branch_name: "3s Life Style",
      credit: 401.42,
      created_at: "2026-07-21T12:00:00Z",
      collection_source: "SALES_REP_COLLECTION",
      collected_by_name: "Nisstaj",
      reference_no: "SALES_REP_COLLECTION",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_name, "3s Life Style");
  assert.equal(rows[0].payment_amount, 401.42);
});

test("canonical legacy import suppresses its matching legacy row", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "payment-1",
      customer_account_id: "account-1",
      amount: 401.42,
      payment_date: "2026-07-21T12:00:00Z",
      created_at: "2026-07-22T09:00:00Z",
      status: "POSTED",
      verification_status: "CONFIRMED",
      source: "LEGACY_CUSTOMER_LEDGER",
      idempotency_key: "legacy-customer-ledger:211",
      payment_reference: "SALES_REP_COLLECTION",
    }],
    legacyPayments: [{
      id: 211,
      entry_type: "PAYMENT",
      customer_account_id: "account-1",
      credit: 401.42,
      created_at: "2026-07-21T12:00:00Z",
      collection_source: "SALES_REP_COLLECTION",
      reference_no: "SALES_REP_COLLECTION",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_kind, "canonical");
});

test("row 221 appears exactly once after canonical migration", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "canonical-221",
      customer_account_id: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
      customer_branch_id: "8f598571-db45-424b-9d23-1fe2fba98d78",
      amount: 43,
      payment_date: "2026-07-22T01:23:39.892083Z",
      created_at: "2026-07-22T02:00:00Z",
      status: "POSTED",
      verification_status: "CONFIRMED",
      source: "PREVIOUS_BALANCE_COLLECTION",
      idempotency_key: "legacy-customer-ledger:221",
      payment_reference: "PBC-20260722-L221",
      payment_method: "Cash",
      paid_by: "Vijay",
    }],
    legacyPayments: [{
      id: 221,
      entry_type: "PAYMENT",
      customer_account_id: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
      customer_branch_id: "8f598571-db45-424b-9d23-1fe2fba98d78",
      credit: 43,
      created_at: "2026-07-22T01:23:39.892083Z",
      reference_no: "PREVIOUS_BALANCE",
      collection_source: "DRIVER_PREVIOUS_BALANCE",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonical_payment_id, "canonical-221");
  assert.equal(rows[0].payment_amount, 43);
});

test("pending and voided canonical payments do not contribute", () => {
  const base = {
    customer_account_id: "account-1",
    amount: 20,
    payment_date: "2026-07-22T10:00:00Z",
  };
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [
      {
        ...base,
        id: "pending",
        status: "POSTED",
        verification_status: "PENDING_VERIFICATION",
      },
      {
        ...base,
        id: "voided",
        status: "VOIDED",
        verification_status: "CONFIRMED",
      },
    ],
  });
  assert.equal(rows.length, 0);
});

test("Weekly Account payment tables remain read-only", () => {
  const source = fs.readFileSync(
    new URL("../pages/AdminSetup/WeeklyAccount.jsx", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "editPayment",
    "onEditPayment",
    "handleEditPayment",
    "editingPayment",
    "setEditingPayment",
    "Edit Payment",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }

  assert.doesNotMatch(source, /<th[^>]*>\s*Action\s*<\/th>/i);
  assert.doesNotMatch(
    source,
    /\.from\(["'](?:customer_ledger|customer_payments|financial_transactions)["']\)[\s\S]{0,200}\.update\(/,
  );

  for (const column of [
    "Customer",
    "Order No",
    "Invoice Total",
    "Paid Amount",
    "Balance",
    "Payment Date",
    "Payment Type",
    "Collected By",
    "Collection Type",
  ]) {
    assert.match(source, new RegExp(`>${column}<`));
  }
});
