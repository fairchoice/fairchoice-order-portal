import test from 'node:test';
import assert from 'node:assert/strict';
import {customerVatMode,priceCodeMatchesCustomer} from './customerCodeEligibility.js';
import {getCustomerCodePriceMode,getActiveCustomerOfferCodeIds} from './customerOfferCodes.js';
import {calculateProductPrice} from './pricing.js';
import {calculateCartTotals} from './orderTotals.js';
import {filterCustomerCodeScope} from './customerCodeScope.js';
const codes=[{id:'eng',code:'ENGDRN01',applies_to_price_mode:'inc vat',active:true},{id:'ske',applies_to_price_mode:'both',active:true},{id:'extra',applies_to_price_mode:'ex vat',active:true}];
const inc={country:'England',town_city:'Leeds',default_price_mode:'Server',customer_price_code_id:'ske',customer_price_overlay_code_ids:['eng','extra']};
const ex={...inc,default_price_mode:'VAT'};
const product={vat_price:10,vat_type:'20',price_code_prices:{eng:8.5,extra:7}};
const pricingSettings={price_codes:codes};
test('code applicability matches customer mode aliases and both without changing the customer',()=>{
 for(const mode of ['Server','Inc.VAT','inc vat','royalty','manager'])assert.equal(customerVatMode(mode),'inc vat');
 for(const mode of ['VAT','Exc.VAT','Ex.VAT','ex vat'])assert.equal(customerVatMode(mode),'ex vat');
 assert.equal(priceCodeMatchesCustomer(inc,codes[0]),true);assert.equal(priceCodeMatchesCustomer(ex,codes[0]),false);
 assert.equal(priceCodeMatchesCustomer(ex,codes[1]),true);assert.equal(priceCodeMatchesCustomer(inc,codes[1]),true);
 assert.equal(priceCodeMatchesCustomer(inc,{...codes[0],active:false}),false);
 assert.equal(priceCodeMatchesCustomer(inc,{...codes[0],applies_to_price_mode:'invalid'}),false);
});
test('England Inc.VAT Dr Pepper offer excludes Ex.VAT customers and excluded cities',()=>{
 const customers=[inc,ex,{...inc,country:'Wales'},{...inc,town_city:'York'}];
 const scope=filterCustomerCodeScope(customers,{country:'England',excludedCities:['York']});
 assert.deepEqual(scope.filter(c=>priceCodeMatchesCustomer(c,codes[0])),[inc]);
 const before=structuredClone(customers);
 assert.deepEqual(getActiveCustomerOfferCodeIds(inc,codes),['eng']);assert.deepEqual(getActiveCustomerOfferCodeIds(ex,codes),['extra']);
 assert.equal(calculateProductPrice({product,priceMode:getCustomerCodePriceMode(inc,codes),pricingSettings}).unitPrice,8.5);
 assert.equal(calculateProductPrice({product,priceMode:getCustomerCodePriceMode(ex,codes),pricingSettings}).unitPrice,7);
 assert.deepEqual(customers,before);
});
test('incompatible code already in a price mode cannot apply during product pricing',()=>{
 const r=calculateProductPrice({product,priceMode:'code:eng|ex vat|overlay:eng',pricingSettings});
 assert.equal(r.unitPrice,10);assert.equal(r.grossPrice,12);
});
test('multiple product codes work without replacing the customer VAT mode or requiring a base',()=>{
 const customer={default_price_mode:'Server',customer_price_overlay_code_ids:['eng','ske']};
 const mode=getCustomerCodePriceMode(customer,codes);
 assert.equal(mode,'code:offers|inc vat|overlay:eng,ske');
 assert.equal(calculateProductPrice({product,priceMode:mode,pricingSettings}).unitPrice,8.5);
 assert.equal(calculateProductPrice({product:{...product,price_code_prices:{ske:6}},priceMode:mode,pricingSettings}).unitPrice,6);
 assert.equal(calculateProductPrice({product:{...product,price_code_prices:{}},priceMode:mode,pricingSettings:{...pricingSettings,server_discount_percent:10}}).unitPrice,10.75);
 assert.equal(customer.default_price_mode,'Server');
});
test('Ex.VAT code carts add VAT once, Inc.VAT carts retain exact inclusive prices',()=>{
 const lines=[{qty:2,price:8.5,vatRate:20,vat_type:'20'}];
 assert.equal(calculateCartTotals(lines,{priceMode:'code:ske|ex vat|overlay:extra'}).grandTotal,20.4);
 assert.equal(calculateCartTotals(lines,{priceMode:'code:ske|inc vat|overlay:eng'}).grandTotal,17);
});
