import { createClient } from "@supabase/supabase-js";

import { calculateDocumentTotals } from "../src/utils/documentTotals.js";
import {
  buildCustomerAccountTransactionModel,
  isBalanceAffectingPayment,
  sortTransactionsForDisplay,
} from "../src/utils/customerAccountTransactions.js";
import { resolveLegacyCompatibilityRows } from "../src/utils/centralPaymentCalculations.js";
import { isTestAccount } from "../src/utils/testAccountFiltering.js";

const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();
const summaryOnly = process.argv.includes("--summary");
const customerFilter = String(
  process.argv.find((argument) => argument.startsWith("--customer=")) || ""
)
  .slice("--customer=".length)
  .trim()
  .toLowerCase();
if (!supabaseUrl || !supabaseKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");
}

const client = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const selectAll = async (table, select = "*") => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
};

const selectOptional = async (table, select = "*") => {
  try {
    return await selectAll(table, select);
  } catch (error) {
    if (/permission denied/i.test(String(error?.message || ""))) {
      console.warn(`${table}: skipped because the anon role cannot read it.`);
      return [];
    }
    throw error;
  }
};

const groupByCustomer = (rows) => {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = String(row.customer_account_id || "");
    if (!key) return;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  });
  return grouped;
};

const [
  customers,
  openings,
  orders,
  payments,
  allocations,
  balances,
  ledgerRows,
] = await Promise.all([
  selectAll("customer_accounts"),
  selectAll("customer_branch_opening_balances"),
  selectAll("orders", "*, order_items(*)"),
  selectAll("customer_payments"),
  selectAll("customer_payment_allocations"),
  selectOptional("central_payment_balances"),
  selectAll("customer_ledger"),
]);
const auditedCustomers = customers.filter(
  (customer) => customer.active !== false && !isTestAccount(customer)
);

const deliveredStatuses = new Set([
  "delivered",
  "confirmed",
  "delivery confirmed",
  "completed",
]);
const invoices = orders
  .filter((order) =>
    deliveredStatuses.has(String(order.status || "").trim().toLowerCase())
  )
  .filter((order) => order.customer_account_id)
  .map((order) => ({
    ...order,
    invoice_number:
      order.invoice_number || order.order_number || order.orderId || order.id,
    invoice_date:
      order.delivered_at ||
      order.delivery_confirmed_at ||
      order.updated_at ||
      order.created_at,
    invoice_total: calculateDocumentTotals(order.order_items || [], order)
      .grandTotal,
    source: "orders",
  }));

const openingByCustomer = groupByCustomer(openings);
const invoiceByCustomer = groupByCustomer(invoices);
const paymentByCustomer = groupByCustomer(payments);
const allocationByCustomer = groupByCustomer(allocations);
const ledgerByCustomer = groupByCustomer(ledgerRows);
const storedBalanceByCustomer = new Map(
  balances
    .filter((row) => row.customer_branch_id === null)
    .map((row) => [String(row.customer_account_id), row])
);
const ledgerPayments = ledgerRows.filter(
  (row) =>
    String(row.entry_type || row.transaction_type || "").toUpperCase() ===
    "PAYMENT"
);
const canonicalPaymentIds = new Set(payments.map((payment) => String(payment.id)));
const canonicalLegacyIds = new Set(
  payments
    .map((payment) =>
      String(payment.idempotency_key || "").match(
        /^legacy-customer-ledger:(.+)$/i
      )?.[1]
    )
    .filter(Boolean)
);
const canonicalPaymentFingerprints = new Set(
  payments.map((payment) =>
    [
      payment.customer_account_id,
      String(payment.payment_reference || payment.reference_no || "")
        .trim()
        .toUpperCase(),
      Number(payment.amount || 0).toFixed(2),
      String(payment.payment_date || payment.created_at || "").slice(0, 10),
    ].join("|")
  )
);

const reconciliation = auditedCustomers.map((customer) => {
  const id = String(customer.id);
  const customerPayments = paymentByCustomer.get(id) || [];
  const activeCanonicalPayments = customerPayments.filter(
    isBalanceAffectingPayment
  );
  const inactiveCanonicalPayments = customerPayments.filter(
    (payment) => !isBalanceAffectingPayment(payment)
  );
  const legacyPaymentsForCustomer = (ledgerByCustomer.get(id) || [])
    .filter(
      (row) =>
        String(row.entry_type || row.transaction_type || "").toUpperCase() ===
        "PAYMENT"
    )
    .filter(
      (row) =>
        ![
          "PENDING",
          "PENDING_VERIFICATION",
          "REJECTED",
          "VOIDED",
          "REVERSED",
          "ARCHIVED",
          "INACTIVE",
          "CANCELLED",
          "DELETED",
        ].includes(String(row.payment_status || row.status || "POSTED").toUpperCase())
    )
    .filter((row) => !row.voided_at && !row.reversed_at)
    .map((row) => ({
      ...row,
      id: `legacy-${row.id}`,
      legacy_ledger_id: row.id,
      payment_reference:
        row.payment_reference || row.reference_no || row.order_number || row.id,
      payment_date: row.payment_date || row.collection_date || row.created_at,
      amount: Number(row.credit ?? row.payment_amount ?? row.amount ?? 0),
      payment_method: row.payment_method || row.payment_type || "Other",
      status: row.payment_status || row.status || "POSTED",
      source: "legacy_customer_ledger",
    }));
  const compatibility = resolveLegacyCompatibilityRows({
    payments: activeCanonicalPayments,
    canonicalIdentityPayments: customerPayments,
    legacyPayments: legacyPaymentsForCustomer,
  });
  const suppressedPaymentIds = new Set(
    compatibility.paymentDiagnostics.suppressedPaymentIds.map(String)
  );
  const customerAllocations = (allocationByCustomer.get(id) || []).filter(
    (allocation) =>
      !suppressedPaymentIds.has(
        String(
          allocation.payment_id ||
            allocation.paymentId ||
            allocation.customer_payment_id ||
            ""
        )
      )
  );
  const model = buildCustomerAccountTransactionModel({
    customer,
    openingBalances: openingByCustomer.get(id) || [],
    invoices: invoiceByCustomer.get(id) || [],
    payments: [...inactiveCanonicalPayments, ...compatibility.payments],
    allocations: customerAllocations,
  });
  const storedRecord = storedBalanceByCustomer.get(id);
  const stored =
    storedRecord === undefined
      ? null
      : Number(storedRecord.outstanding_balance || 0);
  const storedDifference =
    stored === null
      ? null
      : Number((model.summary.closingBalance - stored).toFixed(2));
  const latestRunningBalance = Number(
    model.transactions.at(-1)?.running_balance || 0
  );
  const newestRunningBalance = Number(
    sortTransactionsForDisplay(model.transactions, "newest")[0]
      ?.running_balance || 0
  );
  const historyMatches =
    Math.abs(model.summary.closingBalance - latestRunningBalance) <= 0.01 &&
    Math.abs(model.summary.closingBalance - newestRunningBalance) <= 0.01;
  const lastPaymentAmount = Number(
    model.summary.lastPayment?.credit_amount || 0
  );
  const lastPaymentDate =
    model.summary.lastPayment?.ordering_timestamp || null;
  const matchStatus =
    historyMatches &&
    model.reconciliation.allocationIssues.length === 0 &&
    model.reconciliation.missingTimestamps.length === 0;
  const openingScopeCounts = new Map();
  (openingByCustomer.get(id) || []).forEach((opening) => {
    const key = String(opening.customer_branch_id || "MAIN");
    openingScopeCounts.set(key, (openingScopeCounts.get(key) || 0) + 1);
  });
  const duplicateOpeningBalanceCount = [...openingScopeCounts.values()].filter(
    (count) => count > 1
  ).length;
  return {
    customer: customer.account_name,
    customerAccountId: customer.id,
    total_outstanding: model.summary.outstandingBalance,
    latest_running_balance: latestRunningBalance,
    last_payment_amount: lastPaymentAmount,
    last_payment_date: lastPaymentDate,
    match_status: matchStatus ? "MATCH" : "REVIEW",
    opening: model.summary.openingBalance,
    invoices: model.summary.invoiceTotal,
    activePayments: model.summary.paymentTotal,
    credits: model.summary.customerCredit,
    allocations: model.reconciliation.allocationTotal,
    unallocatedCredit: model.reconciliation.unallocatedCredit,
    calculatedClosing: model.summary.closingBalance,
    displayedClosing: model.reconciliation.displayedClosingBalance,
    storedClosing: stored,
    storedDifference,
    canonicalPayments: compatibility.paymentDiagnostics.canonicalPaymentCount,
    legacyOnlyPayments: compatibility.paymentDiagnostics.legacyOnlyPaymentCount,
    legacyOnlyPaymentIds: compatibility.payments
      .filter((payment) => payment.legacy_ledger_id)
      .map((payment) => payment.legacy_ledger_id),
    suppressedDuplicates:
      compatibility.paymentDiagnostics.suppressedDuplicateCount,
    legacyCompatibility: compatibility.legacyFallbackUsed,
    duplicatePayments: model.reconciliation.duplicatePayments.length,
    duplicateOpeningBalances: duplicateOpeningBalanceCount,
    allocationIssues: model.reconciliation.allocationIssues.length,
    missingTimestamps: model.reconciliation.missingTimestamps.length,
    reconciled:
      matchStatus &&
      model.reconciliation.balanced &&
      (storedDifference === null || Math.abs(storedDifference) <= 0.01) &&
      model.reconciliation.allocationIssues.length === 0 &&
      model.reconciliation.missingTimestamps.length === 0 &&
      duplicateOpeningBalanceCount === 0,
  };
});

const unresolvedLegacy = ledgerPayments.filter(
  (row) => {
    if (
      row.central_payment_id &&
      canonicalPaymentIds.has(String(row.central_payment_id))
    ) {
      return false;
    }
    if (canonicalLegacyIds.has(String(row.id))) return false;
    const fingerprint = [
      row.customer_account_id,
      String(row.payment_reference || row.reference_no || "")
        .trim()
        .toUpperCase(),
      Number(row.credit || row.payment_amount || row.amount || 0).toFixed(2),
      String(row.payment_date || row.collection_date || row.created_at || "").slice(
        0,
        10
      ),
    ].join("|");
    return !canonicalPaymentFingerprints.has(fingerprint);
  }
);
const mismatches = reconciliation.filter((row) => !row.reconciled);
const mismatchReport = mismatches.map((row) => ({
  customer_name: row.customer,
  customer_account_id: row.customerAccountId,
  opening_balance: row.opening,
  invoice_debit_total: row.invoices,
  payment_total: row.activePayments,
  credit_total: row.credits,
  expected_outstanding: row.calculatedClosing,
  displayed_outstanding: row.displayedClosing,
  difference: Number(
    (row.calculatedClosing - row.displayedClosing).toFixed(2)
  ),
  legacy_compatibility: row.legacyCompatibility,
  repair_performed: "read-model reconciliation only; no data changed",
}));
const legacyDependencyReport = reconciliation
  .filter((row) => row.legacyOnlyPayments > 0)
  .map((row) => ({
    customer_name: row.customer,
    customer_account_id: row.customerAccountId,
    legacy_only_payment_count: row.legacyOnlyPayments,
    legacy_ledger_ids: row.legacyOnlyPaymentIds.join(", "),
  }));

const unresolvedLegacyReport = unresolvedLegacy.map((row) => ({
  customer: row.customer_name,
  ledgerId: row.id,
  reference: row.payment_reference || row.reference_no,
  amount: Number(row.credit || row.amount || 0),
  customerAccountId: row.customer_account_id,
}));
const schemaProbeId = "00000000-0000-0000-0000-000000000001";
const rpcSchemaProbes = [
  [
    "set_customer_opening_balance_v1",
    {
      p_username: "schema-audit-invalid",
      p_session_token: "invalid",
      p_customer_account_id: schemaProbeId,
      p_customer_branch_id: null,
      p_amount: 0,
      p_reason: "schema audit",
    },
  ],
  [
    "edit_customer_credit_payment_v1",
    {
      p_username: "schema-audit-invalid",
      p_session_token: "invalid",
      p_customer_account_id: schemaProbeId,
      p_payment_id: schemaProbeId,
      p_amount: 1,
      p_payment_method: "Cash",
      p_payment_date: "2026-07-29",
      p_paid_by: "schema audit",
      p_collection_type: "PREVIOUS_BALANCE",
      p_reference: "schema audit",
      p_notes: "schema audit",
      p_reason: "schema audit",
    },
  ],
  [
    "void_customer_credit_payment_v1",
    {
      p_username: "schema-audit-invalid",
      p_session_token: "invalid",
      p_customer_account_id: schemaProbeId,
      p_payment_id: schemaProbeId,
      p_reason: "schema audit",
    },
  ],
  [
    "get_customer_account_reconciliation_v1",
    {
      p_username: "schema-audit-invalid",
      p_session_token: "invalid",
    },
  ],
];
const rpcSchemaFailures = [];
for (const [name, args] of rpcSchemaProbes) {
  const { error } = await client.rpc(name, args);
  if (["PGRST202", "PGRST204"].includes(String(error?.code || ""))) {
    rpcSchemaFailures.push({
      function: name,
      code: error.code,
      message: error.message,
    });
  }
}
if (!summaryOnly) {
  console.table(reconciliation);
}
console.table(mismatchReport);
console.table(legacyDependencyReport);
if (customerFilter) {
  console.table(
    reconciliation.filter((row) =>
      String(row.customer || "").toLowerCase().includes(customerFilter)
    )
  );
}
console.table(unresolvedLegacyReport);
console.log(
  JSON.stringify(
    {
      totalCustomersChecked: auditedCustomers.length,
      excludedTestOrInactiveCustomers: customers.length - auditedCustomers.length,
      customersUsingCanonicalPayments: reconciliation.filter(
        (row) => row.canonicalPayments > 0
      ).length,
      customersUsingLegacyOnlyPayments: reconciliation.filter(
        (row) => row.legacyOnlyPayments > 0
      ).length,
      customersWithSuppressedDuplicates: reconciliation.filter(
        (row) => row.suppressedDuplicates > 0
      ).length,
      customersWithMismatchedOutstandingBalances: mismatches.length,
      customersWithIncorrectLastPayment: reconciliation.filter(
        (row) => row.missingTimestamps > 0
      ).length,
      customersWithIncorrectInvoiceStatuses: reconciliation.filter(
        (row) => row.allocationIssues > 0
      ).length,
      customersWithDuplicateOpeningBalances: reconciliation.filter(
        (row) => row.duplicateOpeningBalances > 0
      ).length,
      customersWithRpcFailures: rpcSchemaFailures.some(
        (failure) => failure.function === "set_customer_opening_balance_v1"
      )
        ? auditedCustomers.length
        : 0,
      rpcSchemaFailures,
      customersRepaired: 0,
      remainingUnresolvedIssues:
        mismatches.length +
        reconciliation.filter((row) => row.duplicateOpeningBalances > 0).length +
        rpcSchemaFailures.length,
      reconciledCount: reconciliation.length - mismatches.length,
      mismatchCount: mismatches.length,
      unresolvedLegacyCandidateRows: unresolvedLegacy.length,
    },
    null,
    2
  )
);

if (mismatches.length) process.exitCode = 1;
