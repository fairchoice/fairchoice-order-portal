import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  new URL("./AdminSetup/InvoicesPortal.jsx", import.meta.url),
  "utf8"
);

test("invoice void control is visible only to the exact nisstaj_admin user", () => {
  assert.match(
    source,
    /const isNisstajAdmin\s*=\s*[\s\S]*?username[\s\S]*?===\s*"nisstaj_admin"/
  );
  assert.match(source, /\{isNisstajAdmin[\s\S]*?>Void invoice<\/button>/);
  assert.doesNotMatch(source, /\{isAdminUser[\s\S]{0,180}>Void invoice<\/button>/);
});

test("invoice void requires preview, audit reason and final confirmation", () => {
  assert.match(source, /previewInvoiceFinancialCorrection\(\{/);
  assert.match(source, /if \(!reason\)/);
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /voidDuplicateInvoiceFinancially\(\{/);
  assert.match(source, /await loadInvoices\(\)/);
});

test("voided and return invoices cannot expose the financial void action", () => {
  assert.match(source, /!== "RETURN_INVOICE" && !financiallyVoided/);
  assert.match(source, /getInvoiceDisplayStatus/);
  assert.match(source, /isInvoiceFinanciallyVoided/);
});
