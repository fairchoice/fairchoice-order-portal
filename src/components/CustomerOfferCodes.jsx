import { useState } from 'react';
import { supabase } from '../services/supabase.js';
import { getFcSessionState, readStoredFcProfile } from '../services/fcSession.js';
import { canAssignCustomerOfferCode, getCustomerOfferCodeIds, saveCustomerCodeAssignment } from '../utils/customerOfferCodes.js';
import { priceModeLabel } from '../utils/customerCodeEligibility.js';

// This editor saves only offer assignments through the audited RPC. It never
// saves customer details, VAT mode, balances, orders or invoice contents.
export default function CustomerOfferCodes({customer, priceCodes=[], pendingMode, pendingBaseCode, onChanged}) {
 const [savedCustomer,setSavedCustomer]=useState(customer || {});
 const [selected,setSelected]=useState('');
 const [saving,setSaving]=useState(false);
 const [message,setMessage]=useState('');
 const ids=getCustomerOfferCodeIds(savedCustomer).filter(id=>id!==savedCustomer.customer_price_code_id);
 const eligible=priceCodes.filter(code=>canAssignCustomerOfferCode(savedCustomer,code) && !ids.includes(String(code.id)));
 const unsavedPricing=(pendingMode!==undefined && pendingMode!==(savedCustomer.default_price_mode || 'VAT')) ||
  (pendingBaseCode!==undefined && pendingBaseCode!==(savedCustomer.customer_price_code_id || ''));
 async function change(codeId,remove=false) {
  if(unsavedPricing)return setMessage('Save or cancel your Base Code / Price Mode changes before editing offers.');
  if(!window.confirm(`${remove ? 'Remove only' : 'Add'} ${priceCodes.find(code=>String(code.id)===String(codeId))?.code || 'this offer code'} ${remove ? 'from' : 'to'} ${savedCustomer.account_name || 'this customer'}? The Base Code, VAT mode and other offers will be kept.`))return;
  setSaving(true);setMessage('');
  try {
   const session=getFcSessionState(readStoredFcProfile());
   if(!session.valid)throw new Error('Sign in again before changing offer codes.');
   const result=await saveCustomerCodeAssignment(supabase,savedCustomer,codeId,{kind:'offer',remove,session});
   if(result.status==='skipped')return setMessage(result.reason || 'Code does not match this customer. No changes made.');
   setSavedCustomer(current=>({...current,...result.state}));setSelected('');
   setMessage('Offer codes saved. Base Code, VAT mode and other customer details were kept.');
   onChanged?.(result.state);
  } catch(error){setMessage(`${error.message || 'Could not save offer codes.'} Close and reopen this customer to refresh saved assignments.`);}
  finally{setSaving(false);}
 }
 return <section className="md:col-span-2 rounded-lg border border-slate-300 bg-slate-50 p-3" aria-label="Additional Offer Codes">
  <h3 className="font-bold text-sm">Additional Offer Codes ({ids.length})</h3>
  <p className="mt-1 text-xs text-slate-600">Keep the Base Code above and add other product codes here. Offers match this customer's {priceModeLabel(savedCustomer.default_price_mode || 'VAT')} mode.</p>
  {ids.length===0 ? <p className="my-2 text-sm">No additional offer codes saved.</p> : <ul className="my-2 flex flex-wrap gap-2">{ids.map(id=>{
   const code=priceCodes.find(code=>String(code.id)===String(id));
   return <li key={id} className="rounded border bg-white px-2 py-1 text-sm"><b>{code?.code || 'Unavailable code'}</b>{!canAssignCustomerOfferCode(savedCustomer,code) && ' (not applicable)'} <button type="button" aria-label={`Remove offer ${code?.code || id}`} disabled={saving || unsavedPricing} className="ml-2 underline disabled:opacity-40" onClick={()=>change(id,true)}>Remove</button></li>;
  })}</ul>}
  {!savedCustomer.id ? <p className="mt-2 text-sm">Save the customer first, then add offer codes.</p> : <>
   <div className="mt-2 flex flex-wrap gap-2">
    <select aria-label="Additional offer code" value={selected} disabled={saving || unsavedPricing} onChange={e=>setSelected(e.target.value)} className="h-9 rounded border border-slate-400 bg-white px-2 text-sm">
     <option value="">Select another code</option>{eligible.map(code=><option key={code.id} value={code.id}>{code.code}</option>)}
    </select>
    <button type="button" disabled={!selected || saving || unsavedPricing} onClick={()=>change(selected)} className="h-9 rounded bg-blue-700 px-3 text-sm font-bold text-white disabled:opacity-40">{saving ? 'Saving…' : 'Add Offer Code'}</button>
   </div>
   <p className="mt-1 text-xs text-slate-500">Add / Remove saves immediately. It does not require Save Customer.</p>
  </>}
  {unsavedPricing && <p role="status" className="mt-2 text-sm">Save or cancel your Base Code / Price Mode changes before editing offers.</p>}
  {message && <p role="status" className="mt-2 text-sm">{message}</p>}
 </section>;
}
