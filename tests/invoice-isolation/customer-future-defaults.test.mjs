import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
const server=await createServer({root:new URL('../../',import.meta.url).pathname,configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom'});
after(()=>server.close());
const {supabase}=await server.ssrLoadModule('/src/services/supabase.js');
const {saveCustomerAccount,saveCustomerBranch}=await server.ssrLoadModule('/src/services/customerManagement.js');
test('customer VAT/address edits succeed as future defaults without reading or writing existing orders or invoking synchronization',async()=>{
 const calls=[];
 supabase.rpc=async()=>{assert.fail('Customer save must not invoke an order synchronization RPC');};
 supabase.from=table=>{assert.equal(table,'customer_accounts');return {
  update(payload){calls.push({table,payload});return this;},eq(key,value){assert.equal(key,'id');assert.equal(value,'customer');return this;},select(){return this;},async single(){return {data:{id:'customer',...calls.at(-1).payload}};},
 };};
 const saved=await saveCustomerAccount({id:'customer',account_name:'Future Shop',performance_group:'Wales',default_price_mode:'VAT',address_line_1:'New address',country:'England',credit_limit:500});
 assert.equal(saved.default_price_mode,'VAT');assert.equal(saved.address_line_1,'New address');assert.equal(saved.credit_limit,500);
 assert.equal(calls.length,1);assert.equal(calls[0].table,'customer_accounts');
});
test('branch address edits only save the branch and cannot rewrite historical order snapshots',async()=>{
 let saved;
 supabase.from=table=>{assert.equal(table,'customer_branches');return {update(payload){saved=payload;return this;},eq(){return this;},select(){return this;},async single(){return {data:{id:'branch',...saved}};}};};
 const branch=await saveCustomerBranch({id:'branch',customer_account_id:'customer',branch_name:'New branch',delivery_address:'New delivery address'});
 assert.equal(branch.delivery_address,'New delivery address');
});
test('bulk customer imports also leave existing order snapshots unchanged',async()=>{
 const source=await readFile(new URL('../../src/pages/AdminSetup/Customers.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/syncCustomerAddressToOrders|fc_sync_customer_address_to_orders_v1/);
 assert.match(source,/future orders only/);
});
