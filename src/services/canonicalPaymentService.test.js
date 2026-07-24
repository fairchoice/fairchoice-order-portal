import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_PAYMENT_SOURCES,
  buildCanonicalPaymentRpcParams,
  createCanonicalPaymentIdempotencyKey,
  shouldCreateCanonicalDeliveryPayment,
} from "./canonicalPaymentService.js";

test("delivery without money creates no canonical payment", () => {
  assert.equal(
    shouldCreateCanonicalDeliveryPayment({
      paymentCollected: "No",
      paymentType: "Credit",
      amount: 0,
    }),
    false
  );
});

test("partial and full delivery collections each create one canonical intent", () => {
  assert.equal(
    shouldCreateCanonicalDeliveryPayment({
      paymentCollected: "Yes",
      paymentType: "Cash",
      amount: 40,
    }),
    true
  );
  assert.equal(
    shouldCreateCanonicalDeliveryPayment({
      paymentCollected: "Yes",
      paymentType: "Card",
      amount: 100,
    }),
    true
  );
});

test("account and credit delivery choices are not money received", () => {
  for (const paymentType of ["Account", "Credit"]) {
    assert.equal(
      shouldCreateCanonicalDeliveryPayment({
        paymentCollected: "Yes",
        paymentType,
        amount: 100,
      }),
      false
    );
  }
});

test("retry key is stable for the same source and intent", () => {
  const first = createCanonicalPaymentIdempotencyKey(
    CANONICAL_PAYMENT_SOURCES.DRIVER_DELIVERY,
    "delivery:order-1"
  );
  const second = createCanonicalPaymentIdempotencyKey(
    CANONICAL_PAYMENT_SOURCES.DRIVER_DELIVERY,
    "delivery:order-1"
  );
  assert.equal(first, second);
});

test("RPC parameters keep human reference separate from database order ID", () => {
  const params = buildCanonicalPaymentRpcParams({
    customerAccountId: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
    customerBranchId: "8f598571-db45-424b-9d23-1fe2fba98d78",
    amount: 43,
    paymentMethod: "Cash",
    paymentSource: CANONICAL_PAYMENT_SOURCES.DRIVER_DELIVERY,
    paymentReference: "ORD-1783300314589",
    orderId: "37c527c4-fdff-4a1a-9ebc-33124a5b6966",
    paymentIntentId: "delivery:37c527c4-fdff-4a1a-9ebc-33124a5b6966",
  });
  assert.equal(params.p_payment_reference, "ORD-1783300314589");
  assert.equal(params.p_order_id, "37c527c4-fdff-4a1a-9ebc-33124a5b6966");
});
