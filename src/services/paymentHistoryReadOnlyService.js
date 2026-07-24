import { supabase } from "./supabase.js";

export const PAYMENT_HISTORY_PAGE_SIZE = 20;

export const PAYMENT_METHOD_OPTIONS = [
  "Bank Transfer",
  "Cash",
  "Card",
  "Cheque",
  "Other",
];

export const PAYMENT_SOURCE_OPTIONS = [
  "CENTRAL_PAYMENT",
  "DRIVER_COLLECTION",
  "SALES_REP_COLLECTION",
  "CUSTOMER_ORDER_COLLECTION",
  "PREVIOUS_BALANCE_COLLECTION",
  "BANK_TRANSFER",
  "LEGACY_CUSTOMER_LEDGER",
];

const REQUIRED_PAYMENT_COLUMNS = [
  "id",
  "customer_account_id",
  "payment_reference",
  "payment_date",
  "amount",
  "payment_method",
  "status",
  "created_at",
];

const OPTIONAL_PAYMENT_COLUMNS = [
  "customer_branch_id",
  "branch_id",
  "paid_by",
  "source",
  "verification_status",
  "transaction_type",
  "collector_role",
  "created_by",
];

let deployedPaymentColumnsPromise;

const SORTS = {
  payment_newest: { column: "payment_date", ascending: false },
  payment_oldest: { column: "payment_date", ascending: true },
  created_newest: { column: "created_at", ascending: false },
  created_oldest: { column: "created_at", ascending: true },
  amount_highest: { column: "amount", ascending: false },
  amount_lowest: { column: "amount", ascending: true },
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const cleanSearchTerm = (value) =>
  String(value || "")
    .trim()
    .replace(/[%(),]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);

const isPermissionError = (error) =>
  ["401", "403", "42501", "PGRST301"].includes(String(error?.code || error?.status || "")) ||
  /permission|not authorized|not authorised|row-level security/i.test(String(error?.message || ""));

export function getPaymentHistoryErrorMessage(error) {
  if (isPermissionError(error)) {
    return "Payment History could not be loaded because your account does not have permission to read canonical payments.";
  }
  return "Payment History could not be loaded. Please retry or contact an administrator if the problem continues.";
}

function reportReadError(context, error) {
  if (import.meta.env?.DEV) {
    console.error(`[PaymentHistory] ${context}`, {
      message: error?.message || String(error),
      code: error?.code || null,
      details: error?.details || null,
      hint: error?.hint || null,
    });
  }
}

async function getDeployedPaymentColumns() {
  if (!deployedPaymentColumnsPromise) {
    deployedPaymentColumnsPromise = supabase
      .from("customer_payments")
      .select("*")
      .limit(1)
      .then(({ data, error }) => {
        if (error) {
          reportReadError("deployed-column inspection failed", error);
          throw error;
        }
        const discovered = new Set(Object.keys(data?.[0] || {}));
        return discovered.size ? discovered : new Set(REQUIRED_PAYMENT_COLUMNS);
      });
  }
  return deployedPaymentColumnsPromise;
}

export function classifyPaymentRecord(payment) {
  const status = String(payment?.status || "").toUpperCase();
  const verification = String(payment?.verification_status || "").toUpperCase();
  const method = String(payment?.payment_method || "").toUpperCase();

  if (status === "VOIDED") return "voided";
  if (method === "BANK TRANSFER" && verification === "PENDING_VERIFICATION") {
    return "pending";
  }
  if (status === "POSTED" || status === "ACTIVE") return "active";
  return "other";
}

export function assertUniquePaymentIds(payments = []) {
  const ids = payments.map((payment) => String(payment?.id || ""));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("The Payment History response contained a missing or duplicate payment ID.");
  }
  return payments;
}

async function findMatchingCustomerIds(search) {
  if (!search) return [];

  const { data, error } = await supabase
    .from("customer_accounts")
    .select("id")
    .ilike("account_name", `%${search}%`)
    .limit(200);

  if (error) {
    reportReadError("customer-name search lookup failed", error);
    return [];
  }
  return (data || []).map((row) => row.id).filter(Boolean);
}

async function loadPageLookups(payments) {
  const accountIds = [...new Set(payments.map((row) => row.customer_account_id).filter(Boolean))];
  const branchIds = [
    ...new Set(
      payments
        .map((row) => row.customer_branch_id || row.branch_id)
        .filter(Boolean)
    ),
  ];

  const [accountsResult, branchesResult] = await Promise.all([
    accountIds.length
      ? supabase.from("customer_accounts").select("id,account_name").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from("customer_branches").select("id,branch_name").in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const accountNames = new Map(
    (accountsResult.error ? [] : accountsResult.data || []).map((row) => [String(row.id), row.account_name])
  );
  const branchNames = new Map(
    (branchesResult.error ? [] : branchesResult.data || []).map((row) => [String(row.id), row.branch_name])
  );

  if (accountsResult.error) reportReadError("account-name lookup failed", accountsResult.error);
  if (branchesResult.error) reportReadError("branch-name lookup failed", branchesResult.error);

  return { accountNames, branchNames };
}

export async function listReadOnlyPaymentHistory({
  page = 1,
  search = "",
  dateFrom = "",
  dateTo = "",
  status = "",
  verificationStatus = "",
  method = "",
  source = "",
  branchId = "",
  sort = "payment_newest",
} = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const safePage = Math.max(1, Number(page) || 1);
  const from = (safePage - 1) * PAYMENT_HISTORY_PAGE_SIZE;
  const to = from + PAYMENT_HISTORY_PAGE_SIZE - 1;
  const safeSearch = cleanSearchTerm(search);
  const deployedColumns = await getDeployedPaymentColumns();
  const paymentColumns = [
    ...REQUIRED_PAYMENT_COLUMNS,
    ...OPTIONAL_PAYMENT_COLUMNS.filter((column) => deployedColumns.has(column)),
  ];
  const matchingCustomerIds = await findMatchingCustomerIds(safeSearch);
  const selectedSort = SORTS[sort] || SORTS.payment_newest;

  let query = supabase
    .from("customer_payments")
    .select(paymentColumns.join(","), { count: "exact" });

  if (safeSearch) {
    const clauses = [`payment_reference.ilike.%${safeSearch}%`];
    if (UUID_PATTERN.test(safeSearch)) clauses.push(`id.eq.${safeSearch}`);
    if (matchingCustomerIds.length) {
      clauses.push(`customer_account_id.in.(${matchingCustomerIds.join(",")})`);
    }
    query = query.or(clauses.join(","));
  }
  if (dateFrom) query = query.gte("payment_date", `${dateFrom}T00:00:00`);
  if (dateTo) query = query.lte("payment_date", `${dateTo}T23:59:59.999`);
  if (status) query = query.eq("status", status);
  if (verificationStatus && deployedColumns.has("verification_status")) {
    query = query.eq("verification_status", verificationStatus);
  }
  if (method) query = query.eq("payment_method", method);
  if (source && deployedColumns.has("source")) query = query.eq("source", source);
  const branchColumns = ["customer_branch_id", "branch_id"].filter((column) =>
    deployedColumns.has(column)
  );
  if (branchId === "MAIN") {
    branchColumns.forEach((column) => {
      query = query.is(column, null);
    });
  } else if (branchId && branchColumns.length) {
    query = query.or(branchColumns.map((column) => `${column}.eq.${branchId}`).join(","));
  }

  query = query.order(selectedSort.column, { ascending: selectedSort.ascending });
  if (selectedSort.column !== "created_at") {
    query = query.order("created_at", { ascending: false });
  }
  query = query.order("id", { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) {
    reportReadError("customer_payments page query failed", error);
    const readableError = new Error(getPaymentHistoryErrorMessage(error));
    readableError.cause = error;
    readableError.technicalMessage = [error.code, error.message, error.details, error.hint]
      .filter(Boolean)
      .join(" — ");
    throw readableError;
  }

  const payments = assertUniquePaymentIds(data || []);
  const { accountNames, branchNames } = await loadPageLookups(payments);
  const total = Number(count || 0);

  return {
    records: payments.map((payment) => {
      const resolvedBranchId = payment.customer_branch_id || payment.branch_id;
      return {
        ...payment,
        customer_name:
          accountNames.get(String(payment.customer_account_id)) || "Not available",
        branch_name: resolvedBranchId
          ? branchNames.get(String(resolvedBranchId)) || "Not available"
          : "Main account",
        display_state: classifyPaymentRecord(payment),
      };
    }),
    total,
    page: safePage,
    pageSize: PAYMENT_HISTORY_PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAYMENT_HISTORY_PAGE_SIZE)),
  };
}

export async function listReadOnlyPaymentBranches() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("customer_branches")
    .select("id,branch_name,customer_account_id")
    .order("branch_name", { ascending: true });
  if (error) {
    reportReadError("branch-filter lookup failed", error);
    return [];
  }
  return data || [];
}
