import test from 'node:test';
import assert from 'node:assert/strict';
import {individualCodeForCustomer,individualCodeTargets,individualProductPrices} from './individualCustomerCodes.js';
import {getCustomerCodePriceMode} from './customerOfferCodes.js';
import {calculateProductPrice} from './pricing.js';
const codes=[{id:'bill',code:'BIL-123456',customer_account_id:'b',active:true,discount_percent:10},{id:'ex',code:'EXX-654321',customer_account_id:'e',active:true,discount_percent:15},{id:'shared',active:true}];
const customers=[{id:'b',account_name:'Billington',default_price_mode:'Server',customer_price_code_id:'bill',country:'England',town_city:'Leeds'},{id:'e',account_name:'Ex shop',default_price_mode:'VAT',customer_price_code_id:'ex',country:'England',town_city:'York'},{id:'legacy',customer_price_code_id:'shared',country:'England'}];
test('bulk geography targets individual codes only and keeps customer VAT modes',()=>{
 const before=structuredClone(customers);
 assert.deepEqual(individualCodeTargets(customers,codes,{country:'England',priceMode:'inc vat'}),[customers[0]]);
 assert.deepEqual(individualCodeTargets(customers,codes,{country:'England',excludedCities:['York']}),[customers[0]]);
 assert.deepEqual(individualCodeTargets(customers,codes,{codeId:'ex'}),[customers[1]]);
 assert.deepEqual(customers,before);assert.equal(individualCodeForCustomer(customers[2],codes),null);
});
test('a customer cannot borrow another customer’s code or stack legacy offers on an individual code',()=>{
 assert.equal(getCustomerCodePriceMode({...customers[1],customer_price_code_id:'bill'},codes),'vat');
 assert.equal(getCustomerCodePriceMode({...customers[0],customer_price_overlay_code_ids:['ex','shared']},codes),'code:bill|inc vat');
});
test('percentage reductions use existing Inc.VAT and Ex.VAT calculations; exact prices take priority',()=>{
 const product={vat_price:10,vat_type:'20'};
 const inc=calculateProductPrice({product,priceMode:getCustomerCodePriceMode(customers[0],codes),pricingSettings:{price_codes:codes}});
 const ex=calculateProductPrice({product,priceMode:getCustomerCodePriceMode(customers[1],codes),pricingSettings:{price_codes:codes}});
 assert.equal(inc.unitPrice,10.75);assert.equal(inc.grossPrice,10.75);assert.equal(ex.unitPrice,8.5);assert.equal(ex.grossPrice,10.2);
 assert.equal(calculateProductPrice({product:{...product,price_code_prices:{bill:8.5}},priceMode:'code:bill|inc vat',pricingSettings:{price_codes:codes}}).unitPrice,8.5);
});
test('product price requests are explicit, unique, positive and limited; clearing is explicit',()=>{
 assert.deepEqual(individualProductPrices(['p','p'],{p:'8.50'}),[{product_id:'p',price:8.5}]);
 assert.deepEqual(individualProductPrices(['p'],{},{remove:true}),[{product_id:'p',price:null}]);
 for(const value of ['',0,-1,0.001,'bad',Infinity])assert.throws(()=>individualProductPrices(['p'],{p:value}),/positive/);
 assert.throws(()=>individualProductPrices([],{p:8}),/Select/);
 assert.throws(()=>individualProductPrices(Array.from({length:101},(_,n)=>String(n)),{}),/100/);
});
