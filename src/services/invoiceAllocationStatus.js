const INACTIVE_PAYMENT_STATUSES = new Set([
  "PENDING",
  "PENDING_VERIFICATION",
  "REJECTED",
  "VOIDED",
  "REVERSED",
  "ARCHIVED",
  "DELETED",
  "INACTIVE",
  "CANCELLED",
]);

const normalize = (value) => String(value || "").trim().toUpperCase();
const normalizeRef = (value) => normalize(value).replace(/\s+/g, "");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const addUuid = (target, value) => {
  const candidate = String(value || "").trim();
  if (UUID_PATTERN.test(candidate)) target.add(candidate);
};

const addReference = (target, value) => {
  const candidate = normalizeRef(value);
  if (candidate) target.add(candidate);
};

export function isActiveInvoicePayment(payment = {}) {
  const status = normalize(payment.status || payment.payment_status);
  const verification = normalize(payment.verification_status);
  const method = normalize(payment.payment_method).replace(/_/g, " ");

  if (INACTIVE_PAYMENT_STATUSES.has(status)) return false;
  if (payment.voided_at || payment.reversed_at || payment.archived_at) return false;
  if (method === "BANK TRANSFER" && ["PENDING", "PENDING_VERIFICATION", "REJECTED"].includes(verification)) {
    return false;
  }
  return ["ACTIVE", "POSTED", "CONFIRMED", "COMPLETED", "PAID"].includes(status);
}

export function isActiveInvoiceAllocation(allocation = {}) {
  const status = normalize(allocation.status || "ACTIVE");
  return !allocation.reversed_at && !allocation.voided_at && ["ACTIVE", "POSTED"].includes(status);
}

export function isActiveLegacyLedgerPayment(payment = {}) {
  const types = new Set([
    normalize(payment.entry_type),
    normalize(payment.transaction_type),
  ]);
  const status = normalize(payment.payment_status || payment.status);

  if (!["PAYMENT", "COLLECTION"].some((type) => types.has(type))) return false;
  if (INACTIVE_PAYMENT_STATUSES.has(status)) return false;
  if (payment.voided_at || payment.reversed_at || payment.archived_at) return false;
  return !status || ["ACTIVE", "POSTED", "CONFIRMED", "COMPLETED", "PAID"].includes(status);
}

export function getPaymentReferenceKeys(payment = {}) {
  const references = new Set();
  [
    payment.order_number,
    payment.reference_no,
    payment.payment_reference,
  ].forEach((value) => addReference(references, value));
  return references;
}

const getPositivePaymentAmount = (payment = {}) =>
  Math.max(
    0,
    Number(payment.allocated_amount || 0),
    Number(payment.payment_amount || 0),
    Number(payment.amount || 0),
    Number(payment.credit || 0),
  );

const hasMatchingScope = (row = {}, payment = {}) => {
  const customerAccountId = String(
    row.customer_account_id || row._freshOrder?.customer_account_id || ""
  );
  const paymentCustomerAccountId = String(payment.customer_account_id || "");
  if (
    customerAccountId &&
    paymentCustomerAccountId &&
    customerAccountId !== paymentCustomerAccountId
  ) {
    return false;
  }

  const branchId = String(
    row.customer_branch_id ||
      row.branch_id ||
      row._freshOrder?.customer_branch_id ||
      row._freshOrder?.branch_id ||
      ""
  );
  const paymentBranchId = String(
    payment.customer_branch_id || payment.branch_id || ""
  );
  return !branchId || !paymentBranchId || branchId === paymentBranchId;
};

const getStoredLedgerInvoicePaidAmount = (row = {}, invoiceTotal = 0) => {
  const ledgerRow = row._ledgerRow || row;
  const type = normalize(ledgerRow.entry_type || ledgerRow.transaction_type);
  if (!type.includes("INVOICE")) return 0;

  const status = normalize(ledgerRow.invoice_status || ledgerRow.payment_status || ledgerRow.status);
  if (status === "PAID") return Math.max(0, Number(invoiceTotal || 0));
  if (status !== "PART PAID") return 0;

  return Math.max(
    0,
    Number(ledgerRow.paid_amount || ledgerRow.amount_paid || 0),
    Number(invoiceTotal || 0) - Number(ledgerRow.remaining_amount || 0),
  );
};

export function getInvoiceLedgerReferenceKeys(row = {}) {
  const references = new Set();
  [
    row.canonical_order_number,
    row.full_order_number,
    row._freshOrder?.canonical_order_number,
    row._freshOrder?.full_order_number,
    row._freshOrder?.order_number,
    row.order_number,
    row.reference_no,
    row.invoice_number,
  ].forEach((value) => addReference(references, value));
  return references;
}

export function getInvoiceAllocationKeys(row = {}) {
  const sourceIds = new Set();
  [
    row.order_uuid,
    row.dbId,
    row.order_id,
    row.invoice_source_id,
    row.source_id,
    row._freshOrder?.order_uuid,
    row._freshOrder?.dbId,
    row._freshOrder?.order_id,
    row._freshOrder?.id,
    row._freshOrder?.invoice_source_id,
    row.id,
  ].forEach((value) => addUuid(sourceIds, value));

  // These fields retain the complete database order/invoice reference. Display
  // formatting must never write a shortened value back into them.
  const exactReferences = new Set();
  [
    row.canonical_order_number,
    row.full_order_number,
    row._freshOrder?.canonical_order_number,
    row._freshOrder?.full_order_number,
    row._freshOrder?.order_number,
    row._freshOrder?.invoice_number,
    row.order_number,
    row.invoice_number,
  ].forEach((value) => addReference(exactReferences, value));

  // Compatibility references are deliberately last. They remain exact string
  // matches and are accepted only after customer/branch scoping succeeds.
  const compatibilityReferences = new Set();
  [
    row.reference_no,
    row.orderNumber,
    row.orderId,
    row._freshOrder?.orderNumber,
    row._freshOrder?.orderId,
  ].forEach((value) => addReference(compatibilityReferences, value));

  return { sourceIds, exactReferences, compatibilityReferences };
}

export function resolveInvoiceRowFromAllocations({
  row,
  allocations = [],
  paymentsById = new Map(),
  referencePayments = [],
  legacyLedgerPayments = [],
  invoiceTotal = 0,
} = {}) {
  const { sourceIds, exactReferences, compatibilityReferences } =
    getInvoiceAllocationKeys(row);
  const customerAccountId = String(
    row?.customer_account_id || row?._freshOrder?.customer_account_id || ""
  );
  const branchId = String(
    row?.customer_branch_id || row?.branch_id || row?._freshOrder?.customer_branch_id || row?._freshOrder?.branch_id || ""
  );
  const ledgerReferences = getInvoiceLedgerReferenceKeys(row);

  const allocatedAmount = allocations.reduce((sum, allocation) => {
    if (!isActiveInvoiceAllocation(allocation)) return sum;
    const payment = paymentsById.get(String(allocation.payment_id || ""));
    if (!payment || !isActiveInvoicePayment(payment)) return sum;

    if (
      customerAccountId &&
      String(allocation.customer_account_id || "") !== customerAccountId
    ) {
      return sum;
    }
    if (
      branchId &&
      String(allocation.customer_branch_id || allocation.branch_id || "") !== branchId
    ) {
      return sum;
    }

    const allocationSourceId = String(allocation.invoice_source_id || "").trim();
    const allocationReference = normalizeRef(allocation.invoice_reference);
    const sourceMatch = allocationSourceId && sourceIds.has(allocationSourceId);
    const exactReferenceMatch =
      allocationReference && exactReferences.has(allocationReference);
    const compatibilityMatch =
      allocationReference && compatibilityReferences.has(allocationReference);
    const hasComparableSourceIds = UUID_PATTERN.test(allocationSourceId) && sourceIds.size > 0;
    if (
      (hasComparableSourceIds && !sourceMatch) ||
      (!hasComparableSourceIds && !exactReferenceMatch && !compatibilityMatch)
    ) return sum;

    return sum + Math.max(0, Number(allocation.allocated_amount || 0));
  }, 0);

  const legacyLedgerPaidAmount = legacyLedgerPayments.reduce((sum, payment) => {
    if (!isActiveLegacyLedgerPayment(payment)) return sum;
    if (!hasMatchingScope(row, payment)) return sum;
    const paymentReferences = getPaymentReferenceKeys(payment);
    if (![...paymentReferences].some((reference) => ledgerReferences.has(reference))) return sum;
    return sum + getPositivePaymentAmount(payment);
  }, 0);

  const canonicalReferencePaidAmount = referencePayments.reduce((sum, payment) => {
    if (!isActiveInvoicePayment(payment) || !hasMatchingScope(row, payment)) return sum;

    const paymentOrderId = String(payment.order_id || "").trim();
    const hasComparableSourceIds = UUID_PATTERN.test(paymentOrderId) && sourceIds.size > 0;
    const uuidMatch = hasComparableSourceIds && sourceIds.has(paymentOrderId);
    const paymentReferences = getPaymentReferenceKeys(payment);
    const referenceMatch = [...paymentReferences].some((reference) =>
      ledgerReferences.has(reference)
    );
    if ((hasComparableSourceIds && !uuidMatch) || (!hasComparableSourceIds && !referenceMatch)) {
      return sum;
    }

    return sum + getPositivePaymentAmount(payment);
  }, 0);

  const total = Math.max(0, Number(invoiceTotal || 0));
  const storedLedgerInvoicePaidAmount = getStoredLedgerInvoicePaidAmount(row, total);
  // A canonical payment may also have a customer_ledger mirror. Taking the
  // larger resolved effect prevents counting the same payment twice while
  // retaining support for legacy ledger-only payments.
  const resolvedPaidAmount = Math.max(
    allocatedAmount,
    canonicalReferencePaidAmount,
    legacyLedgerPaidAmount,
    storedLedgerInvoicePaidAmount,
  );
  const paidAmount = Math.min(total || resolvedPaidAmount, resolvedPaidAmount);
  const invoiceStatus =
    total > 0 && resolvedPaidAmount >= total - 0.01
      ? "PAID"
      : resolvedPaidAmount > 0
        ? "PART PAID"
        : "UNPAID";

  return {
    ...row,
    paid_amount: paidAmount,
    amount_paid: paidAmount,
    remaining_amount: Math.max(0, total - paidAmount),
    outstanding_amount: Math.max(0, total - paidAmount),
    invoice_status: invoiceStatus,
    payment_status: invoiceStatus,
    status: invoiceStatus,
    _allocationPaidAmount: resolvedPaidAmount,
    _canonicalAllocationPaidAmount: allocatedAmount,
    _canonicalReferencePaidAmount: canonicalReferencePaidAmount,
    _legacyLedgerPaidAmount: legacyLedgerPaidAmount,
    _storedLedgerInvoicePaidAmount: storedLedgerInvoicePaidAmount,
  };
}

export function getResolvedInvoiceOutstanding(row = {}) {
  const explicitOutstanding = row.outstanding_amount ?? row.remaining_amount;
  if (explicitOutstanding !== null && explicitOutstanding !== undefined && explicitOutstanding !== "") {
    const parsed = Number(explicitOutstanding);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }

  const total = Number(
    row.invoice_total ?? row.invoice_amount ?? row.debit ?? row.amount ?? 0
  );
  const paid = Number(row._allocationPaidAmount ?? row.paid_amount ?? row.amount_paid ?? 0);
  return Math.max(0, (Number.isFinite(total) ? total : 0) - (Number.isFinite(paid) ? paid : 0));
}

export function sumResolvedInvoiceOutstanding(rows = []) {
  return (rows || []).reduce(
    (sum, row) => sum + getResolvedInvoiceOutstanding(row),
    0
  );
}
