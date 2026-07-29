const asMoneyInput = (value) => String(Math.max(0, Number(value || 0)));

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
