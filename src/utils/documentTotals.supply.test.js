import test from "node:test";
import assert from "node:assert/strict";
import { calculateDocumentTotals } from "./documentTotals.js";

const items = [
  { qty: 1, price: 18.75, source_status: "In Stock" },
  { qty: 1, price: 62.25, source_status: "Cannot Supply" },
];

test("recent unissued order excludes cannot-supply from net and grand totals", () => {
  const result = calculateDocumentTotals(items, {
    created_at: "2026-10-21T12:00:00Z",
    status: "Warehouse Packing",
    price_mode: "Server",
    order_total: 81,
    net_total: 81,
  });
  assert.equal(result.totalLines, 1);
  assert.equal(result.netTotal, 18.75);
  assert.equal(result.grandTotal, 18.75);
});

test("delivered document preserves saved invoice total", () => {
  const result = calculateDocumentTotals(items, {
    created_at: "2026-10-21T12:00:00Z",
    status: "Delivered",
    price_mode: "Server",
    invoice_total: 81,
    order_total: 81,
    net_total: 81,
  });
  assert.equal(result.grandTotal, 81);
});

test("older orders do not use the new exclusion override", () => {
  const result = calculateDocumentTotals(items, {
    created_at: "2026-10-18T12:00:00Z",
    status: "Warehouse Packing",
    price_mode: "Server",
    order_total: 81,
    net_total: 81,
  });
  assert.equal(result.totalLines, 1);
  assert.equal(result.grandTotal, 18.75);
});

test("recent Ex.VAT order excludes unsupplied lines and retains saved VAT rate", () => {
  const result = calculateDocumentTotals([
    { qty: 2, price: 10, vat_percent: 20, source_status: "In Stock" },
    { qty: 1, price: 30, vat_percent: 20, source_status: "Pre-order" },
  ], {
    created_at: "2026-10-21T12:00:00Z",
    status: "Warehouse Packing",
    price_mode: "VAT",
    order_total: 60,
    net_total: 50,
    vat_total: 10,
  });
  assert.equal(result.totalLines, 1);
  assert.equal(result.netTotal, 20);
  assert.equal(result.vatTotal, 4);
  assert.equal(result.grandTotal, 24);
});

test("recent Inc.VAT order never adds VAT again to saved unit prices", () => {
  const result = calculateDocumentTotals([
    { qty: 2, price: 12, vat_percent: 20, source_status: "In Stock" },
    { qty: 1, price: 30, vat_percent: 20, source_status: "Cannot Supply" },
  ], {
    created_at: "2026-10-21T12:00:00Z",
    status: "Received",
    price_mode: "Inc.VAT",
    order_total: 54,
  });
  assert.equal(result.netTotal, 24);
  assert.equal(result.vatTotal, 0);
  assert.equal(result.grandTotal, 24);
});

test("issued invoice preserves explicitly saved zero totals", () => {
  const result = calculateDocumentTotals(items, {
    created_at: "2026-10-21T12:00:00Z",
    status: "Delivered",
    price_mode: "Server",
    invoice_total: 0,
    net_total: 0,
    vat_total: 0,
  });
  assert.equal(result.grandTotal, 0);
  assert.equal(result.netTotal, 0);
  assert.equal(result.vatTotal, 0);
});
