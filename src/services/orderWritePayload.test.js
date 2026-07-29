import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { sanitizeOrderWritePayload } from "../utils/orderWritePayload.js";

test("orders writes discard read-side compatibility total aliases", () => {
  assert.deepEqual(
    sanitizeOrderWritePayload({
      subtotal: "10.00",
      net_total: "10.00",
      vat_total: "2.00",
      order_total: "12.00",
      grand_total: "12.00",
      finalTotal: 12,
      final_total: 12,
      totalAmount: 12,
      total_amount: 12,
      total: 12,
      orderTotal: 12,
    }),
    {
      subtotal: "10.00",
      net_total: "10.00",
      vat_total: "2.00",
      order_total: "12.00",
      grand_total: "12.00",
    }
  );
});

test("active explicit order-total writes use the real five-column schema", () => {
  const extracts = [
    [
      new URL("../pages/AdminSetup/InvoicesPortal.jsx", import.meta.url),
      'const { error: orderUpdateError }',
      'if (orderUpdateError)',
    ],
    [
      new URL("../pages/CustomerOrder.jsx", import.meta.url),
      "const saveOrderTotalsToDatabase",
      "const getCalculatedOrderItemForSave",
    ],
    [
      new URL("./centralInvoiceEngine.js", import.meta.url),
      "const orderPayload = {",
      "let { data: savedOrder",
    ],
    [
      new URL("./orders.js", import.meta.url),
      "const orderPayload = {",
      "let order = null",
    ],
  ].map(([file, startMarker, endMarker]) => {
    const source = fs.readFileSync(file, "utf8");
    return source.slice(source.indexOf(startMarker), source.indexOf(endMarker));
  });

  for (const source of extracts) {
    for (const column of [
      "subtotal",
      "net_total",
      "vat_total",
      "order_total",
      "grand_total",
    ]) {
      assert.match(source, new RegExp(`${column}:`));
    }
    assert.doesNotMatch(
      source,
      /(?:finalTotal|final_total|totalAmount|total_amount|(?<![A-Za-z0-9_])total)\s*:/
    );
  }
});
