const firstValue = (...values) =>
  values.find(
    (value) => value !== undefined && value !== null && value !== ""
  );

export function isActiveCustomerBranch(branch = {}) {
  const active = firstValue(branch.active, branch.is_active);
  const status = String(branch.status || "")
    .trim()
    .toLowerCase();

  const branchName = String(
    firstValue(branch.branch_name, branch.name) || ""
  ).trim();

  if (!branchName) return false;

  if (
    active === false ||
    String(active).toLowerCase() === "false"
  ) {
    return false;
  }

  if (
    branch.disabled === true ||
    String(branch.disabled).toLowerCase() === "true"
  ) {
    return false;
  }

  if (
    branch.archived === true ||
    String(branch.archived).toLowerCase() === "true"
  ) {
    return false;
  }

  if (
    branch.deleted === true ||
    String(branch.deleted).toLowerCase() === "true"
  ) {
    return false;
  }

  if (
    ["inactive", "disabled", "archived", "deleted"].includes(status)
  ) {
    return false;
  }

  return true;
}

export function branchBelongsToCustomer(branch = {}, customer = {}) {
  const branchCustomerId = firstValue(
    branch.customer_account_id,
    branch.customerAccountId,
    branch.customer_id,
    branch.customerId,
    branch.account_id,
    branch.accountId
  );

  if (!branchCustomerId || !customer?.id) return false;

  return String(branchCustomerId) === String(customer.id);
}

export function getActiveCustomerBranches(customer = {}) {
  return (customer?.customer_branches || []).filter(
    (branch) =>
      isActiveCustomerBranch(branch) &&
      branchBelongsToCustomer(branch, customer)
  );
}

export function customerUsesBranchCredit(customer = {}) {
  return getActiveCustomerBranches(customer).length > 0;
}