import test from "node:test";
import assert from "node:assert/strict";
import {
  getInvoiceAllocationKeys,
  getInvoiceLedgerReferenceKeys,
  getResolvedInvoiceOutstanding,
  isActiveLegacyLedgerPayment,
  isActiveInvoicePayment,
  resolveInvoiceRowFromAllocations,
  sumResolvedInvoiceOutstanding,
} from "./invoiceAllocationStatus.js";
import { formatDisplayOrderId } from "../utils/orderDisplay.js";

test("allocation totals resolve unpaid, part paid, and paid statuses", () => {
  const row = { order_number: "ORD-100", customer_account_id: "acct-1" };
  const paymentsById = new Map([["pay-1", { id: "pay-1", status: "POSTED" }]]);
  const base = {
    row,
    paymentsById,
    invoiceTotal: 100,
  };

  assert.equal(resolveInvoiceRowFromAllocations({ ...base, allocations: [] }).invoice_status, "UNPAID");
  assert.equal(
    resolveInvoiceRowFromAllocations({
      ...base,
      allocations: [{ payment_id: "pay-1", invoice_reference: "ORD-100", customer_account_id: "acct-1", allocated_amount: 40, status: "ACTIVE" }],
    }).invoice_status,
    "PART PAID"
  );
  const paid = resolveInvoiceRowFromAllocations({
    ...base,
    allocations: [{ payment_id: "pay-1", invoice_reference: "ORD-100", customer_account_id: "acct-1", allocated_amount: 100, status: "ACTIVE" }],
  });
  assert.equal(paid.invoice_status, "PAID");
  assert.equal(paid.remaining_amount, 0);
});

test("reversed, voided, and pending bank payments do not settle invoices", () => {
  const row = { id: "invoice-source", customer_account_id: "acct-1" };
  const allocation = {
    payment_id: "pay-1",
    invoice_source_id: "invoice-source",
    allocated_amount: 100,
    status: "ACTIVE",
  };

  for (const payment of [
    { id: "pay-1", status: "VOIDED" },
    { id: "pay-1", status: "REVERSED" },
    { id: "pay-1", status: "POSTED", payment_method: "Bank Transfer", verification_status: "PENDING_VERIFICATION" },
  ]) {
    assert.equal(isActiveInvoicePayment(payment), false);
    assert.equal(
      resolveInvoiceRowFromAllocations({
        row,
        allocations: [allocation],
        paymentsById: new Map([["pay-1", payment]]),
        invoiceTotal: 100,
      }).invoice_status,
      "UNPAID"
    );
  }
});

test("allocation must match invoice and account scope", () => {
  const resolved = resolveInvoiceRowFromAllocations({
    row: { order_number: "ORD-200", customer_account_id: "acct-1" },
    allocations: [
      { payment_id: "pay-1", invoice_reference: "ORD-200", customer_account_id: "acct-2", allocated_amount: 100, status: "ACTIVE" },
      { payment_id: "pay-1", invoice_reference: "ORD-OTHER", customer_account_id: "acct-1", allocated_amount: 100, status: "ACTIVE" },
    ],
    paymentsById: new Map([["pay-1", { id: "pay-1", status: "POSTED" }]]),
    invoiceTotal: 100,
  });
  assert.equal(resolved.invoice_status, "UNPAID");
});

test("exact-search rows derive full, partial, and unpaid status from active allocations", () => {
  const row = {
    id: "order-search-ORD-300",
    order_number: "ORD-300",
    customer_account_id: "acct-1",
    customer_branch_id: "branch-1",
    payment_status: "UNPAID",
    invoice_status: "UNPAID",
  };
  const paymentsById = new Map([
    ["pay-1", { id: "pay-1", status: "POSTED", verification_status: "CONFIRMED" }],
  ]);
  const allocation = (allocatedAmount) => ({
    payment_id: "pay-1",
    invoice_reference: "ORD-300",
    customer_account_id: "acct-1",
    customer_branch_id: "branch-1",
    allocated_amount: allocatedAmount,
    status: "ACTIVE",
  });

  assert.equal(resolveInvoiceRowFromAllocations({ row, allocations: [allocation(100)], paymentsById, invoiceTotal: 100 }).invoice_status, "PAID");
  assert.equal(resolveInvoiceRowFromAllocations({ row, allocations: [allocation(40)], paymentsById, invoiceTotal: 100 }).invoice_status, "PART PAID");
  assert.equal(resolveInvoiceRowFromAllocations({ row, allocations: [], paymentsById, invoiceTotal: 100 }).invoice_status, "UNPAID");
});

test("stale order status cannot override allocations and list/search shapes agree", () => {
  const paymentsById = new Map([["pay-1", { id: "pay-1", status: "POSTED" }]]);
  const allocations = [{
    payment_id: "pay-1",
    invoice_source_id: "order-id-400",
    invoice_reference: "ORD-400",
    customer_account_id: "acct-1",
    customer_branch_id: "branch-1",
    allocated_amount: 100,
    status: "ACTIVE",
  }];
  const normalListRow = {
    id: "order-id-400",
    order_number: "ORD-400",
    customer_account_id: "acct-1",
    customer_branch_id: "branch-1",
    payment_status: "UNPAID",
  };
  const exactSearchRow = {
    id: "order-search-ORD-400",
    order_number: "ORD-400",
    payment_status: "UNPAID",
    _freshOrder: {
      id: "order-id-400",
      order_number: "ORD-400",
      customer_account_id: "acct-1",
      customer_branch_id: "branch-1",
      payment_status: "UNPAID",
    },
  };

  const normalStatus = resolveInvoiceRowFromAllocations({ row: normalListRow, allocations, paymentsById, invoiceTotal: 100 }).invoice_status;
  const exactStatus = resolveInvoiceRowFromAllocations({ row: exactSearchRow, allocations, paymentsById, invoiceTotal: 100 }).invoice_status;
  assert.equal(normalStatus, "PAID");
  assert.equal(exactStatus, normalStatus);
});

test("branch-scoped invoices reject mismatched and unscoped allocations", () => {
  const row = {
    order_number: "ORD-500",
    customer_account_id: "acct-1",
    customer_branch_id: "branch-1",
  };
  const paymentsById = new Map([["pay-1", { id: "pay-1", status: "POSTED" }]]);
  const baseAllocation = {
    payment_id: "pay-1",
    invoice_reference: "ORD-500",
    customer_account_id: "acct-1",
    allocated_amount: 100,
    status: "ACTIVE",
  };

  for (const customerBranchId of ["branch-2", null]) {
    const resolved = resolveInvoiceRowFromAllocations({
      row,
      allocations: [{ ...baseAllocation, customer_branch_id: customerBranchId }],
      paymentsById,
      invoiceTotal: 100,
    });
    assert.equal(resolved.invoice_status, "UNPAID");
  }
});

test("customer-scoped invoices reject allocations without the same customer account", () => {
  const row = { order_number: "ORD-600", customer_account_id: "acct-1" };
  const paymentsById = new Map([["pay-1", { id: "pay-1", status: "POSTED" }]]);
  const baseAllocation = {
    payment_id: "pay-1",
    invoice_reference: "ORD-600",
    allocated_amount: 100,
    status: "ACTIVE",
  };

  for (const customerAccountId of ["acct-2", null]) {
    const resolved = resolveInvoiceRowFromAllocations({
      row,
      allocations: [{ ...baseAllocation, customer_account_id: customerAccountId }],
      paymentsById,
      invoiceTotal: 100,
    });
    assert.equal(resolved.invoice_status, "UNPAID");
  }
});

test("invoice rows keep the full canonical reference and UUID while displaying a short reference", () => {
  const row = {
    order_uuid: "718d21a5-7f01-472a-b2b9-50980b6c9357",
    dbId: "718d21a5-7f01-472a-b2b9-50980b6c9357",
    order_id: "718d21a5-7f01-472a-b2b9-50980b6c9357",
    canonical_order_number: "ORD-1785347593739-19255aad",
    full_order_number: "ORD-1785347593739-19255aad",
    order_number: "ORD-1785347593739-19255aad",
  };

  assert.equal(formatDisplayOrderId(row.canonical_order_number), "ORD-1785347593");
  assert.equal(row.order_number, "ORD-1785347593739-19255aad");
  assert.equal(
    getInvoiceAllocationKeys(row).sourceIds.has("718d21a5-7f01-472a-b2b9-50980b6c9357"),
    true
  );
});

test("stable order UUID has first-priority matching even when the visible reference is shortened", () => {
  const resolved = resolveInvoiceRowFromAllocations({
    row: {
      order_uuid: "718d21a5-7f01-472a-b2b9-50980b6c9357",
      orderId: "ORD-1785347593",
      customer_account_id: "acct-thisha",
    },
    allocations: [{
      payment_id: "pay-thisha",
      invoice_source_id: "718d21a5-7f01-472a-b2b9-50980b6c9357",
      invoice_reference: "ORD-1785347593739-19255aad",
      customer_account_id: "acct-thisha",
      allocated_amount: 631.27,
      status: "active",
    }],
    paymentsById: new Map([["pay-thisha", { id: "pay-thisha", status: "POSTED" }]]),
    invoiceTotal: 631.27,
  });

  assert.equal(resolved.invoice_status, "PAID");
});

test("an exact full reference matches when a source UUID is unavailable", () => {
  const resolved = resolveInvoiceRowFromAllocations({
    row: {
      canonical_order_number: "ORD-1785664978948-02513cfb",
      orderId: "ORD-1785664978",
      customer_account_id: "acct-stella",
    },
    allocations: [{
      payment_id: "pay-stella",
      invoice_reference: "ORD-1785664978948-02513cfb",
      customer_account_id: "acct-stella",
      allocated_amount: 439.73,
      status: "active",
    }],
    paymentsById: new Map([["pay-stella", { id: "pay-stella", status: "POSTED" }]]),
    invoiceTotal: 439.73,
  });

  assert.equal(resolved.invoice_status, "PAID");
});

test("Thisha and Stella full allocation records both resolve to PAID", () => {
  const fixtures = [
    {
      name: "Thisha",
      uuid: "718d21a5-7f01-472a-b2b9-50980b6c9357",
      reference: "ORD-1785347593739-19255aad",
      amount: 631.27,
    },
    {
      name: "Stella",
      uuid: "8e01cbbe-e847-47c0-8150-790610926870",
      reference: "ORD-1785664978948-02513cfb",
      amount: 439.73,
    },
  ];

  fixtures.forEach((fixture) => {
    const paymentId = `payment-${fixture.name}`;
    const resolved = resolveInvoiceRowFromAllocations({
      row: {
        order_uuid: fixture.uuid,
        canonical_order_number: fixture.reference,
        orderId: formatDisplayOrderId(fixture.reference),
        customer_account_id: `account-${fixture.name}`,
        payment_status: "UNPAID",
      },
      allocations: [{
        payment_id: paymentId,
        invoice_source_id: fixture.uuid,
        invoice_reference: fixture.reference,
        customer_account_id: `account-${fixture.name}`,
        allocated_amount: fixture.amount,
        status: "active",
      }],
      paymentsById: new Map([[paymentId, { id: paymentId, status: "POSTED" }]]),
      invoiceTotal: fixture.amount,
    });
    assert.equal(resolved.invoice_status, "PAID", fixture.name);
  });
});

test("Outstanding summary uses resolved paid, partial, and unpaid amounts", () => {
  const rows = [
    { invoice_total: 631.27, outstanding_amount: 0, invoice_status: "PAID" },
    { invoice_total: 200, outstanding_amount: 75, invoice_status: "PART PAID" },
    { invoice_total: 100, outstanding_amount: 100, invoice_status: "UNPAID" },
  ];

  assert.equal(getResolvedInvoiceOutstanding(rows[0]), 0);
  assert.equal(sumResolvedInvoiceOutstanding(rows), 175);
});

test("legacy repaired invoices match PAYMENT reference_no when order_number is null", () => {
  const fixtures = [
    { reference: "ORD-1784144566386", accountId: "account-legacy-1", total: 168.45 },
    { reference: "ORD-1784197506132", accountId: "account-legacy-2", total: 294.8 },
  ];

  const resolvedRows = fixtures.map((fixture) => {
    const row = {
      canonical_order_number: fixture.reference,
      full_order_number: fixture.reference,
      reference_no: fixture.reference,
      order_number: fixture.reference,
      customer_account_id: fixture.accountId,
      invoice_status: "PAID",
      paid_amount: fixture.total,
    };
    const legacyPayment = {
      id: `payment-${fixture.reference}`,
      entry_type: "PAYMENT",
      payment_status: "POSTED",
      reference_no: fixture.reference,
      order_number: null,
      customer_account_id: fixture.accountId,
      payment_amount: fixture.total,
    };

    assert.equal(isActiveLegacyLedgerPayment(legacyPayment), true);
    assert.equal(getInvoiceLedgerReferenceKeys(row).has(fixture.reference), true);
    return resolveInvoiceRowFromAllocations({
      row,
      allocations: [],
      paymentsById: new Map(),
      legacyLedgerPayments: [legacyPayment],
      invoiceTotal: fixture.total,
    });
  });

  resolvedRows.forEach((row) => {
    assert.equal(row.invoice_status, "PAID");
    assert.equal(row.outstanding_amount, 0);
  });
  assert.equal(sumResolvedInvoiceOutstanding(resolvedRows), 0);
});

test("legacy PAYMENT matching rejects another customer and shortened references", () => {
  const row = {
    canonical_order_number: "ORD-1784144566386",
    orderId: "ORD-1784144566",
    customer_account_id: "account-correct",
  };
  const basePayment = {
    entry_type: "PAYMENT",
    payment_status: "POSTED",
    order_number: null,
    payment_amount: 100,
  };

  for (const payment of [
    { ...basePayment, reference_no: "ORD-1784144566386", customer_account_id: "account-other" },
    { ...basePayment, reference_no: "ORD-1784144566", customer_account_id: "account-correct" },
  ]) {
    const resolved = resolveInvoiceRowFromAllocations({
      row,
      legacyLedgerPayments: [payment],
      invoiceTotal: 100,
    });
    assert.equal(resolved.invoice_status, "UNPAID");
    assert.equal(resolved.outstanding_amount, 100);
  }
});
