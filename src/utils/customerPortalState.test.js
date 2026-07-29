import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildCustomerPortalHistoryState,
  getCustomerCartStorageKey,
  getCustomerPortalHistoryAction,
  getCustomerPortalHash,
  getOrderSubmissionErrorMessage,
  isCustomerPortalHomeView,
  isCustomerPortalPageAllowed,
  resolveCustomerPortalPage,
} from "./customerPortalState.js";

const customerOrderSource = fs.readFileSync(
  new URL("../pages/CustomerOrder.jsx", import.meta.url),
  "utf8"
);
const homeGridSource = fs.readFileSync(
  new URL("../components/HomeCategoryGrid.jsx", import.meta.url),
  "utf8"
);
const productFiltersSource = fs.readFileSync(
  new URL("../components/ProductFilters.jsx", import.meta.url),
  "utf8"
);

test("sales rep credit hash restores the sales credit page", () => {
  assert.equal(resolveCustomerPortalPage({ hash: "#credit", isSalesRep: true }), "salesCreditHistory");
  assert.equal(getCustomerPortalHash("salesCreditHistory", { isSalesRep: true }), "#credit");
});

test("cash collection route is hidden when the FC permission is denied", () => {
  assert.equal(
    resolveCustomerPortalPage({
      hash: "#cash-collection",
      isSalesRep: true,
      canCollectCash: false,
    }),
    "order"
  );
  assert.equal(
    resolveCustomerPortalPage({
      hash: "#cash-collection",
      isSalesRep: true,
      canCollectCash: true,
    }),
    "salesCashCollection"
  );
});

test("admin credit hash takes precedence over overlapping staff permissions", () => {
  assert.equal(
    resolveCustomerPortalPage({
      hash: "#credit",
      isAdmin: true,
      isSalesRep: true,
      isWarehouse: true,
      isDriver: true,
    }),
    "credit"
  );

  assert.equal(
    getCustomerPortalHash("credit", {
      isAdmin: true,
      isSalesRep: true,
    }),
    "#credit"
  );
});

test("admin Payment History hash no longer resolves to a separate Back Office route", () => {
  assert.equal(
    resolveCustomerPortalPage({ hash: "#payment-history", isAdmin: true }),
    "orders"
  );
});

test("admin product notices hash opens Home Page Content directly", () => {
  assert.equal(
    resolveCustomerPortalPage({
      hash: "#home-content-notices",
      isAdmin: true,
    }),
    "homePageImages"
  );
  assert.equal(
    getCustomerPortalHash("homePageImages", { isAdmin: true }),
    ""
  );
});

test("customer portal history keeps one internal guard without duplicate entries", () => {
  const homeState = buildCustomerPortalHistoryState(
    { preserved: "value" },
    { view: "home" }
  );
  assert.deepEqual(homeState, {
    preserved: "value",
    fairchoicePortal: true,
    page: "order",
    view: "home",
  });
  assert.equal(getCustomerPortalHistoryAction(homeState, "category"), "push");
  assert.equal(
    getCustomerPortalHistoryAction(
      { ...homeState, view: "category" },
      "product"
    ),
    "replace"
  );
  assert.equal(
    getCustomerPortalHistoryAction(
      { ...homeState, view: "product" },
      "product"
    ),
    "none"
  );
});

test("customer Home state excludes category and product-detail views", () => {
  assert.equal(
    isCustomerPortalHomeView({
      page: "order",
      showHomepage: true,
      hasSelectedProduct: false,
    }),
    true
  );
  assert.equal(
    isCustomerPortalHomeView({
      page: "order",
      showHomepage: false,
      hasSelectedProduct: false,
    }),
    false
  );
  assert.equal(
    isCustomerPortalHomeView({
      page: "order",
      showHomepage: true,
      hasSelectedProduct: true,
    }),
    false
  );
});

test("global Home resets browsing state, preserves cart, and handles popstate", () => {
  const restoreHomeSource = customerOrderSource.match(
    /const restoreCustomerHome = useCallback\(\(\) => \{([\s\S]*?)\n\}, \[[\s\S]*?\]\);/
  )?.[1];
  assert.ok(restoreHomeSource, "restoreCustomerHome implementation is missing");
  for (const reset of [
    'setPage("order")',
    'setSearch("")',
    'setSelectedCategory("All Products")',
    'setSelectedSubCategory("All Sub Categories")',
    'setSelectedBrand("All Brands")',
    'setSelectedSeries("All Series")',
    "setProductPage(1)",
    "setSelectedImage(null)",
    "setIsCartEditing(false)",
  ]) {
    assert.ok(restoreHomeSource.includes(reset), `missing Home reset: ${reset}`);
  }
  assert.doesNotMatch(restoreHomeSource, /setCart\s*\(/);
  assert.match(customerOrderSource, /addEventListener\("popstate"/);
  assert.match(customerOrderSource, /window\.history\.pushState/);
  assert.match(customerOrderSource, /getCustomerPortalHistoryAction/);
  assert.match(
    customerOrderSource,
    /activePortalViewRef\.current !== "home"/
  );
});

test("Home controls are persistent, strongly styled, and never hidden on mobile", () => {
  assert.match(
    customerOrderSource,
    /\(isCustomer \|\| isSalesRep \|\| \(isAdmin && page === "order"\)\)/
  );
  assert.doesNotMatch(
    customerOrderSource,
    /showHomepage && <button[\s\S]{0,250}aria-label="Go to home"/
  );
  for (const source of [customerOrderSource, homeGridSource, productFiltersSource]) {
    assert.match(source, /border-2 border-blue-950 bg-blue-950/);
  }
  assert.doesNotMatch(homeGridSource, /hidden[^"]*Go to home|hidden min-h/);
  assert.match(homeGridSource, /onClick=\{onHome\}/);
  assert.match(productFiltersSource, /onClick=\{onBackToCategories\}/);
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
