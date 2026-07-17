import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLedgerFilters,
  normalizeLedgerRecord,
} from "./globalFinancialLedgerService.js";

test("buildLedgerFilters trims values and normalizes status fields", () => {
  assert.deepEqual(
    buildLedgerFilters({
      search: "  INV-100  ",
      method: " Cash ",
      status: " archived ",
      transactionType: " payment ",
      dateFrom: " 2026-07-01 ",
      dateTo: " 2026-07-31 ",
      customerAccountId: " account-1 ",
      customerBranchId: " branch-1 ",
    }),
    {
      search: "INV-100",
      method: "Cash",
      status: "ARCHIVED",
      transactionType: "PAYMENT",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      customerAccountId: "account-1",
      customerBranchId: "branch-1",
    }
  );
});

test("normalizeLedgerRecord provides stable UI fields and numeric amounts", () => {
  const record = normalizeLedgerRecord({
    record_id: "record-1",
    archive_id: "archive-1",
    source_type: "CUSTOMER_PAYMENT",
    source_id: "payment-1",
    transaction_type: "PAYMENT",
    transaction_date: "2026-07-16T10:00:00Z",
    debit_amount: "0.00",
    credit_amount: "42.50",
    amount: "42.50",
    payment_method: "Cash",
    staff_name: "Owner",
    reference: "PAY-100",
    description: "Manual payment",
    status: "archived",
  });

  assert.equal(record.recordId, "record-1");
  assert.equal(record.archiveId, "archive-1");
  assert.equal(record.amount, 42.5);
  assert.equal(record.creditAmount, 42.5);
  assert.equal(record.debitAmount, 0);
  assert.equal(record.status, "ARCHIVED");
  assert.equal(record.paymentMethod, "Cash");
});
