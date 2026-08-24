import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const receivedOrdersSource = readFileSync(
  new URL("../pages/AdminOrders.jsx", import.meta.url),
  "utf8",
);
const paymentServiceSource = readFileSync(new URL("./centralPaymentService.js", import.meta.url), "utf8");

test("Central Payment edit requires its important-function permission", () => {
  assert.match(paymentServiceSource, /editCentralPayment\(\{ currentUser[\s\S]*?canPerform\(currentUser, "payments\.edit"\)/);
  assert.match(paymentServiceSource, /payments\.amount\.change/);
});

test("Central Payment archive and restore require reverse permission", () => {
  assert.match(paymentServiceSource, /removeCentralPayment\(\{ currentUser[\s\S]*?canPerform\(currentUser, "payments\.reverse"\)/);
  assert.match(paymentServiceSource, /restoreCentralPayment\(\{ currentUser[\s\S]*?canPerform\(currentUser, "payments\.reverse"\)/);
});

test("Received Orders cancel and archive handlers use stable important-function keys", () => {
  assert.match(receivedOrdersSource, /FC_PERMISSIONS\.ORDERS_CANCEL/);
  assert.match(receivedOrdersSource, /FC_PERMISSIONS\.ORDERS_ARCHIVE/);
  assert.match(receivedOrdersSource, /FC_PERMISSIONS\.ORDERS_DELETE/);
  assert.doesNotMatch(receivedOrdersSource, /requirePermission\([^\n]+"can_cancel_order"/);
});
