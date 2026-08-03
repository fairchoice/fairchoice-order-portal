import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const customerOrderSource = fs.readFileSync(
  new URL("../pages/CustomerOrder.jsx", import.meta.url),
  "utf8"
);
const invoiceEngineSource = fs.readFileSync(
  new URL("./centralInvoiceEngine.js", import.meta.url),
  "utf8"
);
const customerCreditSource = fs.readFileSync(
  new URL("../pages/AdminSetup/CustomerCredit.jsx", import.meta.url),
  "utf8"
);

const actionStart = customerOrderSource.indexOf(
  "const openCustomerInvoiceDocument = async"
);
const actionEnd = customerOrderSource.indexOf(
  "const openPickingOrder = async",
  actionStart
);
const actionSource = customerOrderSource.slice(actionStart, actionEnd);

test("Customer invoice actions are selected from the shared resolved status", () => {
  assert.notEqual(actionStart, -1);
  assert.match(customerOrderSource, />\s*View Invoice\s*</);
  assert.match(customerOrderSource, />\s*Download Invoice\s*</);
  assert.match(customerOrderSource, /getInvoiceActionForStatus\(status\) === "VIEW"/);
  assert.match(customerOrderSource, /getInvoiceActionForStatus\(status\) === "DOWNLOAD"/);
  assert.match(
    customerOrderSource,
    /openCustomerInvoiceDocument\(\s*invoiceActionTarget,\s*status,\s*false\s*\)/
  );
  assert.match(
    customerOrderSource,
    /openCustomerInvoiceDocument\(\s*invoiceActionTarget,\s*status,\s*true\s*\)/
  );
  assert.match(customerCreditSource, />\s*View Invoice\s*</);
  assert.match(customerCreditSource, />\s*Download Invoice\s*</);
  assert.match(customerCreditSource, /getInvoiceActionForStatus\(row\.status\)/);
  assert.match(customerCreditSource, /action === "VIEW"/);
  assert.match(customerCreditSource, /action === "DOWNLOAD"/);
});

test("preview and download share the fresh-order and resolved-status path", () => {
  assert.match(actionSource, /await fetchInvoiceOrderFromDb\(order\)/);
  assert.match(actionSource, /getCustomerInvoiceWatermark\(invoiceStatus\)/);
  assert.match(actionSource, /invoicePaymentStatus:\s*invoiceStatus/);
  assert.match(actionSource, /await downloadCentralInvoice\(resolvedOrder\)/);
  assert.match(actionSource, /await previewCentralInvoice\(resolvedOrder\)/);
  assert.match(
    actionSource,
    /This invoice is not linked to an order document\./
  );
  assert.match(actionSource, /Could not \$\{download \? "download" : "open"\} invoice/);
});

test("central invoice HTML renders the resolved three-state watermark", () => {
  assert.match(
    invoiceEngineSource,
    /getCustomerInvoiceWatermark\(\s*order\._documentPaymentStatus/
  );
  assert.match(invoiceEngineSource, /\.watermark\.in-progress/);
  assert.match(invoiceEngineSource, /\.watermark\.part-paid/);
  assert.match(invoiceEngineSource, /\.watermark\.paid/);
  assert.match(
    invoiceEngineSource,
    /paymentStatus\s*\.toLowerCase\(\)\s*\.replace\(\/\\s\+\/g, "-"\)/
  );
});

test("document ledger status uses full references and customer scope", () => {
  const resolverStart = invoiceEngineSource.indexOf(
    "export async function resolveInvoiceLedgerPaymentStatus"
  );
  const resolverEnd = invoiceEngineSource.indexOf(
    "export async function withResolvedInvoicePaymentStatus",
    resolverStart
  );
  const resolverSource = invoiceEngineSource.slice(resolverStart, resolverEnd);

  assert.match(resolverSource, /reference_no\.eq\.\$\{reference\}/);
  assert.match(resolverSource, /order_number\.eq\.\$\{reference\}/);
  assert.match(resolverSource, /customer_account_id/);
  assert.match(resolverSource, /rowCustomerAccountId === customerAccountId/);
});
