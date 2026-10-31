import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
const db=new PGlite();after(async()=>db.close());
const dir=new URL('../../supabase/migrations/',import.meta.url);
await db.exec(await readFile(new URL('../invoice-collection/collection-fixture.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../invoice-collection/collection-fifo-before.sql',import.meta.url),'utf8'));
for(const suffix of ['_invoice_collection_status_only.sql','_invoice_collection_snapshot.sql']){
 const n=(await readdir(dir)).find(n=>n.endsWith(suffix));await db.exec(await readFile(new URL(n,dir),'utf8'));
}
await db.exec(await readFile(new URL('./wallet-invoice-fixture.sql',import.meta.url),'utf8'));
const n=(await readdir(dir)).find(n=>n.endsWith('_wallet_invoice_settlement_reads.sql'));
const sql=await readFile(new URL(n,dir),'utf8');await db.exec(sql);await db.exec(sql);
async function scalar(q,args=[]){return Object.values((await db.query(q,args)).rows[0])[0];}
async function fixture(total=233.29,wallet=45.99){
 const account=randomUUID(),id=randomUUID(),ref='ORD-'+randomUUID();await db.query('insert into customer_accounts values($1)',[account]);
 await db.query('insert into customer_invoices(id,customer_account_id,invoice_number,invoice_total) values($1,$2,$3,$4)',[id,account,ref,total]);
 await db.query("insert into customer_ledger(customer_account_id,entry_type,reference_no,remaining_amount) values($1,'INVOICE',$2,$3)",[account,ref,total]);
 await db.query("insert into customer_wallet_transactions(customer_account_id,transaction_type,direction,amount,source_type) values($1,'RETURN_CREDIT','CREDIT',$2,'CUSTOMER_RETURN')",[account,wallet]);
 return {id,account,ref,total};
}
const apply=(r,amount=null)=>scalar('select fc_apply_customer_wallet_to_invoice_v1($1,$2,$3,$4)',['cash_staff','test-session',r.id,amount]);
const snapshot=r=>scalar('select fc_invoice_financial_snapshot_v1($1,$2,$3,null)',['cash_staff','test-session',r.account]);
const paid=r=>scalar('select fc_collection_paid_amount_v1($1)',[r.id]).then(Number);
async function acknowledge(r,amount,remaining){const item={invoiceSourceId:r.id,invoiceReference:r.ref,customerBranchId:null,mode:amount===r.total?'previous_paid':'previous_part',previouslyPaidAmount:amount,expectedRemainingAmount:remaining};
 return scalar("select fc_save_invoice_collection_v1('"+r.account+"',null,0,now(),'Cash','SALES_REP_COLLECTION','','','{}','[]',$1::jsonb,$2,'cash_staff','test-session')",[JSON.stringify([item]),'invoice-collection:'+randomUUID()]);}

test('45.99 return applied to 233.29 invoice is part paid with 187.30 due',async()=>{
 const r=await fixture();await apply(r);const result=await snapshot(r),i=result.invoices[0];
 assert.equal(Number(i.paid_amount),45.99);assert.equal(Number(i.remaining_amount),187.30);assert.equal(i.invoice_status,'PART PAID');
 assert.equal(result.wallet_applications.length,1);assert.equal(await scalar('select count(*)::int from customer_payments where customer_account_id=$1',[r.account]),0);
 assert.equal(await scalar('select invoice_status from customer_ledger where reference_no=$1',[r.ref]),'PART PAID');
});
test('Wallet that covers the invoice in full marks it Paid',async()=>{
 const r=await fixture(45.99,45.99);await apply(r);const i=(await snapshot(r)).invoices[0];assert.equal(i.invoice_status,'PAID');assert.equal(Number(i.remaining_amount),0);
 await assert.rejects(apply(r),/no outstanding amount|no available credit/);
});
test('cash plus Wallet settles once and amount to collect reflects both',async()=>{
 const r=await fixture(100,80),p=randomUUID();
 await db.query("insert into customer_payments(id,customer_account_id,amount,source) values($1,$2,30,'CENTRAL_PAYMENT')",[p,r.account]);
 await db.query('insert into customer_payment_allocations(payment_id,customer_account_id,invoice_reference,allocated_amount) values($1,$2,$3,30)',[p,r.account,r.ref]);
 const result=await apply(r);assert.equal(Number(result.wallet_applied_now),70);assert.equal(Number(result.amount_to_collect),0);assert.equal(await paid(r),100);
});
test('previous acknowledgements capture Wallet baseline and later Wallet increments only once',async()=>{
 const r=await fixture(100,100);await apply(r,20);await acknowledge(r,50,80);assert.equal(await paid(r),50);
 assert.equal(Number(await scalar('select collection_previous_wallet_amount from customer_invoices where id=$1',[r.id])),20);
 await apply(r,10);assert.equal(await paid(r),60);await acknowledge(r,60,40);assert.equal(await paid(r),60);
});
test('cash collection uses the remaining balance after Wallet, without moving return credit',async()=>{
 const r=await fixture(100,30);await apply(r);const allocations=[{invoiceSourceId:r.id,invoiceReference:r.ref,customerBranchId:null,allocatedAmount:20,expectedRemainingAmount:70}];
 await scalar("select fc_save_invoice_collection_v1($1,null,20,now(),'Cash','SALES_REP_COLLECTION','Fixture','','{}',$2::jsonb,'[]',$3,'cash_staff','test-session')",[r.account,JSON.stringify(allocations),'invoice-collection:'+randomUUID()]);
 assert.equal(await paid(r),50);const i=(await snapshot(r)).invoices[0];assert.equal(Number(i.wallet_applied_amount),30);assert.equal(Number(i.remaining_amount),50);
});
test('invoice read works with RLS-hidden invoices and respects customer session scope',async()=>{
 const a=await fixture(),b=await fixture();await apply(a);
 await db.exec('alter table customer_invoices enable row level security; grant select on customer_invoices to anon;');
 await db.query("select set_config('fixture.customer_id',$1,false)",[a.account]);await db.exec('set role anon;');
 try{
  assert.equal(await scalar('select count(*)::int from customer_invoices'),0);
  const own=await scalar('select fc_invoice_financial_snapshot_v1($1,$2,null,$3::text[])',['customer','test-session',[a.ref,b.ref]]);
  assert.deepEqual(own.invoices.map(i=>i.id),[a.id]);
  await assert.rejects(scalar('select fc_invoice_financial_snapshot_v1($1,$2,$3,null)',['customer','test-session',b.account]),/scope denied/);
  await assert.rejects(scalar('select fc_invoice_financial_snapshot_v1($1,$2,$3,null)',['denied_staff','test-session',a.account]),/access denied/);
 }finally{await db.exec('reset role;');}
});
test('voided Wallet applications are excluded from statement credits',async()=>{
 const r=await fixture();await apply(r);
 await db.query("update customer_wallet_transactions set status='VOID' where invoice_id=$1",[r.id]);
 assert.equal((await snapshot(r)).wallet_applications.length,0);
});
test('invalid amounts cannot become maximum Wallet applications',async()=>{
 for(const amount of [-1,0,0.001]){const r=await fixture();await assert.rejects(apply(r,amount),/positive/);assert.equal(await paid(r),0);}
});
