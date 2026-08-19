import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWarehouseActivityEvent,
  filterWarehouseActivity,
  normalizeWarehouseStatus,
  summarizeWarehouseActivity,
} from "./warehouseActivity.js";

test("Warehouse aliases normalize without allowing Next Supplier as an operational status", () => {
  assert.equal(normalizeWarehouseStatus("Available"), "In Stock");
  for (const status of ["Need Supplier", "Pre Order", "Pre-Order", "NEXT_SUPPLIER"]) {
    assert.equal(normalizeWarehouseStatus(status), "Pre-Order");
  }
  assert.equal(normalizeWarehouseStatus("Cannot Supply"), "Cannot Supply");
});

test("activity payload retains operational analysis dimensions", () => {
  const event = buildWarehouseActivityEvent({
    order: { orderId: "ORD-1", dbId: "11111111-1111-4111-8111-111111111111", companyName: "Shop", branchName: "Cardiff", customer_country: "Wales" },
    item: { dbId: "22222222-2222-4222-8222-222222222222", productId: "33333333-3333-4333-8333-333333333333", productCode: "P1", name: "Product", qty: 4 },
    actionType: "Available", newStatus: "In Stock", sourceModule: "Pre-Order Supply",
  });
  assert.equal(event.order_number, "ORD-1");
  assert.equal(event.product_code, "P1");
  assert.equal(event.customer_name, "Shop");
  assert.equal(event.branch_name, "Cardiff");
  assert.equal(event.country, "Wales");
  assert.equal(event.source_module, "Pre-Order Supply");
});

test("Warehouse Activity filters and summary cover transitions and recalls", () => {
  const rows = [
    { timestamp: "2026-08-18T10:00:00Z", country: "Wales", staffName: "A", productName: "P", customerName: "C", orderNumber: "ORD-1", actionType: "Available", oldStatus: "Pre-Order", newStatus: "In Stock", supplierName: "" },
    { timestamp: "2026-08-18T11:00:00Z", country: "England", staffName: "B", productName: "Q", customerName: "D", orderNumber: "ORD-2", actionType: "Recall Available", oldStatus: "In Stock", newStatus: "Cannot Supply", supplierName: "" },
  ];
  assert.equal(filterWarehouseActivity(rows, { country: "Wales", staff: "All", product: "All", customer: "All", orderNumber: "", action: "All", oldStatus: "All", newStatus: "All", supplier: "All", dateFrom: "", dateTo: "" }).length, 1);
  const summary = summarizeWarehouseActivity(rows);
  assert.equal(summary.total, 2);
  assert.equal(summary.preOrderToInStock, 1);
  assert.equal(summary.recalls, 1);
});
