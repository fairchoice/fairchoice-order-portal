import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerAccountTransactionModel,
  isBalanceAffectingPayment,
  selectLatestActivePayment,
  sortTransactionsForDisplay,
} from "./customerAccountTransactions.js";

const customer = { id: "customer-1", credit_limit: 500 };
const invoice = (overrides = {}) => ({
  id: "invoice-1",
  customer_account_id: customer.id,
  invoice_number: "ORD-001",
  invoice_date: "2026-07-04",
  created_at: "2026-07-04T09:00:00.000Z",
  invoice_total: 100,
  status: "ISSUED",
  ...overrides,
});
const payment = (overrides = {}) => ({
  id: "payment-1",
  customer_account_id: customer.id,
  amount: 100,
  payment_date: "2026-07-04",
  created_at: "2026-07-04T10:00:00.000Z",
  payment_method: "Cash",
  collection_type: "TODAY_INVOICE",
  status: "POSTED",
  verification_status: "CONFIRMED",
  ...overrides,
});
const allocation = (overrides = {}) => ({
  id: "allocation-1",
  customer_account_id: customer.id,
  payment_id: "payment-1",
  invoice_source_id: "invoice-1",
  invoice_reference: "ORD-001",
  allocated_amount: 100,
  status: "ACTIVE",
  ...overrides,
});

test("canonical history shows opening first without a Unix epoch display date", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    openingBalances: [{ opening_balance: 25, effective_at: "1970-01-01" }],
    invoices: [invoice()],
  });

  assert.equal(model.transactions[0].transaction_type, "OPENING_BALANCE");
  assert.equal(model.transactions[0].transaction_date, null);
  assert.equal(model.transactions[0].description, "Opening account balance");
  assert.equal(model.transactions[0].debit_amount, 25);
  assert.equal(model.transactions[1].running_balance, 125);
});

test("invoice is a debit and a linked payment is a credit with deterministic ordering", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [invoice()],
    payments: [payment()],
    allocations: [allocation()],
  });
  const rows = model.transactions.slice(1);

  assert.deepEqual(rows.map((row) => row.transaction_type), ["INVOICE", "PAYMENT"]);
  assert.deepEqual(rows.map((row) => row.running_balance), [100, 0]);
  assert.equal(rows[0].invoice_status, "PAID");
  assert.equal(rows[1].credit_amount, 100);
  assert.equal(rows[1].related_invoice, "ORD-001");
  assert.equal(rows[1].description, "Cash payment for invoice ORD-001");
});

test("a date-only payment uses created_at and remains before a later same-day invoice", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [
      invoice({
        id: "invoice-2",
        invoice_number: "ORD-002",
        invoice_date: "2026-07-11",
        created_at: "2026-07-11T12:00:00.000Z",
        invoice_total: 375.72,
      }),
    ],
    payments: [
      payment({
        payment_date: "2026-07-11",
        created_at: "2026-07-11T09:00:00.000Z",
        amount: 300,
        collection_type: "PREVIOUS_BALANCE",
      }),
    ],
  });

  assert.deepEqual(
    model.transactions.slice(1).map((row) => row.transaction_type),
    ["PAYMENT", "INVOICE"]
  );
  assert.deepEqual(
    model.transactions.map((row) => row.running_balance),
    [0, -300, 75.72]
  );
});

test("part payment leaves a positive balance and PART PAID invoice status", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [invoice()],
    payments: [payment({ amount: 40, collection_type: "PART_PAYMENT" })],
    allocations: [allocation({ allocated_amount: 40 })],
  });

  assert.equal(model.summary.closingBalance, 60);
  assert.equal(model.transactions[1].invoice_status, "PART PAID");
  assert.equal(model.transactions[2].transaction_subtype, "PART_PAYMENT");
});

test("overpayment creates customer credit without negative available credit", () => {
  const model = buildCustomerAccountTransactionModel({
    customer: { ...customer, credit_limit: 0 },
    invoices: [invoice()],
    payments: [payment({ amount: 150 })],
    allocations: [allocation()],
  });

  assert.equal(model.summary.closingBalance, -50);
  assert.equal(model.summary.outstandingBalance, 0);
  assert.equal(model.summary.customerCredit, 50);
  assert.equal(model.summary.availableCreditLimit, 0);
});

test("one payment can allocate across invoices and multiple payments can allocate once", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [
      invoice(),
      invoice({
        id: "invoice-2",
        invoice_number: "ORD-002",
        invoice_total: 80,
        created_at: "2026-07-05T09:00:00.000Z",
      }),
    ],
    payments: [
      payment({ amount: 130 }),
      payment({
        id: "payment-2",
        amount: 50,
        payment_date: "2026-07-06",
        created_at: "2026-07-06T09:00:00.000Z",
      }),
    ],
    allocations: [
      allocation(),
      allocation({
        id: "allocation-2",
        invoice_source_id: "invoice-2",
        invoice_reference: "ORD-002",
        allocated_amount: 30,
      }),
      allocation({
        id: "allocation-3",
        payment_id: "payment-2",
        invoice_source_id: "invoice-2",
        invoice_reference: "ORD-002",
        allocated_amount: 50,
      }),
    ],
  });

  const firstPayment = model.paymentHistory.find(
    (row) => row.payment_id === "payment-1"
  );
  assert.deepEqual(firstPayment.related_invoices, ["ORD-001", "ORD-002"]);
  assert.equal(firstPayment.allocated_amount, 130);
  assert.equal(model.summary.closingBalance, 0);
  assert.equal(
    model.transactions.find((row) => row.reference === "ORD-002").invoice_status,
    "PAID"
  );
});

test("voided, rejected, and pending payments do not affect the balance", () => {
  const rows = [
    payment({ id: "void", status: "VOIDED" }),
    payment({ id: "pending", verification_status: "PENDING_VERIFICATION" }),
    payment({ id: "rejected", verification_status: "REJECTED" }),
  ];
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [invoice()],
    payments: rows,
  });

  assert.equal(model.summary.paymentTotal, 0);
  assert.equal(model.summary.closingBalance, 100);
  assert.deepEqual(
    model.paymentHistory.map((row) => row.status).sort(),
    ["VOIDED", "PENDING", "REJECTED"]
      .sort()
  );
  rows.forEach((row) => assert.equal(isBalanceAffectingPayment(row), false));
});

test("corrected payment is counted once and exposes audit history", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [invoice({ invoice_total: 738.37 })],
    payments: [payment({ amount: 738.37, edited_at: "2026-07-05T10:00:00Z" })],
    allocations: [allocation({ allocated_amount: 738.37 })],
    paymentAudits: [
      {
        id: "audit-1",
        payment_id: "payment-1",
        action: "EDITED",
        old_amount: 748,
        new_amount: 738.37,
      },
    ],
  });
  const paymentRow = model.paymentHistory[0];

  assert.equal(model.summary.paymentTotal, 738.37);
  assert.equal(model.summary.closingBalance, 0);
  assert.equal(paymentRow.status, "CORRECTED");
  assert.equal(paymentRow.audit_history[0].old_amount, 748);
});

test("newest-first changes presentation order but preserves chronological balances and totals", () => {
  const input = {
    customer,
    openingBalances: [{ opening_balance: 20 }],
    invoices: [invoice()],
    payments: [payment({ amount: 40 })],
    allocations: [allocation({ allocated_amount: 40 })],
  };
  const oldest = buildCustomerAccountTransactionModel(input);
  const newest = buildCustomerAccountTransactionModel({
    ...input,
    sortDirection: "newest",
  });

  assert.equal(oldest.summary.closingBalance, newest.summary.closingBalance);
  assert.equal(oldest.reconciliation.balanced, true);
  assert.equal(newest.reconciliation.balanced, true);
  assert.equal(newest.transactions.at(-1).transaction_type, "OPENING_BALANCE");
  assert.equal(
    newest.transactions.find((row) => row.payment_id === "payment-1").running_balance,
    80
  );
});

test("summary, credit history, transactions, and payment history reconcile", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    openingBalances: [{ opening_balance: 20 }],
    invoices: [invoice()],
    payments: [payment({ amount: 40 })],
    allocations: [allocation({ allocated_amount: 40 })],
  });
  const signedTotal = model.transactions.reduce(
    (sum, row) => sum + row.signed_amount,
    0
  );
  const paymentTotal = model.paymentHistory.reduce(
    (sum, row) => sum + (row.signed_amount < 0 ? row.credit_amount : 0),
    0
  );

  assert.equal(signedTotal, model.summary.closingBalance);
  assert.equal(model.creditHistory, model.transactions);
  assert.equal(paymentTotal, model.summary.paymentTotal);
  assert.equal(model.reconciliation.difference, 0);
});

test("latest payment is selected by effective timestamp instead of amount", () => {
  const latest = selectLatestActivePayment([
    payment({
      id: "older-1000",
      amount: 1000,
      payment_date: "2026-07-28",
      created_at: "2026-07-28T10:00:00.000Z",
    }),
    payment({
      id: "latest-350",
      amount: 350,
      payment_date: "2026-07-28",
      created_at: "2026-07-28T14:36:42.000Z",
    }),
  ]);

  assert.equal(latest.id, "latest-350");
  assert.equal(latest.amount, 350);
});

test("latest payment excludes voids, zero values, and matched legacy copies", () => {
  const canonical = payment({
    id: "canonical-350",
    amount: 350,
    payment_reference: "PAY-350",
    payment_date: "2026-07-28",
    created_at: "2026-07-28T14:36:42.000Z",
    edited_at: "2026-07-28T15:00:00.000Z",
  });
  const latest = selectLatestActivePayment([
    canonical,
    payment({
      id: "legacy-350",
      legacy_ledger_id: 350,
      source: "legacy_customer_ledger",
      amount: 350,
      payment_reference: "PAY-350",
      payment_date: "2026-07-28",
      created_at: "2026-07-28T14:36:42.000Z",
    }),
    payment({
      id: "voided-later",
      amount: 900,
      status: "VOIDED",
      created_at: "2026-07-28T16:00:00.000Z",
    }),
    payment({
      id: "zero-later",
      amount: 0,
      created_at: "2026-07-28T17:00:00.000Z",
    }),
  ]);

  assert.equal(latest.id, "canonical-350");
  assert.equal(latest.amount, 350);
});

test("exact timestamp display ordering preserves chronological running balances", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    openingBalances: [{ opening_balance: 1811.17 }],
    invoices: [
      invoice({
        invoice_total: 801.56,
        invoice_date: "2026-07-28",
        created_at: "2026-07-28T13:36:28.000Z",
      }),
    ],
    payments: [
      payment({
        amount: 700,
        payment_date: "2026-07-27",
        created_at: "2026-07-27T12:00:00.000Z",
        collection_type: "PREVIOUS_BALANCE",
      }),
      payment({
        id: "latest-350",
        amount: 350,
        payment_date: "2026-07-28",
        created_at: "2026-07-28T14:36:42.000Z",
      }),
    ],
  });
  const oldest = sortTransactionsForDisplay(model.transactions, "oldest");
  const newest = sortTransactionsForDisplay(model.transactions, "newest");

  assert.deepEqual(
    oldest.slice(-2).map((row) => row.transaction_type),
    ["INVOICE", "PAYMENT"]
  );
  assert.deepEqual(
    newest.slice(0, 2).map((row) => row.transaction_type),
    ["PAYMENT", "INVOICE"]
  );
  assert.equal(newest[0].running_balance, model.summary.closingBalance);
  assert.equal(oldest.at(-1).running_balance, model.summary.closingBalance);
});

test("legacy-only payments receive FIFO allocations alongside canonical database allocations", () => {
  const model = buildCustomerAccountTransactionModel({
    customer,
    invoices: [
      invoice({ id: "invoice-1", invoice_number: "ORD-001", invoice_total: 50 }),
      invoice({
        id: "invoice-2",
        invoice_number: "ORD-002",
        invoice_total: 30,
        invoice_date: "2026-07-05",
        created_at: "2026-07-05T09:00:00.000Z",
      }),
    ],
    payments: [
      payment({ id: "canonical-1", amount: 50 }),
      payment({
        id: "legacy-2",
        legacy_ledger_id: 2,
        payment_reference: "LEGACY-2",
        amount: 30,
        payment_date: "2026-07-06",
        created_at: "2026-07-06T10:00:00.000Z",
      }),
    ],
    allocations: [
      allocation({
        payment_id: "canonical-1",
        allocated_amount: 50,
      }),
    ],
  });

  const invoiceRows = model.transactions.filter(
    (row) => row.transaction_type === "INVOICE"
  );
  assert.deepEqual(invoiceRows.map((row) => row.invoice_status), ["PAID", "PAID"]);
  assert.equal(model.reconciliation.allocationTotal, 80);
  assert.equal(model.reconciliation.allocationSource, "database_plus_inferred_fifo");
});
