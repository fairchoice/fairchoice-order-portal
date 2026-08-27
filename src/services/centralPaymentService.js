import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";
import { hydrateOrdersWithFullOrderItems } from "./centralInvoiceEngine";
import { getActiveCustomerBranches } from "../utils/customerBranchScope";
import {
  CANONICAL_PAYMENT_SOURCES,
  notifyCanonicalPaymentPosted,
  postCanonicalCustomerPayment,
} from "./canonicalPaymentService";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  filterRowsForBranchScope,
  createPaymentIdempotencyKey,
  getBranchKey,
  isVoidedPayment,
  money,
  resolveLegacyCompatibilityRows,
  summarizeCreditSnapshot,
  withResolvedBranchScope,
} from "../utils/centralPaymentCalculations";
import {
  buildCustomerAccountTransactionModel,
  isBalanceAffectingPayment,
} from "../utils/customerAccountTransactions";
import { isTestAccount } from "../utils/testAccountFiltering";
import { getFcSessionState } from "./fcSession";
import { isOwnerUser } from "./ownerFinancialSecurity";
import { canPerform } from "../security/accessControlRegistry";

const deliveredStatuses = ["delivered", "confirmed", "delivery confirmed", "completed"];

const getCurrentOrderItems = (order = {}) => {
  const items = order.order_items || order.items || [];
  return Array.isArray(items) ? items : [];
};

const getCurrentOrderItemsInvoiceTotal = (order = {}) => {
  const items = getCurrentOrderItems(order);
  if (!items.length) return null;

  return calculateDocumentTotals(items, {
    ...order,
    items,
    order_items: items,
  }).grandTotal;
};

const normalizeInvoiceReference = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^ORDER[-_]?/, "ORD-")
    .replace(/^ORD[-_]?/, "ORD-");

const getInvoiceReferenceCandidates = (row = {}) =>
  [
    row.invoice_number,
    row.reference_no,
    row.order_number,
    row.orderId,
    row.order_id,
    row.id,
  ]
    .map(normalizeInvoiceReference)
    .filter(Boolean);

const buildInvoiceReferenceLookup = (rows = []) => {
  const byReference = new Map();

  (rows || []).forEach((row) => {
    getInvoiceReferenceCandidates(row).forEach((reference) => {
      if (!byReference.has(reference)) byReference.set(reference, row);
    });
  });

  return byReference;
};

const findInvoiceByReference = (row = {}, lookup = new Map()) => {
  for (const reference of getInvoiceReferenceCandidates(row)) {
    const match = lookup.get(reference);
    if (match) return match;
  }
  return null;
};

const withOrderBackedInvoiceTotal = (invoice, orderLookup) => {
  const matchingOrder = findInvoiceByReference(invoice, orderLookup);

  if (!matchingOrder) return invoice;

  const correctedTotal = matchingOrder.currentOrderItemsInvoiceTotal ?? matchingOrder.invoice_total;

  return {
    ...invoice,
    customer_branch_id: invoice.customer_branch_id || matchingOrder.customer_branch_id,
    branch_name: invoice.branch_name || matchingOrder.branch_name,
    invoice_date: invoice.invoice_date || matchingOrder.invoice_date,
    invoice_total: correctedTotal,
    invoice_amount: correctedTotal,
    amount: correctedTotal,
    debit: correctedTotal,
    source: invoice.source || "customer_invoices",
    orderSourceTotalApplied: true,
    currentOrderItemsTotalApplied: matchingOrder.currentOrderItemsTotalApplied === true,
  };
};

const getActor = (user = {}) =>
  String(
    user?.username ||
      user?.staff_username ||
      user?.email ||
      user?.name ||
      user?.id ||
      "unknown"
  );

const getBranchName = (customer, branchId) =>
  (customer?.customer_branches || []).find((branch) => String(branch.id) === String(branchId))
    ?.branch_name || "";

const isMissingTableOrColumn = (error) =>
  ["42P01", "42703", "PGRST204", "PGRST205", "PGRST200"].includes(error?.code);

export const isMissingRpcError = (error = {}) => {
  const code = String(error?.code || "");
  const message = String(error?.message || error?.details || "").toLowerCase();

  return (
    code === "42883" ||
    code === "PGRST202" ||
    message.includes("could not find the function") ||
    (message.includes("function") && message.includes("does not exist"))
  );
};

const paymentVoidUnavailableMessage =
  "Payment void service is unavailable. Apply the required database migrations before voiding payments.";
const branchSeparationUnavailableMessage =
  "Branch Separation service is unavailable. Apply the required database migrations before continuing.";

const emptyQueryResult = { data: [], error: null };

const createEmptyCentralPaymentSnapshot = () => ({
  openingBalances: [],
  invoices: [],
  payments: [],
  allPayments: [],
  allocations: [],
  paymentAudits: [],
  allocatedInvoices: [],
  transactionHistory: [],
  accountHistory: buildCustomerAccountTransactionModel(),
  customerSummary: summarizeCreditSnapshot(),
  branchSummary: summarizeCreditSnapshot(),
  branchSummaries: [],
  allocationPreview: { allocations: [], unallocatedAmount: 0 },
  legacyFallbackUsed: false,
  paymentDiagnostics: {
    canonicalPaymentCount: 0,
    legacyOnlyPaymentCount: 0,
    suppressedDuplicateCount: 0,
    canonicalPaymentTotal: 0,
    legacyOnlyPaymentTotal: 0,
    combinedUniquePaymentTotal: 0,
    suppressedPaymentIds: [],
  },
});

async function safeSelect(table, buildQuery) {
  try {
    const query = buildQuery(supabase.from(table));
    const { data, error } = await query;
    if (error) {
      if (isMissingTableOrColumn(error)) return emptyQueryResult;
      return { data: [], error };
    }
    return { data: data || [], error: null };
  } catch (error) {
    if (isMissingTableOrColumn(error)) return emptyQueryResult;
    return { data: [], error };
  }
}

export async function loadCentralPaymentCustomers() {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select("*, customer_branches(*)")
    .order("account_name");

  if (error) throw error;
  return (data || []).filter(
    (customer) => customer.active !== false && !isTestAccount(customer)
  );
}

export async function loadBranchOpeningBalances(customerAccountId) {
  if (!customerAccountId) return [];
  const { data, error } = await safeSelect("customer_branch_opening_balances", (query) =>
    query.select("*").eq("customer_account_id", customerAccountId).order("effective_at")
  );
  if (error) throw error;
  return data || [];
}

export async function loadDeliveredInvoices({ customerAccountId, customerName } = {}) {
  if (!customerAccountId && !customerName) return [];

  const mapOrderInvoice = (order) => {
    const currentOrderItemsInvoiceTotal = getCurrentOrderItemsInvoiceTotal(order);
    const savedTotal = [
      order.order_total,
      order.orderTotal,
      order.totalAmount,
      order.total,
    ].find(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        Number.isFinite(Number(value))
    );

    const invoiceReference = order.invoice_number || order.order_number || order.orderId || order.id;
    const invoiceTotal =
      currentOrderItemsInvoiceTotal ??
      (savedTotal !== undefined ? Number(savedTotal) : calculateDocumentTotals([], order).grandTotal);

    return {
      id: order.id,
      customer_account_id: order.customer_account_id || customerAccountId,
      customer_branch_id:
        order.customer_branch_id ||
        order.branch_id ||
        order.delivery_branch_id ||
        null,
      branch_name: order.delivery_branch_name || order.branch_name || order.shop_name || "",
      invoice_number: invoiceReference,
      reference_no: order.order_number || order.orderId || invoiceReference,
      order_number: order.order_number || order.orderId || invoiceReference,
      order_id: order.id,
      invoice_date: order.delivered_at || order.delivery_confirmed_at || order.created_at || order.updated_at,
      invoice_total: invoiceTotal,
      invoice_amount: invoiceTotal,
      amount: invoiceTotal,
      debit: invoiceTotal,
      currentOrderItemsInvoiceTotal,
      currentOrderItemsTotalApplied: currentOrderItemsInvoiceTotal !== null,
      status: "ISSUED",
      source: "orders",
    };
  };

  const { data: centralInvoices, error: invoiceError } = await safeSelect(
    "customer_invoices",
    (query) => {
      let next = query.select("*").neq("status", "CANCELLED").order("invoice_date", { ascending: true });
      if (customerAccountId) next = next.eq("customer_account_id", customerAccountId);
      return next;
    }
  );
  if (invoiceError) throw invoiceError;

  const { data: orders, error: ordersError } = await safeSelect("orders", (query) => {
    let next = query.select("*, order_items(*)").order("created_at", { ascending: true }).limit(500);
    if (customerAccountId) {
      next = next.eq("customer_account_id", customerAccountId);
    } else if (customerName) {
      next = next.eq("company_name", customerName);
    }
    return next;
  });
  if (ordersError) throw ordersError;

  // The invoice screen recalculates from the complete order_items table. Do the
  // same here so Customer Credit never falls back to a stale saved order total.
  const hydratedOrders = await hydrateOrdersWithFullOrderItems(orders || []);
  const orderInvoiceRows = hydratedOrders
    .filter((order) => deliveredStatuses.includes(String(order.status || "").trim().toLowerCase()))
    .filter(
      (order) =>
        String(order.financial_status || "ACTIVE").trim().toUpperCase() !== "VOID"
    )
    .map(mapOrderInvoice);

  if (!centralInvoices?.length) return orderInvoiceRows;

  const orderLookup = buildInvoiceReferenceLookup(orderInvoiceRows);
  const mergedCentralInvoices = centralInvoices
    .filter(
      (invoice) =>
        String(invoice.financial_status || "ACTIVE").trim().toUpperCase() !== "VOID"
    )
    .map((invoice) => withOrderBackedInvoiceTotal(invoice, orderLookup));
  const mergedReferences = new Set(
    mergedCentralInvoices.flatMap((invoice) => getInvoiceReferenceCandidates(invoice))
  );
  const missingOrderInvoices = orderInvoiceRows.filter(
    (order) =>
      !getInvoiceReferenceCandidates(order).some((reference) => mergedReferences.has(reference))
  );

  return [...mergedCentralInvoices, ...missingOrderInvoices];
}

export async function loadPayments(customerAccountId) {
  return (await loadAllPayments(customerAccountId)).filter(isBalanceAffectingPayment);
}

export async function loadAllPayments(customerAccountId) {
  if (!customerAccountId) return [];
  const { data, error } = await safeSelect("customer_payments", (query) =>
    query
      .select("*")
      .eq("customer_account_id", customerAccountId)
      .order("payment_date", { ascending: true })
  );
  if (error) throw error;
  return data || [];
}

const inactiveLedgerPaymentStatuses = new Set([
  "PENDING",
  "PENDING_VERIFICATION",
  "REJECTED",
  "VOIDED",
  "REVERSED",
  "ARCHIVED",
  "INACTIVE",
  "CANCELLED",
]);

async function loadCustomerLedgerPayments({ customerAccountId, customerName } = {}) {
  if (!customerAccountId && !customerName) return [];
  const result = customerAccountId
    ? await safeSelect("customer_ledger", (query) =>
        query
          .select("*")
          .eq("customer_account_id", customerAccountId)
          .order("payment_date", { ascending: true })
          .order("created_at", { ascending: true })
      )
    : await safeSelect("customer_ledger", (query) =>
        query
          .select("*")
          .eq("customer_name", customerName)
          .order("payment_date", { ascending: true })
          .order("created_at", { ascending: true })
      );
  if (result.error) throw result.error;

  const uniqueRows = new Map();
  for (const row of result.data || []) {
    if (String(row.entry_type || row.transaction_type || "").toUpperCase() !== "PAYMENT") {
      continue;
    }
    const lifecycle = String(row.payment_status || "").trim().toUpperCase();
    if (
      inactiveLedgerPaymentStatuses.has(lifecycle) ||
      row.voided_at ||
      row.reversed_at
    ) {
      continue;
    }
    const uniqueKey = row.central_payment_id
      ? `canonical:${row.central_payment_id}`
      : `legacy:${row.id}`;
    if (uniqueRows.has(uniqueKey)) continue;
    uniqueRows.set(uniqueKey, {
      ...row,
      id: uniqueKey,
      ledger_id: row.id,
      payment_reference:
        row.payment_reference || row.reference_no || row.order_number || "—",
      payment_date: row.payment_date || row.collection_date || row.created_at,
      amount: Number(row.credit ?? row.payment_amount ?? row.amount ?? 0),
      payment_method: row.payment_method || row.payment_type || "Other",
      source: row.source || row.collection_source || "CUSTOMER_LEDGER",
      status: lifecycle || "POSTED",
      transaction_type: "PAYMENT",
    });
  }
  return [...uniqueRows.values()];
}

export async function loadAllocations(customerAccountId) {
  if (!customerAccountId) return [];
  const { data, error } = await safeSelect("customer_payment_allocations", (query) =>
    query
      .select("*")
      .eq("customer_account_id", customerAccountId)
      .order("created_at", { ascending: true })
  );
  if (error) throw error;
  return data || [];
}

async function loadLegacyLedgerFallback({
  customerAccountId,
  customerName,
  customer,
} = {}) {
  if (!customerAccountId && !customerName) return { invoices: [], payments: [] };

  // Temporary legacy compatibility: read-only fallback for accounts that have not yet
  // been represented in the new customer_invoices/customer_payments tables.
  const ledgerById = customerAccountId
    ? await safeSelect("customer_ledger", (query) =>
        query
          .select("*")
          .eq("customer_account_id", customerAccountId)
          .order("created_at", { ascending: true })
      )
    : emptyQueryResult;
  const ledgerRows = ledgerById.data?.length
    ? ledgerById.data
    : (
        await safeSelect("customer_ledger", (query) =>
          query.select("*").eq("customer_name", customerName).order("created_at", { ascending: true })
        )
      ).data || [];

  const branches = getActiveCustomerBranches(customer);
  // Do not use customer_ledger as an active invoice source. Ledger invoice
  // amounts are historical postings and can retain the pre-amendment value.
  // Current invoice amounts must always come from orders + current order_items.
  const legacyInvoices = [];
  const legacyPayments = ledgerRows
      .filter((row) => String(row.entry_type || row.transaction_type || "").toUpperCase() === "PAYMENT")
      .filter((row) => !isVoidedPayment(row))
      .map((row) => ({
        ...row,
        id: `legacy-${row.id}`,
        legacy_ledger_id: row.id,
        payment_reference: row.payment_reference || row.reference_no || row.id,
        payment_date: row.payment_date || row.created_at,
        amount: Number(row.credit || row.amount || 0),
        payment_method: row.payment_method || row.payment_type || "Other",
        status: row.payment_status || "POSTED",
        source: "legacy_customer_ledger",
      }));

  return {
    invoices: withResolvedBranchScope(legacyInvoices, branches),
    payments: withResolvedBranchScope(legacyPayments, branches),
  };
}

export async function loadCentralPaymentSnapshot({
  customerAccountId,
  customerName,
  customer,
  selectedBranchId = "",
  paymentSource = "canonical",
} = {}) {
  if ((!customerAccountId && !customerName) || isTestAccount(customer)) {
    return createEmptyCentralPaymentSnapshot();
  }

  let [openingBalances, invoices, loadedPayments, allocations, paymentAudits] =
    await Promise.all([
    loadBranchOpeningBalances(customerAccountId),
    loadDeliveredInvoices({ customerAccountId, customerName }),
    paymentSource === "customer_ledger"
      ? loadCustomerLedgerPayments({ customerAccountId, customerName })
      : loadAllPayments(customerAccountId),
    loadAllocations(customerAccountId),
    loadPaymentAuditHistory(customerAccountId),
  ]);
  let allPayments = loadedPayments;

  // Branch accounting is ON only when the customer has active branches.
  // Otherwise every financial record belongs to the main customer account.
  const branches = getActiveCustomerBranches(customer);
  const scopedNewInvoices = withResolvedBranchScope(invoices, branches);
  const scopedAllPayments = withResolvedBranchScope(allPayments, branches);
  const scopedNewPayments = scopedAllPayments.filter(isBalanceAffectingPayment);
  const scopedAllocations = withResolvedBranchScope(allocations, branches);
  const compatibilityRows =
    paymentSource === "customer_ledger"
      ? {
          invoices: scopedNewInvoices,
          payments: scopedNewPayments,
          legacyFallbackUsed: false,
          paymentDiagnostics: {
            canonicalPaymentCount: scopedNewPayments.length,
            legacyOnlyPaymentCount: 0,
            suppressedDuplicateCount: 0,
            canonicalPaymentTotal: money(
              scopedNewPayments.reduce(
                (sum, payment) => sum + Number(payment.amount || 0),
                0
              )
            ),
            legacyOnlyPaymentTotal: 0,
            combinedUniquePaymentTotal: money(
              scopedNewPayments.reduce(
                (sum, payment) => sum + Number(payment.amount || 0),
                0
              )
            ),
            suppressedPaymentIds: [],
          },
        }
      : resolveLegacyCompatibilityRows({
          invoices: scopedNewInvoices,
          payments: scopedNewPayments,
          canonicalIdentityPayments: scopedAllPayments,
          legacyInvoices: [],
          legacyPayments: (
            await loadLegacyLedgerFallback({
              customerAccountId,
              customerName,
              customer,
            })
          ).payments,
        });
  invoices = compatibilityRows.invoices;
  const payments = compatibilityRows.payments;
  allPayments = [
    ...scopedAllPayments.filter(
      (payment) => !isBalanceAffectingPayment(payment)
    ),
    ...compatibilityRows.payments,
  ];
  const suppressedPaymentIds = new Set(
    (compatibilityRows.paymentDiagnostics?.suppressedPaymentIds || []).map(String)
  );
  allocations = scopedAllocations.filter(
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
  const selectedInvoices = filterRowsForBranchScope(invoices, selectedBranchId);
  const selectedPayments = filterRowsForBranchScope(payments, selectedBranchId);
  const selectedAllPayments = filterRowsForBranchScope(allPayments, selectedBranchId);
  const selectedAllocations = filterRowsForBranchScope(allocations, selectedBranchId);
  const legacyFallbackUsed = compatibilityRows.legacyFallbackUsed;

  const allocatedInvoices = applyAllocationsToInvoices(invoices, allocations);
  const selectedAllocatedInvoices = applyAllocationsToInvoices(selectedInvoices, selectedAllocations);
  const selectedOpeningBalance = money(
    (openingBalances || [])
      .filter((row) =>
        selectedBranchId
          ? getBranchKey(row.customer_branch_id) === getBranchKey(selectedBranchId)
          : true
      )
      .reduce((sum, row) => sum + Number(row.opening_balance || 0), 0)
  );
  const transactionInvoices = selectedBranchId ? selectedAllocatedInvoices : allocatedInvoices;
  const modelOpeningBalances = selectedBranchId
    ? (openingBalances || []).filter(
        (row) =>
          getBranchKey(row.customer_branch_id) === getBranchKey(selectedBranchId)
      )
    : openingBalances;
  const accountHistory = buildCustomerAccountTransactionModel({
    customer,
    openingBalances: modelOpeningBalances,
    invoices: transactionInvoices,
    payments: selectedBranchId ? selectedAllPayments : allPayments,
    allocations: selectedBranchId ? selectedAllocations : allocations,
    paymentAudits,
    sortDirection: "oldest",
  });
  const activeBranchKeys = new Set(branches.map((branch) => getBranchKey(branch.id)));
  const branchSummaries = branches.map((branch) => {
    const branchId = String(branch.id);
    const branchInvoices = filterRowsForBranchScope(invoices, branchId);
    const branchAllocations = filterRowsForBranchScope(allocations, branchId);
    const branchAllocatedInvoices = applyAllocationsToInvoices(branchInvoices, branchAllocations);
    const branchCreditLimit = branch.credit_limit ?? branch.creditLimit ?? customer?.credit_limit;
    const branchOpeningRows = (openingBalances || []).filter(
      (row) => getBranchKey(row.customer_branch_id) === getBranchKey(branchId)
    );
    const branchAllPayments = filterRowsForBranchScope(allPayments, branchId);
    const branchModel = buildCustomerAccountTransactionModel({
      customer: { ...customer, credit_limit: branchCreditLimit },
      openingBalances: branchOpeningRows,
      invoices: branchAllocatedInvoices,
      payments: branchAllPayments,
      allocations: branchAllocations,
      paymentAudits,
    });

    return {
      branchId,
      branchName: branch.branch_name || branch.name || "",
      ...branchModel.summary,
    };
  });

  // Existing accounts can contain opening balances or historical transactions
  // which pre-date branch assignment. Keep those amounts visible as a separate
  // reconciliation row instead of dropping them from the branch total.
  const unassignedInvoices = branches.length
    ? invoices.filter((row) => row._branchMatched !== true)
    : invoices;
  const unassignedOpeningRows = (openingBalances || []).filter(
    (row) => !activeBranchKeys.has(getBranchKey(row.customer_branch_id))
  );
  const unassignedAllPayments = branches.length
    ? allPayments.filter((row) => row._branchMatched !== true)
    : allPayments;
  const unassignedModel = buildCustomerAccountTransactionModel({
    customer: { ...customer, credit_limit: 0 },
    openingBalances: unassignedOpeningRows,
    invoices: unassignedInvoices,
    payments: unassignedAllPayments,
    allocations: branches.length
      ? allocations.filter((row) => row._branchMatched !== true)
      : allocations,
    paymentAudits,
  });
  const unassignedSummary = unassignedModel.summary;
  const hasUnassignedFinancialActivity = [
    unassignedSummary.openingBalance,
    unassignedSummary.invoiceTotal,
    unassignedSummary.paymentTotal,
  ].some((value) => Number(value || 0) !== 0);

  if (!branches.length || hasUnassignedFinancialActivity) {
    branchSummaries.push({
      branchId: null,
      branchName: branches.length ? "Main / unassigned" : "Main Customer Account",
      isUnassigned: true,
      ...unassignedSummary,
    });
  }

  const fullAccountHistory = buildCustomerAccountTransactionModel({
    customer,
    openingBalances,
    invoices: allocatedInvoices,
    payments: allPayments,
    allocations,
    paymentAudits,
    sortDirection: "oldest",
  });
  const customerSummary = fullAccountHistory.summary;
  const branchOutstandingTotal = money(
    branchSummaries.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)
  );
  const selectedBranchSummary = selectedBranchId
    ? accountHistory.summary
    : customerSummary;

  return {
    openingBalances,
    invoices,
    payments,
    allPayments,
    allocations,
    paymentAudits,
    allocatedInvoices,
    transactionHistory: accountHistory.transactions,
    accountHistory,
    fullAccountHistory,
    paymentHistory: accountHistory.paymentHistory,
    customerSummary,
    branchSummary: selectedBranchSummary,
    branchSummaries,
    reconciliation: {
      branchOutstandingTotal,
      difference: money(customerSummary.outstanding - branchOutstandingTotal),
    },
    selectedInvoices: selectedAllocatedInvoices,
    selectedPayments,
    selectedAllPayments,
    selectedAllocations,
    selectedOpeningBalance,
    branchName: getBranchName(customer, selectedBranchId),
    legacyFallbackUsed,
    paymentDiagnostics: compatibilityRows.paymentDiagnostics,
  };
}

export const loadReadOnlyCustomerCreditSnapshot = (options = {}) =>
  loadCentralPaymentSnapshot(options);

export function buildPaymentPreview({ invoices = [], allocations = [], amount = 0, branchId = "" } = {}) {
  const allocatedInvoices = applyAllocationsToInvoices(invoices, allocations);
  return allocatePaymentOldestFirst(allocatedInvoices, Number(amount || 0), { branchId });
}

export async function createCentralPayment({
  customer,
  customerAccountId,
  customerBranchId = null,
  transactionType = "PAYMENT",
  amount,
  paymentMethod,
  paymentDate,
  paidBy,
  externalReference,
  notes,
  currentUser,
  ownerPassword,
} = {}) {
  const accountId = customerAccountId || customer?.id;
  const paymentAmount = money(amount);
  const actor = getActor(currentUser).toLowerCase();
  const type = String(transactionType || "PAYMENT").toUpperCase();
  if (!accountId) throw new Error("Select a customer before saving a transaction.");
  if (paymentAmount <= 0) throw new Error("Amount must be greater than zero.");
  if (type === "DISCOUNT" && !String(notes || "").trim()) throw new Error("A detailed discount reason is compulsory.");
  if (type === "DISCOUNT" && actor !== "nisstaj_admin") {
    throw new Error("Only nisstaj_admin can post Central Payment discounts.");
  }
  const fcSession = getFcSessionState(currentUser);
  if (!fcSession.valid) {
    throw new Error(
      fcSession.expired
        ? "FC session is invalid or expired. Please sign in again."
        : "FC login session is missing. Sign out and sign in again.",
    );
  }

  const idempotencyKey = createPaymentIdempotencyKey({ customerAccountId: accountId, customerBranchId, amount: paymentAmount, paymentDate, paymentMethod: type === "DISCOUNT" ? "Discount" : paymentMethod, externalReference });
  const duplicate = await safeSelect("customer_payments", (query) => query.select("*").eq("customer_account_id", accountId).eq("idempotency_key", idempotencyKey).limit(1));
  if (duplicate.error) throw duplicate.error;
  const activeDuplicate = (duplicate.data || []).find((payment) => !isVoidedPayment(payment));
  if (activeDuplicate) return { duplicate: true, payment: activeDuplicate, allocations: [] };

  const snapshot = await loadCentralPaymentSnapshot({ customerAccountId: accountId, customerName: customer?.account_name, customer, selectedBranchId: customerBranchId || "" });
  const canonicalInvoicesResult = await safeSelect("customer_invoices", (query) =>
    query
      .select("*")
      .eq("customer_account_id", accountId)
      .neq("status", "CANCELLED")
      .order("invoice_date", { ascending: true })
  );
  if (canonicalInvoicesResult.error) throw canonicalInvoicesResult.error;
  const allocationInvoices = canonicalInvoicesResult.data?.length
    ? canonicalInvoicesResult.data
    : snapshot.invoices;
  const preview = buildPaymentPreview({ invoices: allocationInvoices, allocations: snapshot.allocations, amount: paymentAmount, branchId: customerBranchId || "" });
  const isPendingBank = type === "PAYMENT" && paymentMethod === "Bank Transfer";

  if (type === "PAYMENT") {
    try {
      const data = await postCanonicalCustomerPayment({
        customerAccountId: accountId,
        customerBranchId,
        amount: paymentAmount,
        paymentDate: paymentDate || new Date().toISOString(),
        paymentMethod: paymentMethod || "Cash",
        paymentSource: CANONICAL_PAYMENT_SOURCES.CENTRAL_PAYMENT,
        paymentReference: externalReference,
        paidBy,
        collectorName:
          currentUser?.staff_name ||
          currentUser?.name ||
          currentUser?.username ||
          actor,
        collectorStaffId: currentUser?.staff_id || currentUser?.id || null,
        collectorRole: currentUser?.role || currentUser?.access_level || "OWNER",
        idempotencyKey,
        notes,
        metadata: { entry_point: "CENTRAL_PAYMENT" },
        allocations: isPendingBank ? [] : preview.allocations,
        fcUsername: fcSession.username,
        fcSessionToken: fcSession.token,
      });
      return { ...(data || {}), preview };
    } catch (error) {
      if (isMissingRpcError(error)) {
        throw new Error(
          "Canonical Central Payment is not installed. Review and apply the additive payment architecture migration first.",
          { cause: error },
        );
      }
      throw error;
    }
  }

  const { data, error } = await supabase.rpc("post_owner_central_discount_v2", {
    p_fc_username: fcSession.username,
    p_fc_session_token: fcSession.token,
    p_customer_account_id: accountId,
    p_customer_branch_id: customerBranchId || null,
    p_payment_date: paymentDate || new Date().toISOString(),
    p_amount: paymentAmount,
    p_paid_by: paidBy || "",
    p_external_reference: String(externalReference || "").trim() || null,
    p_notes: notes || "",
    p_idempotency_key: idempotencyKey,
    p_allocations: preview.allocations,
  });
  if (!error) {
    notifyCanonicalPaymentPosted(data);
    return { ...(data || {}), preview };
  }
  if (!isMissingRpcError(error)) throw error;

  // Temporary compatibility fallback until the session-authorised discount RPC is installed.
  if (!ownerPassword) {
    throw new Error("Session-authorised Central Payment discount is not installed yet. Apply the latest additive migration first.");
  }
  const legacy = await supabase.rpc("post_owner_central_transaction", {
    p_owner_username: "nisstaj_admin",
    p_owner_password: ownerPassword,
    p_customer_account_id: accountId,
    p_customer_branch_id: customerBranchId || null,
    p_transaction_type: type,
    p_payment_date: paymentDate || new Date().toISOString(),
    p_amount: paymentAmount,
    p_payment_method: "Other",
    p_paid_by: paidBy || "",
    p_external_reference: String(externalReference || "").trim() || null,
    p_notes: notes || "",
    p_idempotency_key: idempotencyKey,
    p_allocations: preview.allocations,
  });
  if (legacy.error) throw legacy.error;
  notifyCanonicalPaymentPosted(legacy.data);
  return { ...(legacy.data || {}), preview };
}

export async function confirmOwnerBankTransfer({
  payment,
  customer,
  currentUser,
  note,
} = {}) {
  if (getActor(currentUser).toLowerCase() !== "nisstaj_admin") {
    throw new Error("Only nisstaj_admin can confirm bank transfers.");
  }
  if (!payment?.id) throw new Error("Pending bank transfer is required.");
  const fcSession = getFcSessionState(currentUser);
  if (!fcSession.valid) {
    throw new Error("FC login session is missing or expired. Sign in again.");
  }
  if (!String(note || "").trim()) {
    throw new Error("A bank verification note is compulsory.");
  }
  if (payment.payment_method !== "Bank Transfer") {
    throw new Error("Only bank transfers can be confirmed here.");
  }
  if (payment.verification_status !== "PENDING_VERIFICATION") {
    throw new Error("This bank transfer is not pending verification.");
  }

  const snapshot = await loadCentralPaymentSnapshot({
    customerAccountId: payment.customer_account_id,
    customerName: customer?.account_name,
    customer,
    selectedBranchId: payment.customer_branch_id || "",
  });
  const preview = buildPaymentPreview({
    invoices: snapshot.invoices,
    allocations: snapshot.allocations,
    amount: Number(payment.amount || 0),
    branchId: payment.customer_branch_id || "",
  });

  const { data, error } = await supabase.rpc("confirm_owner_bank_transfer_session_v1", {
    p_username: fcSession.username,
    p_session_token: fcSession.token,
    p_payment_id: payment.id,
    p_note: String(note).trim(),
  });

  if (!error) return { ...(data || {}), preview };
  if (isMissingRpcError(error)) {
    throw new Error(
      "Bank confirmation is not installed. Review and apply the additive owner-security migration first."
    );
  }
  throw error;
}

export async function rejectOwnerBankTransfer({
  payment,
  currentUser,
  reason,
} = {}) {
  if (getActor(currentUser).toLowerCase() !== "nisstaj_admin") {
    throw new Error("Only nisstaj_admin can reject bank transfers.");
  }
  if (!payment?.id) throw new Error("Pending bank transfer is required.");
  const fcSession = getFcSessionState(currentUser);
  if (!fcSession.valid) {
    throw new Error("FC login session is missing or expired. Sign in again.");
  }
  if (!String(reason || "").trim()) {
    throw new Error("A bank rejection reason is compulsory.");
  }
  if (payment.payment_method !== "Bank Transfer") {
    throw new Error("Only bank transfers can be rejected here.");
  }
  if (payment.verification_status !== "PENDING_VERIFICATION") {
    throw new Error("This bank transfer is not pending verification.");
  }

  const { data, error } = await supabase.rpc("reject_owner_bank_transfer_session_v1", {
    p_username: fcSession.username,
    p_session_token: fcSession.token,
    p_payment_id: payment.id,
    p_reason: String(reason).trim(),
  });

  if (!error) return data || {};
  if (isMissingRpcError(error)) {
    throw new Error(
      "Bank rejection is not installed. Apply the supplied bank-transfer rejection migration first."
    );
  }
  throw error;
}

const requirePermanentDeleteAdmin = (currentUser, ownerPassword) => {
  if (getActor(currentUser).toLowerCase() !== "nisstaj_admin") {
    throw new Error("Only nisstaj_admin can permanently delete archived payments.");
  }
  if (!ownerPassword) throw new Error("nisstaj_admin financial password is required.");
};

export async function listCentralPaymentRecords({
  currentUser,
  archived = false,
  search = "",
  method = "",
  dateFrom = null,
  dateTo = null,
  page = 1,
} = {}) {
  if (!isOwnerUser(currentUser)) {
    throw new Error("Payment History is restricted to nisstaj_admin.");
  }

  const fcSession = getFcSessionState(currentUser);
  if (!fcSession.valid) {
    throw new Error("FC login session is missing or expired. Sign in again.");
  }

  const safePage = Math.max(1, Number(page) || 1);
  const { data, error } = await supabase.rpc(
    "list_owner_central_payment_records_v1",
    {
      p_username: fcSession.username,
      p_session_token: fcSession.token,
      p_archived: Boolean(archived),
      p_search: String(search || "").trim(),
      p_method: String(method || "").trim(),
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
      p_page: safePage,
      p_page_size: 30,
    }
  );

  if (error) throw error;

  return {
    records: Array.isArray(data?.records) ? data.records : [],
    total: Number(data?.total || 0),
    page: Number(data?.page || safePage),
    page_size: Number(data?.page_size || 30),
    total_pages: Number(data?.total_pages || 1),
  };
}
export async function editCentralPayment({ currentUser, payment, changes, reason } = {}) {
  if (!canPerform(currentUser, "payments.edit")) throw new Error("You do not have permission to edit payments.");
  if (Number(changes?.amount) !== Number(payment?.amount) && !canPerform(currentUser, "payments.amount.change")) {
    throw new Error("You do not have permission to change payment amounts.");
  }
  if (!payment?.id) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) throw new Error("Edit reason is required.");
  const { data, error } = await supabase
    .from("customer_payments")
    .update({
      payment_date: changes.paymentDate,
      amount: Number(changes.amount),
      payment_method: changes.paymentMethod,
      paid_by: changes.paidBy,
      payment_reference: changes.externalReference,
      notes: changes.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function loadPaymentAuditHistory(customerAccountId) {
  if (!customerAccountId) return [];
  const { data, error } = await safeSelect("central_payment_lifecycle_audit", (query) =>
    query
      .select("*")
      .eq("customer_account_id", customerAccountId)
      .order("changed_at", { ascending: true })
  );
  if (
    error &&
    (String(error.code || "") === "42501" ||
      /permission denied/i.test(String(error.message || "")))
  ) {
    return [];
  }
  if (error) throw error;
  return data || [];
}

const getFcSessionCredentials = (currentUser = null) => {
  let storedUser = null;
  if (typeof window !== "undefined") {
    try {
      storedUser = JSON.parse(
        localStorage.getItem("loggedInUser") ||
          localStorage.getItem("fairchoice_user") ||
          "null"
      );
    } catch {
      storedUser = null;
    }
  }

  const user = currentUser || storedUser || {};
  return {
    username: String(user.username || user.user_name || "").trim(),
    sessionToken:
      user.fc_session_token ||
      user.session_token ||
      user.sessionToken ||
      storedUser?.fc_session_token ||
      storedUser?.session_token ||
      null,
  };
};

export async function amendCustomerCreditPayment({
  customerAccountId,
  paymentId,
  changes,
  reason,
  currentUser,
} = {}) {
  if (!customerAccountId) throw new Error("Customer account is required.");
  if (!paymentId) throw new Error("Payment is required.");
  if (!(Number(changes?.amount) > 0)) {
    throw new Error("Payment amount must be greater than zero.");
  }
  if (!String(reason || "").trim()) {
    throw new Error("Amendment reason is required.");
  }

  const { username, sessionToken } = getFcSessionCredentials(currentUser);
  if (!username || !sessionToken) {
    throw new Error("FC login session is missing. Sign out and sign in again.");
  }

  const { data, error } = await supabase.rpc(
    "edit_customer_credit_payment_v1",
    {
      p_username: username,
      p_session_token: sessionToken,
      p_customer_account_id: customerAccountId,
      p_payment_id: paymentId,
      p_amount: Number(changes.amount),
      p_payment_method: String(changes.paymentMethod || "Other").trim(),
      p_payment_date: changes.paymentDate || null,
      p_paid_by: String(changes.paidBy || "").trim(),
      p_collection_type: String(changes.collectionType || "").trim(),
      p_reference: String(changes.reference || "").trim(),
      p_notes: String(changes.notes || "").trim(),
      p_reason: String(reason).trim(),
    }
  );
  if (error) throw error;
  return data;
}

export async function setCustomerOpeningBalance({
  customerAccountId,
  customerBranchId = null,
  amount,
  reason,
  currentUser,
} = {}) {
  if (!customerAccountId) throw new Error("Customer account is required.");
  if (!Number.isFinite(Number(amount))) {
    throw new Error("Opening balance must be a valid amount.");
  }
  if (!String(reason || "").trim()) {
    throw new Error("Opening-balance amendment reason is required.");
  }

  const { username, sessionToken } = getFcSessionCredentials(currentUser);
  if (!username || !sessionToken) {
    throw new Error("FC login session is missing. Sign out and sign in again.");
  }

  const { data, error } = await supabase.rpc(
    "set_customer_opening_balance_v1",
    {
      p_username: username,
      p_session_token: sessionToken,
      p_customer_account_id: customerAccountId,
      p_customer_branch_id: customerBranchId || null,
      p_amount: Number(amount),
      p_reason: String(reason).trim(),
    }
  );
  if (error) throw error;
  return data;
}

export async function voidCustomerCreditPayment({
  customerAccountId,
  paymentId,
  reason,
  currentUser,
} = {}) {
  if (!customerAccountId) throw new Error("Customer account is required.");
  if (!paymentId) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) {
    throw new Error("Void reason is required.");
  }

  const { username, sessionToken } = getFcSessionCredentials(currentUser);
  if (!username || !sessionToken) {
    throw new Error("FC login session is missing. Sign out and sign in again.");
  }

  const { data, error } = await supabase.rpc(
    "void_customer_credit_payment_v1",
    {
      p_username: username,
      p_session_token: sessionToken,
      p_customer_account_id: customerAccountId,
      p_payment_id: paymentId,
      p_reason: String(reason).trim(),
    }
  );
  if (error) throw error;
  return data;
}

export async function removeCentralPayment({ currentUser, payment, reason } = {}) {
  if (!canPerform(currentUser, "payments.reverse")) throw new Error("You do not have permission to reverse payments.");
  if (!payment?.id) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) throw new Error("Archive reason is required.");
  const { data, error } = await supabase
    .from("customer_payments")
    .update({
      status: "VOIDED",
      removed_at: new Date().toISOString(),
      removed_reason: String(reason).trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function restoreCentralPayment({ currentUser, payment, reason } = {}) {
  if (!canPerform(currentUser, "payments.reverse")) throw new Error("You do not have permission to restore payments.");
  if (!payment?.id) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) throw new Error("Restore reason is required.");
  const { data, error } = await supabase
    .from("customer_payments")
    .update({
      status: "POSTED",
      removed_at: null,
      removed_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function permanentlyDeleteCentralPayment({ currentUser, ownerPassword, payment, reason } = {}) {
  requirePermanentDeleteAdmin(currentUser, ownerPassword);
  if (!payment?.id) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) throw new Error("A reason is required.");
  const { data, error } = await supabase.rpc("permanently_delete_central_payment", {
    p_admin_username: "nisstaj_admin",
    p_admin_password: ownerPassword,
    p_payment_id: payment.id,
    p_reason: String(reason).trim(),
  });
  if (error) throw error;
  return data;
}

export async function voidCentralPayment({ payment, reason } = {}) {
  if (!payment?.id) throw new Error("Payment is required.");
  if (!String(reason || "").trim()) throw new Error("Void reason is required.");

  const { data: rpcData, error: rpcError } = await supabase.rpc("void_central_payment", {
    p_payment_id: payment.id,
    p_reason: reason,
  });
  if (!rpcError) return rpcData;
  if (isMissingRpcError(rpcError)) {
    throw new Error(paymentVoidUnavailableMessage);
  }

  throw rpcError;
}

export async function previewBranchSeparation({
  sourceCustomerAccountId,
  sourceBranchId,
  destinationCustomerAccountId,
  reason,
} = {}) {
  if (!sourceCustomerAccountId || !sourceBranchId || !destinationCustomerAccountId) {
    throw new Error("Source customer, source branch and destination customer are required.");
  }
  if (!String(reason || "").trim()) throw new Error("A reason is required.");

  const { data, error } = await supabase.rpc("preview_branch_separation", {
    p_source_customer_account_id: sourceCustomerAccountId,
    p_source_branch_id: sourceBranchId,
    p_destination_customer_account_id: destinationCustomerAccountId,
  });
  if (!error) return data;
  if (!isMissingRpcError(error)) throw error;

  const tables = [
    ["invoices", "customer_invoices"],
    ["payments", "customer_payments"],
    ["payment_allocations", "customer_payment_allocations"],
    ["opening_balances", "customer_branch_opening_balances"],
    ["orders", "orders"],
  ];
  const counts = {};
  for (const [key, table] of tables) {
    const result = await safeSelect(table, (query) =>
      query
        .select("id", { count: "exact", head: true })
        .eq("customer_account_id", sourceCustomerAccountId)
        .eq(table === "orders" ? "customer_branch_id" : "customer_branch_id", sourceBranchId)
    );
    counts[key] = result.data?.length || 0;
  }
  return { counts, local_read_only_preview: true, applyRpcAvailable: false };
}

export async function applyBranchSeparation({
  sourceCustomerAccountId,
  sourceBranchId,
  destinationCustomerAccountId,
  reason,
  confirmation,
  currentUser,
} = {}) {
  if (confirmation !== "SEPARATE BRANCH") {
    throw new Error("Type SEPARATE BRANCH to confirm.");
  }
  const { data, error } = await supabase.rpc("apply_branch_separation", {
    p_source_customer_account_id: sourceCustomerAccountId,
    p_source_branch_id: sourceBranchId,
    p_destination_customer_account_id: destinationCustomerAccountId,
    p_reason: reason,
    p_changed_by: getActor(currentUser),
  });
  if (error) {
    if (isMissingRpcError(error)) throw new Error(branchSeparationUnavailableMessage);
    throw error;
  }
  return data;
}
