import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("./Warehouse.jsx", import.meta.url), "utf8");

test("warehouse status changes preserve the existing item row order", () => {
  assert.match(source, /\[stableItemOrders, setStableItemOrders\] = useState\(\{\}\)/);
  assert.match(source, /const getInitialWarehouseItemOrder = \(items = \[\]\) =>/);
  assert.match(source, /const snapshot = stableItemOrders\[key\] \|\| getInitialWarehouseItemOrder\(items\)\.map\(itemKey\)/);
  assert.match(source, /snapshot\.map\(\(id\) => byId\.get\(id\)\)/);
  assert.match(source, /getGroupedWarehouseItems\(orderId, order\.items\)\.map/);
});
