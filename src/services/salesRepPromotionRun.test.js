import test from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER_MODES,
  buildPromotionCartLine,
  buildPromotionRunNotes,
  canUsePromotionInvoice,
  getPromotionRunCustomer,
} from "./salesRepPromotionRun.js";

test("guest customer never qualifies for invoice", () => {
  assert.equal(canUsePromotionInvoice(CUSTOMER_MODES.GUEST, { id: "c1" }), false);
  assert.equal(canUsePromotionInvoice(CUSTOMER_MODES.REGISTERED, { id: "c1" }), true);
});

test("guest sale uses explicit Guest Customer identity without account id", () => {
  const guest = getPromotionRunCustomer({ customerMode: CUSTOMER_MODES.GUEST });
  assert.equal(guest.account_name, "Guest Customer");
  assert.equal(guest.id, null);
});

test("promotion run notes preserve payment method and competitor sales", () => {
  const notes = buildPromotionRunNotes({
    paymentMethod: "Cash",
    competitorSales: "Elfbar 12 units",
    customerMode: CUSTOMER_MODES.REGISTERED,
    invoiceRequested: true,
    invoiceEmail: "buyer@example.com",
    promotionName: "Buy 10 Get 1 Free",
  });
  assert.match(notes, /Payment method: Cash/);
  assert.match(notes, /Competitor sales: Elfbar 12 units/);
  assert.match(notes, /Invoice requested: Yes/);
});

test("promotion cart line keeps normal order item shape", () => {
  const line = buildPromotionCartLine({
    product: { id: "p1", product_code: "ABC", product_name: "Test", stock: 4 },
    quantity: 2,
    unitPrice: 3.5,
  });
  assert.equal(line.qty, 2);
  assert.equal(line.unit_price, 3.5);
  assert.equal(line.line_total, 7);
  assert.equal(line.includeInPicking, true);
});
