import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertUniquePaymentIds,
  classifyPaymentRecord,
  PAYMENT_HISTORY_PAGE_SIZE,
} from "./paymentHistoryReadOnlyService.js";

test("read-only payment history uses 20-row pages", () => {
  assert.equal(PAYMENT_HISTORY_PAGE_SIZE, 20);
});

test("classifies active, pending-bank and voided records distinctly", () => {
  assert.equal(classifyPaymentRecord({ status: "POSTED", verification_status: "CONFIRMED" }), "active");
  assert.equal(
    classifyPaymentRecord({
      status: "POSTED",
      verification_status: "PENDING_VERIFICATION",
      payment_method: "Bank Transfer",
    }),
    "pending"
  );
  assert.equal(classifyPaymentRecord({ status: "VOIDED" }), "voided");
});

test("rejects duplicate canonical payment IDs", () => {
  assert.throws(
    () => assertUniquePaymentIds([{ id: "payment-1" }, { id: "payment-1" }]),
    /duplicate payment ID/i
  );
  assert.deepEqual(assertUniquePaymentIds([{ id: "payment-1" }, { id: "payment-2" }]), [
    { id: "payment-1" },
    { id: "payment-2" },
  ]);
});

test("payment history service contains no database write or RPC calls", async () => {
  const source = await readFile(new URL("./paymentHistoryReadOnlyService.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.(?:insert|update|upsert|delete)\s*\(/);
  assert.doesNotMatch(source, /\.rpc\s*\(/);
  assert.match(source, /\.from\("customer_payments"\)\s*\.select\(/);
});
