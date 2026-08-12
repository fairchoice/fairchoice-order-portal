import test from "node:test";
import assert from "node:assert/strict";
import { sortPrintItems } from "./printItemSorting.js";

test("operational documents group by series, then brand, sub category and main category fallback", () => {
  const rows = [
    { name: "Main only", category: "Z Main" },
    { name: "Sub only", subCategory: "B Sub" },
    { name: "Brand only", brand: "C Brand" },
    { name: "Series two", series: "B Series" },
    { name: "Series one", series: "A Series" },
  ];
  assert.deepEqual(
    sortPrintItems(rows).map((row) => row.name),
    ["Series one", "Series two", "Brand only", "Sub only", "Main only"]
  );
});
