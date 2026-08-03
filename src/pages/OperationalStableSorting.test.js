import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const received = fs.readFileSync(new URL("./AdminOrders.jsx", import.meta.url), "utf8");
const picking = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");

test("Received Orders groups once and preserves its item snapshot during edits", () => {
  assert.match(received, /\[stableItemOrders, setStableItemOrders\] = useState\(\{\}\)/);
  assert.match(received, /const snapshot = stableItemOrders\[key\] \|\| initialOrderItemSort\(items\)\.map\(itemKey\)/);
  assert.match(received, /snapshot\.map\(\(id\) => byId\.get\(id\)\)/);
  assert.match(received, /getStableOrderItems\(order\.orderId, order\.items\)\.map/);
});

test("Picking sorts only on order entry and maps updates without reordering", () => {
  assert.match(picking, /useState\(\(\) => sortPickingItemsInitially\(order\?\.items \|\| \[\]\)\)/);
  assert.match(picking, /\}, \[order\?\.orderId\]\);/);
  assert.match(picking, /setItems\(\(current\) =>\s*current\.map/);
  assert.doesNotMatch(picking, /updateLocalItem[\s\S]{0,300}\.sort\(/);
});
