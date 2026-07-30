export const OWNER_USERNAME = "nisstaj_admin";

export function isOwnerUser(user) {
  return String(user?.username || "").trim().toLowerCase() === OWNER_USERNAME;
}

const MANUAL_PAYMENT_SECTION = Object.freeze(["manual", "Manual Payment"]);
const OWNER_FINANCIAL_SECTIONS = Object.freeze([
  Object.freeze(["history", "Payment History"]),
  Object.freeze(["archive", "Payment Archive"]),
  Object.freeze(["ledger", "Global Ledger & Archive"]),
]);

export function getCentralPaymentSections(user) {
  return isOwnerUser(user)
    ? [MANUAL_PAYMENT_SECTION, ...OWNER_FINANCIAL_SECTIONS]
    : [MANUAL_PAYMENT_SECTION];
}

export async function runOwnerFinancialRequest(user, request) {
  if (!isOwnerUser(user)) return undefined;
  return request();
}
