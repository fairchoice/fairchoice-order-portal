import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./centralInvoiceEngine.js", import.meta.url),
  "utf8"
);

const htmlReceiptSource = source.match(
  /export function buildThermalReceiptHtml[\s\S]*?const buildThermalReceiptPdf/
)?.[0] || "";

const pdfReceiptSource = source.match(
  /const buildThermalReceiptPdf[\s\S]*?export function printThermalReceipt/
)?.[0] || "";

test("thermal receipt contains the required compact order and payment details", () => {
  for (const label of [
    "Order No",
    "Customer",
    "Branch",
    "Deliver To",
    "Date/Time",
    "Driver",
    "Payment Status",
    "Product / Qty",
    "Unit",
    "Line",
    "Item Count",
    "Subtotal",
    "Total",
  ]) {
    assert.match(htmlReceiptSource, new RegExp(label.replace("/", "\\/")));
  }

  assert.match(htmlReceiptSource, /class="logo"/);
  assert.match(htmlReceiptSource, /max-width:\s*80mm/);
  assert.match(htmlReceiptSource, /@page \{ margin: 2mm; \}/);
});

test("thermal receipt renderers do not print database identifiers", () => {
  for (const receiptSource of [htmlReceiptSource, pdfReceiptSource]) {
    assert.doesNotMatch(receiptSource, /customer_account_id|customerAccountId/);
    assert.doesNotMatch(receiptSource, /customer_branch_id|customerBranchId/);
    assert.doesNotMatch(receiptSource, /receipt\.reference/);
  }

  assert.match(source, /UUID_PATTERN/);
  assert.match(source, /getThermalOrderNumber/);
});
