import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";
import { hydrateOrdersWithFullOrderItems } from "./centralInvoiceEngine";
import { getActiveCustomerBranches } from "../utils/customerBranchScope";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  filterRowsForBranchScope,
  buildCustomerTransactionHistory,
  createPaymentIdempotencyKey,
  getBranchKey,
  isVoidedPayment,
  money,
  resolveLegacyCompatibilityRows,
  summarizeCreditSnapshot,
  summarizeCreditSummaryRows,
  withResolvedBranchScope,
} from "../utils/centralPaymentCalculations";

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
  return (data || []).filter((customer) => customer.active !== false);
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
      invoice_date: order.delivered_at || order.delivery_confirmed_at || order.updated_at || order.created_at,
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
    .map(mapOrderInvoice);

  if (!centralInvoices?.length) return orderInvoiceRows;

  const orderLookup = buildInvoiceReferenceLookup(orderInvoiceRows);
  const mergedCentralInvoices = centralInvoices.map((invoice) =>
    withOrderBackedInvoiceTotal(invoice, orderLookup)
  );
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
  if (!customerAccountId) return [];
  const { data, error } = await safeSelect("customer_payments", (query) =>
    query
      .select("*")
      .eq("customer_account_id", customerAccountId)
      .order("payment_date", { ascending: true })
  );
  if (error) throw error;
  return (data || []).filter((payment) => !isVoidedPayment(payment));
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
  invoiceRows = [],
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
} = {}) {
  if (!customerAccountId && !customerName) {
    return {
      openingBalances: [],
      invoices: [],
      payments: [],
      allocations: [],
      allocatedInvoices: [],
      transactionHistory: [],
      customerSummary: summarizeCreditSnapshot(),
      branchSummary: summarizeCreditSnapshot(),
      branchSummaries: [],
      allocationPreview: { allocations: [], unallocatedAmount: 0 },
      legacyFallbackUsed: false,
    };
  }

  let [openingBalances, invoices, payments, allocations] = await Promise.all([
    loadBranchOpeningBalances(customerAccountId),
    loadDeliveredInvoices({ customerAccountId, customerName }),
    loadPayments(customerAccountId),
    loadAllocations(customerAccountId),
  ]);

  // Branch accounting is ON only when the customer has active branches.
  // Otherwise every financial record belongs to the main customer account.
  const branches = getActiveCustomerBranches(customer);
  const scopedNewInvoices = withResolvedBranchScope(invoices, branches);
  const scopedNewPayments = withResolvedBranchScope(payments, branches);
  const scopedAllocations = withResolvedBranchScope(allocations, branches);
  const legacy = await loadLegacyLedgerFallback({
    customerAccountId,
    customerName,
    customer,
    invoiceRows: scopedNewInvoices,
  });
  const compatibilityRows = resolveLegacyCompatibilityRows({
    invoices: scopedNewInvoices,
    payments: scopedNewPayments,
    legacyInvoices: [],
    legacyPayments: legacy.payments,
  });
  invoices = compatibilityRows.invoices;
  payments = compatibilityRows.payments;
  allocations = scopedAllocations;
  const selectedInvoices = filterRowsForBranchScope(invoices, selectedBranchId);
  const selectedPayments = filterRowsForBranchScope(payments, selectedBranchId);
  const selectedAllocations = filterRowsForBranchScope(allocations, selectedBranchId);
  const branchAwareRecordCount = [...scopedNewInvoices, ...scopedNewPayments, ...scopedAllocations].filter(
    (row) => row._branchMatched === true
  ).length;
  const legacyFallbackUsed =
    !selectedBranchId && compatibilityRows.legacyFallbackUsed && branchAwareRecordCount === 0;

  const allocatedInvoices = applyAllocationsToInvoices(invoices, allocations);
  const selectedAllocatedInvoices = applyAllocationsToInvoices(selectedInvoices, selectedAllocations);
  const openingBalance = money(
    (openingBalances || []).reduce((sum, row) => sum + Number(row.opening_balance || 0), 0)
  );
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
  const transactionPayments = selectedBranchId ? selectedPayments : payments;
  const transactionOpeningBalance = selectedBranchId ? selectedOpeningBalance : openingBalance;
  const activeBranchKeys = new Set(branches.map((branch) => getBranchKey(branch.id)));
  const branchSummaries = branches.map((branch) => {
    const branchId = String(branch.id);
    const branchInvoices = filterRowsForBranchScope(invoices, branchId);
    const branchPayments = filterRowsForBranchScope(payments, branchId);
    const branchAllocations = filterRowsForBranchScope(allocations, branchId);
    const branchAllocatedInvoices = applyAllocationsToInvoices(branchInvoices, branchAllocations);
    const branchOpeningBalance = money(
      (openingBalances || [])
        .filter((row) => getBranchKey(row.customer_branch_id) === getBranchKey(branchId))
        .reduce((sum, row) => sum + Number(row.opening_balance || 0), 0)
    );
    const branchCreditLimit = branch.credit_limit ?? branch.creditLimit ?? customer?.credit_limit;
    const summary = summarizeCreditSnapshot({
      creditLimit: branchCreditLimit,
      openingBalance: branchOpeningBalance,
      invoices: branchAllocatedInvoices,
      payments: branchPayments,
    });

    return {
      branchId,
      branchName: branch.branch_name || branch.name || "",
      ...summary,
    };
  });

  // Existing accounts can contain opening balances or historical transactions
  // which pre-date branch assignment. Keep those amounts visible as a separate
  // reconciliation row instead of dropping them from the branch total.
  const unassignedOpeningBalance = money(
    (openingBalances || [])
      .filter((row) => !activeBranchKeys.has(getBranchKey(row.customer_branch_id)))
      .reduce((sum, row) => sum + Number(row.opening_balance || 0), 0)
  );
  const unassignedInvoices = branches.length
    ? invoices.filter((row) => row._branchMatched !== true)
    : invoices;
  const unassignedPayments = branches.length
    ? payments.filter((row) => row._branchMatched !== true)
    : payments;
  const unassignedSummary = summarizeCreditSnapshot({
    openingBalance: unassignedOpeningBalance,
    invoices: unassignedInvoices,
    payments: unassignedPayments,
  });
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

  const customerSummary = summarizeCreditSummaryRows({
    creditLimit: customer?.credit_limit,
    summaries: branchSummaries,
  });
  const branchOutstandingTotal = money(
    branchSummaries.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)
  );
  const selectedBranchSummary = selectedBranchId
    ? summarizeCreditSnapshot({
        creditLimit: customer?.credit_limit,
        openingBalance: selectedOpeningBalance,
        invoices: selectedAllocatedInvoices,
        payments: selectedPayments,
      })
    : customerSummary;

  return {
    openingBalances,
    invoices,
    payments,
    allocations,
    allocatedInvoices,
    transactionHistory: buildCustomerTransactionHistory({
      openingBalance: transactionOpeningBalance,
      invoices: transactionInvoices,
      payments: transactionPayments,
      newestFirst: true,
    }),
    customerSummary,
    branchSummary: selectedBranchSummary,
    branchSummaries,
    reconciliation: {
      branchOutstandingTotal,
      difference: money(customerSummary.outstanding - branchOutstandingTotal),
    },
    selectedInvoices: selectedAllocatedInvoices,
    selectedPayments,
    selectedAllocations,
    selectedOpeningBalance,
    branchName: getBranchName(customer, selectedBranchId),
    legacyFallbackUsed,
  };
}

export const loadReadOnlyCustomerCreditSnapshot = loadCentralPaymentSnapshot;

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
  if (actor !== "nisstaj_admin") throw new Error("Only nisstaj_admin can post Central Payment transactions.");
  if (!ownerPassword) throw new Error("Owner financial password is required.");
  if (!accountId) throw new Error("Select a customer before saving a transaction.");
  if (paymentAmount <= 0) throw new Error("Amount must be greater than zero.");
  if (type === "DISCOUNT" && !String(notes || "").trim()) throw new Error("A detailed discount reason is compulsory.");

  const idempotencyKey = createPaymentIdempotencyKey({ customerAccountId: accountId, customerBranchId, amount: paymentAmount, paymentDate, paymentMethod: type === "DISCOUNT" ? "Discount" : paymentMethod, externalReference });
  const duplicate = await safeSelect("customer_payments", (query) => query.select("*").eq("customer_account_id", accountId).eq("idempotency_key", idempotencyKey).limit(1));
  if (duplicate.error) throw duplicate.error;
  const activeDuplicate = (duplicate.data || []).find((payment) => !isVoidedPayment(payment));
  if (activeDuplicate) return { duplicate: true, payment: activeDuplicate, allocations: [] };

  const snapshot = await loadCentralPaymentSnapshot({ customerAccountId: accountId, customerName: customer?.account_name, customer, selectedBranchId: customerBranchId || "" });
  const preview = buildPaymentPreview({ invoices: snapshot.invoices, allocations: snapshot.allocations, amount: paymentAmount, branchId: customerBranchId || "" });
  const isPendingBank = type === "PAYMENT" && paymentMethod === "Bank Transfer";

  const { data, error } = await supabase.rpc("post_owner_central_transaction", {
    p_owner_username: "nisstaj_admin",
    p_owner_password: ownerPassword,
    p_customer_account_id: accountId,
    p_customer_branch_id: customerBranchId || null,
    p_transaction_type: type,
    p_payment_date: paymentDate || new Date().toISOString(),
    p_amount: paymentAmount,
    p_payment_method: type === "DISCOUNT" ? "Other" : paymentMethod || "Cash",
    p_paid_by: paidBy || "",
    p_external_reference: String(externalReference || "").trim() || null,
    p_notes: notes || "",
    p_idempotency_key: idempotencyKey,
    p_allocations: isPendingBank ? [] : preview.allocations,
  });
  if (!error) return { ...(data || {}), preview };
  if (isMissingRpcError(error)) throw new Error("Protected Central Payment is not installed. Review and apply the additive owner-security migration first.");
  throw error;
}

export async function confirmOwnerBankTransfer({
  payment,
  customer,
  currentUser,
  ownerPassword,
  note,
} = {}) {
  if (getActor(currentUser).toLowerCase() !== "nisstaj_admin") {
    throw new Error("Only nisstaj_admin can confirm bank transfers.");
  }
  if (!payment?.id) throw new Error("Pending bank transfer is required.");
  if (!ownerPassword) throw new Error("Owner financial password is required.");
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

  const { data, error } = await supabase.rpc("confirm_owner_bank_transfer", {
    p_owner_username: "nisstaj_admin",
    p_owner_password: ownerPassword,
    p_payment_id: payment.id,
    p_note: String(note).trim(),
    p_allocations: preview.allocations,
  });

  if (!error) return { payment: data, preview };
  if (isMissingRpcError(error)) {
    throw new Error(
      "Bank confirmation is not installed. Review and apply the additive owner-security migration first."
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
  archived = false,
  search = "",
  method = "",
  dateFrom = null,
  dateTo = null,
  page = 1,
} = {}) {
  const pageSize = 30;
  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("customer_payments")
    .select("*", { count: "exact" })
    .order("payment_date", { ascending: false })
    .range(from, to);

  query = archived
    ? query.eq("status", "VOIDED")
    : query.eq("status", "POSTED");

  if (method) {
    query = query.eq("payment_method", method);
  }

  if (dateFrom) {
    query = query.gte("payment_date", `${dateFrom}T00:00:00`);
  }

  if (dateTo) {
    query = query.lte("payment_date", `${dateTo}T23:59:59.999`);
  }

  if (String(search || "").trim()) {
    const term = String(search)
      .trim()
      .replace(/[%(),]/g, " ");

    query = query.or(
      `payment_reference.ilike.%${term}%,paid_by.ilike.%${term}%,notes.ilike.%${term}%`
    );
  }

  const {
    data: paymentRows,
    error: paymentError,
    count,
  } = await query;

  if (paymentError) {
    console.error("Payment History query failed:", paymentError);
    throw paymentError;
  }

  const customerIds = [
    ...new Set(
      (paymentRows || [])
        .map((row) => row.customer_account_id)
        .filter(Boolean)
    ),
  ];

  let customerMap = new Map();

  if (customerIds.length) {
    const {
      data: customerRows,
      error: customerError,
    } = await supabase
      .from("customer_accounts")
      .select("id, account_name")
      .in("id", customerIds);

    if (customerError) {
      console.error("Customer name query failed:", customerError);
      throw customerError;
    }

    customerMap = new Map(
      (customerRows || []).map((customer) => [
        String(customer.id),
        customer.account_name,
      ])
    );
  }

  const total = Number(count || 0);

  return {
    records: (paymentRows || []).map((row) => ({
      ...row,
      customer_name:
        customerMap.get(String(row.customer_account_id)) ||
        row.customer_name ||
        "-",
    })),
    total,
    page: safePage,
    page_size: pageSize,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
export async function editCentralPayment({ payment, changes, reason } = {}) {
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

export async function removeCentralPayment({ payment, reason } = {}) {
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

export async function restoreCentralPayment({ payment, reason } = {}) {
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
