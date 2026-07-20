import assert from "node:assert/strict";
import test from "node:test";

import {
  canSelectCustomerForCredit,
  hasConfiguredCreditAccount,
  hasCreditSnapshotActivity,
} from "./customerCreditSelection.js";

test("an unconfigured customer without credit activity is not selectable", () => {
  const customer = { credit_limit: 0, payment_terms: "" };
  const snapshot = {
    openingBalances: [],
    invoices: [],
    payments: [],
    transactionHistory: [],
  };

  assert.equal(hasConfiguredCreditAccount(customer), false);
  assert.equal(hasCreditSnapshotActivity(snapshot), false);
  assert.equal(canSelectCustomerForCredit(customer, snapshot), false);
});

test("configured accounts remain selectable when they have no transactions", () => {
  const customer = { credit_limit: 1000, payment_terms: "" };
  const snapshot = { transactionHistory: [] };

  assert.equal(canSelectCustomerForCredit(customer, snapshot), true);
});

test("existing credit activity qualifies an account with no configured limit", () => {
  const customer = { credit_limit: 0, payment_terms: "" };
  const snapshot = { payments: [{ id: "payment-1" }] };

  assert.equal(canSelectCustomerForCredit(customer, snapshot), true);
});

test("an outstanding delivered order qualifies as credit activity", () => {
  const customer = { credit_limit: 0, payment_terms: "" };
  const snapshot = {
    invoices: [{ id: "order-1", source: "orders" }],
    payments: [],
    openingBalances: [],
  };

  assert.equal(hasCreditSnapshotActivity(snapshot), true);
  assert.equal(canSelectCustomerForCredit(customer, snapshot), true);
});
