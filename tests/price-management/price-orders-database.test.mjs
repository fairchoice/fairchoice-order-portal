import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test,{after} from 'node:test';
const db=new PGlite();after(()=>db.close());
await db.exec(`create role anon;create role authenticated;
create table orders(id uuid primary key,status text,price_mode text default 'VAT',customer_country text,financial_status text default 'ACTIVE',financial_voided_at timestamptz,net_total numeric,subtotal numeric,vat_total numeric,order_total numeric,updated_at timestamptz);
create table products(id uuid primary key,vat_price numeric);
create table order_items(id uuid primary key,order_id uuid,product_id uuid,qty integer,picked_qty integer,price numeric,unit_price numeric,line_total numeric,net_total numeric,gross_total numeric,vat_total numeric,vat_amount numeric,vat_rate numeric,vat_type text,status text,include_in_picking boolean default true,updated_at timestamptz);
create table financial_audit_log(action text,entity_type text,entity_id text,reason text,before_data jsonb,after_data jsonb,changed_by text);
create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission text)
returns table(staff_role text,username text) language plpgsql as $$begin
 if p_session_token<>'valid' or p_permission<>'page.product.price_management' then raise exception 'Denied' using errcode='42501';end if;
 return query select case when p_username='admin' then 'Admin' else 'Staff' end,p_username;end;$$;`);
const dir=new URL('../../supabase/migrations/',import.meta.url);
const name=(await readdir(dir)).find(n=>n.endsWith('_price_management_active_order_updates.sql'));
const sql=await readFile(new URL(name,dir),'utf8');await db.exec(sql);await db.exec(sql);
const scalar=async(q,p=[])=>Object.values((await db.query(q,p)).rows[0])[0];
async function fixture(status='Received'){
 const order=randomUUID(),item=randomUUID(),product=randomUUID();
 await db.query('insert into orders(id,status) values($1,$2)',[order,status]);
 await db.query('insert into products values($1,12)',[product]);
 await db.query("insert into order_items(id,order_id,product_id,qty,picked_qty,price,net_total,gross_total,updated_at,status) values($1,$2,$3,5,0,8,40,48,'2026-10-16T12:00:00Z','In Stock')",[item,order,product]);
 return {itemId:item,orderId:order,productId:product,orderStatus:status,oldPrice:8,newPrice:12,qty:5,expectedUpdatedAt:'2026-10-16T12:00:00Z',expectedPriceMode:'VAT',expectedCountry:'',expectedVatPrice:12,vatRate:20,addVat:true};
}
const apply=(rows,user='admin')=>scalar('select fc_update_active_order_prices_v1($1,$2,$3::jsonb)',[user,'valid',JSON.stringify(rows)]);
test('Received and Warehouse updates set prices and totals without changing quantities or stage',async()=>{
 for(const status of ['Received','Warehouse Packing']){
  const r=await fixture(status);const result=await apply([r]);assert.equal(result.updated_lines,1);
  const i=(await db.query('select * from order_items where id=$1',[r.itemId])).rows[0];
  assert.equal(Number(i.price),12);assert.equal(Number(i.net_total),60);assert.equal(Number(i.gross_total),72);assert.equal(i.qty,5);assert.equal(i.picked_qty,0);assert.equal(i.status,'In Stock');assert.equal(i.include_in_picking,true);
  assert.equal(Number(await scalar('select order_total from orders where id=$1',[r.orderId])),72);
  assert.equal(await scalar('select status from orders where id=$1',[r.orderId]),status);
 }
});
test('Delivered, changed-stage and void orders cannot be updated',async()=>{
 for(const change of ["status='Delivered'","status='Warehouse Packing'","financial_status='VOID'"]){const r=await fixture();await db.query('update orders set '+change+' where id=$1',[r.orderId]);await assert.rejects(apply([r]),/stage changed|no longer active/);assert.equal(Number(await scalar('select price from order_items where id=$1',[r.itemId])),8);}
});
test('stale line or product prices are rejected and an entire mixed batch rolls back',async()=>{
 const a=await fixture(),b=await fixture();await db.query('update order_items set qty=6 where id=$1',[b.itemId]);
 await assert.rejects(apply([a,b]),/changed after review/);assert.equal(Number(await scalar('select price from order_items where id=$1',[a.itemId])),8);
 const c=await fixture();await db.query('update products set vat_price=13 where id=$1',[c.productId]);await assert.rejects(apply([c]),/database price changed/);
});
test('non-admins, duplicate lines and invalid prices are refused',async()=>{
 const r=await fixture();await assert.rejects(apply([r],'staff'),/Admin approval/);await assert.rejects(apply([r,r]),/Duplicate/);
 await assert.rejects(apply([{...r,newPrice:-1}]),/Invalid/);
});
test('zero quantities are preserved and free lines cannot be repriced',async()=>{
 const r=await fixture();await db.query('update order_items set qty=0 where id=$1',[r.itemId]);await apply([{...r,qty:0}]);assert.equal(Number(await scalar('select gross_total from order_items where id=$1',[r.itemId])),0);
 const f=await fixture();await db.query("update order_items set status='Free' where id=$1",[f.itemId]);await assert.rejects(apply([f]),/Free promotion/);
});

test('header totals continue to exclude pre-supply lines without changing their status or quantity',async()=>{
 const r=await fixture();const extra=randomUUID();
 await db.query("insert into order_items(id,order_id,qty,picked_qty,price,net_total,gross_total,vat_total,status,include_in_picking) values($1,$2,10,0,100,1000,1200,200,'Pre-Order Supply',false)",[extra,r.orderId]);
 await apply([r]);assert.equal(Number(await scalar('select order_total from orders where id=$1',[r.orderId])),72);
 assert.equal(await scalar('select status from order_items where id=$1',[extra]),'Pre-Order Supply');
 assert.equal(Number(await scalar('select qty from order_items where id=$1',[extra])),10);
});
