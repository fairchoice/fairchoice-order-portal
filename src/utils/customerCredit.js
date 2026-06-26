const getEntryType = (row = {}) =>
  String(row.entry_type || row.transaction_type || row.type || "").trim().toUpperCase();

const getNumber = (value) => Number(value || 0);

export const getLedgerDebit = (row = {}) => {
  const debit = getNumber(row.debit);

  if (debit) return debit;

  const type = getEntryType(row);
  if (type === "INVOICE") {
    return getNumber(row.amount || row.invoice_amount || row.payment_amount);
  }

  return 0;
};

export const getLedgerCredit = (row = {}) => {
  const credit = getNumber(row.credit);

  if (credit) return credit;

  const type = getEntryType(row);
  if (type === "PAYMENT") {
    return getNumber(row.amount || row.payment_amount || row.amount_collected);
  }

  return 0;
};

export const calculateCustomerCredit = (
  customer = {},
  ledgerRows = [],
  openingBalance = 0
) => {
  const creditLimit = getNumber(customer?.credit_limit || customer?.creditLimit);
  const opening = getNumber(openingBalance || customer?.opening_balance);

  const ledgerMovement = (ledgerRows || []).reduce(
    (total, row) => total + getLedgerDebit(row) - getLedgerCredit(row),
    0
  );

  const outstanding = opening + ledgerMovement;
  const availableCredit = creditLimit - outstanding;

  return {
    creditLimit,
    openingBalance: opening,
    outstanding,
    outstandingBalance: outstanding,
    availableCredit,
  };
};
