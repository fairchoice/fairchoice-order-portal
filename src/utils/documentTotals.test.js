import assert from "node:assert/strict";
import test from "node:test";

import { calculateDocumentTotals } from "./documentTotals.js";

test("calculateDocumentTotals excludes removed raw database order items", () => {
  const totals = calculateDocumentTotals(
    [
      {
        qty: 1,
        net_total: 699.08,
        vat_rate: 20,
        include_in_picking: true,
        source_status: "In Stock",
      },
      {
        qty: 1,
        net_total: 112,
        vat_rate: 20,
        include_in_picking: false,
        source_status: "Cannot Supply",
      },
    ],
    { price_mode: "VAT" }
  );

  assert.equal(totals.netTotal, 699.08);
  assert.equal(totals.vatTotal, 139.82);
  assert.equal(totals.grandTotal, 838.9);
});


test("saved invoice prices correct zero and stale line amounts without mutating rows or free statuses", () => {
  const items = [
    {qty:2,price:18.29,net_total:0,vat_type:'20',source_status:'In Stock'},
    {qty:1,price:15.99,net_total:31.98,vat_type:'0.2',source_status:'In Stock'},
    {qty:3,price:22,net_total:66,vat_type:'20',source_status:'Free'},
    {qty:1,price:100,net_total:100,vat_type:'20',source_status:'Cannot Supply'},
    {qty:1,price:0,net_total:0,vat_type:'20',source_status:'In Stock'},
  ];
  const before=structuredClone(items);
  const totals=calculateDocumentTotals(items,{price_mode:'VAT'});
  assert.equal(totals.netTotal,52.57);assert.equal(totals.vatTotal,10.51);assert.equal(totals.grandTotal,63.08);
  assert.equal(totals.invoiceItems.find(x=>x.source_status==='Free').net_total,0);
  assert.deepEqual(items,before);
});
test("inclusive-VAT invoice prices remain inclusive, and absent prices retain saved amounts",()=>{
 assert.equal(calculateDocumentTotals([{qty:2,price:18.50,net_total:0,vat_type:'20'}],{price_mode:'SERVER'}).grandTotal,37);
 assert.equal(calculateDocumentTotals([{qty:1,net_total:10,vat_type:'20'}],{price_mode:'VAT'}).grandTotal,12);
});
