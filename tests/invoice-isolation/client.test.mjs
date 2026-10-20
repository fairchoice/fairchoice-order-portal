import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({root:new URL('../../',import.meta.url).pathname,configFile:false,server:{middlewareMode:true},appType:'custom'});
after(()=>server.close());
const {supabase}=await server.ssrLoadModule('/src/services/supabase.js');
const protection=await server.ssrLoadModule('/src/services/issuedInvoiceProtection.js');
const engine=await server.ssrLoadModule('/src/services/centralInvoiceEngine.js');
const owner={username:'nisstaj_admin',fc_session_token:'fixture-token',fc_session_expires_at:Date.now()+3600000};
const order={id:'11111111-1111-4111-8111-111111111111',order_number:'READ-ONLY-INV',price_mode:'Server',items:[{id:'p',product_name:'Saved item',qty:2,price:10,source_status:'In Stock',vat_type:20}]};
let calls=[];
supabase.rpc=async(name,payload)=>{calls.push({name,payload});return {data:{revision:'fixture-revision',invoice_total:20}};};

test('only the exact owner with a live session can request the guarded amendment RPC',async()=>{
 for(const user of [{...owner,username:'other_admin'},{...owner,username:'nisstaj_adm'},{...owner,fc_session_token:''},{...owner,fc_session_expires_at:1}]) await assert.rejects(protection.prepareIssuedInvoiceAmendment(order,user),/read-only/);
 assert.equal(calls.length,0);
 await protection.prepareIssuedInvoiceAmendment(order,owner);
 assert.equal(calls.at(-1).name,'fc_prepare_issued_invoice_edit_v1');
});
test('explicit owner amendment sends saved prices to one atomic RPC and requires a revision and reason',async()=>{
 const request={order,user:owner,revision:'fixture-revision',reason:'Requested product correction',header:{price_mode:'Server'},lines:[{dbId:'line-1',productId:'p',qty:2,price:10,vatRate:20}]};
 await assert.rejects(protection.saveIssuedInvoiceAmendment({...request,revision:''}),/Reopen/);
 await protection.saveIssuedInvoiceAmendment(request);
 const call=calls.at(-1);assert.equal(call.name,'fc_amend_issued_invoice_v1');assert.equal(call.payload.p_lines[0].price,10);assert.equal(call.payload.p_expected_revision,'fixture-revision');
});
test('legacy amendment API cannot bypass the guarded owner path',async()=>{await assert.rejects(engine.amendInvoice({order}),/read-only/);});
test('reissuing an existing ledger invoice returns its saved row without writing or syncing',async()=>{
 const saved={id:'ledger-row',invoice_total:20};const query={select(){return this;},eq(){return this;},order(){return this;},async limit(){return {data:[saved]};}};
 supabase.from=(table)=>{assert.equal(table,'customer_ledger');return query;};
 const count=calls.length;assert.equal(await engine.createOrUpdateInvoiceForDeliveredOrder({order}),saved);assert.equal(calls.length,count);
});
test('a canonical invoice without a cached ledger row is also returned without a write',async()=>{
 const saved={id:'canonical-row',invoice_total:20};supabase.from=(table)=>({select(){return this;},eq(){return this;},order(){return this;},async limit(){return {data:[]};},async maybeSingle(){assert.equal(table,'customer_invoices');return {data:saved};}});
 const count=calls.length;assert.equal(await engine.createOrUpdateInvoiceForDeliveredOrder({order}),saved);assert.equal(calls.length,count);
});
test('opening the invoice template cannot write or reprice even when repeated',()=>{
 const html=engine.buildStandardInvoiceHtml(order);assert.equal(engine.buildStandardInvoiceHtml(order),html);assert.match(html,/Saved item/);assert.doesNotMatch(html,/class="watermark/);
});
