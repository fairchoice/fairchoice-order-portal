import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
const db=new PGlite();after(()=>db.close());
await db.exec(`create role anon;create role authenticated;
create table customer_accounts(id uuid primary key,country text,postcode text,town_city text,address text);
create table customer_branches(id uuid primary key,customer_account_id uuid,country text,postcode text,delivery_address text);
create table customer_invoices(id uuid primary key,customer_account_id uuid,customer_branch_id uuid,invoice_number text,invoice_date timestamptz,invoice_total numeric,status text default 'ISSUED',financial_status text default 'ACTIVE',voided_at timestamptz,order_id uuid);
create table orders(id uuid primary key,customer_account_id uuid,customer_branch_id uuid,branch_id uuid,order_number text,status text,financial_status text,financial_voided_at timestamptz,delivered_at timestamp,created_at timestamp,order_total numeric,grand_total numeric);
create table customer_payments(id uuid primary key,customer_account_id uuid,customer_branch_id uuid,branch_id uuid,payment_date timestamptz,amount numeric,payment_method text default 'Cash',transaction_type text default 'PAYMENT',status text default 'POSTED',verification_status text default 'CONFIRMED',voided_at timestamptz,payment_reference text,created_at timestamptz default now(),idempotency_key text,metadata jsonb);
create table customer_ledger(id bigserial,customer_account_id uuid,customer_branch_id uuid,branch_id uuid,payment_date timestamptz,created_at timestamptz default now(),credit numeric,amount numeric,payment_method text,payment_type text,transaction_type text,entry_type text,payment_status text,payment_reference text,reference_no text,central_payment_id uuid,voided_at timestamptz,reversed_at timestamptz);
create table central_payment_archive(payment_id uuid);
create table customer_wallet_transactions(invoice_id uuid,customer_account_id uuid,customer_branch_id uuid,amount numeric,status text,direction text,voided_at timestamptz);
create table customer_branch_opening_balances(customer_account_id uuid,customer_branch_id uuid,opening_balance numeric);
create table stock_locations(id uuid primary key,location_name text,country text,active boolean);
create table product_location_stock(location_id uuid,product_id uuid,qty integer,low_stock_alert integer);
create table business_payouts(amount numeric,status text,voided_at timestamptz,payout_date date);
create function fc_require_session_permission_v2(u text,t text,p text) returns table(staff_id uuid,staff_role text) language plpgsql as $$begin
 if t<>'valid' or u='customer' or p<>'order.checkout.payment' then raise exception 'Denied' using errcode='42501'; end if;
 return query select '00000000-0000-0000-0000-000000000001'::uuid,u;end;$$;`);
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const file=(await readdir(migrations)).find(n=>n.endsWith('_agency_performance_report.sql'));
const migration=await readFile(new URL(file,migrations),'utf8');await db.exec(migration);await db.exec(migration);
const dates=await readFile(new URL((await readdir(migrations)).find(n=>n.endsWith('_agency_performance_order_dates.sql')),migrations),'utf8');await db.exec(dates);await db.exec(dates);
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
const report=(prefix=null,city=null,from='2026-10-01',to='2026-10-31',user='Driver',token='valid')=>scalar('select fc_agency_performance_v1($1,$2,$3,$4,$5,$6)',[user,token,from,to,prefix,city]);
const number=n=>Number(n||0);
const account=async(country='England',postcode='MK9 1AB',city='Milton Keynes')=>{const id=randomUUID();await db.query('insert into customer_accounts values($1,$2,$3,$4,$5)',[id,country,postcode,city,city]);return id;};
const invoice=async(a,amount=100,branch=null,date='2026-10-17T12:00Z',status='ISSUED')=>{const id=randomUUID();await db.query('insert into customer_invoices(id,customer_account_id,customer_branch_id,invoice_number,invoice_date,invoice_total,status) values($1,$2,$3,$4,$5,$6,$7)',[id,a,branch,id,date,amount,status]);return id;};
const payment=async(a,amount=30,branch=null,status='POSTED',method='Cash',type='PAYMENT',date='2026-10-17T12:00Z',ref=randomUUID())=>{const id=randomUUID();await db.query('insert into customer_payments(id,customer_account_id,customer_branch_id,amount,status,payment_method,transaction_type,payment_date,payment_reference) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,a,branch,amount,status,method,type,date,ref]);return id;};
beforeEach(()=>db.exec('truncate customer_accounts,customer_branches,customer_invoices,orders,customer_payments,customer_ledger,central_payment_archive,customer_wallet_transactions,customer_branch_opening_balances,stock_locations,product_location_stock,business_payouts;'));
test('all active staff roles get only aggregates; customer and invalid sessions are denied',async()=>{
 for(const role of ['Admin','Accounts','Accountant','Sales Rep','Driver','Warehouse','Brand Partner','Super Admin']) {const r=await report(null,null,null,null,role);assert.equal(number(r.sales),0);assert.equal('invoices' in r,false);}
 await assert.rejects(report(null,null,null,null,'customer'),/Denied/);await assert.rejects(report(null,null,null,null,'Driver','expired'),/Denied/);
});
test('England totals and postcode filters exclude Wales and use MK/LU fallback for UK country',async()=>{
 for(const [country,post,amount] of [['England','MK9 1AB',100],['UK','lu1 2AB',50],['Wales','MK1 2AB',700],['England','SW1A 1AA',80]]) await invoice(await account(country,post),amount);
 assert.equal(number((await report()).sales),230);assert.equal(number((await report('mk')).sales),100);assert.equal(number((await report('LU')).sales),50);
});
test('main account and branches are each counted once without duplicating payments or opening balances',async()=>{
 const a=await account();const b=randomUUID();await db.query("insert into customer_branches values($1,$2,'England','LU1 2AB','Luton')",[b,a]);await invoice(a,100);await invoice(a,200,b);await payment(a,20);await payment(a,30,b);await db.query('insert into customer_branch_opening_balances values($1,null,10),($1,$2,40)',[a,b]);
 const r=await report();assert.equal(number(r.sales),300);assert.equal(number(r.collections),50);assert.equal(number(r.outstanding),300);assert.equal(number((await report('LU')).outstanding),210);
});
test('Wallet settlement reduces outstanding but does not become cash collection; unused Wallet is excluded',async()=>{
 const a=await account(),i=await invoice(a,100);await payment(a,20);await db.query("insert into customer_wallet_transactions values($1,$2,null,30,'ACTIVE','DEBIT',null),(null,$2,null,400,'ACTIVE','CREDIT',null)",[i,a]);
 const r=await report();assert.equal(number(r.outstanding),50);assert.equal(number(r.collections),20);
});
test('void, pending and archived payments and cancelled invoices never affect totals',async()=>{
 const a=await account();await invoice(a,100);await invoice(a,500,null,undefined,'CANCELLED');await payment(a,10,null,'VOIDED');const pending=await payment(a,20);await db.query("update customer_payments set verification_status='PENDING' where id=$1",[pending]);const archived=await payment(a,30);await db.query('insert into central_payment_archive values($1)',[archived]);
 const r=await report();assert.equal(number(r.sales),100);assert.equal(number(r.outstanding),100);assert.equal(number(r.collections),0);
});
test('discounts reduce balance but are excluded from collections; other customers credits do not hide debt',async()=>{
 const a=await account();await invoice(a,100);await payment(a,10,null,'POSTED','Discount','DISCOUNT');await payment(await account(),1000);
 const r=await report();assert.equal(number(r.collections),1000);assert.equal(number(r.outstanding),90);
});
test('London dates include midnight BST and exclude next local day, while balances remain current',async()=>{
 const a=await account();await invoice(a,10,null,'2026-09-30T23:00:00Z');await invoice(a,20,null,'2026-10-01T22:59:59Z');await invoice(a,40,null,'2026-10-01T23:00:00Z');
 const r=await report(null,null,'2026-10-01','2026-10-01');assert.equal(number(r.sales),30);assert.equal(number(r.outstanding),70);await assert.rejects(report(null,null,'2026-10-02','2026-10-01'),/Date From/);
});
test('England location stock is counted once and remains country-wide under city filters',async()=>{
 const a=await account(),eng=randomUUID(),wal=randomUUID(),p=randomUUID();await invoice(a);await db.query("insert into stock_locations values($1,'England warehouse','England',true),($2,'Wales warehouse','Wales',true)",[eng,wal]);await db.query('insert into product_location_stock values($1,$3,5,7),($2,$3,100,10)',[eng,wal,p]);assert.equal(number((await report('LU')).stock_units),5);assert.equal(number((await report()).stock_locations[0].low_stock),1);
});
test('shared expenses use posted nonvoid records and date filter, unaffected by area',async()=>{
 await db.exec("insert into business_payouts values(80,'POSTED',null,'2026-10-17'),(900,'DRAFT',null,'2026-10-17'),(300,'POSTED',now(),'2026-10-17'),(100,'POSTED',null,'2026-09-01')");assert.equal(number((await report('LU')).shared_expenses),80);
});
test('city list grows from saved towns and Bedford matches delivery address',async()=>{
 const a=await account('England','MK40 1AB','');const b=randomUUID();await db.query("insert into customer_branches values($1,$2,'England','MK40 2AB','High Street, Bedford')",[b,a]);await invoice(a,100,b);await invoice(await account('England','OX1 1AB','Oxford'),50);assert.equal(number((await report(null,'Bedford')).sales),100);assert.ok((await report()).cities.includes('Oxford'));
});
test('old delivered orders are included once; canonical void invoice blocks fallback resurrection',async()=>{
 const a=await account(),o=randomUUID();await db.query("insert into orders(id,customer_account_id,order_number,status,delivered_at,order_total) values($1,$2,'ORD-1','Delivered','2026-10-17',75)",[o,a]);assert.equal(number((await report()).sales),75);const i=await invoice(a,70);await db.query('update customer_invoices set order_id=$1 where id=$2',[o,i]);assert.equal(number((await report()).sales),70);await db.query("update customer_invoices set financial_status='VOID' where id=$1",[i]);assert.equal(number((await report()).sales),0);
});
test('canonical and legacy mirrors count once, including void canonical records and migrated source identities',async()=>{
 const a=await account();const p=await payment(a,30,null,'POSTED','Cash','PAYMENT',undefined,'REF-1');await payment(a,30,null,'POSTED','Cash','PAYMENT',undefined,'REF-1');await db.query("insert into customer_ledger(customer_account_id,payment_date,credit,entry_type,payment_reference,central_payment_id) values($1,'2026-10-17T12:00Z',30,'PAYMENT','REF-1',$2),($1,'2026-10-17T12:00Z',10,'PAYMENT','OLD',null)",[a,p]);assert.equal(number((await report()).collections),40);await db.exec("update customer_payments set status='VOIDED'");assert.equal(number((await report()).collections),10);
});

test('older order timestamps written as UTC follow the same UK date boundaries as invoices',async()=>{
 const a=await account();await db.query("insert into orders(id,customer_account_id,order_number,status,delivered_at,order_total) values($1,$3,'OLD-A','Delivered','2026-09-30T23:00:00',15),($2,$3,'OLD-B','Delivered','2026-10-01T23:00:00',40)",[randomUUID(),randomUUID(),a]);assert.equal(number((await report(null,null,'2026-10-01','2026-10-01')).sales),15);
});
