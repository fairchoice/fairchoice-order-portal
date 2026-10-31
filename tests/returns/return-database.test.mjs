import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test, {after} from 'node:test';
const db=new PGlite();
after(async()=>{await db.close();});
await db.exec(await readFile(new URL('./return-fixture.sql',import.meta.url),'utf8'));
const dir=new URL('../../supabase/migrations/',import.meta.url);
const filename=(await readdir(dir)).find(n=>n.endsWith('_return_customer_wallet_integrity.sql'));
const sql=await readFile(new URL(filename,dir),'utf8');
await db.exec(sql);await db.exec(sql);
const guardFile=(await readdir(dir)).find(n=>n.endsWith('_return_wallet_legacy_credit_guard.sql'));
const guard=await readFile(new URL(guardFile,dir),'utf8');await db.exec(guard);await db.exec(guard);
async function scalar(q,args=[]){return Object.values((await db.query(q,args)).rows[0])[0];}
async function fixture({orphan=false,amount=45.99}={}){
 const account=randomUUID(),id=randomUUID(),ref='RET-'+randomUUID();
 await db.query('insert into customer_accounts values($1,$2)',[account,'Fixture shop']);
 await db.query('insert into customer_returns(id,return_number,customer_account_id,customer_name,return_total) values($1,$2,$3,$4,$5)',[id,ref,orphan?null:account,'Fixture shop',amount]);
 return {account,id,ref,amount};
}
const approve=(r,disposition='CUSTOMER_CREDIT',user='admin')=>scalar('select fc_approve_customer_return_v1($1,$2,$3,$4,$5)',[user,'test-session',r.id,'Fixture approval',disposition]);
const reverse=(r,user='admin')=>scalar('select fc_reverse_customer_return_v1($1,$2,$3,$4)',[user,'test-session',r.id,'Fixture reversal']);
const link=(r,account=r.account,branch=null)=>scalar('select fc_link_customer_return_v1($1,$2,$3,$4,$5,$6)',['admin','test-session',r.id,account,branch,'Restore missing customer link']);
const balance=r=>scalar('select fc_customer_wallet_balance_v1($1)',[r.account]).then(Number);
async function legacyApproval(r,{reversed=false}={}){
 const g=randomUUID();
 await db.query("insert into financial_transactions(id,source_type,source_id,customer_account_id,amount,debit_amount,credit_amount,status) values($1,'CUSTOMER_RETURN',$2,null,$3,0,$3,'ACTIVE')",[g,r.id,r.amount]);
 await db.query("insert into customer_ledger(customer_name,entry_type,reference_no,debit,credit,source,transaction_type,financial_status) values('Fixture shop','RETURN_CREDIT',$1,0,$2,'CUSTOMER_RETURN','RETURN_CREDIT','ACTIVE')",[r.ref,r.amount]);
 await db.query("update customer_returns set status='Confirmed',financial_disposition='CUSTOMER_CREDIT',ledger_transaction_id=$1,reversed_at=case when $3 then now() else null end where id=$2",[g,r.id,reversed]);
 return g;
}

test('approval posts one wallet credit and preserves the invoice and payment boundary',async()=>{
 const r=await fixture();const result=await approve(r);
 assert.equal(Number(result.wallet_credit),45.99);assert.equal(await balance(r),45.99);
 assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),1);
 assert.equal(await scalar('select count(*)::int from customer_ledger where reference_no=$1',[r.ref]),1);
 const replay=await approve(r);assert.equal(replay.duplicate,true);assert.equal(await balance(r),45.99);
 assert.equal(await scalar('select count(*)::int from customer_wallet_transactions where return_id=$1',[r.id]),1);
});
test('No Financial Credit creates no wallet or financial ledger effect',async()=>{
 const r=await fixture();await approve(r,'NO_CREDIT');await approve(r,'NO_CREDIT');
 assert.equal(await balance(r),0);assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),0);
 await assert.rejects(approve(r),/different financial effect/);
 await reverse(r);assert.ok(await scalar('select reversed_at is not null from customer_returns where id=$1',[r.id]));
});
test('an orphan cannot be approved as credit; pending status is retained',async()=>{
 const r=await fixture({orphan:true});await assert.rejects(approve(r),/Link this return/);
 assert.equal(await scalar('select status from customer_returns where id=$1',[r.id]),'Pending Warehouse Confirmation');
 assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),0);
 await link(r);await approve(r);assert.equal(await balance(r),45.99);
});
test('explicit link repairs a confirmed orphan without duplicating its existing credit',async()=>{
 const r=await fixture({orphan:true});const original=await legacyApproval(r);await link(r);await link(r);
 assert.equal(await balance(r),45.99);assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),1);
 assert.equal(await scalar('select ledger_transaction_id from customer_returns where id=$1',[r.id]),original);
 assert.equal(await scalar('select count(*)::int from customer_ledger where reference_no=$1',[r.ref]),1);
 assert.equal(await scalar('select customer_account_id from customer_ledger where reference_no=$1',[r.ref]),r.account);
});
test('reversal offsets wallet and financial credit once and retains approval history',async()=>{
 const r=await fixture();await approve(r);await reverse(r);const replay=await reverse(r);
 assert.equal(replay.duplicate,true);assert.equal(await balance(r),0);
 assert.equal(await scalar('select count(*)::int from customer_wallet_transactions where return_id=$1',[r.id]),2);
 assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),2);
 assert.equal(await scalar('select status from customer_returns where id=$1',[r.id]),'Confirmed');
 assert.ok(await scalar('select reversed_at is not null from customer_returns where id=$1',[r.id]));
 await assert.rejects(approve(r),/reversed return cannot/);
});
test('used wallet credit cannot be reversed into a negative wallet balance',async()=>{
 const r=await fixture();await approve(r);
 await db.query("insert into customer_wallet_transactions(customer_account_id,transaction_type,direction,amount,source_type) values($1,'INVOICE_APPLICATION','DEBIT',20,'FIXTURE')",[r.account]);
 await assert.rejects(reverse(r),/already been used/);assert.equal(await balance(r),25.99);
 assert.equal(await scalar('select reversed_at from customer_returns where id=$1',[r.id]),null);
 assert.equal(await scalar('select count(*)::int from financial_transactions where source_type=\'CUSTOMER_RETURN_REVERSAL\' and source_id=$1',[r.id]),0);
});
test('legacy orphan reversal does not require inventing a customer or wallet credit',async()=>{
 const r=await fixture({orphan:true});await legacyApproval(r);await reverse(r);
 assert.equal(await scalar('select count(*)::int from customer_wallet_transactions where return_id=$1',[r.id]),0);
 assert.ok(await scalar('select reversed_at is not null from customer_returns where id=$1',[r.id]));
});
test('linking an already reversed orphan does not resurrect wallet credit',async()=>{
 const r=await fixture({orphan:true});await legacyApproval(r,{reversed:true});await link(r);
 assert.equal(await balance(r),0);
});
test('customer/branch conflicts and mismatched existing credits roll back all changes',async()=>{
 const r=await fixture(),other=await fixture();await assert.rejects(link(r,other.account),/cannot be moved/);
 const branch=randomUUID();await db.query('insert into customer_branches values($1,$2,$3)',[branch,other.account,'Other branch']);
 const orphan=await fixture({orphan:true});await assert.rejects(link(orphan,orphan.account,branch),/does not belong/);
 assert.equal(await scalar('select customer_account_id from customer_returns where id=$1',[orphan.id]),null);
 const g=await legacyApproval(orphan);await db.query('update financial_transactions set credit_amount=1 where id=$1',[g]);
 await assert.rejects(link(orphan),/conflicts/);assert.equal(await scalar('select customer_account_id from customer_returns where id=$1',[orphan.id]),null);
});
test('invalid money and missing authentication are rejected atomically',async()=>{
 for(const amount of [0,-1,1.001]){const r=await fixture({amount});await assert.rejects(approve(r),/positive/);}
 const r=await fixture();await assert.rejects(approve(r,'CUSTOMER_CREDIT','unknown'),/Permission denied/);
 await approve(r,'CUSTOMER_CREDIT','warehouse');await assert.rejects(reverse(r,'warehouse'),/role denied/);
 await assert.rejects(scalar('select fc_link_customer_return_v1($1,$2,$3,$4,null,$5)',['warehouse','test-session',r.id,r.account,'reason']),/role denied/);
 assert.equal(await scalar("select has_function_privilege('anon','fc_return_credit_effect_v1(uuid,text,uuid,text)','EXECUTE')"),false);
});

test('a ledger credit assigned to another customer cannot be silently reassigned',async()=>{
 const r=await fixture({orphan:true}),other=await fixture();await legacyApproval(r);
 await db.query('update customer_ledger set customer_account_id=$1 where reference_no=$2',[other.account,r.ref]);
 await assert.rejects(link(r),/belongs to another customer/);
 assert.equal(await scalar('select customer_account_id from customer_returns where id=$1',[r.id]),null);
});
test('an existing unlinked wallet credit is flagged instead of being duplicated',async()=>{
 const r=await fixture();
 await db.query("insert into customer_wallet_transactions(customer_account_id,transaction_type,direction,amount,source_type,reference) values($1,'MANUAL_CREDIT','CREDIT',$2,'FIXTURE',$3)",[r.account,r.amount,r.ref]);
 await assert.rejects(approve(r),/unlinked wallet credit/);assert.equal(await balance(r),45.99);
 assert.equal(await scalar('select count(*)::int from financial_transactions where source_id=$1',[r.id]),0);
});

test('legacy payment-style credits are not credited again to Wallet or falsely reversed',async()=>{
 const r=await fixture({orphan:true});await legacyApproval(r);
 await db.query("update customer_ledger set entry_type='PAYMENT',source='CUSTOMER_RETURN_COMPATIBILITY' where reference_no=$1",[r.ref]);
 await assert.rejects(link(r),/already recorded as a payment credit/);
 assert.equal(await scalar('select customer_account_id from customer_returns where id=$1',[r.id]),null);
 await assert.rejects(reverse(r),/already recorded as a payment credit/);
 assert.equal(await scalar('select reversed_at from customer_returns where id=$1',[r.id]),null);
 assert.equal(await scalar('select count(*)::int from customer_wallet_transactions where return_id=$1',[r.id]),0);
});
