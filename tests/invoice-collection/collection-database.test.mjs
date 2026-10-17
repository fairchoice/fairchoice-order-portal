import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const db = new PGlite();
const fixture=await readFile(new URL('./collection-fixture.sql',import.meta.url),'utf8');
const originalFifo=await readFile(new URL('./collection-fifo-before.sql',import.meta.url),'utf8');
await db.exec(fixture);
await db.exec(originalFifo);
const migrationDir = new URL('../../supabase/migrations/',import.meta.url);
const migration=(await readdir(migrationDir)).find(n=>n.endsWith('_invoice_collection_status_only.sql'));
const sql=await readFile(new URL(migration,migrationDir),'utf8');
await db.exec(sql);
await db.exec(sql); // Additive migration can be reapplied without losing markers.
const snapshotMigration=(await readdir(migrationDir)).find(n=>n.endsWith('_invoice_collection_snapshot.sql'));
await db.exec(await readFile(new URL(snapshotMigration,migrationDir),'utf8'));

async function scalar(query,args=[]) { const r=await db.query(query,args); return Object.values(r.rows[0])[0]; }
async function scope() {
 const account=randomUUID(), branch=randomUUID();
 await db.query('insert into customer_accounts values ($1)',[account]);
 await db.query('insert into customer_branches values ($1,$2)',[branch,account]);
 async function invoice(total=100) {
  const id=randomUUID(),ref='ORD-'+randomUUID();
  await db.query('insert into customer_invoices(id,customer_account_id,customer_branch_id,invoice_number,invoice_total) values($1,$2,$3,$4,$5)',[id,account,branch,ref,total]);
  await db.query("insert into customer_ledger(customer_account_id,customer_branch_id,entry_type,reference_no,remaining_amount) values($1,$2,'INVOICE',$3,$4)",[account,branch,ref,total]);
  return {id,ref,total};
 }
 const selection=(i,amount,mode='previous_paid',remaining=i.total)=>({invoiceSourceId:i.id,invoiceReference:i.ref,customerBranchId:branch,expectedRemainingAmount:remaining,...(mode==='new'?{allocatedAmount:amount}:{mode,previouslyPaidAmount:amount})});
 async function save({amount=0,previous=[],allocations=[],key='invoice-collection:'+randomUUID(),method='Cash',username='cash_staff',token='test-session'}={}) {
  return scalar('select fc_save_invoice_collection_v1($1,$2,$3,now(),$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13)',[account,branch,amount,method,'SALES_REP_COLLECTION',amount?'Shop staff':'','',JSON.stringify({}),JSON.stringify(allocations),JSON.stringify(previous),key,username,token]);
 }
 const payments=()=>scalar('select count(*)::int from customer_payments where customer_account_id=$1',[account]);
 const allocated=i=>scalar('select coalesce(sum(allocated_amount),0) from customer_payment_allocations where invoice_reference=$1',[i.ref]).then(Number);
 const paid=i=>scalar('select fc_collection_paid_amount_v1($1)',[i.id]).then(Number);
 return {account,branch,invoice,selection,save,payments,allocated,paid};
}

test('Previous Paid updates invoice status with no payment, allocation, or account-balance mutation',async()=>{
 const s=await scope(),i=await s.invoice();
 await db.query("insert into central_payment_balances(scope_key,customer_account_id,outstanding_balance) values('fixture',$1,100)",[s.account]);
 const beforeCalls=await scalar('select count(*)::int from fixture_canonical_calls');
 const result=await s.save({previous:[s.selection(i,100)]});
 assert.equal(result.status_only,true);assert.equal(result.payment,null);
 assert.equal(await s.payments(),0);assert.equal(await s.allocated(i),0);assert.equal(await s.paid(i),100);
 assert.equal(await scalar('select count(*)::int from fixture_canonical_calls'),beforeCalls);
 assert.equal(Number(await scalar('select outstanding_balance from central_payment_balances where customer_account_id=$1',[s.account])),100);
 assert.equal(await scalar('select invoice_status from customer_ledger where reference_no=$1',[i.ref]),'PAID');
});

test('Previous Part Paid followed by a new part payment adds only the newly received money',async()=>{
 const s=await scope(),older=await s.invoice(),i=await s.invoice();
 await s.save({previous:[s.selection(i,30,'previous_part')]});
 assert.equal(await s.payments(),0);assert.equal(await s.paid(i),30);
 await s.save({amount:20,allocations:[s.selection(i,20,'new',70)]});
 assert.equal(await s.payments(),1);assert.equal(await s.paid(i),50);assert.equal(await s.allocated(older),0);
 assert.equal(Number(await scalar('select sum(amount) from customer_payments where customer_account_id=$1',[s.account])),20);
 await db.query('select recalculate_central_payment_fifo($1)',[s.account]);
 assert.equal(await s.allocated(older),0);assert.equal(await s.paid(i),50);
});

test('reselecting the same previous part-paid total never increments it',async()=>{
 const s=await scope(),i=await s.invoice();
 await s.save({previous:[s.selection(i,30,'previous_part')]});
 await s.save({previous:[s.selection(i,30,'previous_part',70)]});
 assert.equal(await s.paid(i),30);assert.equal(await s.payments(),0);assert.equal(await s.allocated(i),0);
});

test('existing allocated money remains on its invoice and is never counted twice',async()=>{
 const s=await scope(),older=await s.invoice(),i=await s.invoice();
 const payment=randomUUID();
 await db.query("insert into customer_payments(id,customer_account_id,customer_branch_id,amount,source) values($1,$2,$3,25,'CENTRAL_PAYMENT')",[payment,s.account,s.branch]);
 await db.query("insert into customer_payment_allocations(payment_id,customer_account_id,customer_branch_id,invoice_reference,allocated_amount) values($1,$2,$3,$4,25)",[payment,s.account,s.branch,i.ref]);
 await s.save({previous:[s.selection(i,40,'previous_part',75)]});
 assert.equal(await s.paid(i),40);assert.equal(await s.allocated(i),25);
 await s.save({amount:20,allocations:[s.selection(i,20,'new',60)]});
 assert.equal(await s.paid(i),60);assert.equal(await s.allocated(i),45);assert.equal(await s.allocated(older),0);
 assert.equal(Number(await scalar('select sum(amount) from customer_payments where customer_account_id=$1',[s.account])),45);
});

test('mixed previous and new selections save atomically and retain excess as unallocated',async()=>{
 const s=await scope(),a=await s.invoice(),b=await s.invoice(50),c=await s.invoice();
 const result=await s.save({amount:60,previous:[s.selection(a,100)],allocations:[s.selection(b,50,'new')]});
 assert.equal(result.unallocated_amount,10);assert.equal(await s.payments(),1);
 assert.equal(await s.allocated(a),0);assert.equal(await s.allocated(b),50);assert.equal(await s.allocated(c),0);
 assert.equal(await s.paid(a),100);assert.equal(await s.paid(b),50);
 await db.query('select recalculate_central_payment_fifo($1)',[s.account]);
 assert.equal(await s.allocated(c),0);
});

test('failed new payment rolls back previous corrections and audit rows',async()=>{
 const s=await scope(),a=await s.invoice(),b=await s.invoice();
 await assert.rejects(s.save({amount:20,method:'FAIL',previous:[s.selection(a,100)],allocations:[s.selection(b,20,'new')]}),/writer failure/);
 assert.equal(await s.paid(a),0);assert.equal(await s.payments(),0);
 assert.equal(await scalar('select count(*)::int from financial_audit_log where customer_account_id=$1',[s.account]),0);
});

test('lost-response retry and concurrent repeated requests create exactly one payment and correction',async()=>{
 const s=await scope(),a=await s.invoice(),b=await s.invoice();
 const input={amount:10,key:'invoice-collection:'+randomUUID(),previous:[s.selection(a,100)],allocations:[s.selection(b,10,'new')]};
 const [r1,r2]=await Promise.all([s.save(input),s.save(input)]);
 assert.equal(r1.duplicate,false);assert.equal(r2.duplicate,true);assert.equal(await s.payments(),1);
 assert.equal(await scalar('select count(*)::int from financial_audit_log where customer_account_id=$1',[s.account]),1);
 await assert.rejects(s.save({...input,amount:11}),/already saved with different values/);
 assert.equal(await s.payments(),1);
});

test('stale balances, invalid partial values, duplicate invoice choices and cross-branch selections reject all writes',async()=>{
 const s=await scope(),i=await s.invoice();
 for (const item of [s.selection(i,100,'previous_part'),s.selection(i,0,'previous_part'),s.selection(i,1.001,'previous_part'),s.selection(i,20,'previous_part',99),{...s.selection(i,100),customerBranchId:randomUUID()}]) {
  await assert.rejects(s.save({previous:[item]}));assert.equal(await s.paid(i),0);
 }
 await assert.rejects(s.save({amount:10,previous:[s.selection(i,100)],allocations:[s.selection(i,10,'new')]}),/two payment choices/);
 const other=await scope(),foreign=await other.invoice();
 await assert.rejects(s.save({previous:[{...s.selection(foreign,100),customerBranchId:other.branch}]}),/invalid for this customer/);
 assert.equal(await s.payments(),0);
});

test('new payments cannot be allocated to future-dated invoices',async()=>{
 const s=await scope(),i=await s.invoice();
 await db.query("update customer_invoices set invoice_date=now()+interval '1 day' where id=$1",[i.id]);
 await assert.rejects(s.save({amount:10,allocations:[s.selection(i,10,'new')]}),/future-dated invoice/);
 assert.equal(await s.payments(),0);
});

test('bank transfer remains pending while independent previous-payment statuses can be acknowledged',async()=>{
 const s=await scope(),i=await s.invoice();
 await s.save({amount:20,method:'Bank Transfer',previous:[s.selection(i,100)]});
 assert.equal(await s.paid(i),100);assert.equal(await s.allocated(i),0);
 assert.equal(await scalar('select verification_status from customer_payments where customer_account_id=$1',[s.account]),'PENDING_VERIFICATION');
});

test('staff authorization and private helpers cannot be bypassed',async()=>{
 const s=await scope(),i=await s.invoice();
 await assert.rejects(s.save({previous:[s.selection(i,100)],username:'stranger'}),/Permission denied/);
 assert.equal(await s.paid(i),0);
 assert.equal(await scalar("select has_table_privilege('anon','invoice_collection_requests','INSERT')"),false);
 assert.equal(await scalar("select has_function_privilege('anon','fc_collection_paid_amount_v1(uuid)','EXECUTE')"),false);
});

test('migration refuses an unreviewed FIFO implementation before making schema changes',async()=>{
 const isolated=new PGlite();
 try {
  await isolated.exec(fixture);
  await isolated.exec(originalFifo.replace('declare\n','declare\n  -- unreviewed variant\n'));
  await assert.rejects(isolated.exec(sql),/FIFO implementation differs/);
  await isolated.exec('rollback');
  const r=await isolated.query("select count(*)::int as n from information_schema.columns where table_name='customer_invoices' and column_name='collection_previous_paid_amount'");
  assert.equal(r.rows[0].n,0);
 } finally {await isolated.close();}
});

test.after(async()=>{await db.close();});

test('RLS-hidden account invoices use canonical identity; status-only save survives reload',async()=>{
 const account=randomUUID(),id=randomUUID(),ref='ORD-1791154205690-fixture';
 await db.query('insert into customer_accounts values ($1)',[account]);
 await db.query("insert into customer_invoices(id,customer_account_id,invoice_number,invoice_total) values($1,$2,$3,335.04)",[id,account,ref]);
 await db.query("insert into customer_ledger(customer_account_id,entry_type,reference_no,remaining_amount) values($1,'INVOICE',$2,335.04)",[account,ref]);
 await db.exec('alter table customer_invoices enable row level security; grant select on customer_invoices to anon; set role anon;');
 try {
  assert.equal(await scalar('select count(*)::int from customer_invoices'),0);
  const snapshot=()=>scalar('select fc_invoice_collection_snapshot_v1($1,null,$2,$3)',[account,'cash_staff','test-session']);
  const before=await snapshot();
  assert.equal(before.invoices[0].id,id);assert.equal(before.invoices[0].customer_branch_id,null);
  const planned=before.invoices[0];
  const selection={invoiceSourceId:planned.id,invoiceReference:planned.invoice_number,customerBranchId:null,expectedRemainingAmount:335.04,mode:'previous_paid',previouslyPaidAmount:335.04};
  await scalar("select fc_save_invoice_collection_v1($1,null,0,now(),'Cash','SALES_REP_COLLECTION','','','{}','[]',$2::jsonb,$3,'cash_staff','test-session')",[account,JSON.stringify([selection]),'invoice-collection:'+randomUUID()]);
  const after=await snapshot();assert.equal(Number(after.invoices[0].collection_previous_paid_amount),335.04);
  await assert.rejects(scalar('select fc_invoice_collection_snapshot_v1($1,null,$2,$3)',[account,'cash_staff','wrong']),/Permission denied/);
 } finally {await db.exec('reset role;');}
 assert.equal(await scalar('select count(*)::int from customer_payments where customer_account_id=$1',[account]),0);
 assert.equal(await scalar('select count(*)::int from customer_payment_allocations where customer_account_id=$1',[account]),0);
 assert.equal(await scalar('select invoice_status from customer_ledger where reference_no=$1',[ref]),'PAID');
});

test('collection snapshot strictly scopes customer and branch',async()=>{
 const a=await scope(),b=await scope(),i=await a.invoice();await b.invoice();
 const result=await scalar('select fc_invoice_collection_snapshot_v1($1,$2,$3,$4)',[a.account,a.branch,'cash_staff','test-session']);
 assert.deepEqual(result.invoices.map(row=>row.id),[i.id]);
 await assert.rejects(scalar('select fc_invoice_collection_snapshot_v1($1,$2,$3,$4)',[a.account,b.branch,'cash_staff','test-session']),/Branch does not belong/);
});
