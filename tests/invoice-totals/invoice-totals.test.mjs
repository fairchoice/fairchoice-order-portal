import { PGlite } from '@electric-sql/pglite';
import { readFile,readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test,{after,beforeEach} from 'node:test';
import {calculateDocumentTotals} from '../../src/utils/documentTotals.js';
import {calculateCartOrderItems,calculateCartTotals} from '../../src/utils/orderTotals.js';
import {captureInvoiceLinePricing,calculateInvoiceAmendmentTotals} from '../../src/utils/invoiceAmendmentPricing.js';
const db=new PGlite();after(()=>db.close());
await db.exec(`create role anon;create role authenticated;
create table orders(id uuid primary key,customer_account_id uuid,status text default 'Delivered',financial_status text default 'ACTIVE',price_mode text default 'VAT',order_total numeric,net_total numeric,vat_total numeric);
create table order_items(id uuid primary key,order_id uuid,qty numeric,picked_qty numeric,price numeric,unit_price numeric,net_total numeric,line_total numeric,vat_rate numeric,vat_type text,source_status text default 'In Stock',include_in_picking boolean default true);
create table customer_invoices(id uuid primary key,order_id uuid,customer_account_id uuid,customer_branch_id uuid,invoice_number text,invoice_total numeric,status text default 'ISSUED',financial_status text default 'ACTIVE',amount_to_collect numeric,updated_at timestamptz,collection_previous_paid_amount numeric default 0,collection_previous_allocated_amount numeric default 0,collection_previous_wallet_amount numeric default 0,wallet_applied_amount numeric default 0);
create table customer_ledger(customer_account_id uuid,customer_branch_id uuid,entry_type text,reference_no text,financial_status text default 'ACTIVE',invoice_total numeric,invoice_amount numeric,debit numeric,amount numeric,paid_amount numeric,remaining_amount numeric,invoice_status text,collection_previous_paid_amount numeric,collection_previous_allocated_amount numeric,collection_previous_wallet_amount numeric,wallet_applied_amount numeric);
create table customer_payments(id uuid primary key,customer_account_id uuid,amount numeric,status text default 'POSTED',verification_status text default 'CONFIRMED',voided_at timestamptz);
create table customer_payment_allocations(payment_id uuid,customer_account_id uuid,invoice_reference text,allocated_amount numeric,status text default 'active',reversed_at timestamptz,voided_at timestamptz);
create table central_payment_archive(payment_id uuid);
create table central_payment_balances(scope_key text primary key,customer_account_id uuid,customer_branch_id uuid,opening_balance numeric,invoice_total numeric,payment_total numeric,outstanding_balance numeric,recalculated_at timestamptz);
create table financial_audit_log(action text,entity_type text,entity_id text,customer_account_id uuid,customer_branch_id uuid,reason text,before_data jsonb,after_data jsonb,changed_by text);`);
const dir=new URL('../../supabase/migrations/',import.meta.url),files=await readdir(dir);
const collection=await readFile(new URL(files.find(n=>n.endsWith('_invoice_collection_status_only.sql')),dir),'utf8');
const wallet=await readFile(new URL(files.find(n=>n.endsWith('_wallet_invoice_settlement_reads.sql')),dir),'utf8');
for(const [source,name] of [[collection,'fc_collection_allocated_amount_v1'],[wallet,'fc_collection_paid_amount_v1'],[wallet,'fc_sync_collection_invoice_status_v1']]){
 const a=source.indexOf('create or replace function public.'+name+'('),b=source.indexOf('revoke all on function public.'+name,a);await db.exec(source.slice(a,b));
}
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
const seedAccount=randomUUID(),seedOrder=randomUUID(),seedInvoice=randomUUID();
await db.query('insert into orders(id,customer_account_id,order_total) values($1,$2,1005.70)',[seedOrder,seedAccount]);
await db.query("insert into order_items(id,order_id,qty,price,net_total,vat_type) values($1,$2,1,868.08,838.08,'20')",[randomUUID(),seedOrder]);
await db.query("insert into customer_invoices(id,order_id,customer_account_id,invoice_number,invoice_total) values($1,$2,$3,'FIXTURE-LEGACY',1041.70)",[seedInvoice,seedOrder,seedAccount]);
const migration=await readFile(new URL(files.find(n=>n.endsWith('_invoice_document_total_consistency.sql')),dir),'utf8');await db.exec(migration);
const backfillTotal=Number(await scalar('select invoice_total from customer_invoices where id=$1',[seedInvoice]));
const backfillAudit=await scalar("select before_data->>'invoice_total' from financial_audit_log where entity_id=$1",[seedInvoice]);
beforeEach(()=>db.exec('truncate orders,order_items,customer_invoices,customer_ledger,customer_payments,customer_payment_allocations,central_payment_archive,central_payment_balances,financial_audit_log;'));
async function setup({items=[{qty:1,price:100,net_total:100,vat_type:'20'}],mode='VAT',header=null}={}){
 const account=randomUUID(),order=randomUUID(),invoice=randomUUID(),ref='FIXTURE-'+randomUUID();
 await db.query('insert into orders(id,customer_account_id,price_mode,order_total) values($1,$2,$3,$4)',[order,account,mode,header]);
 for(const line of items){await db.query('insert into order_items(id,order_id,qty,picked_qty,price,unit_price,net_total,line_total,vat_rate,vat_type,source_status,include_in_picking) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[randomUUID(),order,line.qty??1,line.picked_qty??0,line.price??null,line.unit_price??null,line.net_total??null,line.line_total??null,line.vat_rate??null,line.vat_type??null,line.source_status??'In Stock',line.include_in_picking??true]);}
 await db.query('insert into customer_invoices(id,order_id,customer_account_id,invoice_number,invoice_total) values($1,$2,$3,$4,999)',[invoice,order,account,ref]);
 await db.query("insert into customer_ledger(customer_account_id,entry_type,reference_no,invoice_total,invoice_amount,debit,amount) values($1,'INVOICE',$2,999,999,999,999)",[account,ref]);
 return {account,order,invoice,ref,total:async()=>Number(await scalar('select invoice_total from customer_invoices where id=$1',[invoice]))};
}
test('existing stale 1041.70 invoice reconciles to confirmed saved-line total 1005.70 with an audit',()=>{assert.equal(backfillTotal,1005.70);assert.equal(Number(backfillAudit),1041.70);});
test('no-change amendment preserves saved reductions instead of recalculating quantity times price',()=>{
 const item={id:'line',qty:1,price:868.08,net_total:838.08,vat_type:'20'};const order={items:[item],price_mode:'VAT',order_total:1005.70,net_total:838.08,vat_total:167.62};const lines=[{...item,...captureInvoiceLinePricing(item,'VAT')}];
 assert.equal(calculateCartTotals([item],{priceMode:'VAT'}).grandTotal,1041.70);assert.equal(calculateInvoiceAmendmentTotals(lines,order).grandTotal,1005.70);assert.equal(calculateCartOrderItems(lines,{priceMode:'VAT',preserveSavedLineTotals:true})[0].net_total,838.08);
 assert.equal(calculateInvoiceAmendmentTotals([{...lines[0],price:900}],order).grandTotal,1080);
});
test('saved header VAT rounding survives a no-change amendment and genuine penny price edits apply',()=>{
 const item={qty:1,price:100,net_total:100,vat_type:'20'};const lines=[{...item,...captureInvoiceLinePricing(item,'VAT')}],order={items:[item],price_mode:'VAT',order_total:119.98,net_total:100,vat_total:19.98};assert.equal(calculateInvoiceAmendmentTotals(lines,order).grandTotal,119.98);assert.equal(calculateInvoiceAmendmentTotals([{...lines[0],price:100.01}],order).grandTotal,120.01);
});
test('free invoice lines remain present with zero amount and zero VAT is respected',()=>{
 const free={id:'free',qty:3,price:15,source_status:'Free',net_total:0,vat_type:'20'};const zero={id:'zero',qty:1,price:20,net_total:20,vat_rate:0,vat_type:'20'};const lines=[free,zero].map(x=>({...x,...captureInvoiceLinePricing(x,'VAT')}));const priced=calculateCartOrderItems(lines,{priceMode:'VAT',preserveSavedLineTotals:true});assert.equal(priced.length,2);assert.equal(priced[0].net_total,0);assert.equal(priced[1].vat_total,0);assert.equal(calculateInvoiceAmendmentTotals(lines,{items:[free,zero],price_mode:'VAT',order_total:20}).grandTotal,20);
});
test('database total equals printed saved-line calculation across tax modes, discounts and status-only supplied lines',async()=>{
 const cases=[
  {mode:'VAT',items:[{qty:1,price:868.08,net_total:838.08,vat_type:'0.2'}],header:1005.70},
  {mode:'VAT',items:[{qty:2,price:10,net_total:17.5,vat_type:'5'},{qty:1,price:4,net_total:4,vat_rate:0,vat_type:'20'}]},
  {mode:'Server',items:[{qty:2,price:10,net_total:17.5,vat_type:'20'}]},
  {mode:'CODE:uuid|ex vat',items:[{qty:1,price:50,net_total:40,vat_type:'20'}]},
  {mode:'CODE:uuid|inc vat',items:[{qty:1,price:50,net_total:40,vat_type:'20'}]},
  {mode:'VAT',items:[{qty:1,price:10,net_total:10,source_status:'In Stock',include_in_picking:false,vat_type:'20'},{qty:1,price:999,net_total:999,source_status:'Cannot Supply',include_in_picking:false,vat_type:'20'},{qty:3,price:10,net_total:30,source_status:'Free',vat_type:'20'}]},
 ];
 for(const c of cases){const s=await setup(c);const printed=calculateDocumentTotals(c.items,{price_mode:c.mode,order_total:c.header});assert.equal(await s.total(),printed.grandTotal,JSON.stringify(c));}
});
test('later supplied status and saved line price changes synchronize canonical invoice and ledger amounts',async()=>{
 const s=await setup({items:[{qty:1,price:10,net_total:10,vat_type:'20'},{qty:1,price:20,net_total:20,vat_type:'20',source_status:'Need Supplier',include_in_picking:false}]});assert.equal(await s.total(),12);
 await db.query("update order_items set source_status='In Stock' where order_id=$1 and source_status='Need Supplier'",[s.order]);assert.equal(await s.total(),36);
 await db.query('update order_items set price=25,net_total=25 where order_id=$1 and price=20',[s.order]);assert.equal(await s.total(),42);
 assert.equal(Number(await scalar('select debit from customer_ledger where reference_no=$1',[s.ref])),42);
});
test('cash, Wallet and previous-paid acknowledgements are preserved with no payment creation or allocation movement',async()=>{
 const s=await setup();const pay=randomUUID();await db.query('insert into customer_payments(id,customer_account_id,amount) values($1,$2,30)',[pay,s.account]);await db.query('insert into customer_payment_allocations(payment_id,customer_account_id,invoice_reference,allocated_amount) values($1,$2,$3,30)',[pay,s.account,s.ref]);
 await db.query('update customer_invoices set wallet_applied_amount=10,collection_previous_paid_amount=40,collection_previous_allocated_amount=30,collection_previous_wallet_amount=10 where id=$1',[s.invoice]);
 await db.query('update order_items set net_total=80,price=80 where order_id=$1',[s.order]);assert.equal(await s.total(),96);assert.equal(Number(await scalar('select amount_to_collect from customer_invoices where id=$1',[s.invoice])),56);
 assert.equal(Number(await scalar('select count(*) from customer_payments')),1);assert.equal(Number(await scalar('select count(*) from customer_payment_allocations')),1);assert.equal(Number(await scalar('select allocated_amount from customer_payment_allocations')),30);assert.equal(Number(await scalar('select remaining_amount from customer_ledger where reference_no=$1',[s.ref])),56);
});
test('stale invoice and later ledger writes cannot overwrite the saved document total',async()=>{
 const s=await setup({items:[{qty:1,price:868.08,net_total:838.08,vat_type:'20'}],header:1005.70});await db.query('update customer_invoices set invoice_total=1041.70 where id=$1',[s.invoice]);assert.equal(await s.total(),1005.70);await db.query('update customer_ledger set debit=1041.70,amount=1041.70 where reference_no=$1',[s.ref]);assert.equal(Number(await scalar('select debit from customer_ledger where reference_no=$1',[s.ref])),1005.70);
});
test('manual and void invoices retain their distinct financial handling',async()=>{
 const account=randomUUID(),id=randomUUID();await db.query("insert into customer_invoices(id,customer_account_id,invoice_number,invoice_total) values($1,$2,'MANUAL',80)",[id,account]);assert.equal(Number(await scalar('select invoice_total from customer_invoices where id=$1',[id])),80);
 const s=await setup();await db.query("update customer_invoices set financial_status='VOID' where id=$1",[s.invoice]);await db.query('update order_items set net_total=200,price=200 where order_id=$1',[s.order]);assert.equal(await s.total(),120);
});
test('zero-value saved lines and private database helpers do not invent amounts or public access',async()=>{
 const s=await setup({items:[{qty:1,price:100,net_total:0,vat_type:'20'}],header:0});assert.equal(await s.total(),0);
 assert.equal(await scalar("select has_function_privilege('anon','fc_invoice_document_total_v1(uuid)','execute')"),false);
});

test('existing balance summaries follow invoice corrections without rebuilding payment allocations',async()=>{
 const s=await setup();await db.query("insert into central_payment_balances(scope_key,customer_account_id,opening_balance,invoice_total,payment_total,outstanding_balance) values($1,$2,5,120,30,95)",[s.account+':ALL',s.account]);
 await db.query('update order_items set net_total=80,price=80 where order_id=$1',[s.order]);
 const row=(await db.query('select invoice_total,payment_total,outstanding_balance from central_payment_balances')).rows[0];
 assert.equal(Number(row.invoice_total),96);assert.equal(Number(row.payment_total),30);assert.equal(Number(row.outstanding_balance),71);
});
