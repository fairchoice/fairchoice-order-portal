import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const driverSource = fs.readFileSync(
  new URL("../pages/AdminSetup/Driver.jsx", import.meta.url),
  "utf8"
);
const ordersSource = fs.readFileSync(new URL("./orders.js", import.meta.url), "utf8");
const migrationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260803020000_reconcile_driver_today_invoice_allocations.sql",
    import.meta.url
  ),
  "utf8"
);
const allocationFoundationSource = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260705090000_central_payment_engine_foundation.sql",
    import.meta.url
  ),
  "utf8"
);

const reconcileEligiblePayments = (payments, orders, allocations) => {
  const active = (allocation) =>
    allocation.status === "active" &&
    allocation.reversed_at == null &&
    allocation.voided_at == null;
  const result = [...allocations];

  for (const payment of payments) {
    if (
      payment.source !== "DRIVER_DELIVERY_COLLECTION" ||
      payment.status !== "POSTED" ||
      payment.verification_status !== "CONFIRMED" ||
      payment.payment_applies_to !== "TODAY_INVOICE" ||
      payment.voided_at != null ||
      result.some((allocation) => allocation.payment_id === payment.id && active(allocation))
    ) continue;

    const order = orders.find((candidate) =>
      candidate.order_number === payment.payment_reference &&
      candidate.customer_account_id === payment.customer_account_id &&
      (candidate.customer_branch_id ?? candidate.branch_id ?? null) ===
        (payment.customer_branch_id ?? payment.branch_id ?? null)
    );
    if (!order) continue;

    const allocatedToInvoice = result
      .filter((allocation) => active(allocation) && (
        allocation.invoice_source_id === order.id ||
        allocation.invoice_reference === order.order_number
      ))
      .reduce((total, allocation) => total + allocation.allocated_amount, 0);
    const canonicalInvoiceTotal = order.canonical_invoice_total ?? order.grand_total;
    const amount = Math.min(
      payment.amount,
      Math.max(canonicalInvoiceTotal - allocatedToInvoice, 0)
    );
    if (amount <= 0) continue;

    result.push({
      payment_id: payment.id,
      invoice_source_id: order.id,
      invoice_reference: order.order_number,
      allocated_amount: amount,
      allocation_type: "rebuild",
      status: "active",
      reversed_at: null,
      voided_at: null,
    });
  }
  return result;
};

test("driver TODAY_INVOICE passes the persisted order UUID", () => {
  assert.match(
    driverSource,
    /canonicalOrderUuid\s*=\s*order\.id\s*\|\|\s*order\.dbId\s*\|\|\s*order\.order_uuid\s*\|\|\s*null/
  );
  assert.match(driverSource, /orderId:\s*canonicalOrderUuid/);
  assert.match(driverSource, /order_uuid:\s*canonicalOrderUuid/);
  assert.doesNotMatch(driverSource, /orderId:\s*order\.(?:orderId|order_number)/);
});

test("driver TODAY_INVOICE fails clearly before posting without a database UUID", () => {
  const guardIndex = driverSource.indexOf('effectiveCollectionType === "TODAY_INVOICE"');
  const postIndex = driverSource.indexOf("await postCanonicalCustomerPayment({", guardIndex);
  assert.ok(guardIndex >= 0 && postIndex > guardIndex);
  assert.match(
    driverSource.slice(guardIndex, postIndex),
    /!canonicalOrderUuid[\s\S]*Missing database order UUID[\s\S]*Refresh the order data and try again/
  );
});

test("driver keeps the readable reference and idempotency key separate from the UUID", () => {
  assert.match(
    driverSource,
    /paymentReference\s*=\s*order\.order_number\s*\|\|\s*order\.orderId\s*\|\|\s*""/
  );
  assert.match(
    driverSource,
    /paymentIntentId:\s*`delivery:\$\{[\s\S]*order\.id\s*\|\|\s*order\.orderId\s*\|\|\s*order\.order_number/
  );
});

test("credit flow remains outside canonical payment posting and UUID validation", () => {
  assert.match(driverSource, /shouldPostPayment\s*=\s*!isCredit\s*&&\s*paymentAmount\s*>\s*0/);
  assert.match(driverSource, /if \([\s\S]*shouldPostPayment[\s\S]*canonicalOrderUuid/);
});

test("orders mapping and operational merging preserve the database UUID", () => {
  assert.match(ordersSource, /const mappedOrders = \(data \|\| \[\]\)\.map\(\(order\) => \(\{\s*\.\.\.order/);
  assert.match(ordersSource, /orderId:\s*order\.order_number/);
  assert.doesNotMatch(ordersSource, /id:\s*order\.order_number/);
  assert.match(ordersSource, /return mergeOperationalOrders\(mappedOrders, processingQueueOrders\)/);
});

test("driver TODAY_INVOICE replaces the preview with one exact-order allocation", () => {
  assert.match(driverSource, /resolveDriverDeliveryAllocations\(\{/);
  assert.match(driverSource, /effectiveCollectionType,/);
  assert.match(driverSource, /orderUuid:\s*canonicalOrderUuid/);
  assert.match(driverSource, /invoiceReference:\s*fullOrderReference/);
  assert.match(driverSource, /allocatedAmount:\s*paymentAmount/);
  assert.match(driverSource, /allocations:\s*deliveryAllocations/);
});

test("migration reconciles only exact confirmed driver invoice payments", () => {
  assert.match(migrationSource, /o\.order_number\s*=\s*p\.payment_reference/);
  assert.match(migrationSource, /o\.customer_account_id\s*=\s*p\.customer_account_id/);
  assert.match(migrationSource, /coalesce\(o\.customer_branch_id, o\.branch_id/);
  assert.match(migrationSource, /p\.source\s*=\s*'DRIVER_DELIVERY_COLLECTION'/);
  assert.match(migrationSource, /p\.status\s*=\s*'POSTED'/);
  assert.match(migrationSource, /p\.verification_status\s*=\s*'CONFIRMED'/);
  assert.match(migrationSource, /payment_applies_to'.*TODAY_INVOICE/s);
});

test("migration uses the canonical order-item invoice resolver, not stale header totals", () => {
  assert.match(migrationSource, /public\.canonical_order_invoice_total\(o\.id\)/i);
  assert.doesNotMatch(
    migrationSource,
    /coalesce\(o\.grand_total,\s*o\.order_total,\s*0\)/i
  );
  assert.match(migrationSource, /Ambiguous unallocated TODAY_INVOICE payment/i);
});

test("migration is idempotent, bounded, and enforces future allocation atomically", () => {
  assert.match(migrationSource, /not exists[\s\S]*existing\.payment_id\s*=\s*p\.id/i);
  assert.match(migrationSource, /least\(c\.payment_amount, c\.invoice_outstanding\)/i);
  assert.match(migrationSource, /create constraint trigger trg_enforce_driver_today_invoice_allocation/i);
  assert.match(migrationSource, /deferrable initially deferred/i);
  assert.match(migrationSource, /a\.invoice_source_id\s*=\s*v_payment\.order_id::text/i);
});

test("every reconciliation insert uses an allocation type permitted by the schema", () => {
  const allowedMatch = allocationFoundationSource.match(
    /customer_payment_allocations_type_check[\s\S]*?allocation_type\s+in\s*\(([^)]+)\)/i
  );
  assert.ok(allowedMatch, "allocation type constraint must be present");
  const allowed = new Set([...allowedMatch[1].matchAll(/'([^']+)'/g)].map((match) => match[1]));
  const insertBlock = migrationSource.match(
    /insert into public\.customer_payment_allocations[\s\S]*?returning \*/i
  )?.[0];
  assert.ok(insertBlock, "reconciliation allocation insert must be present");
  assert.match(insertBlock, /'rebuild'/);
  assert.doesNotMatch(insertBlock, /'reconciliation'/);
  assert.equal(allowed.has("rebuild"), true);
});

test("Thisha and Stella reconcile once each and reruns do not duplicate", () => {
  const payments = ["Thisha", "Stella"].map((name) => ({
    id: `payment-${name}`,
    source: "DRIVER_DELIVERY_COLLECTION",
    status: "POSTED",
    verification_status: "CONFIRMED",
    payment_applies_to: "TODAY_INVOICE",
    voided_at: null,
    payment_reference: `order-${name}`,
    customer_account_id: `customer-${name}`,
    customer_branch_id: `branch-${name}`,
    amount: 25,
  }));
  const orders = ["Thisha", "Stella"].map((name) => ({
    id: `order-id-${name}`,
    order_number: `order-${name}`,
    customer_account_id: `customer-${name}`,
    customer_branch_id: `branch-${name}`,
    grand_total: 40,
  }));

  const firstRun = reconcileEligiblePayments(payments, orders, []);
  const secondRun = reconcileEligiblePayments(payments, orders, firstRun);
  assert.equal(firstRun.length, 2);
  assert.equal(firstRun.filter((row) => row.payment_id === "payment-Thisha").length, 1);
  assert.equal(firstRun.filter((row) => row.payment_id === "payment-Stella").length, 1);
  assert.deepEqual(secondRun, firstRun);
});

test("a valid legacy invoice with a zero header still uses its canonical total", () => {
  const payment = {
    id: "legacy-zero-header-payment",
    source: "DRIVER_DELIVERY_COLLECTION",
    status: "POSTED",
    verification_status: "CONFIRMED",
    payment_applies_to: "TODAY_INVOICE",
    voided_at: null,
    payment_reference: "ORDER-LEGACY",
    customer_account_id: "CUSTOMER-LEGACY",
    customer_branch_id: null,
    amount: 75,
  };
  const order = {
    id: "ORDER-ID-LEGACY",
    order_number: "ORDER-LEGACY",
    customer_account_id: "CUSTOMER-LEGACY",
    customer_branch_id: null,
    grand_total: 0,
    canonical_invoice_total: 125,
  };

  const result = reconcileEligiblePayments([payment], [order], []);
  assert.equal(result.length, 1);
  assert.equal(result[0].allocated_amount, 75);
});

test("a genuinely zero-value canonical invoice is not allocated", () => {
  const payment = {
    id: "zero-payment",
    source: "DRIVER_DELIVERY_COLLECTION",
    status: "POSTED",
    verification_status: "CONFIRMED",
    payment_applies_to: "TODAY_INVOICE",
    voided_at: null,
    payment_reference: "ORDER-ZERO",
    customer_account_id: "CUSTOMER-ZERO",
    customer_branch_id: null,
    amount: 10,
  };
  const order = {
    id: "ORDER-ID-ZERO",
    order_number: "ORDER-ZERO",
    customer_account_id: "CUSTOMER-ZERO",
    customer_branch_id: null,
    grand_total: 0,
    canonical_invoice_total: 0,
  };

  assert.deepEqual(reconcileEligiblePayments([payment], [order], []), []);
});

test("mismatches, existing allocations, and ineligible states are skipped", () => {
  const basePayment = {
    source: "DRIVER_DELIVERY_COLLECTION",
    status: "POSTED",
    verification_status: "CONFIRMED",
    payment_applies_to: "TODAY_INVOICE",
    voided_at: null,
    payment_reference: "ORDER-1",
    customer_account_id: "CUSTOMER-1",
    customer_branch_id: "BRANCH-1",
    amount: 20,
  };
  const order = {
    id: "ORDER-ID-1",
    order_number: "ORDER-1",
    customer_account_id: "CUSTOMER-1",
    customer_branch_id: "BRANCH-1",
    grand_total: 30,
  };
  const payments = [
    { ...basePayment, id: "wrong-customer", customer_account_id: "CUSTOMER-2" },
    { ...basePayment, id: "wrong-order", payment_reference: "ORDER-2" },
    { ...basePayment, id: "voided", voided_at: "2026-08-03T00:00:00Z" },
    { ...basePayment, id: "unconfirmed", verification_status: "PENDING" },
    { ...basePayment, id: "not-posted", status: "PENDING" },
    { ...basePayment, id: "already-allocated" },
  ];
  const existing = [{
    payment_id: "already-allocated",
    invoice_source_id: order.id,
    invoice_reference: order.order_number,
    allocated_amount: 10,
    allocation_type: "automatic",
    status: "active",
    reversed_at: null,
    voided_at: null,
  }];

  assert.deepEqual(reconcileEligiblePayments(payments, [order], existing), existing);
});

test("deferred trigger checks final state and ignores unrelated payment classes", () => {
  assert.match(migrationSource, /select p\.\*[\s\S]*where p\.id = new\.id/i);
  assert.match(migrationSource, /v_payment\.source\s*=\s*'DRIVER_DELIVERY_COLLECTION'/i);
  assert.match(migrationSource, /v_payment\.status\s*=\s*'POSTED'/i);
  assert.match(migrationSource, /v_payment\.verification_status\s*=\s*'CONFIRMED'/i);
  assert.match(migrationSource, /v_payment\.voided_at\s+is\s+null/i);
  assert.match(migrationSource, /payment_applies_to'.*TODAY_INVOICE/s);
});
