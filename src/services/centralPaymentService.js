import { supabase } from "./supabase";
import {
  allocatePaymentOldestFirst,
  applyAllocationsToInvoices,
  buildCustomerTransactionHistory,
  createPaymentIdempotencyKey,
  filterInvoicesForAllocation,
  getBranchKey,
  money,
  resolveLegacyCompatibilityRows,
  summarizeCreditSnapshot,
} from "../utils/centralPaymentCalculations";

const deliveredStatuses = ["delivered", "confirmed", "delivery confirmed", "completed"];

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

const centralPaymentUnavailableMessage =
  "Central Payment service is unavailable. Apply the required database migrations before recording payments.";
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

  const { data: centralInvoices, error: invoiceError } = await safeSelect(
    "customer_invoices",
    (query) => {
      let next = query.select("*").neq("status", "CANCELLED").order("invoice_date", { ascending: true });
      if (customerAccountId) next = next.eq("customer_account_id", customerAccountId);
      return next;
    }
  );
  if (invoiceError) throw invoiceError;
  if (centralInvoices?.length) return centralInvoices;

  const { data: orders, error: ordersError } = await safeSelect("orders", (query) => {
    let next = query.select("*, order_items(*)").order("created_at", { ascending: true }).limit(500);
    if (customerAccountId && customerName) {
      next = next.or(`customer_account_id.eq.${customerAccountId},company_name.eq.${customerName}`);
    } else if (customerAccountId) {
      next = next.eq("customer_account_id", customerAccountId);
    } else if (customerName) {
      next = next.eq("company_name", customerName);
    }
    return next;
  });
  if (ordersError) throw ordersError;

  return (orders || [])
    .filter((order) => deliveredStatuses.includes(String(order.status || "").trim().toLowerCase()))
    .map((order) => ({
      id: order.id,
      customer_account_id: order.customer_account_id || customerAccountId,
      customer_branch_id: order.customer_branch_id || order.branch_id || null,
      branch_name: order.delivery_branch_name || order.branch_name || order.shop_name || "",
      invoice_number: order.invoice_number || order.order_number || order.id,
      order_id: order.id,
      invoice_date: order.delivered_at || order.delivery_confirmed_at || order.updated_at || order.created_at,
      invoice_total: Number(order.final_total || order.total_amount || order.order_total || order.total || 0),
      status: "ISSUED",
      source: "orders",
    }));
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
  return data || [];
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

async function loadLegacyLedgerFallback({ customerAccountId, customerName } = {}) {
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

  return {
    invoices: ledgerRows
      .filter((row) => String(row.entry_type || row.transaction_type || "").toUpperCase() === "INVOICE")
      .map((row) => ({
        ...row,
        id: `legacy-${row.id}`,
        invoice_number: row.reference_no || row.order_number || row.id,
        invoice_date: row.created_at,
        invoice_total: Number(row.debit || row.amount || row.invoice_amount || 0),
        source: "legacy_customer_ledger",
      })),
    payments: ledgerRows
      .filter((row) => String(row.entry_type || row.transaction_type || "").toUpperCase() === "PAYMENT")
      .map((row) => ({
        ...row,
        id: `legacy-${row.id}`,
        payment_reference: row.payment_reference || row.reference_no || row.id,
        payment_date: row.payment_date || row.created_at,
        amount: Number(row.credit || row.amount || 0),
        payment_method: row.payment_method || row.payment_type || "Other",
        status: row.payment_status || "POSTED",
        source: "legacy_customer_ledger",
      })),
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

  const legacy = await loadLegacyLedgerFallback({ customerAccountId, customerName });
  const compatibilityRows = resolveLegacyCompatibilityRows({
    invoices,
    payments,
    legacyInvoices: legacy.invoices,
    legacyPayments: legacy.payments,
  });
  invoices = compatibilityRows.invoices;
  payments = compatibilityRows.payments;
  const legacyFallbackUsed = compatibilityRows.legacyFallbackUsed;

  const allocatedInvoices = applyAllocationsToInvoices(invoices, allocations);
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
  const selectedInvoices = filterInvoicesForAllocation(allocatedInvoices, selectedBranchId);
  const selectedPayments = selectedBranchId
    ? payments.filter((payment) => getBranchKey(payment.customer_branch_id) === getBranchKey(selectedBranchId))
    : payments;

  return {
    openingBalances,
    invoices,
    payments,
    allocations,
    allocatedInvoices,
    transactionHistory: buildCustomerTransactionHistory({
      openingBalance,
      invoices: allocatedInvoices,
      payments,
      newestFirst: true,
    }),
    customerSummary: summarizeCreditSnapshot({
      creditLimit: customer?.credit_limit,
      openingBalance,
      invoices: allocatedInvoices,
      payments,
    }),
    branchSummary: summarizeCreditSnapshot({
      creditLimit: customer?.credit_limit,
      openingBalance: selectedOpeningBalance,
      invoices: selectedInvoices,
      payments: selectedPayments,
    }),
    selectedInvoices,
    selectedPayments,
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
  if (duplicate.data?.length) return { duplicate: true, payment: duplicate.data[0], allocations: [] };

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
  ownerPassword,
  note,
} = {}) {
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
