import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { FC_PERMISSIONS, hasFcPermission } from "../security/fcPermissions.js";
import {
  isCustomerPortalPageAllowed,
  resolveCustomerPortalPage,
} from "../utils/customerPortalState.js";

const customerOrder = fs.readFileSync(
  new URL("../pages/CustomerOrder.jsx", import.meta.url),
  "utf8",
);
const paymentService = fs.readFileSync(
  new URL("./canonicalPaymentService.js", import.meta.url),
  "utf8",
);

test("authorised Sales Rep sees and opens Cash Collection", () => {
  const user = {
    role: "sales_rep",
    effective_permissions: { "payments.collect_cash": true },
  };
  assert.equal(hasFcPermission(user, FC_PERMISSIONS.PAYMENTS_COLLECT_CASH), true);
  assert.equal(resolveCustomerPortalPage({ hash: "#cash-collection", isSalesRep: true, canCollectCash: true }), "salesCashCollection");
  assert.equal(isCustomerPortalPageAllowed("salesCashCollection", { isSalesRep: true, canCollectCash: true }), true);
});

test("unauthorised Sales Rep cannot open Cash Collection", () => {
  const user = { role: "Sales Representative", effective_permissions: {} };
  assert.equal(hasFcPermission(user, FC_PERMISSIONS.PAYMENTS_COLLECT_CASH), false);
  assert.equal(resolveCustomerPortalPage({ hash: "#cash-collection", isSalesRep: true, canCollectCash: false }), "order");
  assert.equal(isCustomerPortalPageAllowed("salesCashCollection", { isSalesRep: true, canCollectCash: false }), false);
});

test("Driver with the existing permission remains authorised", () => {
  assert.equal(
    hasFcPermission(
      { role: "Driver", effective_permissions: { "payments.collect_cash": true } },
      FC_PERMISSIONS.PAYMENTS_COLLECT_CASH,
    ),
    true,
  );
});

test("unrelated staff remains denied", () => {
  assert.equal(
    hasFcPermission({ role: "Warehouse", effective_permissions: {} }, FC_PERMISSIONS.PAYMENTS_COLLECT_CASH),
    false,
  );
});

test("navigation and page use effective permissions while payment stays RPC secured", () => {
  assert.match(customerOrder, /canAccessPage\(activeUser, "page\.order\.sales_rep"\)/);
  assert.match(customerOrder, /hasFcPermission\([\s\S]*FC_PERMISSIONS\.PAYMENTS_COLLECT_CASH/);
  assert.doesNotMatch(customerOrder, /const canCollectCash\s*=[\s\S]{0,300}\["admin",\s*"superadmin"/);
  assert.match(customerOrder, /isSalesRep && canCollectCash && page === "salesCashCollection"/);
  assert.match(paymentService, /post_canonical_customer_payment_v2/);
  assert.match(paymentService, /ownerPassword: input\.fcSessionToken/);
  assert.match(paymentService, /p_fc_session_token: ownerPassword/);
});
