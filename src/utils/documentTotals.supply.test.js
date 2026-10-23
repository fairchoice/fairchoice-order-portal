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
