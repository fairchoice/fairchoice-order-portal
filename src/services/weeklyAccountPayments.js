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
const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const referenceKey = (value) => upper(value).replace(/[^A-Z0-9]/g, "");
const legacyAmount = (row) =>
  Number(row?.credit ?? row?.amount ?? row?.payment_amount ?? row?.amount_collected ?? 0);

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
  const match = String(payment?.idempotency_key || "").match(
    /^(?:legacy-customer-ledger|collection-ledger):(\d+)$/i
  );
  return match?.[1] || "";
};

export const isActiveLegacyPaymentRow = (row) => {
  const lifecycle = upper(row.payment_status || row.status);
  const verification = upper(row.verification_status);
  if (INACTIVE_MARKERS.has(lifecycle) || INACTIVE_MARKERS.has(verification)) {
    return false;
  }
  if (
    row.deleted_at ||
    row.voided_at ||
    row.reversed_at ||
    row.superseded_at ||
    row.replaced_at
  ) {
    return false;
  }
  if (row.is_deleted === true || row.is_voided === true || row.is_active === false) {
    return false;
  }
  return (
    ["PAYMENT", "COLLECTION"].includes(
      upper(row.entry_type || row.transaction_type)
    ) && legacyAmount(row) > 0
  );
};

const legacyIdentityKeys = (row) =>
  [
    row.central_payment_id && `canonical:${row.central_payment_id}`,
    row.canonical_payment_id && `canonical:${row.canonical_payment_id}`,
    row.replacement_payment_id && `canonical:${row.replacement_payment_id}`,
    row.original_payment_id && `canonical:${row.original_payment_id}`,
    row.id && `ledger:${row.id}`,
  ].filter(Boolean);

const compareLegacyRows = (a, b) => {
  const createdDifference =
    new Date(a.created_at || a.payment_date || 0) -
    new Date(b.created_at || b.payment_date || 0);
  if (createdDifference) return createdDifference;
  return String(a.id || "").localeCompare(String(b.id || ""), undefined, {
    numeric: true,
  });
};

const deduplicateLegacyRows = (rows) => {
  const accepted = [];
  const seenIdentities = new Set();
  const seenFingerprints = new Set();

  for (const row of [...rows].sort(compareLegacyRows)) {
    const identities = legacyIdentityKeys(row);
    const rowFingerprint = fingerprint(row);
    if (
      identities.some((identity) => seenIdentities.has(identity)) ||
      seenFingerprints.has(rowFingerprint)
    ) {
      continue;
    }
    identities.forEach((identity) => seenIdentities.add(identity));
    seenFingerprints.add(rowFingerprint);
    accepted.push(row);
  }

  return accepted;
};

const isMissingCompatibilityView = (error) =>
  ["42P01", "PGRST200", "PGRST205"].includes(String(error?.code || "")) ||
  /v_(?:reportable_)?total_collection_payments.*(?:schema cache|does not exist|not find)/i.test(
    String(error?.message || "")
  );

const legacyViewRowToLedgerRow = (row) => ({
  id: row.source_record_id,
  entry_type: "PAYMENT",
  customer_account_id: row.customer_account_id,
  customer_branch_id: row.customer_branch_id,
  customer_name: row.customer_name,
  credit: Number(row.amount || 0),
  payment_reference: row.order_number,
  reference_no: row.order_number,
  payment_date: row.payment_date,
  created_at: row.created_at,
  payment_method: row.payment_method,
  paid_by: row.who_paid,
  collected_by_name: row.collected_by,
  collection_source: row.collection_type,
  payment_status: row.status,
});

async function loadLegacyCompatibilityPayments(supabase) {
  const compatibilityResult = await supabase
    .from("v_reportable_total_collection_payments")
    .select("*")
    .eq("is_legacy", true)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!compatibilityResult.error) {
    return (compatibilityResult.data || []).map(legacyViewRowToLedgerRow);
  }
  if (!isMissingCompatibilityView(compatibilityResult.error)) {
    throw compatibilityResult.error;
  }

  // Deployment-safe bridge: the migration creates the view, while this direct
  // read keeps test usable during a rolling frontend/database deployment.
  const ledgerResult = await supabase
    .from("customer_ledger")
    .select("*")
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (ledgerResult.error) throw ledgerResult.error;
  return ledgerResult.data || [];
}

const collectionTypeFromSource = (source, role) => {
  const normalizedSource = upper(source);
  const normalizedRole = upper(role);
  if (normalizedSource.includes("DRIVER") || normalizedRole === "DRIVER") return "Driver";
  if (normalizedSource.includes("SALES_REP") || normalizedRole.includes("SALES REP")) {
    return "Sales Rep Collection";
  }
  return "Office";
};

const invoiceReferenceCandidates = (invoice = {}) =>
  [
    invoice.id,
    invoice.invoice_number,
    invoice.reference_no,
    invoice.order_number,
    invoice.order_id,
  ]
    .map(referenceKey)
    .filter(Boolean);

const buildInvoiceLookup = (invoices = []) => {
  const lookup = new Map();
  for (const invoice of invoices) {
    for (const reference of invoiceReferenceCandidates(invoice)) {
      if (!lookup.has(reference)) lookup.set(reference, invoice);
    }
  }
  return lookup;
};

export function reconcileCanonicalWeeklyPayments({
  canonicalPayments = [],
  allocations = [],
  invoices = [],
} = {}) {
  const activeAllocations = allocations.filter(
    (row) => !["REVERSED", "VOID", "VOIDED", "INACTIVE"].includes(upper(row.status))
  );
  const allocationsByPayment = new Map();
  for (const allocation of activeAllocations) {
    const key = String(allocation.payment_id || "");
    if (!key) continue;
    const rows = allocationsByPayment.get(key) || [];
    rows.push(allocation);
    allocationsByPayment.set(key, rows);
  }

  const invoiceLookup = buildInvoiceLookup(invoices);
  const invoicePaidToDate = new Map();
  const chronologicalPayments = [...canonicalPayments].sort((a, b) => {
    const timeDifference =
      new Date(getWeeklyPaymentDate(a) || 0) - new Date(getWeeklyPaymentDate(b) || 0);
    if (timeDifference) return timeDifference;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
  const reconciledByPayment = new Map();

  for (const payment of chronologicalPayments) {
    const paymentAllocations = allocationsByPayment.get(String(payment.id)) || [];
    const rows = [];
    let allocatedTotal = 0;

    for (const allocation of paymentAllocations) {
      const invoice =
        invoiceLookup.get(referenceKey(allocation.invoice_source_id)) ||
        invoiceLookup.get(referenceKey(allocation.invoice_reference)) ||
        null;
      const invoiceReference =
        invoice?.invoice_number ||
        invoice?.reference_no ||
        invoice?.order_number ||
        allocation.invoice_reference ||
        payment.payment_reference ||
        "Not available";
      const invoiceKey =
        referenceKey(invoice?.id || invoiceReference) || String(allocation.id || "");
      const invoiceTotal = Number(
        invoice?.invoice_total ??
          invoice?.invoice_amount ??
          invoice?.order_total ??
          invoice?.amount ??
          0
      );
      const allocatedAmount = money(allocation.allocated_amount);
      const paidToDate = money(
        (invoicePaidToDate.get(invoiceKey) || 0) + allocatedAmount
      );
      invoicePaidToDate.set(invoiceKey, paidToDate);
      allocatedTotal = money(allocatedTotal + allocatedAmount);

      rows.push({
        ...payment,
        id: `canonical:${payment.id}:allocation:${allocation.id || invoiceReference}`,
        canonical_payment_id: payment.id,
        allocation_id: allocation.id || null,
        invoice_no: invoiceReference,
        order_number: invoice?.order_number || invoiceReference,
        invoice_total: invoiceTotal,
        payment_amount: allocatedAmount,
        running_balance: Math.max(0, money(invoiceTotal - paidToDate)),
        invoice,
      });
    }

    const unallocatedAmount = money(Number(payment.amount || 0) - allocatedTotal);
    if (rows.length === 0 || unallocatedAmount > 0) {
      rows.push({
        ...payment,
        id: `canonical:${payment.id}${
          rows.length ? ":unallocated" : ""
        }`,
        canonical_payment_id: payment.id,
        invoice_no: rows.length
          ? "Unallocated credit"
          : payment.payment_reference || "Not available",
        order_number: rows.length
          ? "Unallocated credit"
          : payment.payment_reference || "Not available",
        invoice_total: 0,
        payment_amount: rows.length ? unallocatedAmount : Number(payment.amount || 0),
        running_balance: 0,
      });
    }

    reconciledByPayment.set(String(payment.id), rows);
  }

  return canonicalPayments.flatMap(
    (payment) => reconciledByPayment.get(String(payment.id)) || []
  );
}

export function mergeWeeklyAccountPaymentRows({
  canonicalPayments = [],
  allocations = [],
  invoices = [],
  legacyPayments = [],
  orderPayments = [],
  accountNames = new Map(),
  branchNames = new Map(),
  testAccountIds = new Set(),
  includeTestAccounts = false,
} = {}) {
  const isReportableAccount = (row) =>
    includeTestAccounts ||
    !testAccountIds.has(String(row.customer_account_id || row.customerAccountId || ""));
  const activeCanonical = canonicalPayments.filter(isReportableAccount).filter(
    (row) =>
      ACTIVE_PAYMENT_STATUSES.has(upper(row.status)) &&
      ACTIVE_VERIFICATION_STATUSES.has(upper(row.verification_status))
  );
  const canonicalFingerprints = new Set(activeCanonical.map(fingerprint));
  const canonicalIds = new Set(activeCanonical.map((row) => String(row.id)));
  const migratedLegacyIds = new Set(
    activeCanonical.map(importedLegacyId).filter(Boolean)
  );

  const canonicalRows = reconcileCanonicalWeeklyPayments({
    canonicalPayments: activeCanonical,
    allocations,
    invoices,
  }).map((row) => {
    const branchId = row.customer_branch_id || row.branch_id || null;
    const collectionType = collectionTypeFromSource(
      row.source,
      row.collector_role
    );
    return {
      ...row,
      canonical_payment_key: `customer_payments:${row.canonical_payment_id || row.id}`,
      payment_id: row.canonical_payment_id || row.id,
      source_table: "customer_payments",
      source_record_id: row.canonical_payment_id || row.id,
      is_legacy: false,
      customer_name: branchId
        ? branchNames.get(String(branchId)) ||
          accountNames.get(String(row.customer_account_id)) ||
          "Not available"
        : accountNames.get(String(row.customer_account_id)) || "Not available",
      payment_type: row.payment_method || "",
      collected_by:
        row.collector_name ||
        row.metadata?.collector_name ||
        row.metadata?.driver_name ||
        row.metadata?.sales_rep_name ||
        row.metadata?.fc_username ||
        row.created_by ||
        "",
      sales_rep_name:
        collectionType === "Sales Rep Collection"
          ? row.collector_name || row.metadata?.collector_name || row.metadata?.sales_rep_name || row.metadata?.fc_username || row.created_by || ""
          : "",
      driver_name:
        collectionType === "Driver"
          ? row.collector_name || row.metadata?.collector_name || row.metadata?.driver_name || row.metadata?.fc_username || row.created_by || ""
          : "",
      who_paid: row.paid_by || "",
      collector_staff_id: row.collector_staff_id || null,
      collection_type: collectionType,
      created_at: getWeeklyPaymentDate(row),
      source_kind: "canonical",
      read_only: true,
    };
  });

  const eligibleLegacyRows = deduplicateLegacyRows(
    legacyPayments
      .filter(isReportableAccount)
      .filter(isActiveLegacyPaymentRow)
      .filter(
        (row) =>
          !legacyIdentityKeys(row).some(
            (identity) =>
              identity.startsWith("canonical:") &&
              canonicalIds.has(identity.slice("canonical:".length))
          )
      )
      .filter((row) => !migratedLegacyIds.has(String(row.id)))
      .filter((row) => !canonicalFingerprints.has(fingerprint(row)))
  );

  const legacyRows = eligibleLegacyRows
    .map((row) => {
      const collectionType = collectionTypeFromSource(
        row.collection_source || row.source,
        row.collected_by_role
      );
      return {
        ...row,
        id: `ledger:${row.id}`,
        canonical_payment_key: `customer_ledger:${row.id}`,
        payment_id: null,
        source_table: "customer_ledger",
        source_record_id: row.id,
        is_legacy: true,
        legacy_ledger_id: row.id,
        customer_name: row.branch_name || row.customer_name || "Not available",
        invoice_no:
          row.payment_reference || row.reference_no || "Not available",
        order_number:
          row.payment_reference || row.reference_no || "Not available",
        invoice_total: 0,
        amount: legacyAmount(row),
        payment_amount: legacyAmount(row),
        payment_type: row.payment_type || row.payment_method || "",
        collected_by:
          row.collected_by_name || row.paid_by || row.received_by || "",
        sales_rep_name:
          collectionType === "Sales Rep Collection"
            ? row.collected_by_name || row.paid_by || ""
            : "",
        driver_name:
          collectionType === "Driver"
            ? row.collected_by_name || row.paid_by || ""
            : "",
        collection_type: collectionType,
        created_at: getWeeklyPaymentDate(row),
        source_kind: "legacy",
        read_only: true,
      };
    });

  const seen = new Set([
    ...canonicalFingerprints,
    ...eligibleLegacyRows.map(fingerprint),
  ]);
  const unmatchedOrderRows = orderPayments
    .filter(isReportableAccount)
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
      canonical_payment_key: `orders:${row.id}`,
      payment_id: null,
      source_table: "orders",
      source_record_id: row.id,
      is_legacy: true,
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
      read_only: true,
    }));

  return [...canonicalRows, ...legacyRows, ...unmatchedOrderRows].sort(
    (a, b) => {
      const paymentDifference =
        new Date(getWeeklyPaymentDate(b) || 0) -
        new Date(getWeeklyPaymentDate(a) || 0);
      if (paymentDifference) return paymentDifference;
      const createdDifference =
        new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (createdDifference) return createdDifference;
      return String(b.canonical_payment_key || b.id || "").localeCompare(
        String(a.canonical_payment_key || a.id || ""),
        undefined,
        { numeric: true }
      );
    }
  );
}

export async function loadWeeklyAccountPayments(
  supabase,
  { loadInvoices, includeTestAccounts = false } = {}
) {
  const canonicalResult = await supabase
    .from("customer_payments")
    .select(
      "id,customer_account_id,customer_branch_id,branch_id,amount,payment_date,created_at,status,verification_status,source,idempotency_key,payment_reference,payment_method,paid_by,created_by,collector_staff_id,collector_name,collector_role,metadata"
    )
    .in("status", ["POSTED", "ACTIVE"])
    .in("verification_status", ["CONFIRMED", "NOT_REQUIRED"])
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (canonicalResult.error) throw canonicalResult.error;

  const canonicalPayments = canonicalResult.data || [];
  const legacyPayments = await loadLegacyCompatibilityPayments(supabase);
  const paymentIds = canonicalPayments.map((row) => row.id).filter(Boolean);

  const accountIds = [
    ...new Set(
      [...canonicalPayments, ...legacyPayments]
        .map((row) => row.customer_account_id)
        .filter(Boolean)
    ),
  ];

  const branchIds = [
    ...new Set(
      [...canonicalPayments, ...legacyPayments]
        .map((row) => row.customer_branch_id || row.branch_id)
        .filter(Boolean)
    ),
  ];

  const [accountsResult, branchesResult, allocationsResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from("customer_accounts")
          .select("*")
          .in("id", accountIds)
      : Promise.resolve({ data: [], error: null }),

    branchIds.length
      ? supabase
          .from("customer_branches")
          .select("id,branch_name")
          .in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),

    paymentIds.length
      ? supabase
          .from("customer_payment_allocations")
          .select(
            "id,payment_id,customer_account_id,customer_branch_id,invoice_reference,invoice_source_id,allocated_amount,status,allocated_at,created_at"
          )
          .in("payment_id", paymentIds)
          .in("status", ["active", "ACTIVE"])
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (allocationsResult.error) throw allocationsResult.error;

  const accountNames = new Map(
    (accountsResult.error ? [] : accountsResult.data || []).map((row) => [
      String(row.id),
      row.account_name,
    ])
  );

  const branchNames = new Map(
    (branchesResult.error ? [] : branchesResult.data || []).map((row) => [
      String(row.id),
      row.branch_name,
    ])
  );
  const testAccountIds = new Set(
    (accountsResult.error ? [] : accountsResult.data || [])
      .filter((row) => row.is_test_account === true)
      .map((row) => String(row.id))
  );

  const invoices = (
    await Promise.all(
      accountIds.map((customerAccountId) =>
        loadInvoices
          ? loadInvoices({
              customerAccountId,
              customerName: accountNames.get(String(customerAccountId)) || "",
            })
          : Promise.resolve([])
      )
    )
  ).flat();

  return mergeWeeklyAccountPaymentRows({
    canonicalPayments,
    allocations: allocationsResult.data || [],
    invoices,
    legacyPayments,
    orderPayments: [],
    accountNames,
    branchNames,
    testAccountIds,
    includeTestAccounts,
  });
}
