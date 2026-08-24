import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { getPickingAvailability } from "../services/pickingAvailability.js";

test("picking availability uses current country stock", () => {
  assert.equal(getPickingAvailability(1, { stock: 5, inventoryLocationMissing: false }).key, "in_stock");
  assert.equal(getPickingAvailability(5, { stock: 3, inventoryLocationMissing: false }).key, "part_stock");
  assert.equal(getPickingAvailability(1, { stock: 0, inventoryLocationMissing: false }).key, "pre_order");
  assert.equal(getPickingAvailability(1, { stock: 0, inventoryLocationMissing: true }).key, "not_configured");
});

test("picking UI has separate break and bottom release controls", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, />\s*Break\s*</);
  assert.match(source, /Cancel Picking \/ Release Order/);
  assert.match(source, /const breakPicking = \(\) =>/);
  assert.match(source, /await pauseOrderPicking\(order\.orderId, currentUser\)/);
});

test("picking refreshes location stock directly when opened", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /getProductLocationStock\(ids\)/);
  assert.match(source, /buildLocationStockMap\(rows\)/);
});


test("picking helper tolerates null order items", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /const productIdOf = \(item\) =>[\s\S]*item\?\.id \|\|[\s\S]*null;/);
  assert.match(source, /const itemIdOf = \(item\) => item\?\.dbId \|\| item\?\.id \|\| null;/);
});


test("part pick is restricted to genuine partial stock and saved statuses are clickable", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /stock > 0 &&[\s\S]*stock < remaining &&[\s\S]*selectedQty === stock/);
  assert.match(source, /Picked <b>\{pickedQty\}<\/b>/);
  assert.match(source, /Pre-order <b>\{preOrderQty\}<\/b>/);
  assert.match(source, /Replaced <b>\{replacedQty\}<\/b>/);
  assert.match(source, /action === "replace"[\s\S]*Math\.min\(selectedQuantity\(item, stock\), Math\.max\(0, stock\), remaining\)/);
});

test("picking refreshes warehouse stock after pick, replacement, and recall", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(action === "in_stock" \|\| action === "replace"\)[\s\S]*setStockRefreshNonce/);
  assert.match(source, /const recall = async[\s\S]*setStockRefreshNonce/);
});

test("action buttons stay visible, saved rows enable recall, and recall all is available", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, />\s*Recall All\s*</);
  assert.match(source, /const recallAll = async \(\) =>/);
  assert.match(source, /items\.filter\(\(item\) => getResolvedQty\(item\) > 0\)/);
  assert.match(source, /disabled=\{hasSavedAction \|\| !canPickAll \|\| itemBusy\}/);
  assert.match(source, /disabled=\{!hasSavedAction \|\| itemBusy\}/);
});

test("replacement selection is mobile friendly and excludes inactive products", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[selectedReplacement, setSelectedReplacement\]/);
  assert.match(source, /onClick=\{\(\) => setSelectedReplacement\(product\)\}/);
  assert.match(source, /Add Replacement/);
  assert.match(source, /\.filter\(isActiveProduct\)/);
});

test("replacement result displays the selected replacement product", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /Replacement:/);
  assert.match(source, /replacementProductName/);
});

test("partial pick can be followed by pre-order or replacement for the remainder", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /const canResolveRemainder = remaining > 0 && pickedQty > 0/);
  assert.match(source, /hasSavedAction && !canResolveRemainder/);
});


test("pre-order rows can be picked as a physical-stock mismatch even when system stock is zero", () => {
  const source = fs.readFileSync(new URL("./OrderPicking.jsx", import.meta.url), "utf8");
  assert.match(source, /const isPreOrderOverride = \[/);
  assert.match(source, /"need supplier"[\s\S]*"pre-order"[\s\S]*"pre order"[\s\S]*"next supplier"/);
  assert.match(source, /const canPickAll =[\s\S]*isPreOrderOverride \|\|[\s\S]*stock >= remaining/);
  assert.match(source, /getPickingMismatchActivity\([\s\S]*action,[\s\S]*recordWarehouseOperationalActivity/);
});
