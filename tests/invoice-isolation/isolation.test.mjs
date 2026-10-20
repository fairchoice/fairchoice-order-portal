import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
const db=new PGlite();after(()=>db.close());
const o1='11111111-1111-4111-8111-111111111111',o2='22222222-2222-4222-8222-222222222222';
const i1='33333333-3333-4333-8333-333333333333',i2='44444444-4444-4444-8444-444444444444';
const l1='55555555-5555-4555-8555-555555555555',l2='66666666-6666-4666-8666-666666666666';
await db.exec(`create role anon;create role authenticated;create role service_role;
 create table orders(id uuid primary key,order_number text,customer_account_id uuid,customer_branch_id uuid,company_name text,delivery_address text,delivery_postcode text,postcode text,price_mode text,status text,order_total numeric,grand_total numeric,subtotal numeric,net_total numeric,vat_total numeric,notes text,payment_amount numeric,updated_at timestamptz);
 create table order_items(id uuid primary key default gen_random_uuid(),order_id uuid,product_id uuid,product_code text,product_name text,qty int,picked_qty int,price numeric,unit_price numeric,net_total numeric,line_total numeric,gross_total numeric,vat_total numeric,vat_amount numeric,vat_rate numeric,vat_type text,source_status text,include_in_picking boolean,updated_at timestamptz);
 create table customer_invoices(id uuid primary key default gen_random_uuid(),order_id uuid unique,invoice_number text unique,customer_account_id uuid,customer_branch_id uuid,invoice_total numeric,price_mode text,status text,financial_status text default 'ACTIVE',amount_to_collect numeric,wallet_applied_amount numeric,updated_at timestamptz);
 create table customer_ledger(id uuid primary key default gen_random_uuid(),reference_no text,order_number text,customer_name text,invoice_date timestamptz,entry_type text,customer_account_id uuid,customer_branch_id uuid,invoice_total numeric,invoice_amount numeric,debit numeric,amount numeric,paid_amount numeric,remaining_amount numeric,invoice_status text,price_mode text,updated_at timestamptz);
 create table financial_audit_log(action text,entity_type text,entity_id text,customer_account_id uuid,customer_branch_id uuid,reason text,before_data jsonb,after_data jsonb,changed_by text);
 create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text) returns table(username text) language plpgsql as $$ begin if p_username<>'nisstaj_admin' or p_session_token<>'fixture-owner-session' then raise exception 'Invalid owner session' using errcode='42501';end if;return query select p_username;end;$$;
 create function fc_invoice_document_total_v1(p_order_id uuid) returns numeric language sql as $$select sum(qty*price) from order_items where order_id=p_order_id and source_status='In Stock'$$;
 create function sync_customer_invoice_from_order_v1(p_order_id uuid) returns void language plpgsql as $$declare v_order orders%rowtype;begin select * into v_order from orders where id=p_order_id;insert into customer_invoices(order_id,invoice_number,customer_account_id,invoice_total,price_mode,status) values(v_order.id,v_order.order_number,v_order.customer_account_id,v_order.order_total,v_order.price_mode,'ISSUED') on conflict(order_id) do update set invoice_total=excluded.invoice_total;perform public.recalculate_central_payment_fifo(v_order.customer_account_id);end;$$;
 create function fc_invoice_total_before_write_v1() returns trigger language plpgsql as $$begin return new;end;$$;
 create trigger fc_invoice_total_before_write before insert or update of invoice_total,order_id on customer_invoices for each row execute function fc_invoice_total_before_write_v1();
 insert into orders(id,order_number,customer_account_id,price_mode,status,order_total,updated_at) values('${o1}','INV-ONE','${o1}','Server','Delivered',20,now()),('${o2}','INV-TWO','${o1}','Server','Delivered',0,now());
 insert into order_items(id,order_id,product_name,qty,picked_qty,price,unit_price,net_total,line_total,source_status,vat_rate) values('${l1}','${o1}','Saved item',2,2,10,10,20,20,'In Stock',20),('${l2}','${o2}','Unavailable item',1,0,0,0,0,0,'Cannot Supply',20);
 insert into customer_invoices(id,order_id,invoice_number,customer_account_id,invoice_total,price_mode,status) values('${i1}','${o1}','INV-ONE','${o1}',20,'Server','ISSUED'),('${i2}','${o2}','INV-TWO','${o1}',0,'Server','ISSUED');
 insert into customer_ledger(reference_no,entry_type,customer_account_id,invoice_total,invoice_amount,debit,amount,paid_amount) values('INV-ONE','INVOICE','${o1}',20,20,20,20,0);
 grant select,insert,update,delete on orders,order_items,customer_invoices,customer_ledger to anon,authenticated,service_role;`);
const snapshot=async()=>JSON.stringify((await db.query(`select jsonb_build_object('orders',(select jsonb_agg(o order by id) from orders o),'items',(select jsonb_agg(l order by id) from order_items l),'invoices',(select jsonb_agg(i order by id) from customer_invoices i),'ledger',(select jsonb_agg(l order by id) from customer_ledger l)) doc`)).rows);
const before=await snapshot();
const names=await readdir(new URL('../../supabase/migrations/',import.meta.url));
await db.exec(await readFile(new URL('../../supabase/migrations/'+names.find(n=>n.endsWith('issued_invoice_read_only_guards.sql')),import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/'+names.find(n=>n.endsWith('issued_invoice_owner_session_v2.sql')),import.meta.url),'utf8'));
const scalar=async(sql,params=[])=>{const value=Object.values((await db.query(sql,params)).rows[0])[0];return typeof value==='string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;};
const prepare=async()=>JSON.parse(JSON.stringify(await scalar('select fc_prepare_issued_invoice_edit_v1($1,$2,$3)',['nisstaj_admin','fixture-owner-session',o1])));
const amend=async(revision,lines,username='nisstaj_admin',token='fixture-owner-session')=>scalar('select fc_amend_issued_invoice_v1($1,$2,$3,$4,$5,$6,$7)',[username,token,o1,revision,'Explicit owner fixture amendment',JSON.stringify({price_mode:'Server'}),JSON.stringify(lines)]);
const line=(price=12,id=l1)=>({db_id:id,qty:2,price,vat_rate:20,source_status:'In Stock'});

test('installing protection leaves every existing order, invoice, item and ledger row unchanged',async()=>{assert.equal(await snapshot(),before);assert.equal(await scalar('select count(*) from fc_issued_invoice_archive'),2);});
test('direct changes and deletion are blocked, including source line insertion and reparenting',async()=>{
 for(const sql of [
 `update customer_invoices set invoice_total=0 where id='${i1}'`,
 `update customer_invoices set price_mode='VAT' where id='${i1}'`,
 `update customer_invoices set status='CANCELLED' where id='${i1}'`,
 `delete from customer_invoices where id='${i1}'`,
 `update orders set order_total=0 where id='${o1}'`,
 `update orders set status='Received' where id='${o1}'`,
 `delete from orders where id='${o1}'`,
 `update order_items set price=0 where id='${l1}'`,
 `update order_items set order_id='${o2}' where id='${l1}'`,
 `delete from order_items where id='${l1}'`,
 `insert into order_items(order_id,qty,price) values('${o1}',1,999)`,
 `update customer_ledger set amount=0 where reference_no='INV-ONE'`,
 `delete from customer_ledger where reference_no='INV-ONE'`,
 `update fc_issued_invoice_archive set invoice_number='changed'`,
 `delete from fc_issued_invoice_archive`,
 `truncate customer_invoices`, `truncate orders`, `truncate order_items`, `truncate customer_ledger`, `truncate fc_issued_invoice_archive`,
 ]) await assert.rejects(db.exec(sql),/read-only|cannot be deleted|immutable/);
 assert.equal(await snapshot(),before);
});
test('repeated synchronization is a read-only operation and does not rewrite old zero invoices',async()=>{await db.query('select sync_customer_invoice_from_order_v1($1)',[o1]);await db.query('select sync_customer_invoice_from_order_v1($1)',[o2]);assert.equal(await snapshot(),before);});
test('anonymous callers cannot forge an edit context or access the original sync bypass',async()=>{
 await db.exec('set role anon');try{
  await assert.rejects(db.exec(`insert into fc_invoice_edit_context values(txid_current(),pg_backend_pid(),'${i1}','nisstaj_admin')`),/permission denied/);
  await assert.rejects(db.query('select fc_issue_customer_invoice_original_v1($1)',[o1]),/permission denied/);
  await assert.rejects(db.exec(`update order_items set price=1 where id='${l1}'`),/read-only/);
 }finally{await db.exec('reset role');}
});
test('a username string is not enough: general admins, missing and invalid sessions fail',async()=>{
 const p=await prepare();for(const [u,t] of [['other_admin','fixture-owner-session'],['nisstaj_admin',''],['nisstaj_admin','wrong'],['nisstaj_adm','fixture-owner-session']]) await assert.rejects(amend(p.revision,[line()],u,t),/Invalid owner session/);
 assert.equal(await snapshot(),before);
});
test('normal payment updates are separate from immutable invoice contents',async()=>{
 const p=await prepare();await db.exec(`update customer_invoices set amount_to_collect=15,wallet_applied_amount=5 where id='${i1}';update customer_ledger set paid_amount=5,remaining_amount=15,invoice_status='PART PAID' where reference_no='INV-ONE';update orders set payment_amount=5 where id='${o1}';`);
 assert.equal((await prepare()).revision,p.revision);assert.equal(await scalar(`select invoice_total from customer_invoices where id='${i1}'`),20);
});
test('verified owner amendment is atomic, audited and keeps the immutable original snapshot',async()=>{
 const p=await prepare();const result=await amend(p.revision,[line()]);assert.equal(result.invoice_total,24);
 assert.equal(await scalar(`select price from order_items where id='${l1}'`),12);
 assert.equal(await scalar('select count(*) from financial_audit_log'),1);
 assert.equal(await scalar('select changed_by from financial_audit_log'),'nisstaj_admin');
 assert.equal(await scalar(`select (original_document->'invoice'->>'invoice_total')::numeric from fc_issued_invoice_archive where invoice_id='${i1}'`),20);
 assert.equal(await scalar('select count(*) from fc_invoice_edit_context'),0);
 await assert.rejects(amend(p.revision,[line(13)]),/changed since/);
});
test('zero totals and cross-invoice edits roll back every intermediate write and audit entry',async()=>{
 const p=await prepare();const baseline=await snapshot();
 await assert.rejects(amend(p.revision,[line(0)]),/cannot zero/);
 assert.equal(await snapshot(),baseline);
 await assert.rejects(amend(p.revision,[line(13),line(5,l2)]),/does not belong/);
 assert.equal(await snapshot(),baseline);
 assert.equal(await scalar('select count(*) from financial_audit_log'),1);
 assert.equal(await scalar('select count(*) from fc_invoice_edit_context'),0);
});
test('new non-invoiced orders remain editable but issuing a zero invoice is blocked',async()=>{
 const id='77777777-7777-4777-8777-777777777777';await db.exec(`insert into orders(id,order_number,customer_account_id,price_mode,status,order_total) values('${id}','NEW-ORDER','${o1}','Server','Received',0);update orders set order_total=10 where id='${id}';insert into order_items(order_id,qty,price,source_status) values('${id}',1,10,'In Stock');`);
 await db.query('select sync_customer_invoice_from_order_v1($1)',[id]);assert.equal(await scalar(`select invoice_total from customer_invoices where order_id='${id}'`),10);
 assert.equal(await scalar("select count(*) from customer_ledger where reference_no='NEW-ORDER'"),1);
 assert.equal(await scalar("select invoice_total from customer_ledger where reference_no='NEW-ORDER'"),10);
 await db.query('select sync_customer_invoice_from_order_v1($1)',[id]);
 assert.equal(await scalar("select count(*) from customer_ledger where reference_no='NEW-ORDER'"),1);
 const empty='88888888-8888-4888-8888-888888888888';await db.exec(`insert into orders(id,order_number,customer_account_id,price_mode,status,order_total) values('${empty}','EMPTY-ORDER','${o1}','Server','Delivered',0)`);
 await assert.rejects(db.query('select sync_customer_invoice_from_order_v1($1)',[empty]),/positive saved total/);
 assert.equal(await scalar(`select count(*) from customer_invoices where order_id='${empty}'`),0);
 await assert.rejects(db.exec("insert into customer_ledger(reference_no,entry_type,invoice_total) values('NEW-ZERO','INVOICE',0)"),/positive saved total/);
});
