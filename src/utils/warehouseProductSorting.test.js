import assert from "node:assert/strict";
import test from "node:test";
import { sortWarehouseProducts } from "./warehouseProductSorting.js";

const names = (rows) => sortWarehouseProducts(rows).map((row) => row.productName);

test("Vape products sort by Series then Product Name", () => {
  assert.deepEqual(names([
    { id: "3", mainCategory: "Vape", series: "Z Series", productName: "Alpha" },
    { id: "2", mainCategory: "Vape", series: "A Series", productName: "Zulu" },
    { id: "1", mainCategory: "Vape", series: "A Series", productName: "Alpha" },
  ]), ["Alpha", "Zulu", "Alpha"]);
});

test("non-Vape products sort by Sub Category then Product Name", () => {
  assert.deepEqual(names([
    { id: "3", mainCategory: "Grocery", subCategory: "Tea", productName: "Assam" },
    { id: "2", mainCategory: "Grocery", subCategory: "Coffee", productName: "Zulu" },
    { id: "1", mainCategory: "Grocery", subCategory: "Coffee", productName: "Arabica" },
  ]), ["Arabica", "Zulu", "Assam"]);
});

test("missing Series or Sub Category sorts last", () => {
  const rows = sortWarehouseProducts([
    { id: "4", mainCategory: "Grocery", subCategory: "", productName: "Missing Grocery" },
    { id: "3", mainCategory: "Vape", series: "", productName: "Missing Vape" },
    { id: "2", mainCategory: "Grocery", subCategory: "Coffee", productName: "Coffee" },
    { id: "1", mainCategory: "Vape", series: "Series A", productName: "Vape" },
  ]);
  assert.deepEqual(rows.slice(-2).map((row) => row.productName), ["Missing Vape", "Missing Grocery"]);
});

test("sorting is deterministic across equivalent refreshes and new object identities", () => {
  const first = [
    { id: "b", mainCategory: "Vape", series: "Series A", productName: "Same", sourceStatus: "Pre-Order" },
    { id: "a", mainCategory: "Vape", series: "Series A", productName: "Same", sourceStatus: "Pre-Order" },
  ];
  const refreshed = first.map((row) => ({
    ...row,
    sourceStatus: "In Stock",
    supplierName: "Refreshed Supplier",
    actionType: "Available",
  })).reverse();
  assert.deepEqual(
    sortWarehouseProducts(first).map((row) => row.id),
    sortWarehouseProducts(refreshed).map((row) => row.id),
  );
});
