import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { allocateSupplierQuantity } from "../services/preOrderSupplyAllocation.js";

test("supplier quantity allocation fills customer orders in stable order", () => {
  const lines = [
    { itemKey: "x", qty: 5 },
    { itemKey: "y", qty: 6 },
  ];
  assert.deepEqual(allocateSupplierQuantity(lines, 8), { x: 5, y: 3 });
});

test("pre-order supply exposes supplier-first queues and manual sync", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.match(source, /Pre-order Queue/);
  assert.match(source, /Next Supplier/);
  assert.match(source, /Order Pre-orders/);
  assert.match(source, /Confirm Buy/);
  assert.match(source, /Sync All/);
  assert.match(source, /Select Supplier/);
});

test("cannot supply history stays compact without redundant unavailable label", () => {
  const source = fs.readFileSync(new URL("./PreOrderSupply.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, />Not available</);
});
