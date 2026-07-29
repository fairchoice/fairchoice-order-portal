export const CONFIRMED_TEST_SHOP_ACCOUNT_ID =
  "7a673fb8-e01d-4165-8c12-3d243f5eb7b3";
export const TEST_SHOP_CLEANUP_REASON =
  "Removal of confirmed Test Shop data";

const upper = (value) => String(value || "").trim().toUpperCase();
const paymentAmount = (row) =>
  Number(row.amount ?? row.credit ?? row.payment_amount ?? 0);
const isActivePayment = (row) =>
  ["POSTED", "ACTIVE"].includes(upper(row.status || row.payment_status)) &&
  ["CONFIRMED", "NOT_REQUIRED"].includes(
    upper(row.verification_status || "CONFIRMED")
  );
const isInvoice = (row) =>
  upper(row.entry_type || row.transaction_type) === "INVOICE";
const isPayment = (row) =>
  ["PAYMENT", "COLLECTION"].includes(
    upper(row.entry_type || row.transaction_type)
  );

export function assertSafeCleanupEnvironment({
  apply,
  databaseUrl,
  allowedDatabaseUrl,
  allowApply,
} = {}) {
  if (!apply) return true;
  if (allowApply !== "true") {
    throw new Error(
      "Apply is blocked. Set TEST_DATA_CLEANUP_ALLOWED=true only after dry-run approval."
    );
  }
  if (!databaseUrl || !allowedDatabaseUrl || databaseUrl !== allowedDatabaseUrl) {
    throw new Error(
      "Production execution is blocked: the connected URL is not the explicitly allowlisted test database."
    );
  }
  return true;
}

export function buildArchiveCandidates(sourceTable, rows = [], customerAccountId) {
  return rows.map((row) => ({
    source_table: sourceTable,
    source_record_id: String(row.id),
    customer_account_id: customerAccountId,
    record_snapshot: structuredClone(row),
    cleanup_reason: TEST_SHOP_CLEANUP_REASON,
  }));
}

export function findCanonicalLegacyCopies({
  canonicalPayments = [],
  ledgerRows = [],
} = {}) {
  const canonicalById = new Map(
    canonicalPayments.map((payment) => [String(payment.id), payment])
  );
  const canonicalByLegacyId = new Map();
  canonicalPayments.forEach((payment) => {
    const match = String(payment.idempotency_key || "").match(
      /^(?:legacy-customer-ledger:|collection-ledger-)(\d+)$/i
    );
    if (match) canonicalByLegacyId.set(match[1], payment);
  });

  return ledgerRows.filter(isPayment).flatMap((ledger) => {
    const byCentralId = ledger.central_payment_id
      ? canonicalById.get(String(ledger.central_payment_id))
      : null;
    const canonical = byCentralId || canonicalByLegacyId.get(String(ledger.id));
    if (!canonical) return [];
    return [{
      canonical_payment_id: canonical.id,
      duplicate_record_id: ledger.id,
      source_table: "customer_ledger",
      order_number:
        ledger.payment_reference || ledger.reference_no || ledger.order_number,
      amount: paymentAmount(ledger),
      payment_date:
        ledger.payment_date || ledger.collection_date || ledger.created_at,
      match_reason: byCentralId ? "central_payment_id" : "idempotency_key",
      confidence: "EXACT",
      recommended_action:
        "Keep as an audit/compatibility copy; count the canonical payment once.",
    }];
  });
}

export function buildTestShopDryRunReport({
  account,
  branches = [],
  canonicalPayments = [],
  ledgerRows = [],
  orders = [],
  orderItems = [],
  allocations = [],
  openingBalances = [],
  processingQueue = [],
  currentCollectionTotal = 0,
  currentPaymentCount = 0,
  currentPaidCustomerCount = 0,
  legacyOnlyPaymentCount = 0,
} = {}) {
  if (!account || String(account.id) !== CONFIRMED_TEST_SHOP_ACCOUNT_ID) {
    throw new Error("The confirmed Test Shop customer account ID was not found.");
  }
  if (String(account.account_name || "").trim().toLowerCase() !== "test shop") {
    throw new Error("The confirmed account ID no longer belongs to Test Shop.");
  }

  const activePayments = canonicalPayments.filter(isActivePayment);
  const invoiceRows = ledgerRows.filter(isInvoice);
  const activePaymentTotal = activePayments.reduce(
    (sum, row) => sum + paymentAmount(row),
    0
  );
  const invoiceTotal = invoiceRows.reduce(
    (sum, row) =>
      sum +
      Number(row.debit || row.invoice_total || row.invoice_amount || row.amount || 0),
    0
  );
  const openingTotal = openingBalances.reduce(
    (sum, row) => sum + Number(row.opening_balance || 0),
    0
  );
  const archives = [
    ...buildArchiveCandidates("customer_payments", canonicalPayments, account.id),
    ...buildArchiveCandidates("customer_ledger", ledgerRows, account.id),
    ...buildArchiveCandidates("orders", orders, account.id),
    ...buildArchiveCandidates("order_items", orderItems, account.id),
    ...buildArchiveCandidates(
      "customer_payment_allocations",
      allocations,
      account.id
    ),
    ...buildArchiveCandidates(
      "customer_branch_opening_balances",
      openingBalances,
      account.id
    ),
    ...buildArchiveCandidates("processing_queue", processingQueue, account.id),
  ];

  return {
    mode: "dry-run",
    database_writes: 0,
    affected_customers: [{
      customer_account_id: account.id,
      customer_name: account.account_name,
      account_code: account.account_code || "",
      created_at: account.created_at || null,
      branch_ids: branches.map((branch) => branch.id),
    }],
    records_to_archive: archives.length,
    records_to_void: activePayments.length,
    records_to_delete: 0,
    payment_count_reduction: activePayments.length,
    collection_total_reduction: Number(activePaymentTotal.toFixed(2)),
    invoice_count: invoiceRows.length,
    invoice_total_reduction: Number(invoiceTotal.toFixed(2)),
    active_balance_effect: Number(
      (openingTotal + invoiceTotal - activePaymentTotal).toFixed(2)
    ),
    expected_total_collection: Number(
      (Number(currentCollectionTotal) - activePaymentTotal).toFixed(2)
    ),
    expected_combined_payment_count:
      Number(currentPaymentCount) - activePayments.length,
    expected_paid_customer_count:
      Number(currentPaidCustomerCount) - (activePayments.length ? 1 : 0),
    legacy_only_payment_count: Number(legacyOnlyPaymentCount),
    source_counts: {
      customer_payments: canonicalPayments.length,
      customer_ledger: ledgerRows.length,
      orders: orders.length,
      order_items: orderItems.length,
      payment_allocations: allocations.length,
      opening_balances: openingBalances.length,
      processing_queue: processingQueue.length,
    },
    duplicate_report: findCanonicalLegacyCopies({
      canonicalPayments,
      ledgerRows,
    }),
    archive_candidates: archives,
  };
}
