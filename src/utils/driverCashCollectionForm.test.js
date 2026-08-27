import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  applyDriverCollectionType,
  getDriverCashCollectionTypeSetup,
  resolveDriverDeliveryAllocations,
} from "./driverCashCollectionForm.js";

test("TODAY_INVOICE keeps the canonical customer invoice UUID from the preview allocation", () => {
  const orderUuid = "37c527c4-fdff-4a1a-9ebc-33124a5b6966";
  const allocations = resolveDriverDeliveryAllocations({
    effectiveCollectionType: "TODAY_INVOICE",
    previewAllocations: [
      {
        invoiceReference: "ORD-1783300314589",
        invoiceSourceId: "5fa0f648-1ac3-48c1-9999-25585f118c88",
        allocatedAmount: 10,
      },
    ],
    orderUuid,
    invoiceReference: "ORD-1783300314589",
    allocatedAmount: 43,
    customerBranchId: "8f598571-db45-424b-9d23-1fe2fba98d78",
  });

  assert.deepEqual(allocations, [
    {
      invoiceReference: "ORD-1783300314589",
      invoiceSourceId: "5fa0f648-1ac3-48c1-9999-25585f118c88",
      customerBranchId: "8f598571-db45-424b-9d23-1fe2fba98d78",
      allocatedAmount: 43,
    },
  ]);
  assert.notEqual(allocations[0].invoiceSourceId, orderUuid);
  assert.notEqual(allocations[0].invoiceSourceId, allocations[0].invoiceReference);
});

test("TODAY_INVOICE rejects a readable order reference used as the UUID", () => {
  assert.throws(
    () =>
      resolveDriverDeliveryAllocations({
        effectiveCollectionType: "TODAY_INVOICE",
        previewAllocations: [
          {
            invoiceReference: "ORD-1783300314589",
            invoiceSourceId: "5fa0f648-1ac3-48c1-9999-25585f118c88",
            allocatedAmount: 43,
          },
        ],
        orderUuid: "ORD-1783300314589",
        invoiceReference: "ORD-1783300314589",
        allocatedAmount: 43,
      }),
    /database order UUID/
  );
});



test("TODAY_INVOICE rejects a missing canonical invoice allocation", () => {
  assert.throws(
    () =>
      resolveDriverDeliveryAllocations({
        effectiveCollectionType: "TODAY_INVOICE",
        previewAllocations: [],
        orderUuid: "37c527c4-fdff-4a1a-9ebc-33124a5b6966",
        invoiceReference: "ORD-1783300314589",
        allocatedAmount: 43,
      }),
    /canonical customer invoice/
  );
});

test("non-TODAY_INVOICE allocation flows remain unchanged", () => {
  const previewAllocations = [
    {
      invoiceReference: "INV-PREVIOUS",
      invoiceSourceId: "legacy-invoice-source",
      allocatedAmount: 20,
    },
  ];

  assert.strictEqual(
    resolveDriverDeliveryAllocations({
      effectiveCollectionType: "OUTSTANDING_PAYMENT",
      previewAllocations,
      orderUuid: "ORD-readable-not-a-uuid",
      allocatedAmount: 20,
    }),
    previewAllocations
  );
});

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
