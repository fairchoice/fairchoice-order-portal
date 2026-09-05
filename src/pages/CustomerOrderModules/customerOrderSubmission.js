import { persistPromotionRunForOrder } from "./promotionRunPersistence";

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
} = {}) => ({
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
  notes: "Payment status: UNPAID. No Payment Now selected.",
});

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
  promotionRunContext = null,
  persistPromotionRun = persistPromotionRunForOrder,
} = {}) => {
  let createdOrder;

  try {
    createdOrder = await createOrder(orderRequest);
  } catch (error) {
    if (!isAuthError(error)) throw error;
    const refreshed = await refreshSession();
    if (refreshed?.error || !refreshed?.data?.session) throw error;
    createdOrder = await createOrder(orderRequest);
  }

  await persistPromotionRunWithoutBlockingOrder({
    createdOrder,
    promotionRunContext,
    persistPromotionRun,
  });

  return createdOrder;
};
