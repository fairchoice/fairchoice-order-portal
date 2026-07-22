const normalizeCustomerStatus = (status) =>
  String(status || "Active").trim().toLowerCase();

export const getCustomerStatusLabel = (status) => {
  const normalizedStatus = normalizeCustomerStatus(status);

  if (["stopped", "stop", "closed", "inactive"].includes(normalizedStatus)) {
    return "Inactive";
  }

  if (["hold", "on hold"].includes(normalizedStatus)) {
    return "On Hold";
  }

  return "Active";
};

export const getStoredCustomerStatus = (status) =>
  getCustomerStatusLabel(status) === "Inactive"
    ? "Closed"
    : getCustomerStatusLabel(status);

export const isInactiveCustomer = (customer) =>
  customer?.active === false ||
  getCustomerStatusLabel(customer?.account_status || customer?.status) ===
    "Inactive";

export const isOperationalCustomer = (customer) =>
  !isInactiveCustomer(customer) &&
  getCustomerStatusLabel(customer?.account_status || customer?.status) ===
    "Active";
