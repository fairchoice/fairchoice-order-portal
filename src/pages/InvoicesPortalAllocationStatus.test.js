import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./AdminSetup/InvoicesPortal.jsx", import.meta.url), "utf8");

test("normal list and exact search use the same allocation-loading pipeline", () => {
  const calls = source.match(/resolveInvoiceRowsWithAllocationData\(/g) || [];
  assert.equal(calls.length, 2, "expected normal-list and exact-search calls");
  assert.match(source, /const resolvedInvoiceRows = await resolveInvoiceRowsWithAllocationData\(invoiceRows\)/);
  assert.match(source, /const resolvedExactRows = await resolveInvoiceRowsWithAllocationData\(exactRows\)/);
});

test("exact search no longer duplicates stale order status calculation", () => {
  const exactSearchStart = source.indexOf("const loadExactSearchInvoice = async () =>");
  const exactSearchEnd = source.indexOf("loadExactSearchInvoice();", exactSearchStart);
  const exactSearchSource = source.slice(exactSearchStart, exactSearchEnd);

  assert.match(exactSearchSource, /const fallbackOrderRow = getOrderInvoiceListRow\(order\)/);
  assert.doesNotMatch(exactSearchSource, /getOrderPaymentStatus\(order/);
  assert.doesNotMatch(exactSearchSource, /Number\(order\.payment_amount/);
});

test("allocation fallback is retained only for rows that cannot be safely resolved", () => {
  assert.match(source, /if \(!customerAccountIds\.length\) return invoiceRows/);
  assert.match(source, /if \(!customerAccountId\) return row/);
  assert.match(source, /if \(allocationsResult\.error\)[\s\S]*return invoiceRows/);
  assert.match(source, /if \(paymentsResult\.error\)[\s\S]*return invoiceRows/);
});

test("normal invoice rows carry canonical UUID and full reference fields", () => {
  assert.match(source, /order_uuid:\s*order\.id\s*\|\|\s*order\.dbId\s*\|\|\s*order\.order_id/);
  assert.match(source, /canonical_order_number:\s*order\.order_number/);
  assert.match(source, /full_order_number:\s*order\.order_number/);
  assert.match(source, /formatDisplayOrderId\(getReference\(row\)\)/);
});

test("Outstanding summary consumes allocation-resolved rows", () => {
  assert.match(source, /sumResolvedInvoiceOutstanding\(filteredInvoices\)/);
  assert.doesNotMatch(
    source,
    /filteredInvoices\.reduce\([\s\S]{0,240}Number\(row\.debit\s*\|\|\s*getAmount\(row\)\)/
  );
});
