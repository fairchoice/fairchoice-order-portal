import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOrderPricingContext} from '../../src/services/orderPricingContext.js';
import {buildPriceOrderPreview} from '../../src/utils/priceManagementOrders.js';
import {getProductPricePreview} from '../../src/utils/pricing.js';
const code='a613c6ef-1f78-41f4-a309-957cac993e82';
function fakeClient({exact=17.75,codePercent=3.5,failure='',manyCodes=0}={}) {
 const calls=[];
 const rows={pricing_settings:[{id:1,server_discount_percent:1.5}],products:[{id:'p',vat_price:15.69,vat_type:'0.2'}],customer_price_codes:[{id:code,code:'RCCASH01',active:true,discount_percent:codePercent},...Array.from({length:manyCodes},(_,i)=>({id:'other-'+i,active:true}))],product_price_code_prices:exact===null?[]:[{id:'exact',product_id:'p',price_code_id:code,active:true,price:exact}]};
 return {calls,from(table){let filtered=rows[table]||[],start=0,end=Infinity;const query={select(){return this},eq(key,value){filtered=filtered.filter(row=>row[key]===value);return this},in(key,values){filtered=filtered.filter(row=>values.includes(row[key]));return this},order(){return this},range(a,b){start=a;end=b;calls.push({table,start,end});return this},maybeSingle(){return Promise.resolve({data:filtered[0]||null,error:table===failure?{message:'unavailable'}:null})},then(resolve,reject){return Promise.resolve({data:filtered.slice(start,end+1),error:table===failure?{message:'unavailable'}:null}).then(resolve,reject)}};return query}};
}
const order={id:'o',order_number:'ORDER-FIXTURE',status:'Warehouse Packing',price_mode:`CODE:${code.toUpperCase()}|INC VAT`,order_items:[{id:'i',product_id:'p',qty:2,price:19}]};
test('IVG database-to-warehouse preview retains exact RCCASH01 price rather than missing-code 19.00',async()=>{
 const context=await loadOrderPricingContext(['p'],{client:fakeClient()});
 assert.equal(getProductPricePreview(context.products[0],'',context.settings).server,18.50);
 const [row]=buildPriceOrderPreview([order],context.products,['p'],context.settings);
 assert.equal(row.newPrice,17.75);assert.equal(row.priceModeLabel,'RCCASH01');assert.equal(row.lineTotal,35.50);assert.equal(row.grossTotal,35.50);assert.equal(row.addVat,false);
});
test('a code without an exact override uses its own current percentage rather than general Inc VAT rules',async()=>{
 const context=await loadOrderPricingContext(['p'],{client:fakeClient({exact:null})});
 assert.equal(buildPriceOrderPreview([order],context.products,['p'],context.settings)[0].newPrice,18.25);
 const server={...order,price_mode:'INC VAT'};
 assert.equal(buildPriceOrderPreview([server],context.products,['p'],context.settings)[0].newPrice,18.50);
});
test('fresh context reflects changed or removed exact overrides and changed percentages on the next review',async()=>{
 for(const [options,price] of [[{exact:18},18],[{exact:null,codePercent:5},18]]) {
  const context=await loadOrderPricingContext(['p'],{client:fakeClient(options)});
  assert.equal(buildPriceOrderPreview([order],context.products,['p'],context.settings)[0].newPrice,price);
 }
});
test('all price codes are paged and duplicate product selections do not drop the exact-price map',async()=>{
 const client=fakeClient({manyCodes:505});const context=await loadOrderPricingContext(['p','p'],{client});
 assert.equal(context.settings.price_codes.length,506);assert.equal(context.products.length,1);
 assert.equal(context.products[0].priceCodePrices[code],17.75);
 assert.ok(client.calls.some(call=>call.table==='customer_price_codes'&&call.start===500));
});
test('failed pricing inputs and unavailable codes stop repricing instead of saving undiscounted prices',async()=>{
 for(const failure of ['pricing_settings','customer_price_codes','product_price_code_prices','products']) await assert.rejects(loadOrderPricingContext(['p'],{client:fakeClient({failure})}),/Could not refresh/);
 const context=await loadOrderPricingContext(['p'],{client:fakeClient()});
 assert.throws(()=>buildPriceOrderPreview([order],context.products,['p'],{...context.settings,price_codes:[]}),/Customer price code is unavailable/);
 await assert.rejects(loadOrderPricingContext(['missing'],{client:fakeClient()}),/selected product is unavailable/);
});
