import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();after(()=>db.close());
const ids=Array.from({length:12},(_,n)=>`${String(n+1).padStart(8,'0')}-1111-4111-8111-111111111111`);
const [inc,ex,excluded,welsh,legacy,offer,p1,p2,p3,noBase]=ids;
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table customer_accounts(id uuid primary key,account_name text,default_price_mode text,customer_price_code_id uuid,customer_price_overlay_code_id uuid,customer_price_overlay_code_ids uuid[] not null default '{}',active boolean default true,country text,town_city text,credit_limit numeric,payment_amount numeric);
 create table customer_price_codes(id uuid primary key default gen_random_uuid(),code text unique,discount_percent numeric default 0,code_type text default 'base',parent_price_code_id uuid,exact_only boolean default false,active boolean default true,updated_at timestamptz default now());
 create table products(id uuid primary key,product_name text);
 create table product_price_code_prices(id uuid primary key default gen_random_uuid(),product_id uuid references products(id),price_code_id uuid references customer_price_codes(id),price numeric,active boolean default true,updated_at timestamptz default now(),unique(product_id,price_code_id));
 create table pricing_settings(id int primary key,server_discount_percent numeric);
 create table customer_invoices(id uuid,invoice_total numeric);
 create table orders(id uuid,order_total numeric);
 create table customer_payments(id uuid,amount numeric);
 create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text) returns table(username text) language plpgsql as $$begin if p_session_token<>'fixture-session' or p_username<>'nisstaj_admin' or p_permission_key<>'page.product.pricing_rules' then raise exception 'Invalid session' using errcode='42501';end if;return query select p_username;end;$$;
 create function fc_deny_invoice_archive_changes_v1() returns trigger language plpgsql as $$begin raise exception 'Immutable history';end;$$;
 create function fc_invoice_document_total_v1(uuid) returns numeric language sql as $$select case when s.add_vat then 1 else 0 end from (select mode in ('vat','admin','admin offer','long customer','long customers','super') add_vat from (select 'vat'::text mode,'vat'::text price_mode) d) s;$$;
 insert into pricing_settings values(1,10);
 insert into customer_accounts(id,account_name,default_price_mode,customer_price_code_id,customer_price_overlay_code_ids,country,town_city,credit_limit,payment_amount) values
 ('${inc}','Billington Food And Wine','Server','${legacy}',array['${offer}'::uuid],'England','Leeds',500,25),
 ('${ex}','Ex VAT Shop','VAT','${legacy}','{}','England','Leeds',1000,50),
 ('${excluded}','Excluded shop','Server',null,'{}','England','York',200,15),
 ('${welsh}','Welsh shop','Server',null,'{}','Wales','Cardiff',300,0),
 ('${noBase}','12','Server',null,array['${offer}'::uuid],'England','Bath',100,0);
 insert into customer_price_codes(id,code,discount_percent) values('${legacy}','SHARED',7),('${offer}','DRINK',0);
 insert into products values('${p1}','Dr Pepper'),('${p2}','SKE'),('${p3}','Other');
 insert into product_price_code_prices(product_id,price_code_id,price) values('${p1}','${legacy}',8),('${p2}','${legacy}',6),('${p1}','${offer}',8.5);
 insert into customer_invoices values('${inc}',125.86);insert into orders values('${inc}',125.86);insert into customer_payments values('${inc}',25);
 grant all on customer_accounts,customer_price_codes,product_price_code_prices to anon,authenticated,service_role;`);
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const before=await scalar(`select jsonb_build_object('customers',(select jsonb_agg(c order by id) from customer_accounts c),'codes',(select jsonb_agg(c order by id) from customer_price_codes c),'prices',(select jsonb_agg(p order by id) from product_price_code_prices p))`);
for(const name of ['20261020215600_customer_code_vat_scope_and_history.sql','20261020220140_customer_code_vat_scope_permissions.sql','20261020225933_individual_customer_price_codes.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8'));
const state=async(id)=>scalar('select fc_customer_code_state_v1(to_jsonb(c)) from customer_accounts c where id=$1',[id]);
const generate=async(id,expected,token='fixture-session')=>scalar('select fc_generate_individual_customer_code_v1($1,$2,$3,$4)',['nisstaj_admin',token,id,expected || await state(id)]);
const target=async(id)=>{const s=await state(id);return {id,code_id:s.customer_price_code_id,price_mode:s.default_price_mode};};
const apply=async(targets,prices,scope={country:'All',city:'All',priceMode:'both',excludedCities:[]})=>scalar('select fc_apply_individual_customer_prices_v1($1,$2,$3,$4,$5)',['nisstaj_admin','fixture-session',targets,prices,scope]);
const price=async(code,product)=>Number(await scalar('select price from product_price_code_prices where price_code_id=$1 and product_id=$2',[code,product]));
let incCode,exCode;
const protectedSnapshot=async()=>scalar(`select jsonb_build_object('customers',(select jsonb_agg(to_jsonb(c)-array['customer_price_code_id','customer_price_overlay_code_id','customer_price_overlay_code_ids'] order by id) from customer_accounts c),'invoices',(select jsonb_agg(i) from customer_invoices i),'orders',(select jsonb_agg(o) from orders o),'payments',(select jsonb_agg(p) from customer_payments p))`);
const protectedBefore=await protectedSnapshot();
test('additive installation leaves existing assignments/prices unchanged',async()=>{
 assert.deepEqual(await scalar(`select jsonb_build_object('customers',(select jsonb_agg(c order by id) from customer_accounts c),'codes',(select jsonb_agg(to_jsonb(c)-array['applies_to_price_mode','customer_account_id'] order by id) from customer_price_codes c),'prices',(select jsonb_agg(p order by id) from product_price_code_prices p))`),before);
});
test('explicit generation is unique, repeatable and copies effective exact prices and current percentage',async()=>{
 const result=await generate(inc);incCode=result.code;
 assert.match(incCode.code,/^BIL-\d{6}$/);assert.equal(incCode.customer_account_id,inc);assert.equal(incCode.discount_percent,7);
 assert.equal(await price(incCode.id,p1),8.5);assert.equal(await price(incCode.id,p2),6);
 assert.equal(result.state.customer_price_code_id,incCode.id);assert.deepEqual(result.state.customer_price_overlay_code_ids,[]);assert.equal(result.state.default_price_mode,'Server');
 const repeat=await generate(inc);assert.equal(repeat.code.id,incCode.id);assert.equal(repeat.created,false);
 assert.equal(await scalar('select count(*)::int from customer_price_codes where customer_account_id=$1',[inc]),1);
});
test('normal-mode generation retains Inc.VAT percentage and offer-only exact prices',async()=>{
 const result=await generate(noBase);assert.match(result.code.code,/^CUS-\d{6}$/);assert.equal(result.code.discount_percent,10);assert.equal(await price(result.code.id,p1),8.5);
 exCode=(await generate(ex)).code;assert.equal(exCode.discount_percent,7);
 await generate(excluded);await generate(welsh);
});
test('unauthorized generation, stale state and ownership/extra-code assignments are blocked',async()=>{
 await assert.rejects(generate(ex,undefined,'invalid'),/Invalid session/);
 await assert.rejects(generate(inc,{...(await state(inc)),default_price_mode:'VAT'}),/Customer changed/);
 await assert.rejects(db.query('update customer_accounts set customer_price_code_id=$1 where id=$2',[incCode.id,ex]),/one customer/);
 await assert.rejects(db.query('update customer_accounts set customer_price_overlay_code_ids=array[$1::uuid] where id=$2',[offer,inc]),/one individual code/);
 await assert.rejects(db.query('update customer_accounts set customer_price_code_id=$1 where id=$2',[legacy,inc]),/Keep the individual/);
});
test('country/city/mode scope updates only matching individual codes and does not touch shared codes',async()=>{
 const result=await apply(await Promise.all([inc,ex,excluded,welsh].map(target)),[{product_id:p1,price:8.75}],{country:'England',city:'All',excludedCities:['York'],priceMode:'inc vat'});
 assert.equal(result.updated_customers,1);assert.equal(result.skipped.length,3);assert.equal(await price(incCode.id,p1),8.75);assert.equal(await price(exCode.id,p1),8);
 assert.equal(await price(legacy,p1),8);assert.equal(await price(offer,p1),8.5);
});
test('individual overrides take independent prices and explicit clear removes only the requested product',async()=>{
 await apply([await target(ex)],[{product_id:p1,price:9.25},{product_id:p3,price:12.5}]);assert.equal(await price(exCode.id,p1),9.25);assert.equal(await price(incCode.id,p1),8.75);
 await apply([await target(ex)],[{product_id:p1,price:null}]);assert.equal(await scalar('select count(*)::int from product_price_code_prices where price_code_id=$1 and product_id=$2',[exCode.id,p1]),0);assert.equal(await price(exCode.id,p3),12.5);
});
test('invalid and stale bulk requests roll back the whole transaction',async()=>{
 const old=await price(incCode.id,p1);
 await assert.rejects(apply([await target(inc),{...(await target(ex)),price_mode:'Server'}],[{product_id:p1,price:1}]),/pricing changed/);assert.equal(await price(incCode.id,p1),old);
 for(const amount of [0,-1,0.001,'NaN'])await assert.rejects(apply([await target(inc)],[{product_id:p1,price:amount}]),/positive/);
 await assert.rejects(apply([await target(inc)],[{product_id:p1}]),/positive/);
 await assert.rejects(apply([await target(inc),await target(inc)],[{product_id:p1,price:2}]),/Duplicate/);
});
test('percentage changes are audited, bounded and compare-and-set',async()=>{
 const result=await scalar('select fc_edit_individual_customer_percent_v1($1,$2,$3,$4,$5)',['nisstaj_admin','fixture-session',incCode.id,12,7]);assert.equal(result.discount_percent,12);
 await assert.rejects(scalar('select fc_edit_individual_customer_percent_v1($1,$2,$3,$4,$5)',['nisstaj_admin','fixture-session',incCode.id,15,7]),/Percentage changed/);
 await assert.rejects(scalar('select fc_edit_individual_customer_percent_v1($1,$2,$3,$4,$5)',['nisstaj_admin','fixture-session',incCode.id,101,12]),/between 0 and 100/);
});
test('ordinary clients cannot forge an individual write context, overwrite prices or edit audit history',async()=>{
 await db.exec('set role anon');try{
  await assert.rejects(db.exec("insert into fc_individual_price_context values(txid_current(),pg_backend_pid(),'nisstaj_admin')"),/permission denied/);
  await db.query("select set_config('fc.individual_price_authorized','verified',true)");
  await assert.rejects(db.query('update customer_price_codes set discount_percent=99 where id=$1',[incCode.id]),/verified individual/);
  await assert.rejects(db.query('update product_price_code_prices set price=0 where price_code_id=$1',[incCode.id]),/verified individual/);
  await assert.rejects(db.exec('select * from customer_individual_price_audit'),/permission denied/);
 }finally{await db.exec('reset role');}
 await assert.rejects(db.exec("update customer_individual_price_audit set changed_by='forged'"),/Immutable/);
});
test('no operation changes saved invoices, orders, customer details, VAT mode, credit or payments',async()=>{
 assert.deepEqual(await protectedSnapshot(),protectedBefore);
 assert.equal(await scalar('select count(*)::int from fc_individual_price_context'),0);
 assert.ok(await scalar('select count(*)::int from customer_individual_price_audit')>=8);
});
