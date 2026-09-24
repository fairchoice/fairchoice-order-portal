import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateActivePreOrderPurchases,
  aggregateDeliveredProductSales,
  aggregateOutstandingPreOrders,
  buildPurchasePlanningCsv,
  buildPurchasePlanningRows,
  calculatePurchaseSuggestion,
  calculatePurchaseTrend,
  classifyPurchasePlanningDate,
  emptyPurchasePlanningFilters,
  filterPurchasePlanningRows,
  getActivePreOrderPurchaseEvents,
  getPurchasePlanningFilterOptions,
  LEGACY_UNALLOCATED_COUNTRY,
  loadPurchasePlanningReport,
  matchesPurchasePlanningStatus,
  paginatePurchasePlanningRows,
  reconcilePurchasePlanningFilters,
  safeCsvText,
  updatePurchasePlanningHierarchy,
} from "./purchasePlanningReport.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const dayAgo = (days, extraMs = 0) => new Date(NOW.getTime() - days * 86400000 + extraMs).toISOString();
const product = (overrides = {}) => ({
  id: "product-a",
  productCode: "A1",
  name: "Vape One",
  category: "Vape",
  subCategory: "Disposable",
  brand: "Brand X",
  series: "Series Y",
  supplierName: "Supplier One",
  active: true,
  availableInEngland: true,
  availableInWales: false,
  locationStocks: {
    england: { locationId: "england", country: "England", active: true, qty: 3 },
  },
  ...overrides,
});
const orderItem = (overrides = {}) => ({
  id: "item-a",
  product_id: "product-a",
  product_code: "A1",
  product_name: "Vape One",
  qty: 5,
  picked_qty: 5,
  source_status: "In Stock",
  include_in_picking: true,
  ...overrides,
});
const deliveredOrder = (overrides = {}) => ({
  id: "order-a",
  order_number: "ORD-A",
  status: "Delivered",
  delivered_at: dayAgo(2),
  customer_country: "England",
  order_items: [orderItem()],
  ...overrides,
});
const openOrder = (overrides = {}) => ({
  id: "open-a",
  order_number: "ORD-OPEN",
  status: "Received",
  customer_country: "England",
  order_items: [orderItem({ source_status: "Need Supplier", include_in_picking: false })],
  ...overrides,
});
const purchaseEvent = (overrides = {}) => ({
  id: "event-a",
  clientActionId: "client-a",
  itemKey: "ORD-OPEN:item-a",
  itemId: "item-a",
  orderId: "ORD-OPEN",
  actionType: "Buy",
  productId: "product-a",
  productName: "Vape One",
  supplierId: "supplier-a",
  supplierName: "Supplier One",
  quantity: 2,
  timestamp: dayAgo(1),
  userName: "Nisstaj",
  ...overrides,
});

test("last 7 period includes a recent sale", () => {
  assert.deepEqual(classifyPurchasePlanningDate(dayAgo(2), NOW), { last7: true, previous7: false, last30: true });
});

test("previous 7 period excludes the last 7", () => {
  assert.deepEqual(classifyPurchasePlanningDate(dayAgo(10), NOW), { last7: false, previous7: true, last30: true });
});

test("last 30 includes older rolling-window sales", () => {
  assert.deepEqual(classifyPurchasePlanningDate(dayAgo(25), NOW), { last7: false, previous7: false, last30: true });
});

test("seven-day boundary belongs only to the current period", () => {
  assert.deepEqual(classifyPurchasePlanningDate(dayAgo(7), NOW), { last7: true, previous7: false, last30: true });
  assert.deepEqual(classifyPurchasePlanningDate(dayAgo(7, -1), NOW), { last7: false, previous7: true, last30: true });
});

test("thirty-day boundary is inclusive and one millisecond older is excluded", () => {
  assert.equal(classifyPurchasePlanningDate(dayAgo(30), NOW).last30, true);
  assert.equal(classifyPurchasePlanningDate(dayAgo(30, -1), NOW).last30, false);
});

test("delivered product quantities aggregate", () => {
  const result = aggregateDeliveredProductSales([deliveredOrder()], NOW);
  assert.equal(result.get("id:product-a::England").soldLast7, 5);
});

test("multiple delivered orders aggregate for one stable product", () => {
  const result = aggregateDeliveredProductSales([
    deliveredOrder(),
    deliveredOrder({ id: "order-b", order_number: "ORD-B", order_items: [orderItem({ id: "item-b", qty: 3, picked_qty: 3 })] }),
  ], NOW);
  assert.equal(result.get("id:product-a::England").soldLast7, 8);
});

test("same product names with different IDs stay separate", () => {
  const result = aggregateDeliveredProductSales([
    deliveredOrder(),
    deliveredOrder({ id: "order-b", order_items: [orderItem({ id: "item-b", product_id: "product-b", product_code: "B1" })] }),
  ], NOW);
  assert.equal(result.size, 2);
});

test("Cannot Supply lines are excluded", () => {
  const result = aggregateDeliveredProductSales([deliveredOrder({ order_items: [orderItem({ source_status: "Cannot Supply", include_in_picking: false })] })], NOW);
  assert.equal(result.size, 0);
});

test("cancelled orders are excluded", () => {
  assert.equal(aggregateDeliveredProductSales([deliveredOrder({ status: "Cancelled" })], NOW).size, 0);
});

test("partial supplied quantity uses the final picked quantity", () => {
  const result = aggregateDeliveredProductSales([deliveredOrder({ order_items: [orderItem({ qty: 5, picked_qty: 3 })] })], NOW);
  assert.equal(result.get("id:product-a::England").soldLast7, 3);
});

test("replacement sales group under the supplied replacement product", () => {
  const result = aggregateDeliveredProductSales([
    deliveredOrder({
      order_items: [orderItem({
        picking_action: "replace",
        replacement_product_id: "product-r",
        replacement_product_code: "R1",
        replacement_product_name: "Replacement",
      })],
    }),
  ], NOW);
  assert.equal(result.has("id:product-a::England"), false);
  assert.equal(result.get("id:product-r::England").soldLast7, 5);
});

test("England and Wales sales remain separate", () => {
  const result = aggregateDeliveredProductSales([
    deliveredOrder(),
    deliveredOrder({ id: "order-w", order_number: "ORD-W", customer_country: "Wales" }),
  ], NOW);
  assert.equal(result.get("id:product-a::England").soldLast7, 5);
  assert.equal(result.get("id:product-a::Wales").soldLast7, 5);
});

test("Buy is counted", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent()]).length, 1);
});

test("PartialBuy is counted", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent({ actionType: "PartialBuy" })]).length, 1);
});

test("NextSup is excluded", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent({ actionType: "NextSup" })]).length, 0);
});

test("Remove is excluded", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent({ actionType: "Remove" })]).length, 0);
});

test("Recall reverses Buy", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent(), purchaseEvent({ id: "recall", clientActionId: "recall-client", actionType: "Recall", recalledClientActionId: "client-a" })]).length, 0);
});

test("Recall reverses PartialBuy by event ID", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent({ actionType: "PartialBuy" }), purchaseEvent({ id: "recall", clientActionId: "recall-client", actionType: "Recall", recalledEventId: "event-a" })]).length, 0);
});

test("weekly average uses 30 divided by 7", () => {
  assert.equal(calculatePurchaseSuggestion({ soldLast30: 30 }).weeklyAverage, 7);
});

test("trend Higher is more than ten percent", () => {
  assert.equal(calculatePurchaseTrend(12, 10).label, "Higher");
});

test("trend Lower is below minus ten percent", () => {
  assert.equal(calculatePurchaseTrend(8, 10).label, "Lower");
});

test("trend Similar is within ten percent", () => {
  assert.equal(calculatePurchaseTrend(11, 10).label, "Similar");
});

test("suggested quantity cannot be negative", () => {
  assert.equal(calculatePurchaseSuggestion({ soldLast7: 3, currentStock: 20 }).suggestedOrderQty, 0);
});

test("enough current stock produces zero suggestion", () => {
  assert.equal(calculatePurchaseSuggestion({ soldLast7: 10, currentStock: 10 }).suggestedOrderQty, 0);
});

test("incoming Pre-Order stock is subtracted once", () => {
  assert.equal(calculatePurchaseSuggestion({ soldLast7: 10, currentStock: 3, preOrderBoughtQty: 2 }).suggestedOrderQty, 5);
});

test("Pre-Order already represented in stock is not subtracted twice", () => {
  assert.equal(calculatePurchaseSuggestion({ soldLast7: 10, currentStock: 5, preOrderBoughtQty: 2, preOrderBoughtAlreadyInStock: true }).suggestedOrderQty, 5);
});

const filterRows = [
  { productKey: "id:a", productCode: "A1", productName: "One", mainCategory: "Vape", subCategory: "Disposable", brand: "Brand X", series: "Series Y", supplierName: "Supplier One", country: "England", suggestedOrderQty: 1, preOrderBoughtQty: 0, preOrderOutstandingQty: 0 },
  { productKey: "id:b", productCode: "B2", productName: "Two", mainCategory: "Vape", subCategory: "Pod", brand: "Brand Z", series: "Series Q", supplierName: "Supplier Two", country: "Wales", suggestedOrderQty: 0, preOrderBoughtQty: 0, preOrderOutstandingQty: 0 },
];

for (const [label, field, value] of [
  ["Main Category", "mainCategory", "Vape"],
  ["Sub Category", "subCategory", "Disposable"],
  ["Brand", "brand", "Brand X"],
  ["Series", "series", "Series Y"],
  ["Country", "country", "England"],
]) {
  test(`${label} filter`, () => {
    const result = filterPurchasePlanningRows(filterRows, { ...emptyPurchasePlanningFilters, [field]: value });
    assert.equal(result.length, field === "mainCategory" ? 2 : 1);
  });
}

test("Main Category resets all descendants", () => {
  assert.deepEqual(updatePurchasePlanningHierarchy({ ...emptyPurchasePlanningFilters, subCategory: "A", brand: "B", series: "C" }, "mainCategory", "Vape"), { ...emptyPurchasePlanningFilters, mainCategory: "Vape" });
});

test("Sub Category resets Brand and Series", () => {
  const result = updatePurchasePlanningHierarchy({ ...emptyPurchasePlanningFilters, brand: "B", series: "C" }, "subCategory", "Pod");
  assert.equal(result.brand, "All");
  assert.equal(result.series, "All");
});

test("Brand resets Series", () => {
  const result = updatePurchasePlanningHierarchy({ ...emptyPurchasePlanningFilters, series: "C" }, "brand", "Brand X");
  assert.equal(result.series, "All");
});

test("combined Brand, Series and Supplier filters", () => {
  const result = filterPurchasePlanningRows(filterRows, { ...emptyPurchasePlanningFilters, brand: "Brand X", series: "Series Y", supplier: "Supplier One" });
  assert.equal(result.length, 1);
});

test("search matches code, product, brand and series case-insensitively", () => {
  for (const search of ["a1", "ONE", "brand x", "series y"]) {
    assert.equal(filterPurchasePlanningRows(filterRows, { ...emptyPurchasePlanningFilters, search }).length, 1);
  }
});

test("purchase status filters are independent and may overlap", () => {
  const row = { suggestedOrderQty: 2, preOrderBoughtQty: 3, preOrderOutstandingQty: 4 };
  assert.equal(matchesPurchasePlanningStatus(row, "Needs Ordering"), true);
  assert.equal(matchesPurchasePlanningStatus(row, "Already Bought"), true);
  assert.equal(matchesPurchasePlanningStatus(row, "Pre-Order Outstanding"), true);
  assert.equal(matchesPurchasePlanningStatus(row, "No Action"), false);
});

test("Vape hierarchy exposes only valid descendant options", () => {
  let filters = updatePurchasePlanningHierarchy(emptyPurchasePlanningFilters, "mainCategory", "Vape");
  filters = updatePurchasePlanningHierarchy(filters, "subCategory", "Disposable");
  filters = updatePurchasePlanningHierarchy(filters, "brand", "Brand X");
  const options = getPurchasePlanningFilterOptions(filterRows, filters);
  assert.deepEqual(options.series, ["Series Y"]);
  assert.equal(filterPurchasePlanningRows(filterRows, { ...filters, series: "Series Y" }).length, 1);
  assert.equal(updatePurchasePlanningHierarchy({ ...filters, series: "Series Y" }, "brand", "Brand Z").series, "All");
  const changedSub = updatePurchasePlanningHierarchy({ ...filters, brand: "Brand X", series: "Series Y" }, "subCategory", "Pod");
  assert.equal(changedSub.brand, "All");
  assert.equal(changedSub.series, "All");
  const changedMain = updatePurchasePlanningHierarchy(changedSub, "mainCategory", "Food");
  assert.equal(changedMain.subCategory, "All");
  assert.equal(changedMain.brand, "All");
  assert.equal(changedMain.series, "All");
});

test("active purchases and live outstanding quantities join product and country", () => {
  const purchases = aggregateActivePreOrderPurchases([purchaseEvent()], [openOrder()]);
  const outstanding = aggregateOutstandingPreOrders([openOrder()]);
  const rows = buildPurchasePlanningRows({ products: [product()], purchases, outstanding });
  assert.equal(rows[0].preOrderBoughtQty, 2);
  assert.equal(rows[0].preOrderOutstandingQty, 5);
});

test("country rows use their own canonical location stock", () => {
  const rows = buildPurchasePlanningRows({
    products: [product({
      availableInWales: true,
      locationStocks: {
        england: { locationId: "england", country: "England", active: true, qty: 3 },
        wales: { locationId: "wales", country: "Wales", active: true, qty: 9 },
      },
    })],
  });
  assert.equal(rows.find((row) => row.country === "England").currentStock, 3);
  assert.equal(rows.find((row) => row.country === "Wales").currentStock, 9);
});

test("delivered purchase history is no longer active incoming stock", () => {
  assert.equal(getActivePreOrderPurchaseEvents([purchaseEvent({ deliveryConfirmed: true })]).length, 0);
});

test("CSV neutralises formula-like text while leaving normal text unchanged", () => {
  for (const value of ["=FORMULA", "+FORMULA", "-FORMULA", "@FORMULA", "  =FORMULA"]) {
    assert.equal(safeCsvText(value), `'${value}`);
  }
  assert.equal(safeCsvText("A100"), "A100");
  assert.equal(safeCsvText("Normal product"), "Normal product");
});

test("CSV treats report quantities as numeric cells", () => {
  const csv = buildPurchasePlanningCsv([{
    productCode: "=CODE",
    productName: "+Product",
    mainCategory: "-Category",
    subCategory: "@Sub",
    brand: "  =Brand",
    series: "Series",
    supplierName: "Supplier",
    country: "England",
    currentStock: -5,
    soldLast7: 2,
    soldPrevious7: 1,
    soldLast30: 4,
    weeklyAverage: 1,
    trend: "Higher",
    trendQty: 1,
    preOrderBoughtQty: 0,
    preOrderOutstandingQty: 0,
    suggestedOrderQty: 4,
    salesAvailable: true,
    preorderHistoryAvailable: true,
    preorderOutstandingAvailable: true,
    suggestionAvailable: true,
  }]);
  assert.match(csv, /"'=CODE"/);
  assert.match(csv, /"'\+Product"/);
  assert.match(csv, /,-5,2,1,4,1,/);
});

test("history failure preserves outstanding demand and marks history unavailable", async () => {
  const report = await loadPurchasePlanningReport({
    products: [product()],
    now: NOW,
    sourceLoaders: {
      sales: async () => [deliveredOrder()],
      outstanding: async () => [openOrder()],
      history: async () => { throw new Error("denied"); },
    },
  });
  assert.equal(report.sourceStatus.salesAvailable, true);
  assert.equal(report.sourceStatus.preorderOutstandingAvailable, true);
  assert.equal(report.sourceStatus.preorderHistoryAvailable, false);
  assert.equal(report.rows[0].preOrderOutstandingQty, 5);
  assert.equal(report.rows[0].preorderHistoryAvailable, false);
  assert.match(report.preOrderWarning, /history is unavailable/i);
});

test("outstanding failure preserves recent sales", async () => {
  const report = await loadPurchasePlanningReport({
    products: [product()],
    now: NOW,
    sourceLoaders: {
      sales: async () => [deliveredOrder()],
      outstanding: async () => { throw new Error("unavailable"); },
      history: async () => ({ events: [], sourceVersion: "v2" }),
    },
  });
  assert.equal(report.sourceStatus.salesAvailable, true);
  assert.equal(report.sourceStatus.preorderOutstandingAvailable, false);
  assert.equal(report.rows[0].soldLast7, 5);
  assert.equal(report.rows[0].preorderOutstandingAvailable, false);
});

test("inactive product keeps historical sales but never suggests ordering", () => {
  const sales = aggregateDeliveredProductSales([deliveredOrder()], NOW);
  const rows = buildPurchasePlanningRows({
    products: [product({ active: false, locationStocks: {}, stock: 0 })],
    sales,
  });
  const row = rows.find((candidate) => candidate.country === "England");
  assert.equal(row.soldLast7, 5);
  assert.equal(row.suggestedOrderQty, 0);
  assert.equal(row.suggestionAvailable, true);
  assert.equal(row.productState, "Inactive Product");
  assert.equal(matchesPurchasePlanningStatus(row, "Needs Ordering"), false);
});

test("legacy global stock is reported once and never duplicated by country", () => {
  const sales = aggregateDeliveredProductSales([
    deliveredOrder(),
    deliveredOrder({ id: "order-w", order_number: "ORD-W", customer_country: "Wales" }),
  ], NOW);
  const rows = buildPurchasePlanningRows({
    products: [product({
      stock: 20,
      availableInEngland: true,
      availableInWales: true,
      locationStocks: {},
    })],
    sales,
  });
  assert.equal(rows.find((row) => row.country === LEGACY_UNALLOCATED_COUNTRY).currentStock, 20);
  assert.equal(rows.find((row) => row.country === "England").currentStock, 0);
  assert.equal(rows.find((row) => row.country === "Wales").currentStock, 0);
  assert.equal(rows.reduce((sum, row) => sum + row.currentStock, 0), 20);
});

test("legacy v1 purchases remain informational but do not reduce suggestions", async () => {
  const report = await loadPurchasePlanningReport({
    products: [product({ locationStocks: { england: { country: "England", active: true, qty: 0 } } })],
    now: NOW,
    sourceLoaders: {
      sales: async () => [deliveredOrder()],
      outstanding: async () => [openOrder()],
      history: async () => ({ events: [purchaseEvent()], sourceVersion: "v1" }),
    },
  });
  const row = report.rows.find((candidate) => candidate.country === "England");
  assert.equal(row.preOrderBoughtQty, 2);
  assert.equal(row.incomingQty, 0);
  assert.equal(row.suggestedOrderQty, 5);
  assert.equal(report.sourceStatus.preorderIncomingAvailable, false);
  assert.match(report.preOrderWarning, /cannot reliably determine incoming stock/i);
});

test("indexed product and metric lookup preserves country calculations", () => {
  const sales = aggregateDeliveredProductSales([
    deliveredOrder(),
    deliveredOrder({ id: "order-w", customer_country: "Wales" }),
  ], NOW);
  const rows = buildPurchasePlanningRows({
    products: [product({
      availableInWales: true,
      locationStocks: {
        england: { country: "England", active: true, qty: 3 },
        wales: { country: "Wales", active: true, qty: 9 },
      },
    })],
    sales,
  });
  assert.deepEqual(
    rows.map((row) => [row.country, row.currentStock, row.soldLast7]),
    [["England", 3, 5], ["Wales", 9, 5]],
  );
});

test("pagination returns the requested page and supported page size", () => {
  const rows = Array.from({ length: 61 }, (_, index) => ({ rowKey: index }));
  const first = paginatePurchasePlanningRows(rows, 1, 50);
  const second = paginatePurchasePlanningRows(rows, 2, 50);
  assert.equal(first.rows.length, 50);
  assert.deepEqual([first.start, first.end, first.total], [1, 50, 61]);
  assert.deepEqual([second.start, second.end, second.rows.length], [51, 61, 11]);
  assert.equal(paginatePurchasePlanningRows(rows, 1, 999).pageSize, 50);
});

test("filter reconciliation resets only invalid hierarchy descendants", () => {
  const current = {
    ...emptyPurchasePlanningFilters,
    mainCategory: "Vape",
    subCategory: "Disposable",
    brand: "Removed Brand",
    series: "Removed Series",
  };
  const result = reconcilePurchasePlanningFilters(filterRows, current);
  assert.equal(result.mainCategory, "Vape");
  assert.equal(result.subCategory, "Disposable");
  assert.equal(result.brand, "All");
  assert.equal(result.series, "All");
});
