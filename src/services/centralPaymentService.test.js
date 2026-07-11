import assert from "node:assert/strict";
import test from "node:test";
import { resolveLegacyCompatibilityRows } from "../utils/centralPaymentCalculations.js";

test("legacy payments fill missing history when new invoices exist", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["legacy-payment"]);
});

test("legacy invoices fill missing history when new payments exist", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["legacy-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["new-payment"]);
});

test("equivalent legacy and new records do not duplicate", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["new-payment"]);
});
