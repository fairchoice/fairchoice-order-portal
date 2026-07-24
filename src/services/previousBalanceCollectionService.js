import {
  CANONICAL_PAYMENT_SOURCES,
  buildCanonicalPaymentRpcParams,
  createPaymentIntentId,
  postCanonicalCustomerPayment,
} from "./canonicalPaymentService.js";

export const PREVIOUS_BALANCE_SOURCE = "PREVIOUS_BALANCE_COLLECTION";

export function createPreviousBalancePaymentIntentId() {
  return createPaymentIntentId();
}

export function buildPreviousBalanceRpcParams({
  customerAccountId,
  customerBranchId = null,
  amount,
  paymentMethod,
  paymentDate,
  payerName,
  collectorName,
  collectorStaffId = null,
  collectorRole,
  notes,
  paymentIntentId,
} = {}) {
  return buildCanonicalPaymentRpcParams({
    customerAccountId,
    customerBranchId,
    amount,
    paymentMethod,
    paymentDate,
    paymentSource: CANONICAL_PAYMENT_SOURCES.PREVIOUS_BALANCE,
    paymentReference: "PREVIOUS_BALANCE",
    paidBy: payerName,
    collectorName,
    collectorStaffId,
    collectorRole,
    notes,
    paymentIntentId,
    metadata: { collection_kind: "PREVIOUS_BALANCE" },
  });
}

export async function postPreviousBalanceCollection(input = {}) {
  return postCanonicalCustomerPayment({
    ...input,
    paymentSource: CANONICAL_PAYMENT_SOURCES.PREVIOUS_BALANCE,
    paymentReference: "PREVIOUS_BALANCE",
    paidBy: input.payerName,
    metadata: {
      ...(input.metadata || {}),
      collection_kind: "PREVIOUS_BALANCE",
    },
  });
}
