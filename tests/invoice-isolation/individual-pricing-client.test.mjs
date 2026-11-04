import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({root:new URL('../../',import.meta.url).pathname,configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});after(()=>server.close());
const {supabase}=await server.ssrLoadModule('/src/services/supabase.js');
const service=await server.ssrLoadModule('/src/services/individualCustomerCodes.js');
const {default:Code}=await server.ssrLoadModule('/src/components/IndividualCustomerCode.jsx');
const prices=await server.ssrLoadModule('/src/services/priceCodes.js');
const user={username:'nisstaj_admin',fc_session_token:'fixture-token',fc_session_expires_at:Date.now()+3600000};
const customer={id:'customer',account_name:'Billington',default_price_mode:'Server',customer_price_code_id:'legacy',customer_price_overlay_code_ids:[]};
test('generation/price/percentage actions use only verified pricing RPCs with expected customer mode',async()=>{
 const calls=[];supabase.rpc=async(name,args)=>{calls.push({name,args});return {data:{}};};
 const before=structuredClone(customer);
 await service.generateIndividualCustomerCode(customer,user);
 await service.applyIndividualCustomerPrices([customer],[{product_id:'p',price:8.5}],{country:'England',priceMode:'inc vat'},user);
 await service.editIndividualCustomerPercent({id:'owned',discount_percent:7},10,user);
 assert.deepEqual(calls.map(c=>c.name),['fc_generate_individual_customer_code_v1','fc_apply_individual_customer_prices_v1','fc_edit_individual_customer_percent_v1']);
 assert.equal(calls[0].args.p_expected.default_price_mode,'Server');assert.equal(calls[1].args.p_targets[0].price_mode,'Server');assert.equal(calls[2].args.p_expected_percent,7);assert.deepEqual(customer,before);
 await assert.rejects(async()=>service.generateIndividualCustomerCode(customer,{username:'nisstaj_admin'}),/Sign in/);assert.equal(calls.length,3);
});
test('customer code control shows one generation button or the single saved code, with unsaved VAT changes blocked',()=>{
 const render=props=>renderToStaticMarkup(React.createElement(Code,{customer,...props}));
 assert.match(render({}),/>Generate Code</);assert.doesNotMatch(render({}),/Add Offer Code/);
 const owned={id:'owned',code:'BIL-123456',customer_account_id:customer.id,discount_percent:10};
 const html=render({customer:{...customer,customer_price_code_id:'owned'},codes:[owned]});assert.match(html,/BIL-123456/);assert.doesNotMatch(html,/>Generate Code</);
 assert.match(render({pendingMode:'VAT'}),/Save or cancel the Price Mode/);
});
test('exact-price reads page beyond 1000 rows so individual prices are never silently dropped',async()=>{
 const rows=Array.from({length:1005},(_,n)=>({id:String(n),product_id:'p',price_code_id:'code'+n,price:8.5}));const ranges=[];
 supabase.from=table=>{assert.equal(table,'product_price_code_prices');return {select(){return this;},in(){return this;},eq(){return this;},order(){return this;},async range(a,b){ranges.push([a,b]);return {data:rows.slice(a,b+1)};}};};
 assert.equal((await prices.getProductPriceCodeRows(['p'])).length,1005);assert.deepEqual(ranges,[[0,999],[1000,1999]]);
});
test('catalogue price sync preserves individual-code overrides and changes shared prices only',async()=>{
 const calls=[];
 supabase.from=table=>{
  if(table==='customer_price_codes')return {select(){return this;},async order(){return {data:[{id:'shared'},{id:'owned',customer_account_id:'customer'}]};}};
  assert.equal(table,'product_price_code_prices');return {
   delete(){calls.push({action:'delete'});return this;},eq(){return this;},async in(column,ids){calls.at(-1).ids=ids;return {};},
   insert(rows){calls.push({action:'insert',rows});return this;},async select(){return {data:[]};},
  };
 };
 await prices.syncProductPriceCodePrices('p',[{priceCodeId:'shared',price:9},{priceCodeId:'owned',price:1}]);
 assert.deepEqual(calls[0].ids,['shared']);assert.deepEqual(calls[1].rows,[{product_id:'p',price_code_id:'shared',price:9,active:true}]);
});
