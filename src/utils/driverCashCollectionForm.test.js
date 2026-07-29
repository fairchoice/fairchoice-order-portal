import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  applyDriverCollectionType,
  getDriverCashCollectionTypeSetup,
} from "./driverCashCollectionForm.js";

test("Today's Invoice is immediately ready after opening Cash Collection without toggling the collection type", () => {
  const { form, setup } = applyDriverCollectionType(
    {
      paymentType: "Cash",
      collectionType: "Today's Invoice",
      resolvedCollectionType: "",
      paymentAmount: "",
      paidBy: "Shop staff",
    },
    {
      invoiceAmount: 67.41,
      customerOutstanding: 67.41,
    }
  );

  assert.equal(form.collectionType, "TODAY_INVOICE");
  assert.equal(form.paymentAmount, "67.41");
  assert.equal(setup.applicableBalance, 67.41);
  assert.equal(setup.maximumCollectibleAmount, 67.41);
  assert.equal(setup.amountInputEnabled, true);
  assert.equal(setup.amountIsFixed, true);
  assert.equal(setup.allocationMode, "TODAY_INVOICE");
});

test("re-running collection setup does not overwrite an editable amount", () => {
  const { form } = applyDriverCollectionType(
    {
      paymentType: "Cash",
      collectionType: "OUTSTANDING_PAYMENT",
      paymentAmount: "15",
    },
    {
      invoiceAmount: 20,
      customerOutstanding: 52.41,
    }
  );

  assert.equal(form.paymentAmount, "15");
});

test("unallocated payment remains disabled until its allocation type is resolved", () => {
  const setup = getDriverCashCollectionTypeSetup({
    paymentType: "Cash",
    collectionType: "UNALLOCATED_PAYMENT",
    invoiceAmount: 67.41,
    customerOutstanding: 67.41,
  });

  assert.equal(setup.effectiveCollectionType, "");
  assert.equal(setup.amountInputEnabled, false);
  assert.equal(setup.allocationMode, "");
});

test("Driver initializes and manually changes collection types through the shared setup function", () => {
  const driverSource = fs.readFileSync(
    new URL("../pages/AdminSetup/Driver.jsx", import.meta.url),
    "utf8"
  );

  assert.match(
    driverSource,
    /useEffect\(\(\) => \{[\s\S]*?applyCollectionType\(paymentForm\.collectionType/
  );
  assert.match(
    driverSource,
    /onChange=\{\(e\) => \{[\s\S]*?applyCollectionType\(e\.target\.value/
  );
  assert.match(driverSource, /activeCashCollectionInvoiceAmount/);
  assert.match(driverSource, /activeCashCollectionOutstanding/);
});
