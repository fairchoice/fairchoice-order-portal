import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
const db=new PGlite();after(()=>db.close());
const inc='11111111-1111-4111-8111-111111111111',ex='22222222-2222-4222-8222-222222222222';
const base='33333333-3333-4333-8333-333333333333',offer='44444444-4444-4444-8444-444444444444',both='55555555-5555-4555-8555-555555555555';
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table customer_accounts(id uuid primary key,account_name text,default_price_mode text,customer_price_code_id uuid,customer_price_overlay_code_id uuid,customer_price_overlay_code_ids uuid[] not null default '{}',credit_limit numeric,payment_amount numeric);
 create table customer_price_codes(id uuid primary key,code text,code_type text default 'base',parent_price_code_id uuid,active boolean default true);
 create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text) returns table(username text) language plpgsql as $$begin if p_session_token<>'fixture-session' or p_username not in ('nisstaj_admin','staff') or p_permission_key<>'page.product.pricing_rules' then raise exception 'Invalid session' using errcode='42501';end if;return query select p_username;end;$$;
 create function fc_deny_invoice_archive_changes_v1() returns trigger language plpgsql as $$begin raise exception 'Immutable history';end;$$;
 create function fc_invoice_document_total_v1(uuid) returns numeric language sql as $$select case when s.add_vat then 1 else 0 end from (select mode in ('vat','admin','admin offer','long customer','long customers','super') add_vat from (select 'vat'::text mode,'vat'::text price_mode) d) s;$$;
 insert into customer_accounts values('${inc}','Inc shop','Server','${base}',null,'{}',500,25),('${ex}','Ex shop','VAT','${base}',null,'{}',1000,50);
 insert into customer_price_codes(id,code) values('${base}','BASE'),('${offer}','ENGDRN01'),('${both}','SKE');`);
const rows=async()=>JSON.stringify((await db.query('select * from customer_accounts order by id')).rows);
const before=await rows();
await db.exec(await readFile(new URL('../../supabase/migrations/20261020215600_customer_code_vat_scope_and_history.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/20261020220140_customer_code_vat_scope_permissions.sql',import.meta.url),'utf8'));
const scalar=async(sql,params=[])=>Object.values((await db.query(sql,params)).rows[0])[0];
const state=async(id)=>scalar('select fc_customer_code_state_v1(to_jsonb(c)) from customer_accounts c where id=$1',[id]);
const assign=async(id,code=offer,kind='offer',remove=false,expected,username='nisstaj_admin',token='fixture-session')=>scalar('select fc_assign_customer_price_code_v1($1,$2,$3,$4,$5,$6,$7)',[username,token,id,code,kind,remove,expected || await state(id)]);
const reverse=async(id,user='nisstaj_admin',reason='Restore saved configuration')=>scalar('select fc_reverse_customer_code_change_v1($1,$2,$3,$4)',[user,'fixture-session',id,reason]);
const latest=async(id)=>scalar('select id from customer_code_change_history where customer_id=$1 order by changed_at desc,id desc limit 1',[id]);

test('installation changes no customer mode, assignment, credit or payment',async()=>{
 assert.equal(await rows(),before);assert.equal(await scalar('select count(*)::int from customer_code_change_history'),0);
 await db.query("update customer_price_codes set applies_to_price_mode='inc vat' where id=$1",[offer]);
});
test('mismatched Ex.VAT customer is skipped without any database or audit change',async()=>{
 const old=await rows();const result=await assign(ex);assert.equal(result.status,'skipped');assert.equal(await rows(),old);assert.equal(await scalar('select count(*)::int from customer_code_change_history'),0);
});
test('matching Inc.VAT customer can have many codes and keeps its VAT mode, credit and payment',async()=>{
 await assign(inc);await assign(inc,both);
 const a=await scalar('select to_jsonb(c) from customer_accounts c where id=$1',[inc]);
 assert.equal(a.default_price_mode,'Server');assert.equal(a.credit_limit,500);assert.equal(a.payment_amount,25);
 assert.deepEqual(new Set(a.customer_price_overlay_code_ids),new Set([offer,both]));
 assert.equal(await scalar('select count(*)::int from customer_code_change_history'),2);
});
test('Base Code assignment preserves VAT mode and all additional offers',async()=>{
 const original=await state(inc);await assign(inc,both,'base');
 const s=await state(inc);assert.equal(s.default_price_mode,'Server');assert.equal(s.customer_price_code_id,both);assert.deepEqual(s.customer_price_overlay_code_ids,original.customer_price_overlay_code_ids);
});
test('stale assignments and unverified callers fail without overwriting',async()=>{
 const s=await state(ex),old=await rows();
 await assert.rejects(assign(ex,both,'offer',false,s,'nisstaj_admin','wrong'),/Invalid session/);
 await assert.rejects(assign(ex,both,'offer',false,{...s,default_price_mode:'Server'}),/Customer changed/);
 assert.equal(await rows(),old);
});
test('old clients cannot change customer VAT mode as a side effect of assigning codes',async()=>{
 const old=await rows();
 await assert.rejects(db.query("update customer_accounts set default_price_mode='Server',customer_price_code_id=$1 where id=$2",[both,ex]),/cannot change/);
 await assert.rejects(db.query('update customer_accounts set customer_price_overlay_code_ids=array[$1::uuid] where id=$2',[offer,ex]),/does not match/);
 assert.equal(await rows(),old);
});
test('recorded Ex.VAT to Inc.VAT mode changes can be restored by the owner only',async()=>{
 const original=await state(ex);
 await db.query("update customer_accounts set default_price_mode='Server' where id=$1",[ex]);const id=await latest(ex);
 await assert.rejects(reverse(id,'staff'),/Only nisstaj_admin/);
 await assert.rejects(reverse(id,'nisstaj_admin',''),/reason/);
 const restored=await reverse(id);assert.deepEqual(restored,original);
 assert.equal(await scalar('select count(*)::int from customer_code_change_history where reverses_change_id=$1',[id]),1);
 await assert.rejects(reverse(id),/changed again/);
});
test('reversal refuses to discard a newer change',async()=>{
 await assign(ex,both);const id=await latest(ex);await assign(ex,base,'base',true);
 const old=await rows();await assert.rejects(reverse(id),/changed again/);assert.equal(await rows(),old);
});
test('history is immutable and not directly available to anonymous or authenticated clients',async()=>{
 await assert.rejects(db.exec("update customer_code_change_history set changed_by='forged'"),/Immutable/);
 for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  try {await assert.rejects(db.exec('select * from customer_code_change_history'),/permission denied/);}
  finally{await db.exec('reset role');}
 }
});
