import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({root:new URL('../../',import.meta.url).pathname,configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});
after(()=>server.close());
const {default:Editor}=await server.ssrLoadModule('/src/components/CustomerOfferCodes.jsx');
const codes=[{id:'ske',code:'SKECASHALL',active:true},{id:'eng',code:'ENGDRN01',applies_to_price_mode:'inc vat',active:true},{id:'extra',code:'EXTRA',active:true}];
const customer={id:'billing',account_name:'Billington',default_price_mode:'Server',customer_price_code_id:'ske',customer_price_overlay_code_id:'eng',customer_price_overlay_code_ids:['eng','extra'],credit_limit:500,payment_amount:10};
const render=(props={})=>renderToStaticMarkup(React.createElement(Editor,{customer,priceCodes:codes,pendingMode:'Server',pendingBaseCode:'ske',...props}));
test('customer payment tab displays every saved offer separately from the Base Code without mutating the customer',()=>{
 const before=structuredClone(customer),html=render();assert.match(html,/Additional Offer Codes \(2\)/);assert.match(html,/ENGDRN01/);assert.match(html,/EXTRA/);assert.doesNotMatch(html,/>SKECASHALL</);assert.deepEqual(customer,before);
});
test('a customer with only a Base Code is clearly shown to have no additional codes',()=>{
 const html=render({customer:{...customer,customer_price_overlay_code_id:null,customer_price_overlay_code_ids:[]}});assert.match(html,/No additional offer codes saved/);assert.match(html,/Add Offer Code/);
});
test('unsaved VAT or base changes block separate offer editing',()=>{
 assert.match(render({pendingMode:'VAT'}),/Save or cancel your Base Code/);assert.match(render({pendingBaseCode:'eng'}),/Save or cancel your Base Code/);
});
test('offer picker excludes VAT-mismatched codes and permits several product codes without a Base Code',()=>{
 const html=render({customer:{id:'ex',default_price_mode:'VAT'},pendingMode:'VAT',pendingBaseCode:''});
 assert.doesNotMatch(html,/value="eng"/);assert.match(html,/value="ske"/);assert.match(html,/value="extra"/);
});
