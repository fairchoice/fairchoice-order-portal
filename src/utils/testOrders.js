const normalizeTestValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const TEST_SHOP_NAMES = new Set(["test shop"]);

export const isTestCustomer = (customer = {}) => {
  const values = [
    customer,
    customer.account_name,
    customer.company_name,
    customer.companyName,
    customer.customer_name,
    customer.customerName,
    customer.branch_name,
    customer.branchName,
    customer.shop_name,
    customer.shopName,
    customer.delivery_branch_name,
    customer.deliveryBranchName,
    customer.name,
  ];

  if (
    customer?.is_test_customer === true ||
    customer?.isTestCustomer === true ||
    customer?.test_customer === true ||
    customer?.testCustomer === true
  ) {
    return true;
  }

  return values.some((value) => TEST_SHOP_NAMES.has(normalizeTestValue(value)));
};

export const isTestOrder = (order = {}) => {
  if (!order) return false;

  if (
    order.is_test_order === true ||
    order.isTestOrder === true ||
    order.test_order === true ||
    order.testOrder === true
  ) {
    return true;
  }

  return isTestCustomer(order);
};
