import test from 'node:test';
import assert from 'node:assert/strict';
import {insertReturnHeader,isActiveReturnCredit,returnDisplayStatus,returnStaffId} from './returnHeaderPersistence.js';
const account='10000000-0000-4000-8000-000000000001';
const branch='10000000-0000-4000-8000-000000000002';
const payload={customer_account_id:account,customer_branch_id:branch,branch_id:branch,price_mode:'vat',return_number:'RET-fixture'};
function client(replies){const calls=[];return {calls,from:()=>({insert:data=>{calls.push({...data});return {select:()=>({single:async()=>replies.shift()})};}})};}
test('missing optional price mode never strips customer or branch scope',async()=>{
 const c=client([{error:{code:'PGRST204',message:"Could not find the 'price_mode' column of 'customer_returns' in the schema cache"}},{data:{id:'return'}}]);
 assert.equal((await insertReturnHeader(c,payload)).id,'return');
 assert.equal(c.calls[1].customer_account_id,account);assert.equal(c.calls[1].customer_branch_id,branch);assert.equal(c.calls[1].branch_id,branch);
 assert.equal('price_mode' in c.calls[1],false);assert.equal(payload.price_mode,'vat');
});
test('permission, invalid values and missing financial columns fail without a destructive retry',async()=>{
 for(const error of [{code:'42501',message:'denied'},{code:'22P02',message:'bad uuid'},{code:'PGRST204',message:"Could not find the 'customer_account_id' column"}]){
  const c=client([{error}]);await assert.rejects(insertReturnHeader(c,payload));assert.equal(c.calls.length,1);
 }
 await assert.rejects(insertReturnHeader(client([]),{...payload,customer_account_id:null}),/Select a customer/);
});
test('a PostgreSQL missing optional-column error preserves financial scope',async()=>{
 const c=client([{error:{code:'42703',message:'column "price_mode" of relation "customer_returns" does not exist'}},{data:{id:'return'}}]);
 await insertReturnHeader(c,payload);assert.equal(c.calls[1].customer_account_id,account);
});
test('return staff ID accepts UUIDs and does not substitute arbitrary login identifiers',()=>{
 assert.equal(returnStaffId({id:'staff-login-name',staff_id:account}),account);assert.equal(returnStaffId({id:'login-name'}),null);
});
test('reversed and no-credit returns do not appear as active invoice credit notes',()=>{
 const row={status:'Confirmed',financial_disposition:'CUSTOMER_CREDIT'};
 assert.equal(isActiveReturnCredit(row),true);assert.equal(isActiveReturnCredit({...row,reversed_at:'2026-10-16'}),false);
 assert.equal(isActiveReturnCredit({...row,financial_disposition:'NO_CREDIT'}),false);
 assert.equal(returnDisplayStatus({...row,reversed_at:'2026-10-16'}),'Reversed');
});
