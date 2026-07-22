export const money = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const normalizeDateValue = (value) => {
  const date = value ? new Date(value) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};

export const getInvoiceReference = (invoice = {}) =>
  String(
    invoice.invoice_number ||
      invoice.reference_no ||
      invoice.order_number ||
      invoice.orderId ||
      invoice.order_id ||
      invoice.id ||
      ""
  ).trim();

export const getInvoiceAmount = (invoice = {}) =>
  money(
    invoice.invoice_total ??
      invoice.invoice_amount ??
      invoice.total_amount ??
      invoice.order_total ??
      invoice.final_total ??
      invoice.amount ??
      invoice.debit ??
      0
  );

export const getInvoiceDate = (invoice = {}) =>
  invoice.invoice_date ||
  invoice.delivered_at ||
  invoice.delivery_confirmed_at ||
  invoice.created_at ||
  new Date(0).toISOString();

export const isCancelledInvoice = (invoice = {}) =>
  ["CANCELLED", "CANCELED", "VOIDED", "DELETED", "REMOVED"].includes(
    String(invoice.status || invoice.invoice_status || invoice.paymentStatus || "")
      .trim()
      .toUpperCase()
  );

export const isVoidedPayment = (payment = {}) =>
  ["VOIDED", "VOID", "DELETED", "REVERSED", "CANCELLED", "CANCELED"].includes(
    String(payment.status || payment.payment_status || "").trim().toUpperCase()
  );

export function getBranchKey(value) {
  return value === null || value === undefined || value === "" ? "MAIN" : String(value);
}

export const normalizeBranchName = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const buildBranchResolution = (branches = []) => {
  const branchIds = new Set();
  const idsByName = new Map();

  (branches || []).forEach((branch) => {
    const id = String(branch.id || "").trim();
    if (!id) return;

    branchIds.add(id);
    const name = normalizeBranchName(branch.branch_name || branch.name);
    if (name) idsByName.set(name, [...(idsByName.get(name) || []), id]);
  });

  return { branchIds, idsByName };
};

export const resolveRowBranchId = (row = {}, branchResolution = buildBranchResolution()) => {
  const directId = String(
    row.customer_branch_id ||
      row.customerBranchId ||
      row.branch_id ||
      row.branchId ||
      row.delivery_branch_id ||
      row.deliveryBranchId ||
      ""
  ).trim();

  if (directId && (!branchResolution.branchIds.size || branchResolution.branchIds.has(directId))) {
    return { branchId: directId, matched: true, ambiguous: false };
  }

  const normalizedName = normalizeBranchName(
    row.branch_name ||
      row.branchName ||
      row.delivery_branch_name ||
      row.customer_branch_name ||
      row.shop_name
  );

  if (!normalizedName) {
    return { branchId: null, matched: false, ambiguous: false };
  }

  const matches = branchResolution.idsByName.get(normalizedName) || [];
  if (matches.length === 1) {
    return { branchId: matches[0], matched: true, ambiguous: false };
  }

  return { branchId: null, matched: false, ambiguous: matches.length > 1 };
};

export const withResolvedBranchScope = (rows = [], branches = []) => {
  const branchResolution = buildBranchResolution(branches);

  return (rows || []).map((row) => {
    const resolved = resolveRowBranchId(row, branchResolution);
    return {
      ...row,
      customer_branch_id: resolved.branchId || row.customer_branch_id || null,
      _branchMatched: resolved.matched,
      _branchAmbiguous: resolved.ambiguous,
    };
  });
};

export const filterRowsForBranchScope = (rows = [], selectedBranchId = "") => {
  if (!selectedBranchId) return rows || [];

  const selectedKey = getBranchKey(selectedBranchId);
  return (rows || []).filter((row) => {
    const branchId =
      row.customer_branch_id ??
      row.customerBranchId ??
      row.branch_id ??
      row.branchId ??
      row.delivery_branch_id ??
      row.deliveryBranchId;
    return row._branchMatched === true && getBranchKey(branchId) === selectedKey;
  });
};

const sortByDateThenReference = (a, b) => {
  const dateDiff =
    new Date(normalizeDateValue(getInvoiceDate(a))).getTime() -
    new Date(normalizeDateValue(getInvoiceDate(b))).getTime();
  if (dateDiff !== 0) return dateDiff;

  return getInvoiceReference(a).localeCompare(getInvoiceReference(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export function filterInvoicesForAllocation(invoices = [], branchId = "") {
  const branchKey = getBranchKey(branchId);
  return (invoices || []).filter((invoice) => {
    if (isCancelledInvoice(invoice)) return false;
    if (!branchId) return true;
    return getBranchKey(
      invoice.customer_branch_id ??
        invoice.customerBranchId ??
        invoice.branch_id ??
        invoice.branchId ??
        invoice.delivery_branch_id ??
        invoice.deliveryBranchId
    ) === branchKey;
  });
}

export function allocatePaymentOldestFirst(invoices = [], amount = 0, options = {}) {
  let remaining = money(amount);
  const sorted = filterInvoicesForAllocation(invoices, options.branchId)
    .filter(
      (invoice) =>
        Number(invoice.remainingAmount ?? invoice.remaining_amount ?? getInvoiceAmount(invoice)) > 0
    )
    .sort(sortByDateThenReference);

  const allocations = [];

  for (const invoice of sorted) {
    if (remaining <= 0) break;

    const invoiceRemaining = money(
      invoice.remainingAmount ?? invoice.remaining_amount ?? getInvoiceAmount(invoice)
    );
    const allocatedAmount = money(Math.min(invoiceRemaining, remaining));

    if (allocatedAmount <= 0) continue;

    allocations.push({
      invoiceReference: getInvoiceReference(invoice),
      invoiceSourceId: invoice.id ? String(invoice.id) : null,
      customerBranchId:
        invoice.customer_branch_id ??
          invoice.customerBranchId ??
          invoice.branch_id ??
          invoice.branchId ??
          invoice.delivery_branch_id ??
          invoice.deliveryBranchId ??
          null,
      allocatedAmount,
    });
    remaining = money(remaining - allocatedAmount);
  }

  return { allocations, unallocatedAmount: remaining };
}

export function applyAllocationsToInvoices(invoices = [], allocations = []) {
  const allocatedByInvoice = (allocations || []).reduce((result, allocation) => {
    const key = String(allocation.invoice_reference || allocation.invoiceReference || "");
    const status = String(allocation.status || "active").toLowerCase();
    if (!key || ["void", "voided", "reversed", "cancelled", "canceled"].includes(status)) {
      return result;
    }
    result[key] = money(
      (result[key] || 0) +
        Number(allocation.allocated_amount || allocation.allocatedAmount || 0)
    );
    return result;
  }, {});

  return (invoices || [])
    .filter((invoice) => !isCancelledInvoice(invoice))
    .map((invoice) => {
      const invoiceAmount = getInvoiceAmount(invoice);
      const reference = getInvoiceReference(invoice);
      const paidAmount = money(allocatedByInvoice[reference] || 0);
      const remainingAmount = money(Math.max(0, invoiceAmount - paidAmount));
      const paymentStatus =
        remainingAmount <= 0 ? "PAID" : paidAmount > 0 ? "PARTIALLY PAID" : "UNPAID";

      return {
        ...invoice,
        invoiceAmount,
        paidAmount,
        remainingAmount,
        paymentStatus,
      };
    });
}

const transactionSort = (a, b) => {
  const dateDiff =
    new Date(normalizeDateValue(a.date)).getTime() -
    new Date(normalizeDateValue(b.date)).getTime();
  if (dateDiff !== 0) return dateDiff;

  const typeRank = { OPENING: 0, INVOICE: 1, PAYMENT: 2 };
  const rankDiff = (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9);
  if (rankDiff !== 0) return rankDiff;

  return String(a.reference || "").localeCompare(String(b.reference || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

export function buildCustomerTransactionHistory({
  openingBalance = 0,
  openingDate = new Date(0).toISOString(),
  invoices = [],
  payments = [],
  newestFirst = true,
} = {}) {
  const rows = [
    {
      id: "opening-balance",
      type: "OPENING",
      date: openingDate,
      reference: "Opening Balance",
      amount: money(openingBalance),
      paymentMethod: null,
      paidBy: null,
      branchId: null,
      branchName: "",
      status: "OPENING",
    },
    ...(invoices || [])
      .filter((invoice) => !isCancelledInvoice(invoice))
      .map((invoice) => ({
        id: `invoice-${getInvoiceReference(invoice)}`,
        type: "INVOICE",
        date: getInvoiceDate(invoice),
        reference: getInvoiceReference(invoice),
        amount: getInvoiceAmount(invoice),
        paymentMethod: null,
        paidBy: null,
        branchId:
          invoice.customer_branch_id ??
          invoice.customerBranchId ??
          invoice.branch_id ??
          invoice.branchId ??
          invoice.delivery_branch_id ??
          invoice.deliveryBranchId ??
          null,
        branchName: invoice.branch_name || invoice.delivery_branch_name || "",
        status:
          invoice.paymentStatus ||
          invoice.payment_status ||
          invoice.invoice_status ||
          "UNPAID",
      })),
    ...(payments || [])
      .filter((payment) => !isVoidedPayment(payment))
      .map((payment) => ({
        id: `payment-${payment.id || payment.payment_reference}`,
        type: "PAYMENT",
        date: payment.payment_date || payment.created_at,
        reference: payment.payment_reference || payment.reference_no || payment.id,
        amount: money(-Math.abs(Number(payment.amount || payment.credit || 0))),
        paymentMethod: payment.payment_method || payment.payment_type || "Other",
        paidBy: payment.paid_by || payment.who_paid || payment.collected_by || "",
        branchId:
          payment.customer_branch_id ??
          payment.customerBranchId ??
          payment.branch_id ??
          payment.branchId ??
          payment.delivery_branch_id ??
          payment.deliveryBranchId ??
          null,
        branchName: payment.branch_name || "",
        status: "POSTED",
      })),
  ].sort(transactionSort);

  let runningBalance = 0;
  const withBalances = rows.map((row) => {
    runningBalance = money(runningBalance + row.amount);
    return { ...row, runningBalance };
  });

  return newestFirst ? [...withBalances].reverse() : withBalances;
}

export function summarizeCreditSnapshot({
  creditLimit = 0,
  openingBalance = 0,
  invoices = [],
  payments = [],
} = {}) {
  const activeInvoices = (invoices || []).filter((invoice) => !isCancelledInvoice(invoice));
  const activePayments = (payments || []).filter((payment) => !isVoidedPayment(payment));
  const invoiceTotal = money(activeInvoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0));
  const paymentTotal = money(
    activePayments.reduce((sum, payment) => sum + Math.abs(Number(payment.amount || payment.credit || 0)), 0)
  );
  const outstanding = money(Number(openingBalance || 0) + invoiceTotal - paymentTotal);

  return {
    openingBalance: money(openingBalance),
    invoiceTotal,
    paymentTotal,
    outstanding,
    creditLimit: money(creditLimit),
    availableCredit: money(Number(creditLimit || 0) - outstanding),
  };
}

const mergeMissingByReference = (primaryRows = [], fallbackRows = [], getReference) => {
  const existing = new Set(
    primaryRows.map(getReference).map((value) => String(value || "").trim()).filter(Boolean)
  );
  const missing = fallbackRows.filter((row) => {
    const reference = String(getReference(row) || "").trim();
    return reference && !existing.has(reference);
  });
  return [...primaryRows, ...missing];
};

export function resolveLegacyCompatibilityRows({
  invoices = [],
  payments = [],
  legacyInvoices = [],
  legacyPayments = [],
} = {}) {
  const migratedLegacyIds = new Set(
    payments.flatMap((payment) => {
      const idempotencyMatch = String(payment.idempotency_key || "").match(
        /^legacy-customer-ledger:(\d+)$/i
      );
      const metadataId =
        payment.metadata?.legacy_source === "customer_ledger"
          ? payment.metadata?.legacy_source_id
          : null;
      return [idempotencyMatch?.[1], metadataId].filter(Boolean).map(String);
    })
  );
  const unmatchedLegacyPayments = legacyPayments.filter((payment) => {
    const legacyId = payment.legacy_ledger_id;
    return !legacyId || !migratedLegacyIds.has(String(legacyId));
  });

  return {
    invoices,
    payments: mergeMissingByReference(
      payments,
      unmatchedLegacyPayments,
      (row) => row.payment_reference || row.reference_no || row.id
    ),
    legacyFallbackUsed: unmatchedLegacyPayments.length > 0,
  };
}

export function summarizeCreditSummaryRows({
  creditLimit = 0,
  summaries = [],
} = {}) {
  const openingBalance = money(
    summaries.reduce((sum, row) => sum + Number(row.openingBalance || 0), 0)
  );
  const invoiceTotal = money(
    summaries.reduce((sum, row) => sum + Number(row.invoiceTotal || 0), 0)
  );
  const paymentTotal = money(
    summaries.reduce((sum, row) => sum + Number(row.paymentTotal || 0), 0)
  );
  const outstanding = money(
    summaries.reduce((sum, row) => sum + Number(row.outstanding || 0), 0)
  );

  return {
    openingBalance,
    invoiceTotal,
    paymentTotal,
    outstanding,
    creditLimit: money(creditLimit),
    availableCredit: money(Number(creditLimit || 0) - outstanding),
  };
}

export function createPaymentIdempotencyKey({
  customerAccountId,
  customerBranchId,
  amount,
  paymentDate,
  paymentMethod,
  externalReference,
}) {
  return [
    customerAccountId,
    customerBranchId || "ALL",
    money(amount).toFixed(2),
    String(paymentDate || "").slice(0, 16),
    String(paymentMethod || "").trim().toUpperCase(),
    String(externalReference || "").trim().toUpperCase(),
  ].join("|");
}
