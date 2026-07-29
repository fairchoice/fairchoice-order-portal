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

const hasTimeComponent = (value) => {
  if (!value) return false;
  const text = String(value).trim();
  return text.includes("T") || /\d{2}:\d{2}/.test(text);
};

const firstValidTimestamp = (...values) => {
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }

  return new Date(0).toISOString();
};

const getInvoiceOrderingTimestamp = (invoice = {}) => {
  const preciseInvoiceDate = hasTimeComponent(invoice.invoice_date)
    ? invoice.invoice_date
    : null;

  return firstValidTimestamp(
    invoice.delivered_at,
    invoice.delivery_confirmed_at,
    preciseInvoiceDate,
    invoice.created_at,
    invoice.updated_at,
    invoice.invoice_date
  );
};

const getPaymentOrderingTimestamp = (payment = {}) => {
  const precisePaymentDate = hasTimeComponent(payment.payment_date)
    ? payment.payment_date
    : null;

  return firstValidTimestamp(
    payment.posted_at,
    payment.received_at,
    payment.collected_at,
    payment.payment_timestamp,
    precisePaymentDate,
    payment.created_at,
    payment.payment_date
  );
};

const transactionSort = (a, b) => {
  const dateDiff =
    new Date(normalizeDateValue(a.orderingTimestamp)).getTime() -
    new Date(normalizeDateValue(b.orderingTimestamp)).getTime();
  if (dateDiff !== 0) return dateDiff;

  const typeRank = { OPENING: 0, PAYMENT: 1, INVOICE: 2 };
  const rankDiff = (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9);
  if (rankDiff !== 0) return rankDiff;

  const referenceDiff = String(a.reference || "").localeCompare(
    String(b.reference || ""),
    undefined,
    {
      numeric: true,
      sensitivity: "base",
    }
  );
  if (referenceDiff !== 0) return referenceDiff;

  return String(a.id || "").localeCompare(String(b.id || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

const normalizeStatementValue = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const parseStatementMetadata = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

export const getStatementCollectionType = (row = {}) => {
  const source = row.source || {};
  const metadata = {
    ...parseStatementMetadata(source.metadata || source.payment_metadata),
    ...parseStatementMetadata(row.metadata || row.payment_metadata),
  };
  const normalizedValues = [
    row.collection_type,
    row.collectionType,
    row.resolved_collection_type,
    row.resolvedCollectionType,
    source.collection_type,
    source.collectionType,
    source.resolved_collection_type,
    source.resolvedCollectionType,
    metadata.collection_type,
    metadata.resolved_collection_type,
    row.transaction_reason,
    source.transaction_reason,
    row.payment_applies_to,
    source.payment_applies_to,
    metadata.payment_applies_to,
    row.payment_source,
    source.payment_source,
    source.collection_source,
    metadata.collection_kind,
    metadata.payment_source,
    row.reference,
  ]
    .map(normalizeStatementValue)
    .filter(Boolean);
  const rawValue =
    normalizedValues.find(
      (value) =>
        value.includes("PREVIOUS_BALANCE") ||
        value.includes("PREVIOUS_PAYMENT") ||
        value.includes("PREVIOUS_CREDIT") ||
        value.includes("OUTSTANDING_PAYMENT") ||
        value.includes("PART_PAYMENT") ||
        value.includes("PARTIAL_PAYMENT") ||
        value.includes("TODAYS_INVOICE") ||
        value.includes("TODAY_INVOICE")
    ) || normalizedValues[0];

  if (!rawValue) return "OTHER";
  if (
    rawValue.includes("PREVIOUS_BALANCE") ||
    rawValue.includes("PREVIOUS_PAYMENT") ||
    rawValue.includes("PREVIOUS_CREDIT") ||
    rawValue.includes("OUTSTANDING_PAYMENT")
  ) {
    return "PREVIOUS_BALANCE";
  }
  if (rawValue.includes("PART_PAYMENT") || rawValue.includes("PARTIAL_PAYMENT")) {
    return "PART_PAYMENT";
  }
  if (rawValue.includes("TODAYS_INVOICE") || rawValue.includes("TODAY_INVOICE")) {
    return "TODAY_INVOICE";
  }
  return rawValue;
};

const getStatementBusinessDate = (row = {}) => {
  const value =
    row.transactionDate ||
    row.transaction_date ||
    row.date ||
    row.payment_date ||
    row.invoice_date ||
    row.orderingTimestamp ||
    row.createdAt ||
    row.created_at;
  const text = String(value || "").trim();
  const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (datePrefix) return datePrefix[1];

  const timestamp = new Date(value || 0);
  return Number.isNaN(timestamp.getTime())
    ? "0000-00-00"
    : timestamp.toISOString().slice(0, 10);
};

const getStatementTimestamp = (row = {}) =>
  new Date(
    normalizeDateValue(
      row.orderingTimestamp ||
        row.createdAt ||
        row.created_at ||
        row.transactionDate ||
        row.transaction_date ||
        row.date
    )
  ).getTime();

const statementReferenceSort = (a, b) => {
  const referenceDiff = String(a.reference || "").localeCompare(
    String(b.reference || ""),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
  if (referenceDiff !== 0) return referenceDiff;

  return String(a.id || "").localeCompare(String(b.id || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

const getStatementPriority = (row = {}) => {
  const type = String(row.type || "").toUpperCase();
  if (type === "OPENING") return 0;
  if (type === "PAYMENT" && getStatementCollectionType(row) === "PREVIOUS_BALANCE") {
    return 5;
  }
  if (type === "INVOICE") return 10;
  if (
    type === "PAYMENT" &&
    ["TODAY_INVOICE", "PART_PAYMENT"].includes(getStatementCollectionType(row))
  ) {
    return 20;
  }
  return 10;
};

const normalizeLinkValue = (value) => String(value || "").trim().toLowerCase();

const getStatementAliases = (row = {}, type = "") => {
  const source = row.source || {};
  const aliases =
    type === "PAYMENT"
      ? [
          source.id,
          source.payment_id,
          source.payment_reference,
          source.reference_no,
          source.payment_number,
          row.payment_id,
          row.payment_reference,
          row.reference,
          String(row.id || "").replace(/^payment-/i, ""),
        ]
      : [
          source.id,
          source.invoice_id,
          source.invoice_number,
          source.invoice_reference,
          source.reference_no,
          source.order_id,
          source.order_number,
          row.invoice_id,
          row.invoice_number,
          row.invoice_reference,
          row.order_id,
          row.order_number,
          row.reference,
          String(row.id || "").replace(/^invoice-/i, ""),
        ];

  return new Set(aliases.map(normalizeLinkValue).filter(Boolean));
};

const isActiveStatementAllocation = (allocation = {}) =>
  !["VOID", "VOIDED", "REVERSED", "CANCELLED", "CANCELED", "DELETED"].includes(
    String(allocation.status || "ACTIVE").trim().toUpperCase()
  );

const findLinkedStatementInvoices = (payment, invoiceRows, allocations) => {
  const paymentAliases = getStatementAliases(payment, "PAYMENT");
  const allocationLinks = (allocations || [])
    .filter(isActiveStatementAllocation)
    .filter((allocation) =>
      [
        allocation.payment_id,
        allocation.paymentId,
        allocation.customer_payment_id,
        allocation.payment_reference,
      ]
        .map(normalizeLinkValue)
        .some((value) => value && paymentAliases.has(value))
    )
    .flatMap((allocation) => [
      allocation.invoice_source_id,
      allocation.invoiceSourceId,
      allocation.invoice_id,
      allocation.invoiceId,
      allocation.invoice_reference,
      allocation.invoiceReference,
      allocation.order_id,
      allocation.orderId,
      allocation.order_number,
    ]);

  const source = payment.source || {};
  const metadata = {
    ...parseStatementMetadata(source.metadata || source.payment_metadata),
    ...parseStatementMetadata(payment.metadata || payment.payment_metadata),
  };
  const directLinks = [
    payment.invoice_id,
    payment.invoice_reference,
    payment.applies_to_reference,
    payment.allocated_invoice_reference,
    payment.order_id,
    payment.order_number,
    source.invoice_id,
    source.invoice_reference,
    source.applies_to_reference,
    source.allocated_invoice_reference,
    source.order_id,
    source.order_number,
    metadata.invoice_id,
    metadata.invoice_reference,
    metadata.order_id,
    metadata.order_number,
  ];
  const linkValues = new Set(
    [...allocationLinks, ...directLinks].map(normalizeLinkValue).filter(Boolean)
  );

  const stronglyLinked = invoiceRows.filter((invoice) =>
    [...getStatementAliases(invoice, "INVOICE")].some((alias) => linkValues.has(alias))
  );
  if (stronglyLinked.length > 0) return stronglyLinked;

  const sameDayInvoices = invoiceRows.filter(
    (invoice) => getStatementBusinessDate(invoice) === getStatementBusinessDate(payment)
  );
  return sameDayInvoices.length === 1 ? sameDayInvoices : [];
};

/**
 * Applies Customer Credit presentation chronology without changing source
 * transactions or allocation amounts. Balances are calculated only after the
 * final oldest-first statement order has been resolved.
 */
export function orderCustomerStatementRows({
  rows = [],
  allocations = [],
  newestFirst = true,
} = {}) {
  const rowsByDate = new Map();

  (rows || []).forEach((row, index) => {
    const businessDate = getStatementBusinessDate(row);
    rowsByDate.set(businessDate, [
      ...(rowsByDate.get(businessDate) || []),
      { ...row, _statementIndex: index },
    ]);
  });

  const chronologicalRows = [...rowsByDate.keys()]
    .sort()
    .flatMap((businessDate) => {
      const dateRows = rowsByDate.get(businessDate) || [];
      const ordered = [...dateRows].sort((a, b) => {
        const priorityDiff = getStatementPriority(a) - getStatementPriority(b);
        if (priorityDiff !== 0) return priorityDiff;

        const timestampDiff = getStatementTimestamp(a) - getStatementTimestamp(b);
        if (timestampDiff !== 0) return timestampDiff;

        const referenceDiff = statementReferenceSort(a, b);
        if (referenceDiff !== 0) return referenceDiff;
        return a._statementIndex - b._statementIndex;
      });
      const invoiceRows = dateRows.filter(
        (row) => String(row.type || "").toUpperCase() === "INVOICE"
      );
      const linkedPayments = dateRows
        .filter(
          (row) =>
            String(row.type || "").toUpperCase() === "PAYMENT" &&
            ["TODAY_INVOICE", "PART_PAYMENT"].includes(getStatementCollectionType(row))
        )
        .sort((a, b) => {
          const timestampDiff = getStatementTimestamp(b) - getStatementTimestamp(a);
          return timestampDiff || statementReferenceSort(b, a);
        });

      linkedPayments.forEach((payment) => {
        const linkedInvoices = findLinkedStatementInvoices(
          payment,
          invoiceRows,
          allocations
        );
        if (linkedInvoices.length === 0) return;

        const paymentIndex = ordered.indexOf(payment);
        if (paymentIndex >= 0) ordered.splice(paymentIndex, 1);
        const linkedIndexes = linkedInvoices
          .map((invoice) => ordered.indexOf(invoice))
          .filter((index) => index >= 0);
        const insertAfter = linkedIndexes.length > 0 ? Math.max(...linkedIndexes) : -1;
        ordered.splice(insertAfter + 1, 0, payment);
      });

      return ordered;
    });

  let runningBalance = 0;
  const withBalances = chronologicalRows.map((row) => {
    const hasDebitOrCredit = row.debit !== undefined || row.credit !== undefined;
    const delta = hasDebitOrCredit
      ? Number(row.debit || 0) - Number(row.credit || 0)
      : Number(row.amount || 0);
    runningBalance = money(runningBalance + delta);
    const cleanRow = { ...row };
    delete cleanRow._statementIndex;
    return { ...cleanRow, runningBalance };
  });

  if (!newestFirst) return withBalances;

  const completedByDate = new Map();
  withBalances.forEach((row) => {
    const businessDate = getStatementBusinessDate(row);
    completedByDate.set(businessDate, [
      ...(completedByDate.get(businessDate) || []),
      row,
    ]);
  });

  return [...completedByDate.keys()]
    .sort()
    .reverse()
    .flatMap((businessDate) => completedByDate.get(businessDate) || []);
}

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
      orderingTimestamp: firstValidTimestamp(openingDate),
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
        orderingTimestamp: getInvoiceOrderingTimestamp(invoice),
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
        orderingTimestamp: getPaymentOrderingTimestamp(payment),
        reference: payment.payment_reference || payment.reference_no || payment.id,
        amount: money(-Math.abs(Number(payment.amount || payment.credit || 0))),
        paymentMethod: payment.payment_method || payment.payment_type || "Other",
        paidBy: payment.paid_by || payment.who_paid || payment.collected_by || "",
        collection_type: payment.collection_type || payment.collectionType || null,
        resolved_collection_type:
          payment.resolved_collection_type || payment.resolvedCollectionType || null,
        transaction_reason: payment.transaction_reason || payment.transactionReason || null,
        payment_applies_to: payment.payment_applies_to || payment.paymentAppliesTo || null,
        invoice_reference:
          payment.invoice_reference ||
          payment.applies_to_reference ||
          payment.allocated_invoice_reference ||
          null,
        metadata: payment.metadata || payment.payment_metadata || null,
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

const compatibilityPaymentReference = (payment = {}) =>
  String(
    payment.payment_reference ||
      payment.reference_no ||
      payment.order_number ||
      ""
  )
    .trim()
    .toUpperCase();

const compatibilityPaymentAmount = (payment = {}) =>
  money(
    Math.abs(
      Number(payment.amount ?? payment.credit ?? payment.payment_amount ?? 0)
    )
  );

const compatibilityPaymentDate = (payment = {}) =>
  String(
    payment.payment_date ||
      payment.collection_date ||
      payment.created_at ||
      ""
  ).slice(0, 10);

const compatibilityPaymentFingerprint = (payment = {}, { includeBranch = true } = {}) => {
  const reference = compatibilityPaymentReference(payment);
  if (!reference) return "";
  const parts = [
    payment.customer_account_id || "",
    reference,
    compatibilityPaymentAmount(payment).toFixed(2),
    compatibilityPaymentDate(payment),
  ];
  if (includeBranch) {
    parts.splice(
      1,
      0,
      payment.customer_branch_id || payment.branch_id || "MAIN"
    );
  }
  return parts.join("|");
};

const stableCompatibilityPaymentSort = (left = {}, right = {}) => {
  const createdDifference =
    new Date(left.created_at || left.payment_date || 0).getTime() -
    new Date(right.created_at || right.payment_date || 0).getTime();
  if (createdDifference !== 0) return createdDifference;
  return String(left.id || "").localeCompare(String(right.id || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
};

const sumCompatibilityPayments = (payments = []) =>
  money(
    payments.reduce(
      (sum, payment) => sum + compatibilityPaymentAmount(payment),
      0
    )
  );

export function resolveLegacyCompatibilityRows({
  invoices = [],
  payments = [],
  canonicalIdentityPayments = payments,
  legacyPayments = [],
} = {}) {
  const suppressedPaymentIds = [];
  const migratedLegacyIds = new Set(
    canonicalIdentityPayments.flatMap((payment) => {
      const idempotencyMatch = String(payment.idempotency_key || "").match(
        /^legacy-customer-ledger:(.+)$/i
      );
      const metadataId =
        payment.metadata?.legacy_source === "customer_ledger"
          ? payment.metadata?.legacy_source_id
          : null;
      return [idempotencyMatch?.[1], metadataId].filter(Boolean).map(String);
    })
  );
  const canonicalById = new Set(
    canonicalIdentityPayments
      .flatMap((payment) => [payment.id, payment.central_payment_id])
      .filter(Boolean)
      .map(String)
  );
  const canonicalByFingerprint = new Set();
  const canonicalByLooseFingerprint = new Set();
  const uniqueCanonicalPayments = [];

  [...payments].sort(stableCompatibilityPaymentSort).forEach((payment) => {
    const fingerprint = compatibilityPaymentFingerprint(payment);
    if (fingerprint && canonicalByFingerprint.has(fingerprint)) {
      suppressedPaymentIds.push(String(payment.id || payment.payment_id || ""));
      return;
    }
    if (fingerprint) canonicalByFingerprint.add(fingerprint);
    const looseFingerprint = compatibilityPaymentFingerprint(payment, {
      includeBranch: false,
    });
    if (looseFingerprint) canonicalByLooseFingerprint.add(looseFingerprint);
    uniqueCanonicalPayments.push(payment);
  });
  canonicalIdentityPayments.forEach((payment) => {
    const looseFingerprint = compatibilityPaymentFingerprint(payment, {
      includeBranch: false,
    });
    if (looseFingerprint) canonicalByLooseFingerprint.add(looseFingerprint);
  });

  const uniqueLegacyPayments = [];
  const legacyByFingerprint = new Set();
  [...legacyPayments].sort(stableCompatibilityPaymentSort).forEach((payment) => {
    const legacyId = String(payment.legacy_ledger_id || payment.ledger_id || "");
    const linkedCanonicalId = String(payment.central_payment_id || "");
    const fingerprint = compatibilityPaymentFingerprint(payment);
    const looseFingerprint = compatibilityPaymentFingerprint(payment, {
      includeBranch: false,
    });
    const duplicated =
      (legacyId && migratedLegacyIds.has(legacyId)) ||
      (linkedCanonicalId && canonicalById.has(linkedCanonicalId)) ||
      (looseFingerprint && canonicalByLooseFingerprint.has(looseFingerprint)) ||
      (fingerprint && legacyByFingerprint.has(fingerprint));

    if (duplicated) {
      suppressedPaymentIds.push(String(payment.id || legacyId));
      return;
    }
    if (fingerprint) legacyByFingerprint.add(fingerprint);
    uniqueLegacyPayments.push(payment);
  });

  const uniquePayments = [...uniqueCanonicalPayments, ...uniqueLegacyPayments];
  const paymentDiagnostics = {
    canonicalPaymentCount: uniqueCanonicalPayments.length,
    legacyOnlyPaymentCount: uniqueLegacyPayments.length,
    suppressedDuplicateCount: suppressedPaymentIds.length,
    canonicalPaymentTotal: sumCompatibilityPayments(uniqueCanonicalPayments),
    legacyOnlyPaymentTotal: sumCompatibilityPayments(uniqueLegacyPayments),
    combinedUniquePaymentTotal: sumCompatibilityPayments(uniquePayments),
    suppressedPaymentIds: suppressedPaymentIds.filter(Boolean),
  };

  return {
    invoices,
    payments: uniquePayments,
    legacyFallbackUsed: uniqueLegacyPayments.length > 0,
    paymentDiagnostics,
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
