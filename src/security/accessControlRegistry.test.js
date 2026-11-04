import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ALL_IMPORTANT_FUNCTION_KEYS,
  ALL_PAGE_PERMISSION_KEYS,
  PAGE_REGISTRY,
  canAccessPage,
  canPerform,
  getAccessiblePageSections,
  getRoleDefaultPermissionKeys,
} from "./accessControlRegistry.js";

const withPermissions = (role, keys = []) => ({
  username: `${role}-user`,
  role,
  active: true,
  effective_permissions: Object.fromEntries(keys.map((key) => [key, true])),
});

test("Nisstaj_admin receives every current and future page and important function", () => {
  const master = withPermissions("Admin");
  master.username = "Nisstaj_admin";
  for (const key of [...ALL_PAGE_PERMISSION_KEYS, ...ALL_IMPORTANT_FUNCTION_KEYS, "page.future.registered", "future.sensitive.action"]) {
    assert.equal(canPerform(master, key), true);
  }
});

test("role templates contain the required Sales Rep, Driver and Warehouse pages", () => {
  assert.deepEqual(getRoleDefaultPermissionKeys("Sales Rep").filter((key) => key === "page.order.sales_rep"), ["page.order.sales_rep"]);
  assert.ok(getRoleDefaultPermissionKeys("Driver").includes("page.operations.driver"));
  for (const key of ["page.operations.received_orders", "page.operations.returns", "page.operations.warehouse", "page.operations.pre_order_supply"]) {
    assert.ok(getRoleDefaultPermissionKeys("Warehouse").includes(key));
  }
});

test("Sales Invoice and Expenses are default-visible to every standard non-customer staff role", () => {
  for (const role of ["Admin", "Accounts", "Accountant", "Sales Rep", "Driver", "Warehouse"]) {
    const defaults = getRoleDefaultPermissionKeys(role);
    assert.ok(defaults.includes("page.order.sales_invoice"));
    assert.ok(defaults.includes("page.accounts.expenses"));
  }
});

test("page access does not imply an important-function permission", () => {
  const warehouse = withPermissions("Warehouse", ["page.operations.received_orders"]);
  assert.equal(canAccessPage(warehouse, "orders"), true);
  assert.equal(canPerform(warehouse, "orders.cancel"), false);
});

test("direct page navigation uses the same registry authorization as the sidebar", () => {
  const driver = withPermissions("Driver", ["page.operations.driver"]);
  assert.equal(canAccessPage(driver, "driver"), true);
  assert.equal(canAccessPage(driver, "centralPayment"), false);
});

test("the legacy Sales Rep Order route cannot bypass centralized page access", () => {
  const source = readFileSync(new URL("../pages/CustomerOrder.jsx", import.meta.url), "utf8");
  assert.match(source, /page === "order" && !isCustomer[\s\S]*\? isSalesRep/);
  assert.doesNotMatch(source, /\(isAdmin \|\| isSalesRep \|\| isCustomer\) && page === "order"/);
});

test("payment page access does not grant payment edit", () => {
  const accounts = withPermissions("Accounts", ["page.accounts.central_payment"]);
  assert.equal(canAccessPage(accounts, "centralPayment"), true);
  assert.equal(canPerform(accounts, "payments.edit"), false);
});

test("empty parent and sidebar sections are removed", () => {
  const driver = withPermissions("Driver", ["page.operations.driver"]);
  const sections = getAccessiblePageSections(driver);
  assert.deepEqual(sections.map((section) => section.title), ["Operations"]);
  assert.deepEqual(sections[0].items.map((item) => item.label), ["Driver Portal"]);
});

test("customers cannot inherit Back Office permissions from supplied JSON", () => {
  const customer = withPermissions("Customer", PAGE_REGISTRY.map((item) => item.key));
  assert.equal(canAccessPage(customer, "orderSalesInvoices"), false);
  assert.equal(canPerform(customer, "orders.cancel"), false);
});

test("inactive staff are denied even when permission data remains", () => {
  const user = withPermissions("Warehouse", ["page.operations.warehouse"]);
  user.active = false;
  assert.equal(canAccessPage(user, "warehouse"), false);
});
