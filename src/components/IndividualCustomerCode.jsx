import {useState} from 'react';
import {generateIndividualCustomerCode} from '../services/individualCustomerCodes.js';
import {individualCodeForCustomer} from '../utils/individualCustomerCodes.js';
export default function IndividualCustomerCode({customer,codes=[],pendingMode,compact=false,onChanged}) {
 const [generated,setGenerated]=useState(null),[saving,setSaving]=useState(false),[message,setMessage]=useState('');
 const code=generated || individualCodeForCustomer(customer,codes);
 const pending=pendingMode!==undefined && pendingMode!==(customer?.default_price_mode || 'VAT');
 async function generate(){
  if(!customer?.id || pending)return;
  if(!window.confirm(`Generate one individual price code for ${customer.account_name}? Current exact product prices and percentage will be copied. Customer VAT mode, credit, payments and saved invoices will stay unchanged.`))return;
  setSaving(true);setMessage('');
  try{const result=await generateIndividualCustomerCode(customer);setGenerated(result.code);try{await onChanged?.(result.state,result.code);}catch(error){setMessage(`Code saved. Reload the screen to refresh prices: ${error.message}`);return;}setMessage('Individual code saved. Manage product prices in Customer Code Prices and its percentage in Pricing Rules.');}
  catch(error){setMessage(error.message || 'Could not generate the code.');}finally{setSaving(false);}
 }
 return <section className={compact?'mt-1':'md:col-span-2 rounded-lg border bg-slate-50 p-3'} aria-label="Individual customer code">
  {!compact && <h3 className="font-bold text-sm">Individual Customer Code</h3>}
  {code ? <p className="text-sm font-bold">{code.code}{!compact && ` — ${Number(code.discount_percent || 0)}% reduction`}</p> : <button type="button" disabled={saving || !customer?.id || pending} onClick={generate} className="rounded bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">{saving?'Generating…':'Generate Code'}</button>}
  {!compact && <p className="mt-1 text-xs text-slate-600">One code per customer: first 3 letters of the name + a random number. Exact product prices take priority over its percentage. Existing shared codes stay in place until you generate this code.</p>}
  {!customer?.id && <p className="text-xs">Save the customer first.</p>}
  {pending && <p role="status" className="text-xs">Save or cancel the Price Mode change first.</p>}
  {message && <p role="status" className="mt-1 text-xs">{message}</p>}
 </section>;
}
