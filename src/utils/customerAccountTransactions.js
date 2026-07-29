import {
  getInvoiceAmount,
  getInvoiceDate,
  getInvoiceReference,
  getStatementCollectionType,
  isCancelledInvoice,
  isVoidedPayment,
  money,
} from "./centralPaymentCalculations.js";

const VOID_PAYMENT_STATUSES = new Set([
  "VOID",
  "VOIDED",
  "REVERSED",
  "ARCHIVED",
  "INACTIVE",
  "CANCELLED",
  "CANCELED",
  "DELETED",
]);

const ACTIVE_PAYMENT_STATUSES = new Set(["POSTED", "ACTIVE"]);
const ACTIVE_VERIFICATION_STATUSES = new Set(["", "CONFIRMED", "NOT_REQUIRED"]);
const INACTIVE_ALLOCATION_STATUSES = new Set([
  "VOID",
  "VOIDED",
  "REVERSED",
  "INACTIVE",
  "CANCELLED",
  "CANCELED",
  "DELETED",
]);

const upper = (value) => String(value || "").trim().toUpperCase();
const text = (value) => String(value || "").trim();
const normalizeReference = (value) =>
  text(value)
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^ORDER[-_]?/, "ORD-")
    .replace(/^ORD[-_]?/, "ORD-");

const hasTime = (value) =>
  Boolean(value) && (String(value).includes("T") || /\d{2}:\d{2}/.test(String(value)));

const validTimestamp = (...values) => {
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return null;
};

const getBusinessDate = (value) => {
  if (!value) return "";
  const prefix = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (prefix) return prefix[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const paymentTimestamp = (payment = {}) =>
  validTimestamp(
    payment.posted_at,
    payment.received_at,
    payment.collected_at,
    payment.payment_timestamp,
    hasTime(payment.payment_date) ? payment.payment_date : null,
    payment.created_at,
    payment.payment_date,
    payment.updated_at
  );

export const getPaymentEffectiveTimestamp = (payment = {}) =>
  paymentTimestamp(payment);

const invoiceTimestamp = (invoice = {}) =>
  validTimestamp(
    invoice.delivered_at,
    invoice.delivery_confirmed_at,
    hasTime(invoice.invoice_date) ? invoice.invoice_date : null,
    invoice.created_at,
    invoice.updated_at,
    invoice.invoice_date
  );

const activeAllocation = (allocation = {}) =>
  !INACTIVE_ALLOCATION_STATUSES.has(upper(allocation.status || "ACTIVE"));

export function isBalanceAffectingPayment(payment = {}) {
  const status = upper(payment.status || payment.payment_status || "POSTED");
  const verification = upper(
    payment.verification_status || payment.verificationStatus || "CONFIRMED"
  );

  return (
    !isVoidedPayment(payment) &&
    !payment.voided_at &&
    !payment.reversed_at &&
    !VOID_PAYMENT_STATUSES.has(status) &&
    ACTIVE_PAYMENT_STATUSES.has(status) &&
    ACTIVE_VERIFICATION_STATUSES.has(verification)
  );
}

const paymentAliases = (payment = {}) =>
  new Set(
    [
      payment.id,
      payment.payment_id,
      payment.central_payment_id,
      payment.payment_reference,
      payment.reference_no,
    ]
      .map(normalizeReference)
      .filter(Boolean)
  );

const invoiceAliases = (invoice = {}) =>
  new Set(
    [
      invoice.id,
      invoice.invoice_id,
      invoice.invoice_number,
      invoice.invoice_reference,
      invoice.reference_no,
      invoice.order_id,
      invoice.order_number,
    ]
      .map(normalizeReference)
      .filter(Boolean)
  );

const buildAllocationMaps = (allocations = []) => {
  const byPayment = new Map();
  const byInvoice = new Map();

  (allocations || []).filter(activeAllocation).forEach((allocation) => {
    const paymentId = normalizeReference(
      allocation.payment_id ||
        allocation.paymentId ||
        allocation.customer_payment_id
    );
    const invoiceKeys = [
      allocation.invoice_source_id,
      allocation.invoiceSourceId,
      allocation.invoice_id,
      allocation.invoiceId,
      allocation.invoice_reference,
      allocation.invoiceReference,
      allocation.order_id,
      allocation.orderId,
    ]
      .map(normalizeReference)
      .filter(Boolean);

    if (paymentId) {
      byPayment.set(paymentId, [...(byPayment.get(paymentId) || []), allocation]);
    }
    invoiceKeys.forEach((key) => {
      byInvoice.set(key, [...(byInvoice.get(key) || []), allocation]);
    });
  });

  return { byPayment, byInvoice };
};

const allocationsForPayment = (payment, allocationMaps) => {
  const matches = new Map();
  paymentAliases(payment).forEach((key) => {
    (allocationMaps.byPayment.get(key) || []).forEach((allocation) => {
      matches.set(
        String(allocation.id || `${allocation.payment_id}:${allocation.invoice_reference}`),
        allocation
      );
    });
  });
  return [...matches.values()];
};

const allocationsForInvoice = (invoice, allocationMaps) => {
  const matches = new Map();
  invoiceAliases(invoice).forEach((key) => {
    (allocationMaps.byInvoice.get(key) || []).forEach((allocation) => {
      matches.set(
        String(allocation.id || `${allocation.payment_id}:${allocation.invoice_reference}`),
        allocation
      );
    });
  });
  return [...matches.values()];
};

const invoiceReferenceFromAllocation = (allocation = {}, invoiceLookup) => {
  const candidates = [
    allocation.invoice_source_id,
    allocation.invoiceSourceId,
    allocation.invoice_id,
    allocation.invoiceId,
    allocation.invoice_reference,
    allocation.invoiceReference,
    allocation.order_id,
    allocation.orderId,
  ]
    .map(normalizeReference)
    .filter(Boolean);

  for (const candidate of candidates) {
    const invoice = invoiceLookup.get(candidate);
    if (invoice) return getInvoiceReference(invoice);
  }
  return text(
    allocation.invoice_reference ||
      allocation.invoiceReference ||
      allocation.invoice_source_id
  );
};

const buildInvoiceLookup = (invoices = []) => {
  const lookup = new Map();
  invoices.forEach((invoice) => {
    invoiceAliases(invoice).forEach((alias) => {
      if (!lookup.has(alias)) lookup.set(alias, invoice);
    });
  });
  return lookup;
};

const displayPaymentMethod = (payment = {}) =>
  text(payment.payment_method || payment.payment_type || "Other") || "Other";

const getPaymentActivityState = (payment = {}) => {
  const status = upper(payment.status || payment.payment_status || "POSTED");
  const verification = upper(
    payment.verification_status || payment.verificationStatus || "CONFIRMED"
  );
  if (
    isVoidedPayment(payment) ||
    payment.voided_at ||
    payment.reversed_at ||
    VOID_PAYMENT_STATUSES.has(status)
  ) {
    return "VOIDED";
  }
  if (verification === "REJECTED" || status === "REJECTED") return "REJECTED";
  if (verification === "PENDING_VERIFICATION" || status === "PENDING") {
    return "PENDING";
  }
  return isBalanceAffectingPayment(payment) ? "ACTIVE" : "INACTIVE";
};

const friendlyCollectionLabel = (collectionType) => {
  switch (collectionType) {
    case "TODAY_INVOICE":
      return "Today's Invoice";
    case "PART_PAYMENT":
      return "Part Payment";
    case "PREVIOUS_BALANCE":
      return "Previous Balance";
    default:
      return "General Payment";
  }
};

const paymentDescription = ({
  payment,
  collectionType,
  relatedInvoices,
  transactionType,
}) => {
  const method = displayPaymentMethod(payment);
  const invoiceReference = relatedInvoices[0];
  const source = upper(payment.source || payment.collection_source);

  if (transactionType === "DISCOUNT") return "Manual customer discount";
  if (transactionType === "CREDIT_NOTE") return "Customer credit note";
  if (transactionType === "VOID") return "Voided payment";
  if (transactionType === "PAYMENT_CORRECTION") return "Payment correction";
  if (collectionType === "PART_PAYMENT" && invoiceReference) {
    return `Part payment for invoice ${invoiceReference}`;
  }
  if (collectionType === "TODAY_INVOICE" && invoiceReference) {
    return `${method} payment for invoice ${invoiceReference}`;
  }
  if (collectionType === "PREVIOUS_BALANCE") {
    return `${method} payment toward previous balance`;
  }
  if (source.includes("SALES_REP")) {
    return `Sales representative ${method.toLowerCase()} collection`;
  }
  if (source.includes("DRIVER")) {
    return `Driver ${method.toLowerCase()} collection`;
  }
  return `${method} customer payment`;
};

const transactionReference = (payment = {}) =>
  text(
    payment.payment_reference ||
      payment.reference_no ||
      payment.order_number ||
      payment.id
  );

const transactionSubtypeForPayment = (payment, collectionType, activityState) => {
  const rawType = upper(payment.transaction_type || payment.entry_type || "PAYMENT");
  const method = upper(payment.payment_method || payment.payment_type);

  if (activityState === "VOIDED") return "VOID";
  if (activityState === "PENDING") return "PENDING_PAYMENT";
  if (activityState === "REJECTED") return "REJECTED_PAYMENT";
  if (rawType.includes("RETURN_CREDIT") || method === "RETURN CREDIT") {
    return "CREDIT_NOTE";
  }
  if (rawType === "DISCOUNT" || method === "DISCOUNT") return "DISCOUNT";
  if (payment.edited_at || payment.edit_reason) return "PAYMENT_CORRECTION";
  if (collectionType === "PART_PAYMENT") return "PART_PAYMENT";
  if (collectionType === "PREVIOUS_BALANCE") return "PREVIOUS_BALANCE_PAYMENT";
  return "PAYMENT";
};

const sourceTableForPayment = (payment = {}) => {
  if (payment.legacy_ledger_id || payment.ledger_id) {
    return "customer_ledger";
  }
  return "customer_payments";
};

const paymentDeduplicationFingerprint = (payment = {}) =>
  [
    payment.customer_account_id,
    payment.customer_branch_id || payment.branch_id || "MAIN",
    money(payment.amount ?? payment.credit ?? payment.payment_amount).toFixed(2),
    normalizeReference(transactionReference(payment)),
    getBusinessDate(payment.payment_date || payment.created_at),
  ].join("|");

export function selectLatestActivePayment(payments = []) {
  const activePayments = (payments || []).filter(
    (payment) =>
      isBalanceAffectingPayment(payment) &&
      Math.abs(
        Number(payment.amount ?? payment.credit ?? payment.payment_amount ?? 0)
      ) > 0.009
  );
  const canonicalFingerprints = new Set(
    activePayments
      .filter((payment) => sourceTableForPayment(payment) === "customer_payments")
      .map(paymentDeduplicationFingerprint)
  );
  const deduplicated = activePayments.filter(
    (payment) =>
      sourceTableForPayment(payment) !== "customer_ledger" ||
      !canonicalFingerprints.has(paymentDeduplicationFingerprint(payment))
  );

  return [...deduplicated].sort((left, right) => {
    const effectiveDifference =
      new Date(paymentTimestamp(right) || 0).getTime() -
      new Date(paymentTimestamp(left) || 0).getTime();
    if (effectiveDifference !== 0) return effectiveDifference;
    const createdDifference =
      new Date(right.created_at || 0).getTime() -
      new Date(left.created_at || 0).getTime();
    if (createdDifference !== 0) return createdDifference;
    return text(right.id || right.payment_id).localeCompare(
      text(left.id || left.payment_id),
      undefined,
      { numeric: true, sensitivity: "base" }
    );
  })[0] || null;
}

const deterministicRowSort = (left, right) => {
  if (left.transaction_type === "OPENING_BALANCE") return -1;
  if (right.transaction_type === "OPENING_BALANCE") return 1;

  const leftTime = new Date(left.ordering_timestamp || 0).getTime();
  const rightTime = new Date(right.ordering_timestamp || 0).getTime();
  if (leftTime !== rightTime) return leftTime - rightTime;

  const typeRank = { INVOICE: 10, PAYMENT: 20, CREDIT: 20, ADJUSTMENT: 20 };
  const rankDifference =
    (typeRank[left.transaction_type] ?? 50) -
    (typeRank[right.transaction_type] ?? 50);
  if (rankDifference !== 0) return rankDifference;

  const referenceDifference = text(left.reference).localeCompare(
    text(right.reference),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
  if (referenceDifference !== 0) return referenceDifference;
  return text(left.transaction_id).localeCompare(text(right.transaction_id));
};

const enforceLinkedSameDayOrder = (rows = []) => {
  const ordered = [...rows].sort(deterministicRowSort);
  const linkedPayments = ordered
    .filter(
      (row) =>
        row.transaction_type === "PAYMENT" &&
        ["TODAY_INVOICE", "PART_PAYMENT"].includes(row.collection_type) &&
        row.related_invoices.length > 0
    )
    .sort((left, right) => deterministicRowSort(right, left));

  linkedPayments.forEach((payment) => {
    const linkedReferences = new Set(payment.related_invoices.map(normalizeReference));
    const linkedInvoices = ordered.filter(
      (row) =>
        row.transaction_type === "INVOICE" &&
        getBusinessDate(row.transaction_date) ===
          getBusinessDate(payment.transaction_date) &&
        linkedReferences.has(normalizeReference(row.reference))
    );
    if (!linkedInvoices.length) return;

    const currentIndex = ordered.indexOf(payment);
    if (currentIndex >= 0) ordered.splice(currentIndex, 1);
    const invoiceIndexes = linkedInvoices
      .map((invoice) => ordered.indexOf(invoice))
      .filter((index) => index >= 0);
    ordered.splice(Math.max(...invoiceIndexes) + 1, 0, payment);
  });

  return ordered;
};

export const sortTransactionsForDisplay = (rows = [], direction = "oldest") =>
  [...(rows || [])].sort((left, right) =>
    direction === "newest"
      ? deterministicRowSort(right, left)
      : deterministicRowSort(left, right)
  );

const duplicatePaymentFingerprints = (payments = []) => {
  const grouped = new Map();
  payments.filter(isBalanceAffectingPayment).forEach((payment) => {
    const key = [
      payment.customer_account_id,
      payment.customer_branch_id || payment.branch_id || "MAIN",
      money(payment.amount ?? payment.credit ?? payment.payment_amount).toFixed(2),
      normalizeReference(transactionReference(payment)),
      getBusinessDate(payment.payment_date || payment.created_at),
    ].join("|");
    grouped.set(key, [...(grouped.get(key) || []), payment]);
  });
  return [...grouped.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([fingerprint, matches]) => ({
      fingerprint,
      paymentIds: matches.map((payment) => payment.id),
      count: matches.length,
    }));
};

const inferFifoAllocations = ({
  invoices = [],
  payments = [],
  openingBalance = 0,
} = {}) => {
  const remainingByInvoice = new Map(
    [...invoices]
      .sort((left, right) =>
        String(invoiceTimestamp(left) || "").localeCompare(
          String(invoiceTimestamp(right) || "")
        )
      )
      .map((invoice) => [invoice, getInvoiceAmount(invoice)])
  );
  let openingRemaining = Math.max(0, money(openingBalance));
  const inferred = [];

  [...payments]
    .filter(isBalanceAffectingPayment)
    .sort((left, right) =>
      String(paymentTimestamp(left) || "").localeCompare(
        String(paymentTimestamp(right) || "")
      )
    )
    .forEach((payment) => {
      let available = money(
        Math.abs(Number(payment.amount ?? payment.credit ?? payment.payment_amount ?? 0))
      );
      const openingAllocation = Math.min(openingRemaining, available);
      openingRemaining = money(openingRemaining - openingAllocation);
      available = money(available - openingAllocation);

      for (const [invoice, remaining] of remainingByInvoice.entries()) {
        if (available <= 0.009) break;
        if (remaining <= 0.009) continue;
        const allocatedAmount = money(Math.min(available, remaining));
        inferred.push({
          id: `inferred:${payment.id}:${invoice.id}`,
          payment_id: payment.central_payment_id || payment.id,
          invoice_source_id: invoice.id,
          invoice_reference: getInvoiceReference(invoice),
          order_id: invoice.order_id || null,
          customer_account_id:
            payment.customer_account_id || invoice.customer_account_id || null,
          customer_branch_id:
            payment.customer_branch_id || invoice.customer_branch_id || null,
          allocated_amount: allocatedAmount,
          status: "ACTIVE",
          inferred: true,
        });
        remainingByInvoice.set(invoice, money(remaining - allocatedAmount));
        available = money(available - allocatedAmount);
      }
    });

  return inferred;
};

const inferMissingPaymentAllocations = ({
  invoices = [],
  payments = [],
  openingBalance = 0,
  suppliedAllocations = [],
} = {}) => {
  const suppliedMaps = buildAllocationMaps(suppliedAllocations);
  const remainingByInvoice = new Map(
    [...invoices]
      .sort((left, right) =>
        String(invoiceTimestamp(left) || "").localeCompare(
          String(invoiceTimestamp(right) || "")
        )
      )
      .map((invoice) => {
        const allocated = allocationsForInvoice(invoice, suppliedMaps).reduce(
          (sum, allocation) =>
            sum + Number(allocation.allocated_amount || allocation.allocatedAmount || 0),
          0
        );
        return [invoice, money(Math.max(0, getInvoiceAmount(invoice) - allocated))];
      })
  );
  let openingRemaining = Math.max(0, money(openingBalance));
  const inferred = [];

  [...payments]
    .filter(isBalanceAffectingPayment)
    .sort((left, right) =>
      String(paymentTimestamp(left) || "").localeCompare(
        String(paymentTimestamp(right) || "")
      )
    )
    .forEach((payment) => {
      if (allocationsForPayment(payment, suppliedMaps).length > 0) return;

      let available = money(
        Math.abs(Number(payment.amount ?? payment.credit ?? payment.payment_amount ?? 0))
      );
      const openingAllocation = Math.min(openingRemaining, available);
      openingRemaining = money(openingRemaining - openingAllocation);
      available = money(available - openingAllocation);

      for (const [invoice, remaining] of remainingByInvoice.entries()) {
        if (available <= 0.009) break;
        if (remaining <= 0.009) continue;
        const allocatedAmount = money(Math.min(available, remaining));
        inferred.push({
          id: `inferred-missing:${payment.id}:${invoice.id}`,
          payment_id: payment.central_payment_id || payment.id,
          invoice_source_id: invoice.id,
          invoice_reference: getInvoiceReference(invoice),
          order_id: invoice.order_id || null,
          customer_account_id:
            payment.customer_account_id || invoice.customer_account_id || null,
          customer_branch_id:
            payment.customer_branch_id || invoice.customer_branch_id || null,
          allocated_amount: allocatedAmount,
          status: "ACTIVE",
          inferred: true,
        });
        remainingByInvoice.set(invoice, money(remaining - allocatedAmount));
        available = money(available - allocatedAmount);
      }
    });

  return inferred;
};

export function buildCustomerAccountTransactionModel({
  customer = {},
  openingBalances = [],
  invoices = [],
  payments = [],
  allocations = [],
  paymentAudits = [],
  sortDirection = "oldest",
} = {}) {
  const activeInvoices = (invoices || []).filter((invoice) => !isCancelledInvoice(invoice));
  const auditsByPayment = new Map();

  (paymentAudits || []).forEach((audit) => {
    const key = String(audit.payment_id || "");
    if (!key) return;
    auditsByPayment.set(key, [...(auditsByPayment.get(key) || []), audit]);
  });

  const openingBalance = money(
    (openingBalances || []).reduce(
      (sum, opening) => sum + Number(opening.opening_balance || opening.amount || 0),
      0
    )
  );
  const meaningfulOpeningDate = (openingBalances || [])
    .map((opening) => opening.effective_at || opening.account_start_date || null)
    .filter((value) => value && !String(value).startsWith("1970-01-01"))
    .sort()[0] || null;
  const openingCreatedAt = (openingBalances || [])
    .map((opening) => opening.created_at)
    .filter(Boolean)
    .sort()[0] || null;
  const suppliedActiveAllocations = (allocations || []).filter(activeAllocation);
  const effectiveAllocations = suppliedActiveAllocations.length
    ? [
        ...suppliedActiveAllocations,
        ...inferMissingPaymentAllocations({
          invoices: activeInvoices,
          payments,
          openingBalance,
          suppliedAllocations: suppliedActiveAllocations,
        }),
      ]
    : inferFifoAllocations({
        invoices: activeInvoices,
        payments,
        openingBalance,
      });
  const allocationMaps = buildAllocationMaps(effectiveAllocations);
  const invoiceLookup = buildInvoiceLookup(activeInvoices);

  const openingRow = {
    transaction_id: `opening:${customer.id || "account"}`,
    customer_account_id: customer.id || null,
    customer_branch_id: null,
    transaction_type: "OPENING_BALANCE",
    transaction_subtype: "OPENING_BALANCE",
    transaction_date: meaningfulOpeningDate,
    ordering_timestamp: "0001-01-01T00:00:00.000Z",
    created_at: openingCreatedAt,
    updated_at: null,
    reference: "Opening Balance",
    invoice_id: null,
    order_id: null,
    payment_id: null,
    allocation_id: null,
    description: "Opening account balance",
    debit_amount: openingBalance > 0 ? openingBalance : 0,
    credit_amount: openingBalance < 0 ? Math.abs(openingBalance) : 0,
    signed_amount: openingBalance,
    running_balance: 0,
    payment_method: null,
    collection_type: null,
    collection_label: null,
    paid_by: null,
    collected_by: null,
    status: "OPENING",
    invoice_status: null,
    allocated_amount: 0,
    unallocated_amount: 0,
    related_invoice: null,
    related_invoices: [],
    notes: null,
    voided: false,
    corrected: false,
    source_table: "customer_branch_opening_balances",
    source_record_id: null,
    source: null,
    source_record: null,
    audit_history: [],
  };

  const invoiceRows = activeInvoices.map((invoice) => {
    const invoiceAllocations = allocationsForInvoice(invoice, allocationMaps);
    const invoiceAmount = getInvoiceAmount(invoice);
    const allocatedAmount = money(
      invoiceAllocations.reduce(
        (sum, allocation) =>
          sum + Number(allocation.allocated_amount || allocation.allocatedAmount || 0),
        0
      )
    );
    const remainingAmount = money(Math.max(0, invoiceAmount - allocatedAmount));
    const invoiceStatus =
      remainingAmount <= 0.009
        ? "PAID"
        : allocatedAmount > 0
          ? "PART PAID"
          : "UNPAID";
    const reference = getInvoiceReference(invoice);
    const orderingTimestamp = invoiceTimestamp(invoice);

    return {
      transaction_id: `invoice:${invoice.id || reference}`,
      customer_account_id: invoice.customer_account_id || customer.id || null,
      customer_branch_id:
        invoice.customer_branch_id || invoice.branch_id || invoice.delivery_branch_id || null,
      transaction_type: "INVOICE",
      transaction_subtype: "INVOICE",
      transaction_date: getInvoiceDate(invoice),
      ordering_timestamp: orderingTimestamp,
      created_at: invoice.created_at || null,
      updated_at: invoice.updated_at || null,
      reference,
      invoice_id: invoice.id || null,
      order_id: invoice.order_id || null,
      payment_id: null,
      allocation_id:
        invoiceAllocations.length === 1 ? invoiceAllocations[0].id || null : null,
      description: `Invoice ${reference}`,
      debit_amount: invoiceAmount,
      credit_amount: 0,
      signed_amount: invoiceAmount,
      running_balance: 0,
      payment_method: null,
      collection_type: null,
      collection_label: null,
      paid_by: null,
      collected_by: null,
      status: invoiceStatus,
      invoice_status: invoiceStatus,
      allocated_amount: allocatedAmount,
      unallocated_amount: remainingAmount,
      related_invoice: reference,
      related_invoices: [reference],
      notes: invoice.notes || null,
      voided: false,
      corrected: false,
      source_table: invoice.source === "orders" ? "orders" : "customer_invoices",
      source_record_id: invoice.id || null,
      source: invoice.source || "customer_invoices",
      source_record: invoice,
      audit_history: [],
    };
  });

  const paymentRows = (payments || []).map((payment) => {
    const paymentAllocations = allocationsForPayment(payment, allocationMaps);
    const relatedInvoices = [
      ...new Set(
        paymentAllocations
          .map((allocation) =>
            invoiceReferenceFromAllocation(allocation, invoiceLookup)
          )
          .filter(Boolean)
      ),
    ];
    const paymentAmount = money(
      Math.abs(Number(payment.amount ?? payment.credit ?? payment.payment_amount ?? 0))
    );
    const allocatedAmount = money(
      paymentAllocations.reduce(
        (sum, allocation) =>
          sum + Number(allocation.allocated_amount || allocation.allocatedAmount || 0),
        0
      )
    );
    const activityState = getPaymentActivityState(payment);
    const active = activityState === "ACTIVE";
    const collectionType = getStatementCollectionType({
      ...payment,
      source: payment,
    });
    const subtype = transactionSubtypeForPayment(
      payment,
      collectionType,
      activityState
    );
    const isCreditNote = subtype === "CREDIT_NOTE";
    const transactionType = active
      ? isCreditNote
        ? "CREDIT"
        : "PAYMENT"
      : "ADJUSTMENT";
    const paymentId = payment.central_payment_id || payment.id || null;
    const auditHistory = auditsByPayment.get(String(paymentId)) || [];
    const corrected = Boolean(
      payment.edited_at ||
        payment.edit_reason ||
        auditHistory.some((audit) => upper(audit.action) === "EDITED")
    );
    const status = activityState !== "ACTIVE"
      ? activityState
      : corrected
        ? "CORRECTED"
        : paymentAmount > allocatedAmount + 0.009
          ? "UNALLOCATED"
          : "POSTED";

    return {
      transaction_id: `payment:${sourceTableForPayment(payment)}:${paymentId}`,
      customer_account_id: payment.customer_account_id || customer.id || null,
      customer_branch_id:
        payment.customer_branch_id || payment.branch_id || payment.delivery_branch_id || null,
      transaction_type: transactionType,
      transaction_subtype: subtype,
      transaction_date: payment.payment_date || payment.collection_date || payment.created_at,
      ordering_timestamp: paymentTimestamp(payment),
      created_at: payment.created_at || null,
      updated_at: payment.updated_at || null,
      reference: transactionReference(payment),
      invoice_id: payment.invoice_id || null,
      order_id: payment.order_id || null,
      payment_id: paymentId,
      allocation_id:
        paymentAllocations.length === 1 ? paymentAllocations[0].id || null : null,
      description: paymentDescription({
        payment,
        collectionType,
        relatedInvoices,
        transactionType: subtype,
      }),
      debit_amount: 0,
      credit_amount: paymentAmount,
      signed_amount: active ? money(-paymentAmount) : 0,
      running_balance: 0,
      payment_method: displayPaymentMethod(payment),
      collection_type: collectionType,
      collection_label: friendlyCollectionLabel(collectionType),
      paid_by: payment.paid_by || payment.who_paid || null,
      collected_by:
        payment.collector_name ||
        payment.collected_by_name ||
        payment.received_by ||
        payment.created_by ||
        null,
      status,
      invoice_status: null,
      allocated_amount: allocatedAmount,
      unallocated_amount: money(Math.max(0, paymentAmount - allocatedAmount)),
      related_invoice: relatedInvoices[0] || null,
      related_invoices: relatedInvoices,
      notes: payment.notes || payment.transaction_reason || null,
      voided: activityState === "VOIDED",
      corrected,
      source_table: sourceTableForPayment(payment),
      source_record_id: payment.ledger_id || payment.id || null,
      source: payment.source || payment.collection_source || sourceTableForPayment(payment),
      source_record: payment,
      audit_history: auditHistory,
    };
  });

  const chronologicalRows = enforceLinkedSameDayOrder([
    openingRow,
    ...invoiceRows,
    ...paymentRows,
  ]);
  let runningBalance = 0;
  const withBalances = chronologicalRows.map((row) => {
    runningBalance = money(runningBalance + Number(row.signed_amount || 0));
    return {
      ...row,
      running_balance: runningBalance,
      // Compatibility aliases while existing screens migrate.
      id: row.transaction_id,
      type:
        row.transaction_type === "OPENING_BALANCE"
          ? "OPENING"
          : row.transaction_type === "INVOICE"
            ? "INVOICE"
            : "PAYMENT",
      date: row.transaction_date,
      orderingTimestamp: row.ordering_timestamp,
      amount: row.signed_amount,
      runningBalance: runningBalance,
      paymentMethod: row.payment_method,
      paidBy: row.paid_by,
      branchId: row.customer_branch_id,
      branchName:
        row.source_record?.branch_name ||
        row.source_record?.customer_branch_name ||
        "",
    };
  });

  const activeRows = withBalances.filter(
    (row) =>
      row.transaction_type === "OPENING_BALANCE" ||
      row.transaction_type === "INVOICE" ||
      row.signed_amount !== 0
  );
  const invoiceTotal = money(
    invoiceRows.reduce((sum, row) => sum + row.debit_amount, 0)
  );
  const paymentTotal = money(
    paymentRows
      .filter((row) => row.signed_amount < 0)
      .reduce((sum, row) => sum + row.credit_amount, 0)
  );
  const closingBalance = money(openingBalance + invoiceTotal - paymentTotal);
  const outstandingBalance = money(Math.max(0, closingBalance));
  const customerCredit = money(Math.max(0, -closingBalance));
  const creditLimit = money(customer.credit_limit ?? customer.creditLimit ?? 0);
  const availableCreditLimit = money(
    creditLimit > 0 ? Math.max(0, creditLimit - outstandingBalance) : 0
  );
  const latestPaymentRecord = selectLatestActivePayment(payments);
  const latestPaymentId = String(
    latestPaymentRecord?.central_payment_id || latestPaymentRecord?.id || ""
  );
  const lastPayment =
    paymentRows.find(
      (row) =>
        row.signed_amount < 0 &&
        String(row.payment_id || "") === latestPaymentId
    ) || null;
  const allocationTotal = money(
    effectiveAllocations
      .reduce(
        (sum, allocation) =>
          sum + Number(allocation.allocated_amount || allocation.allocatedAmount || 0),
        0
      )
  );
  const displayedClosingBalance = activeRows.length
    ? activeRows.at(-1).running_balance
    : 0;
  const duplicatePayments = duplicatePaymentFingerprints(payments);
  const missingTimestamps = withBalances
    .filter(
      (row) =>
        row.transaction_type !== "OPENING_BALANCE" && !row.ordering_timestamp
    )
    .map((row) => row.transaction_id);
  const allocationIssues = paymentRows
    .filter((row) => row.allocated_amount > row.credit_amount + 0.009)
    .map((row) => ({
      paymentId: row.payment_id,
      paymentAmount: row.credit_amount,
      allocatedAmount: row.allocated_amount,
    }));

  const transactions =
    sortTransactionsForDisplay(withBalances, sortDirection);

  return {
    transactions,
    creditHistory: transactions,
    paymentHistory: transactions.filter(
      (row) =>
        row.source_table === "customer_payments" ||
        row.source_table === "customer_ledger"
    ),
    summary: {
      openingBalance,
      invoiceTotal,
      paymentTotal,
      closingBalance,
      outstanding: closingBalance,
      outstandingBalance,
      customerCredit,
      creditLimit,
      availableCredit: availableCreditLimit,
      availableCreditLimit,
      lastPaymentAmount: lastPayment?.credit_amount || 0,
      lastPayment,
    },
    reconciliation: {
      expectedClosingBalance: closingBalance,
      displayedClosingBalance,
      difference: money(closingBalance - displayedClosingBalance),
      allocationTotal,
      unallocatedCredit: money(
        paymentRows
          .filter((row) => row.signed_amount < 0)
          .reduce((sum, row) => sum + row.unallocated_amount, 0)
      ),
      duplicatePayments,
      allocationIssues,
      missingTimestamps,
      allocationSource:
        suppliedActiveAllocations.length > 0 &&
        effectiveAllocations.length > suppliedActiveAllocations.length
          ? "database_plus_inferred_fifo"
          : suppliedActiveAllocations.length > 0
            ? "database"
            : "inferred_fifo",
      balanced: Math.abs(closingBalance - displayedClosingBalance) <= 0.01,
    },
  };
}
