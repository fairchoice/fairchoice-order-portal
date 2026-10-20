import { customerVatMode, priceCodeMatchesCustomer } from "./customerCodeEligibility.js";
// Keep the legacy single offer alongside the new list until all clients are upgraded.
export const getCustomerOfferCodeIds = (customer = {}) => [...new Set([
  customer.customer_price_overlay_code_id,
  ...(customer.customer_price_overlay_code_ids || []),
].filter(Boolean).map(String))];

export const canAssignCustomerOfferCode = (customer, code) => {
  if (!customer || !priceCodeMatchesCustomer(customer, code)) return false;
  if (String(code.id) === String(customer.customer_price_code_id)) return false;
  return String(code.code_type || "base").toLowerCase() !== "sub" ||
    String(code.parent_price_code_id || "") === String(customer.customer_price_code_id);
};

export const getActiveCustomerOfferCodeIds = (customer, codes = []) =>
  getCustomerOfferCodeIds(customer).filter((id) => codes.some((code) =>
    String(code.id) === id && canAssignCustomerOfferCode(customer, code)
  ));

export const normalizeOfferCodeIds = (value) => [...new Set(
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((id) => String(id).trim()).filter(Boolean)
)];

// Server-side matching, session verification, audit and compare-and-set are atomic.
export const customerCodeState = (customer) => ({
 default_price_mode: customer.default_price_mode ?? null,
 customer_price_code_id: customer.customer_price_code_id ?? null,
 customer_price_overlay_code_id: customer.customer_price_overlay_code_id ?? null,
 customer_price_overlay_code_ids: customer.customer_price_overlay_code_ids || [],
});
export async function saveCustomerCodeAssignment(client, customer, codeId, {kind='offer', remove=false, session}={}) {
 if(!session?.username || !session?.token) throw new Error('Sign in again before changing customer codes.');
 const {data,error}=await client.rpc('fc_assign_customer_price_code_v1', {
  p_username:session.username,p_session_token:session.token,p_customer_id:customer.id,
  p_code_id:codeId || null,p_kind:kind,p_remove:remove,p_expected:customerCodeState(customer),
 });
 if(error)throw error;
 if(!data)throw new Error('Customer changed. Refresh and try again.');
 return data;
}
export async function saveCustomerOfferCode(client, customer, codeId, remove=false, session) {
 return saveCustomerCodeAssignment(client,customer,codeId,{kind:'offer',remove,session});
}

export function getCustomerCodePriceMode(customer, codes=[]) {
 const base=codes.find(code=>String(code.id)===String(customer?.customer_price_code_id) && priceCodeMatchesCustomer(customer,code));
 const offers=base?.customer_account_id ? [] : getActiveCustomerOfferCodeIds(customer,codes);
 const mode=customerVatMode(customer?.default_price_mode || 'VAT');
 if(!base && !offers.length)return mode==='inc vat'?'inc vat':'vat';
 return `code:${base?.id || 'offers'}|${mode}${offers.length ? '|overlay:'+offers.join(',') : ''}`;
}
