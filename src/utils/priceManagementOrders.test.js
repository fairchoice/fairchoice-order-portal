import test from 'node:test';
import assert from 'node:assert/strict';
import {activePriceOrderStages,buildPriceOrderPreview,sameReviewedPriceRows} from './priceManagementOrders.js';
const product={id:'p1',product_name:'Product',vat_price:12,vat_type:'20'};
const item={id:'i1',product_id:'p1',qty:5,picked_qty:0,price:8,updated_at:'2026-10-16T12:00:00Z'};
const order={id:'o1',status:'Received',price_mode:'VAT',order_items:[item]};
test('Received and Warehouse selectors share the allowed stages',()=>{
 assert.deepEqual(activePriceOrderStages(),['Received','Warehouse Packing']);
 assert.deepEqual(activePriceOrderStages('Warehouse Packing'),['Warehouse Packing']);
 assert.throws(()=>activePriceOrderStages('Delivered'),/Select/);
});
test('preview uses current product prices and saved ordered quantity rather than zero picked quantity',()=>{
 const rows=buildPriceOrderPreview([order,{...order,id:'o2',status:'Warehouse Packing'}],[product],['p1']);
 assert.equal(rows.length,2);for(const row of rows){assert.equal(row.qty,5);assert.equal(row.newPrice,12);assert.equal(row.netTotal,60);assert.equal(row.grossTotal,72);assert.equal(row.expectedUpdatedAt,item.updated_at);}
 assert.equal(item.price,8);assert.equal(item.picked_qty,0);
});
test('delivered, voided, free and unrelated product lines stay outside the review',()=>{
 const orders=[{...order,status:'Delivered'},{...order,financial_status:'VOID'},{...order,order_items:[{...item,status:'Free'}]},order];
 assert.equal(buildPriceOrderPreview(orders,[product],['p1']).length,1);
 assert.equal(buildPriceOrderPreview([order],[product],['other']).length,0);
});
test('zero quantity remains zero and non-VAT modes do not gain extra VAT',()=>{
 assert.equal(buildPriceOrderPreview([{...order,order_items:[{...item,qty:0}]}],[product],['p1'])[0].grossTotal,0);
 const row=buildPriceOrderPreview([{...order,price_mode:'server'}],[product],['p1'])[0];
 assert.equal(row.grossTotal,row.netTotal);
});

test('changing pricing rules or stage after preview requires a new review',()=>{
 const rows=buildPriceOrderPreview([order],[product],['p1']);
 assert.equal(sameReviewedPriceRows(rows,rows),true);
 for(const change of [{newPrice:13},{vatRate:5},{orderStatus:'Warehouse Packing'},{qty:6}]) {
  assert.equal(sameReviewedPriceRows(rows,[{...rows[0],...change}]),false);
 }
 assert.equal(sameReviewedPriceRows(rows,[]),false);
});
