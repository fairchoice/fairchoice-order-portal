import {customerVatMode} from './customerCodeEligibility.js';
import {filterCustomerCodeScope} from './customerCodeScope.js';
export const individualCodeForCustomer=(customer,codes=[])=>codes.find(code=>
 String(code.customer_account_id || '')===String(customer?.id || '') &&
 String(code.id)===String(customer?.customer_price_code_id || '')
) || null;
export function individualCodeTargets(customers,codes,{priceMode='both',codeId='',...scope}={}) {
 return filterCustomerCodeScope(customers,scope).filter(customer=>{
  const code=individualCodeForCustomer(customer,codes);
  return code?.active!==false && code && (!codeId || String(code.id)===String(codeId)) &&
   (priceMode==='both' || customerVatMode(customer.default_price_mode)===priceMode);
 });
}
export function individualProductPrices(productIds,drafts,{remove=false}={}) {
 const ids=[...new Set(productIds.map(String))];
 if(!ids.length || ids.length>100)throw new Error('Select between 1 and 100 products.');
 return ids.map(id=>{
  const value=Number(drafts[id]);
  if(!remove && (!Number.isFinite(value) || value<=0 || Math.round(value*100)<=0))throw new Error('Enter a positive exact price for every selected product.');
  return {product_id:id,price:remove?null:Math.round((value+Number.EPSILON)*100)/100};
 });
}
