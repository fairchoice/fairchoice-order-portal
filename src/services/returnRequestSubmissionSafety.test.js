import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  acquireReturnSubmissionLock,
  releaseReturnSubmissionLock,
} from "./returnRequestSubmissionSafety.js";

const modal = fs.readFileSync(new URL("../components/ReturnRequestModal.jsx", import.meta.url), "utf8");
const salesPortal = fs.readFileSync(new URL("../pages/CustomerOrder.jsx", import.meta.url), "utf8");

const modalInvoiceFields = modal.match(/placeholder="Previous invoice number"|type="date"/g) || [];

test("previous invoice number is rendered only by the Sales Rep parent", () => {
  assert.match(salesPortal, /Previous Invoice Number/);
  assert.doesNotMatch(modal, /placeholder="Previous invoice number"/);
});

test("previous invoice date is rendered only by the Sales Rep parent", () => {
  assert.match(salesPortal, /Previous Invoice Date/);
  assert.equal(modalInvoiceFields.length, 0);
});

test("one confirmed submission acquires one request lock", () => {
  const lock = { current: false };
  assert.equal(acquireReturnSubmissionLock(lock, null), true);
});

test("rapid double submission cannot acquire the lock twice", () => {
  const lock = { current: false };
  assert.equal(acquireReturnSubmissionLock(lock, null), true);
  assert.equal(acquireReturnSubmissionLock(lock, null), false);
});

test("submission lock is acquired synchronously before createReturnRequest", () => {
  assert.ok(modal.indexOf("acquireReturnSubmissionLock") < modal.indexOf("await createReturnRequest"));
  assert.match(modal, /disabled=\{formLocked\}/);
  assert.match(modal, /Create this return request\?/);
  assert.match(modal, />Cancel<\/button>/);
  assert.match(modal, /"Confirm"/);
});

test("pending button displays Creating Return", () => {
  assert.match(modal, /saving \? "Creating Return\.\.\." : "Confirm Return Request"/);
});

test("success receipt replaces the form and hides its confirm button", () => {
  assert.match(modal, /if \(createdReturn\?\.id\)/);
  assert.ok(modal.indexOf("if (createdReturn?.id)") < modal.indexOf("const content ="));
});

test("success receipt displays the stable created return number", () => {
  assert.match(modal, /Return Request Created/);
  assert.match(modal, /createdReturn\.return_number/);
});

test("a created return blocks reuse of selected products", () => {
  const lock = { current: false };
  assert.equal(acquireReturnSubmissionLock(lock, { id: "return-1" }), false);
  assert.match(modal, /createdReturnRef\.current\?\.id/);
});

test("Create Another Return clears transaction-specific modal and parent state", () => {
  assert.match(modal, /Create Another Return/);
  assert.match(modal, /setLines\(\[\]\)[\s\S]*setSearch\(""\)[\s\S]*setNotes\(""\)/);
  assert.match(salesPortal, /onCreateAnother[\s\S]*branchId: ""[\s\S]*previousInvoiceNumber: ""[\s\S]*previousInvoiceDate: ""/);
});

test("failed submission retains entered fields", () => {
  const catchBlock = modal.match(/} catch \(error\) \{[\s\S]*?\n\s{4}\}/)?.[0] || "";
  assert.doesNotMatch(catchBlock, /setLines|setNotes|setSearch|setReturnType/);
});

test("failed submission unlocks retry", () => {
  const lock = { current: true };
  releaseReturnSubmissionLock(lock);
  assert.equal(lock.current, false);
  assert.match(modal, /catch \(error\)[\s\S]*releaseReturnSubmissionLock\(submitLockRef\)[\s\S]*setSaving\(false\)/);
});

test("exact current-session duplicate submission is blocked", () => {
  assert.match(modal, /createdReturnRef\.current = receipt/);
  assert.match(modal, /if \(submitLockRef\.current \|\| createdReturnRef\.current\?\.id \|\| createdReturn\?\.id\) return/);
});

test("previous invoice number remains in submitted notes", () => {
  assert.match(modal, /previousInvoiceNumber \? `Previous invoice: \$\{previousInvoiceNumber\}`/);
});

test("previous invoice date remains in submitted notes", () => {
  assert.match(modal, /previousInvoiceDate \? `Previous invoice date: \$\{previousInvoiceDate\}`/);
});

test("estimated credit remains quantity multiplied by current item price", () => {
  assert.match(modal, /Number\(line\.returnQty \|\| 0\) \* getItemPrice\(line\)/);
  assert.match(modal, /\{formatCurrency\(total\)\}/);
});
