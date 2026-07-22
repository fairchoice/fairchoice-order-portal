import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const gridSource = await readFile(new URL("./HomeCategoryGrid.jsx", import.meta.url), "utf8");
const orderPageSource = await readFile(new URL("../pages/CustomerOrder.jsx", import.meta.url), "utf8");

test("homepage product finder uses the compact Fair Choice blue header", () => {
  assert.match(gridSource, /bg-\[#0b2f5b\]/);
  assert.match(gridSource, /text-2xl/);
  assert.match(gridSource, /placeholder="Search all products/);
  assert.doesNotMatch(gridSource, /placeholder="Search categories/);
});

test("homepage search renders products rather than matching category cards", () => {
  assert.match(gridSource, /searchingProducts/);
  assert.match(gridSource, /productResultCount/);
  assert.match(gridSource, /\{children\}/);
  assert.match(orderPageSource, /const homepageSearchProducts = useMemo/);
  assert.match(orderPageSource, /homepageVisibleSearchProducts\.map/);
  assert.match(orderPageSource, /<ProductCard/);
  assert.doesNotMatch(orderPageSource, /visibleHomepageCategoryCards/);
});
