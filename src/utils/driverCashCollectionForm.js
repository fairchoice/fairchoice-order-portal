const asMoneyInput = (value) => String(Math.max(0, Number(value || 0)));

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const verifiedUuidOrNull = (value) => {
  const normalized = String(value || "").trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
};

export function resolveDriverDeliveryAllocations({
  effectiveCollectionType,
  previewAllocations = [],
  orderUuid,
  invoiceReference,
  allocatedAmount,
  customerBranchId = null,
} = {}) {
  if (String(effectiveCollectionType || "").toUpperCase() !== "TODAY_INVOICE") {
    return previewAllocations;
  }

  const canonicalOrderUuid = verifiedUuidOrNull(orderUuid);
  if (!canonicalOrderUuid) {
    throw new Error("TODAY_INVOICE requires the database order UUID.");
  }

  const readableReference = String(invoiceReference || "").trim();
  if (!readableReference) {
    throw new Error("TODAY_INVOICE requires the readable order reference.");
  }

  const amount = Number(allocatedAmount || 0);
  if (!(amount > 0)) {
    throw new Error("TODAY_INVOICE allocation amount must be greater than zero.");
  }

  const todayAllocation = previewAllocations.find((allocation) =>
    verifiedUuidOrNull(
      allocation?.invoiceSourceId || allocation?.invoice_source_id
    )
  );

  if (!todayAllocation) {
    throw new Error(
      "TODAY_INVOICE could not find the canonical customer invoice."
    );
  }

  const canonicalInvoiceUuid = verifiedUuidOrNull(
    todayAllocation.invoiceSourceId || todayAllocation.invoice_source_id
  );

  return [
    {
      ...todayAllocation,
      invoiceReference:
        todayAllocation.invoiceReference ||
        todayAllocation.invoice_reference ||
        readableReference,
      invoiceSourceId: canonicalInvoiceUuid,
      customerBranchId:
        verifiedUuidOrNull(
          todayAllocation.customerBranchId ||
          todayAllocation.customer_branch_id
        ) || verifiedUuidOrNull(customerBranchId),
      allocatedAmount: amount,
    },
  ];
}

export const normalizeDriverCollectionType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  if (
    [
      "OUTSTANDING_PAYMENT",
      "PREVIOUS_BALANCE",
      "PREVIOUS_CREDIT_BALANCE",
    ].includes(normalized)
  ) {
    return "OUTSTANDING_PAYMENT";
  }
  if (["PART_PAYMENT", "PARTIAL_PAYMENT"].includes(normalized)) {
    return "PART_PAYMENT";
  }
  if (["UNALLOCATED_PAYMENT", "UNKNOWN_PAYMENT"].includes(normalized)) {
    return "UNALLOCATED_PAYMENT";
  }
  return "TODAY_INVOICE";
};

export function getDriverCashCollectionTypeSetup({
  collectionType,
  resolvedCollectionType = "",
  invoiceAmount = 0,
  customerOutstanding = 0,
  paymentType = "Cash",
} = {}) {
  const isCredit = paymentType === "Credit";
  const normalizedCollectionType = isCredit
    ? "OUTSTANDING_PAYMENT"
    : normalizeDriverCollectionType(collectionType);
  const normalizedResolvedType =
    normalizedCollectionType === "UNALLOCATED_PAYMENT" &&
    String(resolvedCollectionType || "").trim()
      ? normalizeDriverCollectionType(resolvedCollectionType)
      : "";
  const effectiveCollectionType =
    normalizedCollectionType === "UNALLOCATED_PAYMENT"
      ? normalizedResolvedType
      : normalizedCollectionType;
  const safeInvoiceAmount = Math.max(0, Number(invoiceAmount || 0));
  const safeOutstanding = Number(customerOutstanding || 0);
  const outstandingDebt = Math.max(0, safeOutstanding);
  const availableAccountCredit = Math.max(0, -safeOutstanding);
  const payableToday = Math.max(
    0,
    safeInvoiceAmount - availableAccountCredit
  );

  const applicableBalance =
    effectiveCollectionType === "TODAY_INVOICE"
      ? safeInvoiceAmount
      : effectiveCollectionType === "PART_PAYMENT"
      ? payableToday
      : effectiveCollectionType === "OUTSTANDING_PAYMENT"
        ? outstandingDebt
        : 0;
  const amountIsFixed =
    !isCredit && effectiveCollectionType === "TODAY_INVOICE";

  return {
    collectionType: normalizedCollectionType,
    resolvedCollectionType: normalizedResolvedType,
    effectiveCollectionType,
    applicableBalance,
    maximumCollectibleAmount: applicableBalance,
    amountInputEnabled: !isCredit && Boolean(effectiveCollectionType),
    amountIsFixed,
    allocationMode:
      effectiveCollectionType === "OUTSTANDING_PAYMENT"
        ? "PREVIOUS_BALANCE"
        : effectiveCollectionType
          ? "TODAY_INVOICE"
          : "",
  };
}

export function applyDriverCollectionType(
  currentForm = {},
  {
    collectionType = currentForm.collectionType,
    resolvedCollectionType = currentForm.resolvedCollectionType,
    invoiceAmount = 0,
    customerOutstanding = 0,
    paymentType = currentForm.paymentType || "Cash",
    resetEditableAmount = false,
  } = {}
) {
  const setup = getDriverCashCollectionTypeSetup({
    collectionType,
    resolvedCollectionType,
    invoiceAmount,
    customerOutstanding,
    paymentType,
  });
  let paymentAmount = currentForm.paymentAmount ?? "";

  if (paymentType === "Credit") {
    paymentAmount = "";
  } else if (setup.amountIsFixed) {
    paymentAmount = asMoneyInput(invoiceAmount);
  } else if (resetEditableAmount) {
    paymentAmount = "";
  }

  return {
    form: {
      ...currentForm,
      paymentType,
      collectionType: setup.collectionType,
      resolvedCollectionType: setup.resolvedCollectionType,
      paymentAmount,
    },
    setup,
  };
}
