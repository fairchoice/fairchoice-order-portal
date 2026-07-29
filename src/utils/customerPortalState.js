const CUSTOMER_PAGES = new Set(["order", "paymentHistory"]);
const SALES_REP_PAGES = new Set([
  "order",
  "salesCashCollection",
  "salesCreditHistory",
  "salesReturn",
]);
const KNOWN_PORTAL_PAGES = new Set([
  ...CUSTOMER_PAGES,
  ...SALES_REP_PAGES,
  "branchSeparation",
  "categories",
  "centralPayment",
  "credit",
  "customers",
  "driver",
  "invoicesPortal",
  "loginSetup",
  "orders",
  "orderSalesInvoices",
  "preOrderSupply",
  "priceManagement",
  "pricingRule",
  "productImportExport",
  "products",
  "promotions",
  "returnsPortal",
  "staff",
  "stockhistory",
  "stockreceipts",
  "stockTaking",
  "suppliers",
  "warehouse",
  "weeklyAccount",
]);

const BACK_OFFICE_HASH_ROUTES = {
  "#admin": "orders",
  "#products": "products",
  "#warehouse": "warehouse",
  "#driver": "driver",
  "#stock-receipts": "stockreceipts",
  "#stockhistory": "stockhistory",
  "#config": "loginSetup",
  "#customers": "customers",
  "#credit": "credit",
  "#home-content-notices": "homePageImages",
};

export const CUSTOMER_PORTAL_HOME_VIEW = "home";

export function buildCustomerPortalHistoryState(
  currentState,
  { page = "order", view = CUSTOMER_PORTAL_HOME_VIEW } = {}
) {
  const safeCurrentState =
    currentState && typeof currentState === "object" ? currentState : {};
  return {
    ...safeCurrentState,
    fairchoicePortal: true,
    page,
    view,
  };
}

export function getCustomerPortalHistoryAction(
  currentState,
  nextView
) {
  if (
    currentState?.fairchoicePortal === true &&
    currentState?.view === nextView
  ) {
    return "none";
  }
  return currentState?.fairchoicePortal === true &&
    currentState?.view !== CUSTOMER_PORTAL_HOME_VIEW
    ? "replace"
    : "push";
}

export function isCustomerPortalHomeView({
  page = "order",
  showHomepage = false,
  hasSelectedProduct = false,
} = {}) {
  return (
    page === "order" &&
    showHomepage === true &&
    hasSelectedProduct === false
  );
}

export function resolveCustomerPortalPage({
  hash = "",
  isAdmin = false,
  isSalesRep = false,
  isWarehouse = false,
  isDriver = false,
  isCustomer = false,
} = {}) {
  const normalizedHash = String(hash || "").trim().toLowerCase();

  if (isAdmin) return BACK_OFFICE_HASH_ROUTES[normalizedHash] || "orders";

  if (isCustomer) {
    return ["#credit", "#payment-history"].includes(normalizedHash)
      ? "paymentHistory"
      : "order";
  }

  if (isSalesRep) {
    return {
      "#cash-collection": "salesCashCollection",
      "#credit": "salesCreditHistory",
      "#return": "salesReturn",
      "#sales-cash-collection": "salesCashCollection",
      "#sales-credit-history": "salesCreditHistory",
      "#sales-return": "salesReturn",
    }[normalizedHash] || "order";
  }

  if (isDriver) return normalizedHash === "#driver" ? "driver" : "driver";
  if (isWarehouse) return normalizedHash === "#stockhistory" ? "stockhistory" : "warehouse";
  return "order";
}

export function getCustomerPortalHash(
  page,
  { isAdmin = false, isCustomer = false, isSalesRep = false } = {}
) {
  if (isAdmin) {
    if (page === "homePageImages") return "";
    return Object.entries(BACK_OFFICE_HASH_ROUTES).find(
      ([, routePage]) => routePage === page
    )?.[0] || "";
  }

  if (isCustomer) {
    return page === "paymentHistory" ? "#credit" : "#order";
  }

  if (isSalesRep) {
    return {
      order: "#order",
      salesCashCollection: "#cash-collection",
      salesCreditHistory: "#credit",
      salesReturn: "#return",
    }[page] || "#order";
  }

  return "";
}

export function isCustomerPortalPageAllowed(
  page,
  { isCustomer = false, isSalesRep = false } = {}
) {
  if (isCustomer) return CUSTOMER_PAGES.has(page);
  if (isSalesRep) return SALES_REP_PAGES.has(page);
  return KNOWN_PORTAL_PAGES.has(page);
}

export function getCustomerCartStorageKey(user = {}) {
  const owner =
    user.login_user_id || user.id || user.customer_account_id || user.username || user.email || "guest";
  return `fairchoice_cart:${encodeURIComponent(String(owner))}`;
}

export function isOrderAuthError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error?.details || "").toLowerCase();

  return (
    status === 401 ||
    code === "PGRST301" ||
    message.includes("jwt expired") ||
    message.includes("invalid jwt") ||
    message.includes("refresh token") ||
    message.includes("session expired")
  );
}

export function getOrderSubmissionErrorMessage(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const message = String(error?.message || error?.details || "").trim();
  const normalizedMessage = message.toLowerCase();

  if (isOrderAuthError(error)) {
    return "Your session has expired. Your cart has been saved. Please log in again and retry the order.";
  }
  if (status === 403 || normalizedMessage.includes("permission denied")) {
    return "The order was not submitted because this account does not have permission. Your cart has been saved; please contact FairChoice support.";
  }
  if (
    error?.name === "AbortError" ||
    normalizedMessage.includes("timeout") ||
    normalizedMessage.includes("timed out")
  ) {
    return "The order request timed out. Your cart has been saved. Check your connection and try again.";
  }
  if (
    error instanceof TypeError ||
    normalizedMessage.includes("failed to fetch") ||
    normalizedMessage.includes("network")
  ) {
    return "The order could not reach FairChoice. Your cart has been saved. Check your internet connection and try again.";
  }

  return `The order was not submitted. Your cart has been saved.${message ? `\n\n${message}` : " Please try again."}`;
}

