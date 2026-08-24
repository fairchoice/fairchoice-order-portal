import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { canAccessPage } from "../../security/accessControlRegistry.js";
import {
  emptyWarehouseActivityFilters,
  filterWarehouseActivity,
  sumWarehouseActivityQuantity,
} from "../../services/warehouseActivity.js";

const page = fs.readFileSync(new URL("./WarehouseActivityReport.jsx", import.meta.url), "utf8");
const customerOrder = fs.readFileSync(new URL("../CustomerOrder.jsx", import.meta.url), "utf8");

test("Warehouse Activity Monitor exposes the required cards, filters and table", () => {
  for (const label of ["Warehouse Activity Monitor","Total Status Changes","In Stock → Pre-Order","In Stock → Cannot Supply","Pre-Order → In Stock","Pre-Order → Cannot Supply","Cannot Supply → In Stock","Recalls","Date From","Date To","Staff","Product","Customer","Order Number","Action","Old Status","New Status","Supplier"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /Date\/Time/);
  assert.match(page, /loadWarehouseActivityReport/);
  assert.match(page, /Filtered Quantity Total:/);
  assert.match(page, /sumWarehouseActivityQuantity\(filteredRows\)/);
});

test("Filtered Quantity Total follows the currently filtered report rows", () => {
  const rows = [
    { quantity: 2, country: "England" },
    { quantity: 2, country: "Wales" },
    { quantity: 1, country: "England" },
    { quantity: 2, country: "Wales" },
  ];
  assert.equal(sumWarehouseActivityQuantity(rows), 7);
  const filtered = filterWarehouseActivity(rows, {
    ...emptyWarehouseActivityFilters,
    country: "Wales",
  });
  assert.equal(sumWarehouseActivityQuantity(filtered), 4);
});

test("report uses centralized routing and permission enforcement", () => {
  assert.match(customerOrder, /page === "warehouseActivity"/);
  const allowed = { username: "staff", role: "Warehouse", active: true, effective_permissions: { "page.reports.warehouse_activity": true } };
  const denied = { ...allowed, effective_permissions: {} };
  assert.equal(canAccessPage(allowed, "warehouseActivity"), true);
  assert.equal(canAccessPage(denied, "warehouseActivity"), false);
  assert.equal(canAccessPage({ ...denied, username: "nisstaj_admin" }, "warehouseActivity"), true);
});
