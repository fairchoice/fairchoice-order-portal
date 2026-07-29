import { createClient } from "@supabase/supabase-js";

import { mergeWeeklyAccountPaymentRows } from "../src/services/weeklyAccountPayments.js";
import {
  CONFIRMED_TEST_SHOP_ACCOUNT_ID,
  assertSafeCleanupEnvironment,
  buildTestShopDryRunReport,
} from "../src/utils/testDataCleanup.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const explicitDryRun = args.has("--dry-run");
if (apply && explicitDryRun) {
  throw new Error("Choose either --dry-run or --apply, not both.");
}

const databaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const databaseKey = String(process.env.VITE_SUPABASE_ANON_KEY || "").trim();
if (!databaseUrl || !databaseKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.");
}

assertSafeCleanupEnvironment({
  apply,
  databaseUrl,
  allowedDatabaseUrl: String(
    process.env.TEST_DATA_CLEANUP_SUPABASE_URL || ""
  ).trim(),
  allowApply: String(process.env.TEST_DATA_CLEANUP_ALLOWED || "").toLowerCase(),
});

const client = createClient(databaseUrl, databaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const selectAll = async (table) => {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if ((data || []).length < 1000) return rows;
  }
};

const [
  accounts,
  branches,
  canonicalPayments,
  ledgerRows,
  orders,
  allocations,
  openingBalances,
  processingQueue,
  allCanonicalPayments,
  allLedgerRows,
] = await Promise.all([
  selectAll("customer_accounts"),
  selectAll("customer_branches"),
  client
    .from("customer_payments")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  client
    .from("customer_ledger")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  client
    .from("orders")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  client
    .from("customer_payment_allocations")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  client
    .from("customer_branch_opening_balances")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  client
    .from("processing_queue")
    .select("*")
    .eq("customer_account_id", CONFIRMED_TEST_SHOP_ACCOUNT_ID)
    .then(({ data, error }) => {
      if (error) throw error;
      return data || [];
    }),
  selectAll("customer_payments"),
  selectAll("customer_ledger"),
]);

const account = accounts.find(
  (row) => String(row.id) === CONFIRMED_TEST_SHOP_ACCOUNT_ID
);
const accountBranches = branches.filter(
  (row) => String(row.customer_account_id) === CONFIRMED_TEST_SHOP_ACCOUNT_ID
);
const orderIds = orders.map((row) => row.id).filter(Boolean);
const orderItems = orderIds.length
  ? await client
      .from("order_items")
      .select("*")
      .in("order_id", orderIds)
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      })
  : [];

const accountNames = new Map(
  accounts.map((row) => [String(row.id), row.account_name])
);
const branchNames = new Map(
  branches.map((row) => [String(row.id), row.branch_name])
);
const combinedRows = mergeWeeklyAccountPaymentRows({
  canonicalPayments: allCanonicalPayments,
  legacyPayments: allLedgerRows,
  accountNames,
  branchNames,
  includeTestAccounts: true,
});
const uniqueCombinedKeys = new Set(
  combinedRows.map((row) => row.canonical_payment_key || row.id)
);
const currentCollectionTotal = combinedRows.reduce(
  (sum, row) => sum + Number(row.payment_amount || 0),
  0
);
const currentPaidCustomerCount = new Set(
  combinedRows.map((row) => row.customer_account_id || row.customer_name)
).size;
const legacyOnlyPaymentCount = combinedRows.filter(
  (row) => row.is_legacy
).length;

const report = buildTestShopDryRunReport({
  account,
  branches: accountBranches,
  canonicalPayments,
  ledgerRows,
  orders,
  orderItems,
  allocations,
  openingBalances,
  processingQueue,
  currentCollectionTotal,
  currentPaymentCount: uniqueCombinedKeys.size,
  currentPaidCustomerCount,
  legacyOnlyPaymentCount,
});

const similarAccounts = accounts
  .filter((row) =>
    /(test|demo|sample|dummy)/i.test(String(row.account_name || ""))
  )
  .filter((row) => String(row.id) !== CONFIRMED_TEST_SHOP_ACCOUNT_ID)
  .map((row) => ({
    customer_account_id: row.id,
    customer_name: row.account_name,
    account_code: row.account_code || "",
    created_at: row.created_at,
    action: "REVIEW ONLY - no cleanup",
  }));

const transactionReport = [
  ...canonicalPayments.map((row) => ({
    source_table: "customer_payments",
    record_id: row.id,
    customer_account_id: row.customer_account_id,
    order_number: row.payment_reference,
    payment_id: row.id,
    transaction_type: row.transaction_type || "PAYMENT",
    amount: row.amount,
    status: `${row.status}/${row.verification_status}`,
    created_at: row.created_at,
    linked_record_id: row.order_id || row.invoice_id || null,
  })),
  ...ledgerRows.map((row) => ({
    source_table: "customer_ledger",
    record_id: row.id,
    customer_account_id: row.customer_account_id,
    order_number:
      row.payment_reference || row.reference_no || row.order_number,
    payment_id: row.central_payment_id,
    transaction_type: row.entry_type || row.transaction_type,
    amount: Number(row.credit || row.debit || row.amount || 0),
    status: row.payment_status || row.invoice_status,
    created_at: row.created_at,
    linked_record_id: row.central_payment_id || row.order_id,
  })),
  ...orders.map((row) => ({
    source_table: "orders",
    record_id: row.id,
    customer_account_id: row.customer_account_id,
    order_number: row.order_number,
    payment_id: null,
    transaction_type: "ORDER",
    amount: Number(
      row.final_total ?? row.order_total ?? row.total_amount ?? 0
    ),
    status: row.status,
    created_at: row.created_at,
    linked_record_id: null,
  })),
  ...orderItems.map((row) => ({
    source_table: "order_items",
    record_id: row.id,
    customer_account_id: CONFIRMED_TEST_SHOP_ACCOUNT_ID,
    order_number:
      orders.find((order) => String(order.id) === String(row.order_id))
        ?.order_number || null,
    payment_id: null,
    transaction_type: "ORDER_ITEM",
    amount: Number(row.line_total ?? row.net_total ?? 0),
    status: row.source_status,
    created_at: row.created_at,
    linked_record_id: row.order_id,
  })),
  ...openingBalances.map((row) => ({
    source_table: "customer_branch_opening_balances",
    record_id: row.id,
    customer_account_id: row.customer_account_id,
    order_number: null,
    payment_id: null,
    transaction_type: "OPENING_BALANCE",
    amount: Number(row.opening_balance || 0),
    status: "ACTIVE",
    created_at: row.created_at,
    linked_record_id: row.customer_branch_id,
  })),
  ...processingQueue.map((row) => ({
    source_table: "processing_queue",
    record_id: row.id,
    customer_account_id: row.customer_account_id,
    order_number: row.order_number,
    payment_id: null,
    transaction_type: "PROCESSING_QUEUE",
    amount: Number(row.grand_total || 0),
    status: row.queue_status,
    created_at: row.created_at,
    linked_record_id: row.order_id,
  })),
];

console.log("TEST SHOP CLEANUP - DRY RUN");
console.table({
  customerAccountId: CONFIRMED_TEST_SHOP_ACCOUNT_ID,
  recordsToArchive: report.records_to_archive,
  recordsToVoid: report.records_to_void,
  recordsToDelete: report.records_to_delete,
  paymentCountReduction: report.payment_count_reduction,
  collectionTotalReduction: report.collection_total_reduction,
  invoiceTotalReduction: report.invoice_total_reduction,
  activeBalanceEffect: report.active_balance_effect,
  expectedPaymentCount: report.expected_combined_payment_count,
  expectedPaidCustomerCount: report.expected_paid_customer_count,
  expectedTotalCollection: report.expected_total_collection,
});
console.log("Confirmed account:");
console.table(report.affected_customers);
console.log("Similar names (review only):");
console.table(similarAccounts);
console.log("Duplicate classification:");
console.table(report.duplicate_report);
console.log("Complete transaction report:");
console.table(transactionReport);

if (!apply) {
  console.log("Dry-run complete. Database writes: 0. Re-run with --apply only after approval.");
  process.exit(0);
}

const username = String(process.env.FC_USERNAME || "").trim();
const sessionToken = String(process.env.FC_SESSION_TOKEN || "").trim();
if (!username || !sessionToken) {
  throw new Error("FC_USERNAME and FC_SESSION_TOKEN are required for --apply.");
}

const { data, error } = await client.rpc(
  "cleanup_test_customer_transactions_v1",
  {
    p_username: username,
    p_session_token: sessionToken,
    p_customer_account_id: CONFIRMED_TEST_SHOP_ACCOUNT_ID,
    p_apply: true,
  }
);
if (error) throw error;
console.log("Approved cleanup result:");
console.table(data);
