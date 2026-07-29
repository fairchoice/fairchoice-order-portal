const accountIdFor = (row = {}) =>
  row.customer_account_id ||
  row.customerAccountId ||
  row.account_id ||
  row.id ||
  "";

export function isTestAccount(row = {}, testAccountIds = new Set()) {
  if (row.is_test_account === true) return true;
  const accountId = String(accountIdFor(row));
  return Boolean(accountId && testAccountIds.has(accountId));
}

export function getTestAccountIds(accounts = []) {
  return new Set(
    accounts
      .filter((account) => account.is_test_account === true)
      .map((account) => String(account.id))
  );
}

export function excludeTestAccountRows(
  rows = [],
  { accounts = [], testAccountIds = getTestAccountIds(accounts) } = {}
) {
  return rows.filter((row) => !isTestAccount(row, testAccountIds));
}
