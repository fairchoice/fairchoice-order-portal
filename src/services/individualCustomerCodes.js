import {supabase} from './supabase.js';
import {getFcSessionState,readStoredFcProfile} from './fcSession.js';
import {customerCodeState} from '../utils/customerOfferCodes.js';
const sessionArgs=(user)=>{
 const s=getFcSessionState(user || readStoredFcProfile());
 if(!s.valid)throw new Error('Sign in again before changing customer pricing.');
 return {p_username:s.username,p_session_token:s.token};
};
async function call(name,args){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;}
export const generateIndividualCustomerCode=(customer,user)=>call('fc_generate_individual_customer_code_v1',{
 ...sessionArgs(user),p_customer_id:customer.id,p_expected:customerCodeState(customer),
});
export const applyIndividualCustomerPrices=(customers,prices,scope,user)=>call('fc_apply_individual_customer_prices_v1',{
 ...sessionArgs(user),p_targets:customers.map(c=>({id:c.id,code_id:c.customer_price_code_id,price_mode:c.default_price_mode})),
 p_prices:prices,p_scope:scope,
});
export const editIndividualCustomerPercent=(code,percent,user)=>call('fc_edit_individual_customer_percent_v1',{
 ...sessionArgs(user),p_code_id:code.id,p_percent:percent,p_expected_percent:Number(code.discount_percent || 0),
});
