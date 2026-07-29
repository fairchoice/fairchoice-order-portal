import assert from "node:assert/strict";
import test from "node:test";

import {
  getCustomerInvoiceWatermark,
  getInvoiceActionForStatus,
  normalizeInvoicePaymentStatus,
} from "./invoicePaymentStatus.js";

test("maps resolved invoice statuses to document watermarks", () => {
  assert.equal(getCustomerInvoiceWatermark("UNPAID"), "IN PROGRESS");
  assert.equal(getCustomerInvoiceWatermark("PART PAID"), "PART PAID");
  assert.equal(getCustomerInvoiceWatermark("PARTIALLY_PAID"), "PART PAID");
  assert.equal(getCustomerInvoiceWatermark("PAID"), "PAID");
});

test("normalizes status separators without changing payment meaning", () => {
  assert.equal(normalizeInvoicePaymentStatus(" part_paid "), "PART PAID");
});

test("paid invoices download while unpaid and part-paid invoices only view", () => {
  assert.equal(getInvoiceActionForStatus("PAID"), "DOWNLOAD");
  assert.equal(getInvoiceActionForStatus(" paid "), "DOWNLOAD");
  assert.equal(getInvoiceActionForStatus("UNPAID"), "VIEW");
  assert.equal(getInvoiceActionForStatus("PART PAID"), "VIEW");
  assert.equal(getInvoiceActionForStatus("partially_paid"), "VIEW");
  assert.equal(getInvoiceActionForStatus("IN PROGRESS"), "VIEW");
});
