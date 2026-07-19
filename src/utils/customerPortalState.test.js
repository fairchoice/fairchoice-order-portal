import assert from "node:assert/strict";
import test from "node:test";

import {
  getCustomerCartStorageKey,
  getCustomerPortalHash,
  getOrderSubmissionErrorMessage,
  isCustomerPortalPageAllowed,
  resolveCustomerPortalPage,
} from "./customerPortalState.js";

test("sales rep credit hash restores the sales credit page", () => {
  assert.equal(resolveCustomerPortalPage({ hash: "#credit", isSalesRep: true }), "salesCreditHistory");
  assert.equal(getCustomerPortalHash("salesCreditHistory", { isSalesRep: true }), "#credit");
});

test("unknown customer and sales routes safely default to Order", () => {
  assert.equal(resolveCustomerPortalPage({ hash: "#admin", isCustomer: true }), "order");
  assert.equal(resolveCustomerPortalPage({ hash: "#unknown", isSalesRep: true }), "order");
  assert.equal(isCustomerPortalPageAllowed("credit", { isSalesRep: true }), false);
});

test("cart keys are scoped to the logged-in user", () => {
  assert.equal(getCustomerCartStorageKey({ login_user_id: "abc" }), "fairchoice_cart:abc");
  assert.notEqual(getCustomerCartStorageKey({ id: "one" }), getCustomerCartStorageKey({ id: "two" }));
});

test("submission errors provide actionable session and network messages", () => {
  assert.match(getOrderSubmissionErrorMessage({ status: 401 }), /session has expired/i);
  assert.match(getOrderSubmissionErrorMessage(new TypeError("Failed to fetch")), /internet connection/i);
});
