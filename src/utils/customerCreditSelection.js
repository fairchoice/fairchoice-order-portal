export function hasConfiguredCreditAccount(customer = {}) {
  return (
    Number(customer.credit_limit || customer.creditLimit || 0) > 0 ||
    Boolean(String(customer.payment_terms || customer.paymentTerms || "").trim())
  );
}

export function hasCreditSnapshotActivity(snapshot) {
  if (!snapshot) return false;

  return [
    snapshot.openingBalances,
    snapshot.invoices,
    snapshot.payments,
    snapshot.transactionHistory,
  ].some((rows) => Array.isArray(rows) && rows.length > 0);
}

export function canSelectCustomerForCredit(customer, snapshot) {
  return hasConfiguredCreditAccount(customer) || hasCreditSnapshotActivity(snapshot);
}
