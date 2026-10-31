import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCodeProducts,codeProductPreview} from './customerCodePriceEditor.js';
import {individualProductPrices} from './individualCustomerCodes.js';
const products=[{id:'a',product_code:'DR-01',main_category:'Drinks',brand:'DP',series:'Cans',vat_price:10,vat_type:20,price_code_prices:{a:8.5}},{id:'b',product_code:'DR-02',main_category:'Drinks',brand:'Other',product_series:'Cans'},{id:'c',main_category:'Food',brand:'DP',series:'Cans'},{id:'d',main_category:'Drinks',brand:'DP',series:'Cans',active:false}];
const codes=[{id:'a',active:true,discount_percent:10},{id:'b',active:true,discount_percent:15}];
test('product code search and intersecting category, brand, series filters select the full matching series',()=>{
 assert.deepEqual(filterCodeProducts(products,{category:'Drinks',brand:'DP',series:'Cans'}).map(p=>p.id),['a']);
 assert.deepEqual(filterCodeProducts(products,{search:' dr-02 '}).map(p=>p.id),['b']);
 assert.deepEqual(filterCodeProducts(products,{series:'Cans',category:'Drinks'}).map(p=>p.id),['a','b']);
});
test('preview removes exact overrides for calculation, uses shared VAT math and reports mixed codes without mutating products',()=>{
 const before=structuredClone(products[0]);
 const inc=codeProductPreview(products[0],codes,'inc vat');
 assert.deepEqual(inc.calculated,[10.75,10.25]);assert.deepEqual(inc.exact,[8.5,null]);assert.equal(inc.status,'Mixed');
 assert.deepEqual(codeProductPreview(products[0],codes,'ex vat').calculated,[9,8.5]);
 assert.equal(codeProductPreview(products[0],[codes[0]],'inc vat').status,'Exact override');
 assert.equal(codeProductPreview(products[0],[codes[1]],'inc vat').status,'Calculated');
 assert.deepEqual(products[0],before);
});
test('series save uses explicit product requests and rejects over-limit series atomically before sending',()=>{
 const ids=filterCodeProducts(products,{category:'Drinks',brand:'DP',series:'Cans'}).map(p=>p.id);
 assert.deepEqual(individualProductPrices(ids,{a:'8.50'}),[{product_id:'a',price:8.5}]);
 assert.throws(()=>individualProductPrices(Array.from({length:101},(_,i)=>String(i)),{}),/100/);
 assert.deepEqual(individualProductPrices(['a'],{},{remove:true}),[{product_id:'a',price:null}]);
});
