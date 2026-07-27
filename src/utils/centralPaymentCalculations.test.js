import assert from "node:assert/strict";
import test from "node:test";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  buildCustomerTransactionHistory,
  createPaymentIdempotencyKey,
} from "./centralPaymentCalculations.js";

const invoices = [
  { id: "1", invoice_number: "INV-1", invoice_date: "2026-01-01T09:00:00Z", invoice_total: 100 },
  { id: "2", invoice_number: "INV-2", invoice_date: "2026-01-02T09:00:00Z", invoice_total: 150 },
  { id: "3", invoice_number: "INV-3", invoice_date: "2026-01-03T09:00:00Z", invoice_total: 200 },
];

test("allocates a partial payment oldest-first", () => {
  const result = allocatePaymentOldestFirst(invoices, 75);
  assert.deepEqual(result.allocations, [
    {
      invoiceReference: "INV-1",
      invoiceSourceId: "1",
      customerBranchId: null,
      allocatedAmount: 75,
    },
  ]);

  const allocated = applyAllocationsToInvoices(invoices, result.allocations);
  assert.equal(allocated[0].remainingAmount, 25);
  assert.equal(allocated[1].remainingAmount, 150);
  assert.equal(allocated[2].remainingAmount, 200);
});

test("calculates chronological running balance before newest-first display", () => {
  const rows = buildCustomerTransactionHistory({
    openingBalance: 100,
    invoices: [
      ...invoices,
      { id: "4", invoice_number: "INV-4", invoice_date: "2026-01-05T09:00:00Z", invoice_total: 500 },
    ],
    payments: [
      {
        id: "P-1",
        payment_reference: "PAY-1",
        payment_date: "2026-01-04T09:00:00Z",
        amount: 75,
        status: "POSTED",
      },
    ],
    newestFirst: false,
  });

  assert.deepEqual(
    rows.map((row) => row.runningBalance),
    [100, 200, 350, 550, 475, 975]
  );
});

test("payment clears previous balance before later same-day invoice", () => {
  const input = {
    openingBalance: 0,
    openingDate: "2026-07-04T00:00:00Z",
    invoices: [
      {
        id: "invoice-old",
        invoice_number: "INV-537",
        invoice_date: "2026-07-04",
        delivered_at: "2026-07-04T09:00:00Z",
        created_at: "2026-07-04T09:00:00Z",
        invoice_total: 537.3,
      },
      {
        id: "invoice-new",
        invoice_number: "INV-375",
        invoice_date: "2026-07-11",
        delivered_at: "2026-07-11T15:00:00Z",
        created_at: "2026-07-11T15:00:00Z",
        invoice_total: 375.72,
      },
    ],
    payments: [
      {
        id: "payment-237",
        payment_reference: "PAY-237",
        payment_date: "2026-07-10",
        created_at: "2026-07-10T10:00:00Z",
        amount: 237.3,
        status: "POSTED",
      },
      {
        id: "payment-300",
        payment_reference: "PAY-300",
        payment_date: "2026-07-11",
        created_at: "2026-07-11T09:00:00Z",
        amount: 300,
        status: "POSTED",
      },
    ],
  };
  const rows = buildCustomerTransactionHistory({ ...input, newestFirst: false });

  assert.deepEqual(
    rows.map((row) => ({
      type: row.type,
      reference: row.reference,
      balance: row.runningBalance,
    })),
    [
      { type: "OPENING", reference: "Opening Balance", balance: 0 },
      { type: "INVOICE", reference: "INV-537", balance: 537.3 },
      { type: "PAYMENT", reference: "PAY-237", balance: 300 },
      { type: "PAYMENT", reference: "PAY-300", balance: 0 },
      { type: "INVOICE", reference: "INV-375", balance: 375.72 },
    ]
  );
  assert.equal(rows.at(-1).runningBalance, 375.72);

  const newestFirstRows = buildCustomerTransactionHistory(input);
  assert.deepEqual(
    newestFirstRows.map((row) => [row.reference, row.runningBalance]),
    [
      ["INV-375", 375.72],
      ["PAY-300", 0],
      ["PAY-237", 300],
      ["INV-537", 537.3],
      ["Opening Balance", 0],
    ]
  );
});

test("uses precise created_at to order a date-only payment before a later same-day invoice", () => {
  const rows = buildCustomerTransactionHistory({
    invoices: [
      {
        id: "later-invoice",
        invoice_number: "INV-LATER",
        invoice_date: "2026-07-11",
        created_at: "2026-07-11T15:00:00Z",
        invoice_total: 375.72,
      },
    ],
    payments: [
      {
        id: "earlier-payment",
        payment_reference: "PAY-EARLIER",
        payment_date: "2026-07-11",
        created_at: "2026-07-11T12:00:00Z",
        amount: 300,
      },
    ],
    newestFirst: false,
  });

  assert.deepEqual(
    rows.map((row) => row.reference),
    ["Opening Balance", "PAY-EARLIER", "INV-LATER"]
  );
  assert.equal(rows[1].date, "2026-07-11");
  assert.equal(rows[1].orderingTimestamp, "2026-07-11T12:00:00.000Z");
});

test("marks invoices paid on full payment", () => {
  const result = allocatePaymentOldestFirst(invoices.slice(0, 1), 100);
  const allocated = applyAllocationsToInvoices(invoices.slice(0, 1), result.allocations);
  assert.equal(allocated[0].paymentStatus, "PAID");
  assert.equal(allocated[0].remainingAmount, 0);
});

test("marks invoices partially paid", () => {
  const result = allocatePaymentOldestFirst(invoices.slice(0, 1), 40);
  const allocated = applyAllocationsToInvoices(invoices.slice(0, 1), result.allocations);
  assert.equal(allocated[0].paymentStatus, "PARTIALLY PAID");
  assert.equal(allocated[0].remainingAmount, 60);
});

test("keeps overpayment as unallocated advance payment", () => {
  const result = allocatePaymentOldestFirst(invoices.slice(0, 1), 125);
  assert.equal(result.allocations[0].allocatedAmount, 100);
  assert.equal(result.unallocatedAmount, 25);
});

test("returns full payment as unallocated when there are no outstanding invoices", () => {
  const result = allocatePaymentOldestFirst([], 50);
  assert.deepEqual(result.allocations, []);
  assert.equal(result.unallocatedAmount, 50);
});

test("filters allocation to one branch", () => {
  const result = allocatePaymentOldestFirst(
    [
      { ...invoices[0], customer_branch_id: "A" },
      { ...invoices[1], customer_branch_id: "B" },
    ],
    200,
    { branchId: "B" }
  );
  assert.deepEqual(result.allocations.map((row) => row.invoiceReference), ["INV-2"]);
  assert.equal(result.unallocatedAmount, 50);
});

test("allocates across all branches when branch is not selected", () => {
  const result = allocatePaymentOldestFirst(
    [
      { ...invoices[0], customer_branch_id: "A" },
      { ...invoices[1], customer_branch_id: "B" },
    ],
    200
  );
  assert.deepEqual(result.allocations.map((row) => row.invoiceReference), ["INV-1", "INV-2"]);
});

test("creates deterministic duplicate idempotency keys", () => {
  const input = {
    customerAccountId: "customer-1",
    customerBranchId: "",
    amount: 25,
    paymentDate: "2026-01-01T12:34:56Z",
    paymentMethod: "cash",
    externalReference: "abc",
  };
  assert.equal(createPaymentIdempotencyKey(input), createPaymentIdempotencyKey(input));
});

test("excludes cancelled invoices", () => {
  const result = allocatePaymentOldestFirst(
    [{ ...invoices[0], status: "CANCELLED" }, invoices[1]],
    100
  );
  assert.equal(result.allocations[0].invoiceReference, "INV-2");
});

test("excludes voided payments from running balance", () => {
  const rows = buildCustomerTransactionHistory({
    openingBalance: 0,
    invoices: [invoices[0]],
    payments: [{ id: "P1", payment_reference: "P1", payment_date: "2026-01-02", amount: 50, status: "VOIDED" }],
    newestFirst: false,
  });
  assert.deepEqual(rows.map((row) => row.runningBalance), [0, 100]);
});

test("orders same-date transactions deterministically", () => {
  const rows = buildCustomerTransactionHistory({
    openingBalance: 0,
    invoices: [
      { id: "2", invoice_number: "INV-2", invoice_date: "2026-01-01T09:00:00Z", invoice_total: 10 },
      { id: "1", invoice_number: "INV-1", invoice_date: "2026-01-01T09:00:00Z", invoice_total: 10 },
    ],
    payments: [{ id: "P1", payment_reference: "PAY-1", payment_date: "2026-01-01T09:00:00Z", amount: 5 }],
    newestFirst: false,
  });

  assert.deepEqual(
    rows.map((row) => row.reference),
    ["Opening Balance", "PAY-1", "INV-1", "INV-2"]
  );
});
