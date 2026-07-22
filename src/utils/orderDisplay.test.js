import assert from "node:assert/strict";
import test from "node:test";
import { formatDisplayOrderId } from "./orderDisplay.js";

test("shortens generated order numbers to the first 10 numeric digits", () => {
  assert.equal(formatDisplayOrderId("ORD-1784658759299-c183dc2c"), "ORD-1784658759");
  assert.equal(formatDisplayOrderId("ORD-1784648440888-d0ce811e"), "ORD-1784648440");
  assert.equal(formatDisplayOrderId("ORD-1784646582830-a4505c98"), "ORD-1784646582");
});

test("keeps only the first 10 digits for future longer order numbers", () => {
  assert.equal(formatDisplayOrderId("ORD-12345678901234567890-extra"), "ORD-1234567890");
});

test("leaves non-order references unchanged", () => {
  assert.equal(formatDisplayOrderId("INV-12345"), "INV-12345");
  assert.equal(formatDisplayOrderId("SALES_REP_COLLECTION"), "SALES_REP_COLLECTION");
  assert.equal(formatDisplayOrderId(""), "");
  assert.equal(formatDisplayOrderId(null), "");
});
