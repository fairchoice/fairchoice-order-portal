import { persistPromotionRunForOrder } from "./promotionRunPersistence";

export const calculateRequestedWalletAmount = ({
  walletUseRequested = false,
  walletBalance = 0,
  orderTotal = 0,
} = {}) => {
  if (!walletUseRequested) return 0;

  const availableWallet = Math.max(0, Number(walletBalance || 0));
  const payableOrderTotal = Math.max(0, Number(orderTotal || 0));

  return Math.min(availableWallet, payableOrderTotal);
};

export const buildCustomerOrderRequest = ({
  orderNumber,
  customer,
  branch,
  priceMode,
  cart,
  finalTotal,
  effectiveOrderDiscountPercent = 0,
  discountAmount = 0,
  canManualCheckoutDiscount = false,
  userProfile = {},
  orderCountry = "",
  creditLimit,
  walletUseRequested = false,
  walletBalance = 0,
} = {}) => {
  const walletRequestedAmount = calculateRequestedWalletAmount({
    walletUseRequested,
    walletBalance,
    orderTotal: finalTotal,
  });
  const shouldUseWallet = walletRequestedAmount > 0;

  return {
    orderNumber,
  companyName: customer?.account_name || "",
  priceMode,
  cart,
  total: finalTotal,
  discount_percent: effectiveOrderDiscountPercent,
  discount_amount: canManualCheckoutDiscount ? Number(discountAmount || 0) : 0,
  discount_applied_by: canManualCheckoutDiscount ? userProfile?.id || "" : "",
  discount_applied_by_name: canManualCheckoutDiscount
    ? userProfile?.full_name || userProfile?.name || ""
    : "",
  customer_account_id: customer?.id || null,
  customer_branch_id: branch?.id || null,
  delivery_branch_name: branch?.branch_name || "",
  delivery_address: branch?.delivery_address || "",
  delivery_postcode: branch?.postcode || "",
  customer_country: orderCountry,
  credit_limit: creditLimit,
  wallet_use_requested: shouldUseWallet,
  wallet_requested_amount: walletRequestedAmount,
  wallet_requested_at: shouldUseWallet ? new Date().toISOString() : null,
    notes: "Payment status: UNPAID. No Payment Now selected.",
  };
};

const persistPromotionRunWithoutBlockingOrder = async ({
  createdOrder,
  promotionRunContext,
  persistPromotionRun = persistPromotionRunForOrder,
} = {}) => {
  if (!promotionRunContext || typeof persistPromotionRun !== "function") return;

  try {
    await persistPromotionRun({
      ...promotionRunContext,
      orderNumber:
        createdOrder?.orderNumber ||
        createdOrder?.order_number ||
        promotionRunContext?.orderNumber ||
        "",
    });
  } catch (error) {
    // Promotion audit must never break a successfully-created customer order.
    console.error("Promotion Run audit error:", error);
  }
};

export const createCustomerOrderWithSessionRetry = async ({
  orderRequest,
  createOrder,
  isAuthError,
  refreshSession,
  findOrderByNumber,
  promotionRunContext = null,
  persistPromotionRun = persistPromotionRunForOrder,
} = {}) => {
  let createdOrder;

  const recoverAlreadyCreatedOrder = async () => {
    const orderNumber = String(orderRequest?.orderNumber || "").trim();
    if (!orderNumber || typeof findOrderByNumber !== "function") return null;

    try {
      return await findOrderByNumber(orderNumber);
    } catch (verificationError) {
      // Verification is best-effort. Preserve the original submission error if
      // the network/database is also unavailable during the verification read.
      console.warn("[OrderSubmission] could not verify order after submit error", verificationError);
      return null;
    }
  };

  try {
    createdOrder = await createOrder(orderRequest);
  } catch (error) {
    // A browser can lose the response after the server has already committed
    // the order. Always verify the same order number before allowing a retry.
    createdOrder = await recoverAlreadyCreatedOrder();

    if (!createdOrder) {
      if (!isAuthError(error)) throw error;

      const refreshed = await refreshSession();
      if (refreshed?.error || !refreshed?.data?.session) throw error;

      // The first request may have completed while the session was being
      // refreshed, so verify again before issuing a second write.
      createdOrder = await recoverAlreadyCreatedOrder();
      if (!createdOrder) {
        createdOrder = await createOrder(orderRequest);
      }
    }
  }

  await persistPromotionRunWithoutBlockingOrder({
    createdOrder,
    promotionRunContext,
    persistPromotionRun,
  });

  return createdOrder;
};
