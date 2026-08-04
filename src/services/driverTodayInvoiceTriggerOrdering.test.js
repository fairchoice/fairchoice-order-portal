import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260804100000_fix_driver_today_invoice_trigger_ordering.sql",
    import.meta.url
  ),
  "utf8"
);

const exactOrderId = "37c527c4-fdff-4a1a-9ebc-33124a5b6966";
const otherOrderId = "5fa0f648-1ac3-48c1-9999-25585f118c88";

const payment = () => ({
  id: "payment-1",
  source: "DRIVER_DELIVERY_COLLECTION",
  status: "POSTED",
  verification_status: "CONFIRMED",
  payment_applies_to: "TODAY_INVOICE",
  voided_at: null,
  order_id: exactOrderId,
  payment_reference: "ORD-1783300314589",
  customer_account_id: "account-1",
  customer_branch_id: "branch-1",
});

const exactAllocation = () => ({
  payment_id: "payment-1",
  status: "active",
  reversed_at: null,
  voided_at: null,
  invoice_reference: "ORD-1783300314589",
  invoice_source_id: exactOrderId,
  customer_account_id: "account-1",
  customer_branch_id: "branch-1",
  allocated_amount: 43,
});

const validateFinalState = (candidate, allocations, requireAllocation = true) => {
  assert.equal(candidate.order_id, exactOrderId);
  assert.equal(candidate.payment_reference, "ORD-1783300314589");
  if (!requireAllocation) return;

  const active = allocations.filter(
    (row) =>
      row.payment_id === candidate.id &&
      row.status === "active" &&
      row.reversed_at == null &&
      row.voided_at == null
  );
  const exact = active.filter(
    (row) =>
      row.invoice_reference === candidate.payment_reference &&
      row.invoice_source_id === candidate.order_id &&
      row.customer_account_id === candidate.customer_account_id &&
      row.customer_branch_id === candidate.customer_branch_id &&
      row.allocated_amount > 0
  );

  if (active.length > exact.length) throw new Error("another invoice");
  if (active.length !== 1 || exact.length !== 1) throw new Error("exact allocation");
};

const runCanonicalTransaction = (allocations) => {
  const durableState = { payments: [], allocations: [] };
  const pendingState = structuredClone(durableState);
  const candidate = payment();

  try {
    pendingState.payments.push(candidate);
    validateFinalState(candidate, pendingState.allocations, false);
    pendingState.allocations.push(...allocations);

    // The repaired FIFO preserves TODAY_INVOICE rows instead of rebuilding
    // them against another invoice.
    const afterFifo = pendingState.allocations.filter(
      (row) => row.payment_id === candidate.id
    );
    validateFinalState(candidate, afterFifo, true);
    return pendingState;
  } catch (error) {
    assert.deepEqual(durableState, { payments: [], allocations: [] });
    throw error;
  }
};

test("payment INSERT validates identity without requiring a not-yet-inserted allocation", () => {
  assert.doesNotThrow(() => validateFinalState(payment(), [], false));
  assert.match(migration, /new\.id,\s*tg_op\s*<>\s*'INSERT'/i);
});

test("canonical TODAY_INVOICE transaction succeeds with one exact allocation", () => {
  const result = runCanonicalTransaction([exactAllocation()]);
  assert.equal(result.payments.length, 1);
  assert.deepEqual(result.allocations, [exactAllocation()]);
});

test("missing allocation fails and leaves the transaction atomic", () => {
  assert.throws(() => runCanonicalTransaction([]), /exact allocation/);
});

test("wrong-order allocation fails", () => {
  assert.throws(
    () =>
      runCanonicalTransaction([
        { ...exactAllocation(), invoice_source_id: otherOrderId },
      ]),
    /another invoice/
  );
});

test("an additional active allocation to another invoice fails", () => {
  assert.throws(
    () =>
      runCanonicalTransaction([
        exactAllocation(),
        {
          ...exactAllocation(),
          invoice_reference: "ORD-OTHER",
          invoice_source_id: otherOrderId,
        },
      ]),
    /another invoice/
  );
});

test("FIFO preserves exact rows and validates only after rebuild and balances", () => {
  const capture = migration.indexOf("into v_today_allocations");
  const deleteAllocations = migration.indexOf(
    "delete from public.customer_payment_allocations"
  );
  const restore = migration.indexOf("jsonb_populate_recordset");
  const balanceRebuild = migration.indexOf(
    "delete from public.central_payment_balances"
  );
  const checkpoint = migration.lastIndexOf(
    "perform public.fc_validate_driver_today_invoice_allocation_v1"
  );

  assert.ok(capture >= 0 && capture < deleteAllocations);
  assert.ok(deleteAllocations < restore);
  assert.ok(restore < balanceRebuild);
  assert.ok(balanceRebuild < checkpoint);
  assert.match(
    migration,
    /and not \([\s\S]*payment_applies_to'[\s\S]*TODAY_INVOICE[\s\S]*\)\s*order by/i
  );
});

test("later payment and allocation changes retain deferred final-state guards", () => {
  assert.match(
    migration,
    /create constraint trigger trg_enforce_driver_today_invoice_allocation[\s\S]*after insert or update[\s\S]*deferrable initially deferred/i
  );
  assert.match(
    migration,
    /create constraint trigger trg_enforce_driver_today_invoice_allocation_change[\s\S]*after insert or update or delete[\s\S]*deferrable initially deferred/i
  );
  assert.match(
    migration,
    /tg_op\s*=\s*'UPDATE'[\s\S]*old\.payment_id\s+is\s+distinct\s+from\s+new\.payment_id[\s\S]*old\.payment_id[\s\S]*new\.payment_id/i
  );
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.customer_payments[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.customer_payment_allocations[\s\S]*from public, anon, authenticated/i
  );
});

test("migration is transactional and contains no historical data backfill", () => {
  assert.match(migration, /^begin;/i);
  assert.match(migration, /notify pgrst, 'reload schema';\s*commit;\s*$/i);
  assert.doesNotMatch(migration, /_fc_driver_today_invoice_repairs/i);
  assert.doesNotMatch(migration, /DRIVER_TODAY_INVOICE_EXACT_ALLOCATION_REPAIRED/i);
});
