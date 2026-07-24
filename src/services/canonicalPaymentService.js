import { supabase } from "./supabase.js";

export const PAYMENT_POSTED_EVENT = "fairchoice:canonical-payment-posted";

export const CANONICAL_PAYMENT_SOURCES = Object.freeze({
  CENTRAL_PAYMENT: "CENTRAL_PAYMENT",
  DRIVER_DELIVERY: "DRIVER_DELIVERY_COLLECTION",
  PREVIOUS_BALANCE: "PREVIOUS_BALANCE_COLLECTION",
  SALES_REP: "SALES_REP_COLLECTION",
  CUSTOMER_PORTAL: "CUSTOMER_PORTAL_PAYMENT",
});

export function createPaymentIntentId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error("This browser cannot create a secure payment intent. Please update the browser.");
}

export function createCanonicalPaymentIdempotencyKey(source, intentId) {
  const normalizedSource = String(source || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const normalizedIntent = String(intentId || "").trim();
  if (!normalizedSource || !normalizedIntent) {
    throw new Error("A payment source and stable payment intent are required.");
  }
  return `${normalizedSource}:${normalizedIntent}`;
}

export function shouldCreateCanonicalDeliveryPayment({
  paymentCollected,
  paymentType,
  amount,
} = {}) {
  return (
    String(paymentCollected || "").toLowerCase() === "yes" &&
    Number(amount || 0) > 0 &&
    !["credit", "account"].includes(String(paymentType || "").toLowerCase())
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidOrNull = (value) => {
  const normalized = String(value || "").trim();
  return UUID_PATTERN.test(normalized) ? normalized : null;
};

export function buildCanonicalPaymentRpcParams({
  customerAccountId,
  customerBranchId = null,
  amount,
  paymentDate,
  paymentMethod,
  paymentSource,
  paymentReference,
  paidBy,
  collectorName,
  collectorStaffId = null,
  collectorRole,
  orderId = null,
  invoiceId = null,
  paymentIntentId,
  idempotencyKey,
  notes,
  metadata = {},
  allocations = [],
  ownerUsername = null,
  ownerPassword = null,
} = {}) {
  return {
    p_customer_account_id: customerAccountId,
    p_customer_branch_id: customerBranchId || null,
    p_amount: Number(amount || 0),
    p_payment_date: paymentDate || new Date().toISOString(),
    p_payment_method: paymentMethod,
    p_payment_source: paymentSource,
    p_payment_reference: String(paymentReference || "").trim() || null,
    p_paid_by: paidBy || "",
    p_collector_name: collectorName || "",
    p_collector_staff_id: uuidOrNull(collectorStaffId),
    p_collector_role: collectorRole || "",
    p_order_id: uuidOrNull(orderId),
    p_invoice_id: uuidOrNull(invoiceId),
    p_idempotency_key:
      idempotencyKey ||
      createCanonicalPaymentIdempotencyKey(paymentSource, paymentIntentId),
    p_notes: notes || "",
    p_metadata: metadata || {},
    p_allocations: allocations || [],
    p_owner_username: ownerUsername || null,
    p_owner_password: ownerPassword || null,
  };
}

function notifyCanonicalPaymentPosted(result) {
  if (typeof window === "undefined" || !result?.payment?.id) return;
  window.dispatchEvent(
    new CustomEvent(PAYMENT_POSTED_EVENT, {
      detail: {
        paymentId: result.payment.id,
        customerAccountId: result.payment.customer_account_id,
        customerBranchId: result.payment.customer_branch_id || null,
        duplicate: result.duplicate === true,
      },
    })
  );
}

export async function postCanonicalCustomerPayment(input = {}) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!input.customerAccountId) throw new Error("Customer account is required.");
  if (!(Number(input.amount) > 0)) throw new Error("Payment amount must be greater than zero.");
  if (!input.paymentSource) throw new Error("Payment source is required.");
  if (!input.paymentMethod) throw new Error("Payment method is required.");
  if (!input.idempotencyKey && !input.paymentIntentId) {
    throw new Error("A stable payment intent is required.");
  }

  const { data, error } = await supabase.rpc(
    "post_canonical_customer_payment_v1",
    buildCanonicalPaymentRpcParams(input)
  );

  if (error) throw error;
  notifyCanonicalPaymentPosted(data);
  return data;
}
