export const normalizeInvoicePaymentStatus = (status = "") =>
  String(status || "")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");

export const getCustomerInvoiceWatermark = (status = "") => {
  const normalizedStatus = normalizeInvoicePaymentStatus(status);

  if (normalizedStatus === "PAID") return "PAID";
  if (
    normalizedStatus === "PART PAID" ||
    normalizedStatus === "PARTIALLY PAID"
  ) {
    return "PART PAID";
  }

  return "IN PROGRESS";
};

export const getInvoiceActionForStatus = (status = "") => {
  const normalizedStatus = normalizeInvoicePaymentStatus(status);
  return normalizedStatus === "PAID" ? "DOWNLOAD" : "VIEW";
};
