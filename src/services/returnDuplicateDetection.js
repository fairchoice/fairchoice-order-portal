const normalizedReturnItem = (item = {}) => ({
  productId: String(item.product_id || item.productId || item.id || ""),
  quantity: Number(item.qty || item.quantity || item.returnQty || 0),
});

const customerAccountIdFor = (order = {}) =>
  order.customerAccountId || order.customer_account_id || null;

export function findMatchingReturn({ order, returnType, items, existingReturns = [] } = {}) {
  const orderId = String(order?.dbId || order?.id || "");
  const customerAccountId = String(customerAccountIdFor(order) || "");
  const requestedItems = (items || []).map(normalizedReturnItem)
    .filter((item) => item.productId && item.quantity > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId));

  return (existingReturns || []).find((candidate) => {
    if (!["pending warehouse confirmation", "confirmed"].includes(String(candidate.status || "").toLowerCase())) return false;
    if (String(candidate.order_id || "") !== orderId) return false;
    if (String(candidate.customer_account_id || "") !== customerAccountId) return false;
    if (String(candidate.return_type || "") !== String(returnType || "")) return false;
    const candidateItems = (candidate.customer_return_items || candidate.items || [])
      .map(normalizedReturnItem)
      .filter((item) => item.productId && item.quantity > 0)
      .sort((a, b) => a.productId.localeCompare(b.productId));
    return JSON.stringify(candidateItems) === JSON.stringify(requestedItems);
  }) || null;
}
