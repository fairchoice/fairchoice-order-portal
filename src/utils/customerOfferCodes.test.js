import test from "node:test";
import assert from "node:assert/strict";
import { getActiveCustomerOfferCodeIds, getCustomerOfferCodeIds, normalizeOfferCodeIds } from "./customerOfferCodes.js";
import { calculateProductPrice } from "./pricing.js";

const product = { vat_price: 10, vat_type: "0.2", price_code_prices: { base: 9, one: 8, two: 7 } };
const price = (offers, baseMode = "ex vat", overrides = {}) => calculateProductPrice({
  product: { ...product, ...overrides }, priceMode: `code:base|${baseMode}${offers ? `|overlay:${offers}` : ""}`,
  pricingSettings: { price_codes: [{ id: "base", discount_percent: 10 }] },
});

test("legacy and multiple assignments are merged without duplicates", () => {
  assert.deepEqual(getCustomerOfferCodeIds({ customer_price_overlay_code_id: "one", customer_price_overlay_code_ids: ["one", "two"] }), ["one", "two"]);
  assert.deepEqual(normalizeOfferCodeIds("one,two,one"), ["one", "two"]);
  assert.deepEqual(getCustomerOfferCodeIds({}), []);
});

test("inactive offers and offers for a different Base Code are ignored", () => {
  const customer = { customer_price_code_id: "base", customer_price_overlay_code_ids: ["one", "two", "three", "four", "missing"] };
  const codes = [
    { id: "one", code_type: "sub", parent_price_code_id: "base", active: true },
    { id: "two", code_type: "sub", parent_price_code_id: "base", active: false },
    { id: "three", code_type: "sub", parent_price_code_id: "other", active: true },
    { id: "four", code_type: "base", active: true },
  ];
  assert.deepEqual(getActiveCustomerOfferCodeIds(customer, codes), ["one"]);
});

test("overlapping offers choose the lowest exact price without stacking discounts", () => {
  assert.equal(price("one,two").unitPrice, 7);
  assert.equal(price("two,one").unitPrice, 7);
  assert.equal(price("one,one,two").unitPrice, 7);
  assert.equal(price("one,two", "inc vat").grossPrice, 7);
});

test("separate offers apply to separate products and unpriced products use their Base Code", () => {
  assert.equal(price("one,two", "ex vat", { price_code_prices: { one: 8 } }).unitPrice, 8);
  assert.equal(price("one,two", "ex vat", { price_code_prices: { two: 7 } }).unitPrice, 7);
  assert.equal(price("one,two", "ex vat", { price_code_prices: { base: 9 } }).unitPrice, 9);
  assert.equal(price("one,two", "ex vat", { price_code_prices: {} }).unitPrice, 9);
});

test("single legacy offer keeps its exact override even when above the Base Code price", () => {
  assert.equal(price("one", "ex vat", { price_code_prices: { base: 5, one: 8 } }).unitPrice, 8);
  assert.equal(price("").unitPrice, 9);
});

test("invalid or nonpositive offer prices cannot replace valid pricing", () => {
  assert.equal(price("one,two", "ex vat", { price_code_prices: { base: 9, one: -3, two: "bad" } }).unitPrice, 9);
});


test("Ex.VAT adds VAT once and Inc.VAT preserves the exact offer total", () => {
  assert.equal(price("one,two").grossPrice, 8.4);
  assert.equal(price("one,two").vatAmount, 1.4);
  assert.equal(price("one,two", "inc vat").vatAmount, 0);
});
