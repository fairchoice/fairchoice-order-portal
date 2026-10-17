import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
const db=new PGlite();after(()=>db.close());
await db.exec(`create role anon;create role authenticated;
create table fc_permissions(permission_key text primary key,permission_name text,category text,description text,active boolean,updated_at timestamptz default now());
create table fc_staff_permissions(staff_id uuid,permission_key text,allowed boolean);
create table mock_staff(username text primary key,id uuid unique);
create table customer_accounts(id uuid primary key,account_name text,country text,postcode text,town_city text,address text,address_line_1 text,address_line_2 text);
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
create function fc_require_session_permission_v2(u text,t text,p text) returns table(staff_id uuid,staff_role text,effective_permissions jsonb) language plpgsql as $$declare sid uuid;perms jsonb;begin
 if t<>'valid' or u='customer' or p<>'order.checkout.payment' then raise exception 'Denied' using errcode='42501'; end if;
 select m.id into sid from mock_staff m where m.username=u;
 if found then
  select coalesce(jsonb_object_agg(sp.permission_key,sp.allowed),'{}'::jsonb) into perms from fc_staff_permissions sp join fc_permissions fp on fp.permission_key=sp.permission_key and fp.active where sp.staff_id=sid;
 elsif u in ('owner','Super Admin') then sid:='00000000-0000-0000-0000-000000000001';perms:='{"all_access":true}'::jsonb;
 else
  sid:='00000000-0000-0000-0000-000000000002';
  -- Existing report fixtures are explicitly assigned every scoped group.
  perms:='{"agency.middleton_england":true,"agency.south_england":true,"agency.west_england":true,"agency.east_england":true,"agency.wales":true,"agency.shared_totals":true}'::jsonb;
 end if;
 return query select sid,u,perms;end;$$;`);
const migrations=new URL('../../supabase/migrations/',import.meta.url);
const file=(await readdir(migrations)).find(n=>n.endsWith('_agency_performance_report.sql'));
const migration=await readFile(new URL(file,migrations),'utf8');await db.exec(migration);await db.exec(migration);
const dates=await readFile(new URL((await readdir(migrations)).find(n=>n.endsWith('_agency_performance_order_dates.sql')),migrations),'utf8');await db.exec(dates);await db.exec(dates);
const groupsSql=await readFile(new URL((await readdir(migrations)).find(n=>n.endsWith('_customer_performance_groups.sql')),migrations),'utf8');
await db.exec("insert into customer_accounts(id,country,town_city) values('00000000-0000-0000-0000-000000000011','England','Southampton'),('00000000-0000-0000-0000-000000000012','England','Milton Keynes')");
await db.exec(groupsSql);
const pagesSql=await readFile(new URL((await readdir(migrations)).find(n=>n.endsWith('_agency_customer_sales_pages.sql')),migrations),'utf8');await db.exec(pagesSql);await db.exec(pagesSql);
const accessSql=await readFile(new URL((await readdir(migrations)).find(n=>n.endsWith('_agency_access_control.sql')),migrations),'utf8');await db.exec(accessSql);await db.exec(accessSql);
const backfilled=(await db.query('select performance_group from customer_accounts order by id')).rows.map(r=>r.performance_group);
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
const report=(prefix=null,city=null,from='2026-10-01',to='2026-10-31',user='owner',token='valid')=>scalar('select fc_agency_performance_v1($1,$2,$3,$4,$5,$6)',[user,token,from,to,prefix,city]);
const number=n=>Number(n||0);
const account=async(country='England',postcode='MK9 1AB',city='Milton Keynes')=>{const id=randomUUID();await db.query('insert into customer_accounts(id,country,postcode,town_city,address) values($1,$2,$3,$4,$5)',[id,country,postcode,city,city]);return id;};
const invoice=async(a,amount=100,branch=null,date='2026-10-17T12:00Z',status='ISSUED')=>{const id=randomUUID();await db.query('insert into customer_invoices(id,customer_account_id,customer_branch_id,invoice_number,invoice_date,invoice_total,status) values($1,$2,$3,$4,$5,$6,$7)',[id,a,branch,id,date,amount,status]);return id;};
const payment=async(a,amount=30,branch=null,status='POSTED',method='Cash',type='PAYMENT',date='2026-10-17T12:00Z',ref=randomUUID())=>{const id=randomUUID();await db.query('insert into customer_payments(id,customer_account_id,customer_branch_id,amount,status,payment_method,transaction_type,payment_date,payment_reference) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,a,branch,amount,status,method,type,date,ref]);return id;};
beforeEach(()=>db.exec('truncate mock_staff,fc_staff_permissions,customer_accounts,customer_branches,customer_invoices,orders,customer_payments,customer_ledger,central_payment_archive,customer_wallet_transactions,customer_branch_opening_balances,stock_locations,product_location_stock,business_payouts;'));
test('system administrators get legacy aggregates; scoped staff, customers and invalid sessions are denied',async()=>{
 for(const role of ['owner','Super Admin']) {const r=await report(null,null,null,null,role);assert.equal(number(r.sales),0);assert.equal('invoices' in r,false);}
 await assert.rejects(report(null,null,null,null,'Driver'),/Agency access denied/);
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

const groupReport=(group='Middleton England')=>scalar('select fc_agency_performance_v2($1,$2,null,null,null,null,$3)',['Warehouse','valid',group]);
test('migration backfills named places and Middleton; groups cannot be empty, invalid or cleared',async()=>{
 assert.deepEqual(backfilled,['South England','Middleton England']);const a=await account();
 await assert.rejects(db.query("update customer_accounts set performance_group='' where id=$1",[a]),/constraint/);
 await assert.rejects(db.query("update customer_accounts set performance_group=null where id=$1",[a]),/null/);
 await assert.rejects(db.query("update customer_accounts set performance_group='Unknown' where id=$1",[a]),/constraint/);
});
test('each listed location belongs to exactly its regional group and is excluded from Middleton',async()=>{
 const cases=[['Southampton','South England',10],['Portsmouth','South England',20],['Shillington','South England',30],['Swindon','West England',40],['Newport','Wales',50],['Kent','East England',60],['Milton Keynes','Middleton England',70],['Luton','Middleton England',80],['Bedford','Middleton England',90]];
 for(const [city,group,amount] of cases){const a=await account(city==='Newport'?'Wales':'England','MK1 1AB',city);await invoice(a,amount);assert.equal(await scalar('select performance_group from customer_accounts where id=$1',[a]),group);}
 for(const [group,amount] of [['South England',60],['West England',40],['Wales',50],['East England',60],['Middleton England',240]]){const r=await groupReport(group);assert.equal(number(r.sales),amount);assert.equal(r.performance_group,group);}
 await assert.rejects(groupReport('Unknown'),/Invalid Performance Group/);
});
test('manual group choice survives address updates; branches follow the customer group',async()=>{
 const a=await account('England','SO1 1AB','Southampton');await db.query("update customer_accounts set performance_group='East England',town_city='Swindon' where id=$1",[a]);const b=randomUUID();await db.query("insert into customer_branches values($1,$2,'England','MK1 1AB','Bedford')",[b,a]);await invoice(a,100,b);assert.equal(number((await groupReport('East England')).sales),100);assert.equal(number((await groupReport()).sales),0);
});
test('Wales group reads Wales stock; England groups share country stock without inventing agency quantities',async()=>{
 const eng=randomUUID(),wal=randomUUID(),p=randomUUID();await db.query("insert into stock_locations values($1,'England warehouse','England',true),($2,'Wales warehouse','Wales',true)",[eng,wal]);await db.query('insert into product_location_stock values($1,$3,5,0),($2,$3,80,0)',[eng,wal,p]);assert.equal(number((await groupReport('Wales')).stock_units),80);assert.equal(number((await groupReport('South England')).stock_units),5);
});

const customerPage=(page=1,group='Middleton England',prefix=null,city=null,from=null,to=null,user='Driver',token='valid')=>scalar('select fc_agency_customer_sales_v1($1,$2,$3,$4,$5,$6,$7,$8)',[user,token,from,to,prefix,city,group,page]);
test('customer sales pages are bounded, deterministic, complete and reconcile with the group summary',async()=>{
 const ids=[];for(let j=0;j<65;j++){const a=await account();ids.push(a);await db.query('update customer_accounts set account_name=$2 where id=$1',[a,'Customer '+j]);await invoice(a,j);}
 const pages=await Promise.all([customerPage(1),customerPage(2),customerPage(3)]);assert.deepEqual(pages.map(p=>p.rows.length),[30,30,5]);assert.equal(pages[0].rows[0].customer_name,'Customer 64');
 const rows=pages.flatMap(p=>p.rows);assert.equal(new Set(rows.map(r=>r.customer_id)).size,65);assert.deepEqual(new Set(rows.map(r=>r.customer_id)),new Set(ids));assert.equal(rows.reduce((sum,r)=>sum+number(r.sales),0),number((await groupReport()).sales));
 for(const page of pages){assert.equal(number(page.total_rows),65);assert.equal(number(page.total_pages),3);assert.equal(number(page.total_sales),2080);}
 assert.deepEqual((await customerPage(2)).rows,pages[1].rows);assert.equal((await customerPage(999)).page,3);
});
test('customer names and sales stay within Performance Group and applied postcode/city/date filters',async()=>{
 const a=await account(),b=await account('England','LU1 1AB','Luton'),c=await account('England','SO1 1AB','Southampton');await invoice(a,100);await invoice(b,200);await invoice(c,900);
 const r=await customerPage(1,'Middleton England','MK','Milton Keynes','2026-10-01','2026-10-31');assert.equal(number(r.total_rows),1);assert.equal(r.rows[0].customer_id,a);assert.equal(number(r.rows[0].sales),100);
 const old=await customerPage(1,'Middleton England',null,null,'2026-09-01','2026-09-30');assert.equal(number(old.total_rows),2);assert.ok(old.rows.every(r=>number(r.sales)===0));
});
test('customer sales aggregate matching branches once, with void and old-order fallback matching summary',async()=>{
 const a=await account(),b=randomUUID();await db.query("insert into customer_branches values($1,$2,'England','LU1 1AB','Luton')",[b,a]);await invoice(a,100);await invoice(a,200,b);await invoice(a,800,null,undefined,'CANCELLED');
 const o=randomUUID();await db.query("insert into orders(id,customer_account_id,order_number,status,delivered_at,order_total) values($1,$2,'OLD-PAGE','Delivered','2026-10-17',75)",[o,a]);
 const all=await customerPage();assert.equal(all.rows.length,1);assert.equal(number(all.rows[0].sales),375);assert.equal(number(all.rows[0].invoice_count),3);assert.equal(number(all.total_sales),number((await groupReport()).sales));assert.equal(number((await customerPage(1,'Middleton England','LU')).rows[0].sales),200);
});
test('empty customer pages are valid; invalid pages, groups, customers and expired staff sessions are denied',async()=>{
 const r=await customerPage();assert.deepEqual(r.rows,[]);assert.equal(number(r.total_rows),0);assert.equal(r.page,1);assert.equal(r.total_pages,1);
 await assert.rejects(customerPage(0),/Page must/);await assert.rejects(customerPage(null),/Page must/);await assert.rejects(customerPage(1,'Unknown'),/Invalid Performance Group/);
 for(const [user,token] of [['customer','valid'],['Driver','expired']]) await assert.rejects(customerPage(1,'Middleton England',null,null,null,null,user,token),/Denied/);
 const a=await account();await invoice(a);const row=(await customerPage()).rows[0];assert.deepEqual(Object.keys(row).sort(),['customer_id','customer_name','invoice_count','sales']);
});

const accessFor=(user='owner',token='valid')=>scalar('select fc_agency_access_snapshot_v1($1,$2)',[user,token]);
const scopedSummary=(user,group)=>scalar('select fc_agency_performance_v2($1,$2,null,null,null,null,$3)',[user,'valid',group]);
const staffMember=async(username,keys=[])=>{const id=randomUUID();await db.query('insert into mock_staff values($1,$2)',[username,id]);for(const key of keys) await db.query('insert into fc_staff_permissions values($1,$2,true)',[id,key]);return id;};
test('several individuals share Middleton access without gaining other groups or changing each other',async()=>{
 const a=await staffMember('scope-a',['agency.middleton_england']),b=await staffMember('scope-b',['agency.middleton_england']);
 for(const user of ['scope-a','scope-b']) {assert.deepEqual((await accessFor(user)).groups,['Middleton England']);assert.equal(number((await scopedSummary(user,'Middleton England')).sales),0);await assert.rejects(scopedSummary(user,'South England'),/Agency access denied/);await assert.rejects(customerPage(1,'Wales',null,null,null,null,user),/Agency access denied/);}
 await db.query('delete from fc_staff_permissions where staff_id=$1',[a]);assert.deepEqual((await accessFor('scope-a')).groups,[]);await assert.rejects(scopedSummary('scope-a','Middleton England'),/Agency access denied/);assert.deepEqual((await accessFor('scope-b')).groups,['Middleton England']);assert.notEqual(a,b);
});
test('unassigned users see no agencies; direct summary, customer-page and legacy requests cannot bypass scope',async()=>{
 await staffMember('no-agency');assert.deepEqual((await accessFor('no-agency')).groups,[]);
 await assert.rejects(scopedSummary('no-agency','Middleton England'),/Agency access denied/);
 await assert.rejects(customerPage(1,'Middleton England',null,null,null,null,'no-agency'),/Agency access denied/);
 await assert.rejects(report(null,null,null,null,'no-agency'),/Agency access denied/);
});
test('only selected group data and customer names are returned; shared totals are redacted unless separately granted',async()=>{
 const sid=await staffMember('limited',['agency.south_england']);await invoice(await account('England','SO1 1AB','Southampton'),50);await invoice(await account('England','MK1 1AB','Milton Keynes'),900);
 const r=await scopedSummary('limited','South England');assert.equal(number(r.sales),50);assert.equal(r.shared_totals_visible,false);assert.equal(r.stock_units,null);assert.equal(r.shared_expenses,null);assert.deepEqual(r.stock_locations,[]);assert.equal('unlocated_accounts' in r,false);
 const names=await customerPage(1,'South England',null,null,null,null,'limited');assert.equal(number(names.total_rows),1);assert.equal(number(names.total_sales),50);
 await db.query("insert into fc_staff_permissions values($1,'agency.shared_totals',true)",[sid]);const shared=await scopedSummary('limited','South England');assert.equal(shared.shared_totals_visible,true);assert.equal(number(shared.shared_expenses),0);await assert.rejects(scopedSummary('limited','Middleton England'),/Agency access denied/);
});
test('fresh stored permissions take effect immediately and caller-supplied filters cannot widen access',async()=>{
 const sid=await staffMember('changing',['agency.wales']);assert.deepEqual((await accessFor('changing')).groups,['Wales']);await db.query("update fc_staff_permissions set allowed=false where staff_id=$1",[sid]);await assert.rejects(scopedSummary('changing','Wales'),/Agency access denied/);await db.query("insert into fc_staff_permissions values($1,'agency.east_england',true)",[sid]);assert.deepEqual((await accessFor('changing')).groups,['East England']);await assert.rejects(scopedSummary('changing','Wales'),/Agency access denied/);
});
test('master access includes all agencies while invalid/customer sessions remain denied',async()=>{
 assert.equal((await accessFor('owner')).groups.length,5);assert.equal((await accessFor('owner')).can_view_shared_totals,true);
 await assert.rejects(accessFor('customer'),/Denied/);await assert.rejects(accessFor('owner','expired'),/Denied/);
 const privileges=await scalar("select has_function_privilege('anon','fc_require_agency_access_v1(text,text,text)','execute')");assert.equal(privileges,false);
});
