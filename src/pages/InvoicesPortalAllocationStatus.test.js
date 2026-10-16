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

test("allocation failures do not block exact payment or ledger resolution", () => {
  assert.match(source, /customerAccountIds\.length[\s\S]*\{ data: \[\], error: null \}/);
  assert.match(source, /allocations: rowAccountId \? allocations : \[\]/);
  assert.match(source, /allocationsResult\.error \? \[\] : allocationsResult\.data/);
  assert.doesNotMatch(source, /if \(allocationsResult\.error\)[\s\S]{0,240}return invoiceRows/);
});

test("normal and exact rows load legacy payments by full ledger reference", () => {
  assert.match(source, /getInvoiceLedgerReferenceKeys\(row\)/);
  assert.match(source, /\.in\("reference_no", referenceChunk\)/);
  assert.match(source, /\.in\("order_number", referenceChunk\)/);
  assert.match(source, /\.in\("payment_reference", referenceChunk\)/);
  assert.match(source, /\.in\("order_id", sourceIdChunk\)/);
  assert.match(source, /referencePayments: \[\.\.\.paymentsById\.values\(\)\]/);
  assert.match(source, /legacyLedgerPayments,/);
});

test("normal invoice rows carry canonical UUID and full reference fields", () => {
  assert.match(source, /order_uuid:\s*order\.id\s*\|\|\s*order\.dbId\s*\|\|\s*order\.order_id/);
  assert.match(source, /canonical_order_number:\s*order\.order_number/);
  assert.match(source, /full_order_number:\s*order\.order_number/);
  assert.match(source, /formatDisplayOrderId\(getReference\(row\)\)/);
});

test("Outstanding summary consumes allocation-resolved rows", () => {
  assert.match(source, /sumResolvedInvoiceOutstanding\(displayedInvoices\)/);
  assert.doesNotMatch(
    source,
    /filteredInvoices\.reduce\([\s\S]{0,240}Number\(row\.debit\s*\|\|\s*getAmount\(row\)\)/
  );
});

test("secure status verification covers unfiltered and large invoice lists in safe batches", () => {
  assert.match(source, /supabase\.rpc\("fc_invoice_payment_statuses_v1"/);
  assert.match(source, /p_username:\s*invoiceVerificationUsername/);
  assert.match(source, /p_session_token:\s*invoiceVerificationSessionToken/);
  assert.match(source, /uniqueRefs\.slice\(index, index \+ 50\)/);
  assert.doesNotMatch(source, /term\.length < 2/);
  assert.doesNotMatch(source, /filteredInvoices\.length > 60/);
});

test("verified statuses use canonical amounts and leave failed or missing rows on fallback data", () => {
  assert.match(source, /if \(error\) \{[\s\S]{0,180}continue;/);
  assert.match(source, /const verified = verifiedByInvoice\.get\(reference\);[\s\S]{0,80}if \(!verified\) return;/);
  assert.match(source, /remaining <= 0\.01[\s\S]{0,100}"PAID"[\s\S]{0,100}"PART PAID"[\s\S]{0,100}"UNPAID"/);
  assert.match(source, /remaining_amount:\s*remaining/);
  assert.match(source, /outstanding_amount:\s*remaining/);
});

test("verification deduplicates and matches complete invoice references", () => {
  assert.match(source, /const uniqueRefs = \[\.\.\.new Set\(refs\.map\(\(\{ reference \}\) => reference\)\)\]/);
  assert.match(source, /verifiedByInvoice\.get\(reference\)/);
  assert.doesNotMatch(source, /verifiedByInvoice[\s\S]{0,120}startsWith\(reference\)/);
});
