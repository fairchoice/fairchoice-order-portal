import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(
  new URL("../pages/reports/PurchasePlanningReport.jsx", import.meta.url),
  "utf8",
);
const layout = fs.readFileSync(
  new URL("../pages/AdminSetup/BackOfficeLayout.jsx", import.meta.url),
  "utf8",
);
const customerOrder = fs.readFileSync(
  new URL("../pages/CustomerOrder.jsx", import.meta.url),
  "utf8",
);
const service = fs.readFileSync(
  new URL("purchasePlanningReport.js", import.meta.url),
  "utf8",
);
const registry = fs.readFileSync(new URL("../security/accessControlRegistry.js", import.meta.url), "utf8");

test("Purchase Planning navigation and render use centralized page access", () => {
  assert.match(registry, /page\("page\.reports\.purchase_planning", "Purchase Planning", "purchasePlanning"/);
  assert.match(layout, /PAGE_ACCESS_SECTIONS[\s\S]*registryCanAccessPage/);
  assert.match(customerOrder, /page === "purchasePlanning"[\s\S]*<PurchasePlanningReport/);
});

test("report page is read-only and exposes refresh plus filtered CSV export", () => {
  assert.match(page, /Refresh Report/);
  assert.match(page, /Export CSV/);
  assert.match(page, /buildPurchasePlanningCsv\(filteredRows\)/);
  assert.doesNotMatch(page, /supabase\s*\.\s*from/);
});

test("report loader batches orders and reuses paged Pre-Order history", () => {
  assert.match(service, /\.from\("orders"\)[\s\S]*\.range\(offset, offset \+ PAGE_SIZE - 1\)/);
  assert.match(service, /loadPreOrderSupplyHistory\(user\)/);
  assert.match(service, /Promise\.allSettled/);
  assert.doesNotMatch(service, /\.select\(`\*,\s*order_items/);
  assert.doesNotMatch(service, /for\s*\([^)]*product[^)]*\)[\s\S]{0,300}supabase/i);
});

test("responsive report includes mobile details and active Pre-Order purchase detail", () => {
  assert.match(page, /ppr-mobile-list/);
  assert.match(page, /View Details/);
  assert.match(page, /Pre-Order Purchases/);
  assert.match(page, /Suggested quantity is advisory only\./);
});

test("responsive report mounts one layout and paginates filtered rows", () => {
  assert.match(page, /!mobileLayout\s*\?/);
  assert.match(page, /pagination\.rows\.map/);
  assert.match(page, /\[25, 50, 100\]/);
  assert.match(page, /Showing \{pagination\.start\}/);
  assert.match(page, /buildPurchasePlanningCsv\(filteredRows\)/);
});

test("report source warning documents the future reports-only RPC", () => {
  assert.match(service, /SELECT-only Purchase Planning history/);
  assert.match(service, /access_reports/);
  assert.match(service, /page\.warehouse/);
});
