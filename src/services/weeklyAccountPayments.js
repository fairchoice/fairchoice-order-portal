const ACTIVE_PAYMENT_STATUSES = new Set(["POSTED", "ACTIVE"]);
const ACTIVE_VERIFICATION_STATUSES = new Set(["CONFIRMED", "NOT_REQUIRED"]);
const INACTIVE_MARKERS = new Set([
  "PENDING",
  "PENDING_VERIFICATION",
  "REJECTED",
  "VOIDED",
  "REVERSED",
  "ARCHIVED",
]);

const upper = (value) => String(value || "").trim().toUpperCase();
const moneyKey = (value) => Number(value || 0).toFixed(2);

export function getWeeklyPaymentDate(row) {
  return row?.payment_date || row?.collection_date || row?.created_at || null;
}

const dateKey = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

export function getWeeklyPaymentDateKey(row) {
  return dateKey(getWeeklyPaymentDate(row));
}

const fingerprint = (row) =>
  [
    row.customer_account_id || "",
    row.customer_branch_id || row.branch_id || "MAIN",
    moneyKey(row.amount ?? row.credit ?? row.payment_amount),
    upper(row.payment_reference || row.reference_no || row.order_number),
    getWeeklyPaymentDateKey(row),
  ].join("|");

const importedLegacyId = (payment) => {
  const match = String(payment?.idempotency_key || "").match(/^legacy-customer-ledger:(\d+)$/i);
  return match?.[1] || "";
};

const isActiveLegacyRow = (row) => {
  const lifecycle = upper(row.payment_status || row.status);
  const verification = upper(row.verification_status);
  if (INACTIVE_MARKERS.has(lifecycle) || INACTIVE_MARKERS.has(verification)) return false;
  return upper(row.entry_type || row.transaction_type) === "PAYMENT";
};

const collectionTypeFromSource = (source, role) => {
  const normalizedSource = upper(source);
  const normalizedRole = upper(role);
  if (normalizedSource.includes("DRIVER") || normalizedRole === "DRIVER") return "Driver";
  if (normalizedSource.includes("SALES_REP") || normalizedRole.includes("SALES REP")) {
    return "Sales Rep Collection";
  }
  return "Office";
};

export function mergeWeeklyAccountPaymentRows({
  canonicalPayments = [],
  legacyPayments = [],
  orderPayments = [],
  accountNames = new Map(),
  branchNames = new Map(),
} = {}) {
  const activeCanonical = canonicalPayments.filter(
    (row) =>
      ACTIVE_PAYMENT_STATUSES.has(upper(row.status)) &&
      ACTIVE_VERIFICATION_STATUSES.has(upper(row.verification_status))
  );
  const canonicalFingerprints = new Set(activeCanonical.map(fingerprint));
  const migratedLegacyIds = new Set(activeCanonical.map(importedLegacyId).filter(Boolean));

  const canonicalRows = activeCanonical.map((row) => {
    const branchId = row.customer_branch_id || row.branch_id || null;
    const collectionType = collectionTypeFromSource(row.source, row.collector_role);
    return {
      ...row,
      id: `canonical:${row.id}`,
      canonical_payment_id: row.id,
      customer_name: branchId
        ? branchNames.get(String(branchId)) || accountNames.get(String(row.customer_account_id)) || "Not available"
        : accountNames.get(String(row.customer_account_id)) || "Not available",
      invoice_no: row.payment_reference || "Not available",
      order_number: row.payment_reference || "Not available",
      invoice_total: 0,
      payment_amount: Number(row.amount || 0),
      payment_type: row.payment_method || "",
      collected_by: row.paid_by || row.created_by || "",
      sales_rep_name: collectionType === "Sales Rep Collection" ? row.paid_by || row.created_by || "" : "",
      driver_name: collectionType === "Driver" ? row.paid_by || row.created_by || "" : "",
      collection_type: collectionType,
      created_at: getWeeklyPaymentDate(row),
      source_kind: "canonical",
      read_only: true,
    };
  });

  const legacyRows = legacyPayments
    .filter(isActiveLegacyRow)
    .filter((row) => !migratedLegacyIds.has(String(row.id)))
    .filter((row) => !canonicalFingerprints.has(fingerprint(row)))
    .map((row) => {
      const collectionType = collectionTypeFromSource(row.collection_source || row.source, row.collected_by_role);
      return {
        ...row,
        id: `ledger:${row.id}`,
        legacy_ledger_id: row.id,
        customer_name: row.branch_name || row.customer_name || "Not available",
        invoice_no: row.payment_reference || row.reference_no || "Not available",
        order_number: row.payment_reference || row.reference_no || "Not available",
        invoice_total: 0,
        amount: Number(row.credit ?? row.amount ?? row.payment_amount ?? 0),
        payment_amount: Number(row.credit ?? row.amount ?? row.payment_amount ?? 0),
        payment_type: row.payment_type || "",
        collected_by: row.collected_by_name || row.paid_by || row.received_by || "",
        sales_rep_name: collectionType === "Sales Rep Collection" ? row.collected_by_name || row.paid_by || "" : "",
        driver_name: collectionType === "Driver" ? row.collected_by_name || row.paid_by || "" : "",
        collection_type: collectionType,
        created_at: getWeeklyPaymentDate(row),
        source_kind: "legacy",
      };
    });

  const seen = new Set([...canonicalFingerprints, ...legacyPayments.filter(isActiveLegacyRow).map(fingerprint)]);
  const unmatchedOrderRows = orderPayments
    .filter((row) => Number(row.payment_amount || 0) > 0)
    .filter((row) => {
      const key = fingerprint(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((row) => ({
      ...row,
      id: `order:${row.id}`,
      order_id: row.id,
      customer_name: row.company_name || "Not available",
      invoice_no: row.order_number || "Not available",
      invoice_total: Number(row.final_total || row.order_total || 0),
      amount: Number(row.payment_amount || 0),
      payment_amount: Number(row.payment_amount || 0),
      payment_type: row.payment_type || "",
      collected_by: row.driver_name || row.received_by || "",
      driver_name: row.driver_name || "",
      collection_type: row.driver_name ? "Driver" : "Office",
      created_at: getWeeklyPaymentDate(row),
      source_kind: "order",
    }));

  return [...canonicalRows, ...legacyRows, ...unmatchedOrderRows].sort((a, b) => {
    const paymentDifference = new Date(getWeeklyPaymentDate(b) || 0) - new Date(getWeeklyPaymentDate(a) || 0);
    if (paymentDifference) return paymentDifference;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

export async function loadWeeklyAccountPayments(supabase) {
  const [canonicalResult, legacyResult, ordersResult] = await Promise.all([
    supabase
      .from("customer_payments")
      .select("id,customer_account_id,customer_branch_id,branch_id,amount,payment_date,created_at,status,verification_status,source,idempotency_key,payment_reference,payment_method,paid_by,created_by,collector_role")
      .in("status", ["POSTED", "ACTIVE"])
      .in("verification_status", ["CONFIRMED", "NOT_REQUIRED"])
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("customer_ledger")
      .select("*")
      .eq("entry_type", "PAYMENT")
      .order("created_at", { ascending: false }),
    supabase
      .from("orders")
      .select("*")
      .eq("payment_collected", "Yes")
      .gt("payment_amount", 0)
      .order("created_at", { ascending: false }),
  ]);

  if (canonicalResult.error) throw canonicalResult.error;
  if (legacyResult.error) throw legacyResult.error;
  if (ordersResult.error) throw ordersResult.error;

  const accountIds = [...new Set((canonicalResult.data || []).map((row) => row.customer_account_id).filter(Boolean))];
  const branchIds = [...new Set((canonicalResult.data || []).map((row) => row.customer_branch_id || row.branch_id).filter(Boolean))];
  const [accountsResult, branchesResult] = await Promise.all([
    accountIds.length
      ? supabase.from("customer_accounts").select("id,account_name").in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from("customer_branches").select("id,branch_name").in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const accountNames = new Map((accountsResult.error ? [] : accountsResult.data || []).map((row) => [String(row.id), row.account_name]));
  const branchNames = new Map((branchesResult.error ? [] : branchesResult.data || []).map((row) => [String(row.id), row.branch_name]));

  return mergeWeeklyAccountPaymentRows({
    canonicalPayments: canonicalResult.data || [],
    legacyPayments: legacyResult.data || [],
    orderPayments: ordersResult.data || [],
    accountNames,
    branchNames,
  });
}
