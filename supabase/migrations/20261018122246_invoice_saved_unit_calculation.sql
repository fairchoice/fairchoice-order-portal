-- Calculate from saved invoice unit prices before cached line amounts.
-- This changes no catalogue prices, line statuses, free rows or financial movements.
-- Existing invoice data repairs are separately audited; no automatic backfill here.
begin;
create or replace function public.fc_invoice_document_total_v1(p_order_id uuid)
returns numeric language sql volatile security invoker set search_path=pg_catalog,public as $$
 with doc as (
  select o.*,lower(regexp_replace(regexp_replace(trim(coalesce(o.price_mode,'')),'[._-]+',' ','g'),'\s+',' ','g')) mode
  from public.orders o where o.id=p_order_id
   and lower(trim(o.status)) in ('delivered','confirmed','delivery confirmed','completed')
   and upper(coalesce(o.financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED')
 ), settings as (
  select *,mode in ('vat','admin','admin offer','long customer','long customers','super') add_vat from doc
 ), raw as (
  select to_jsonb(i) j,d.add_vat from public.order_items i join settings d on d.id=i.order_id
 ), items as (
  select j,add_vat,coalesce((j->>'qty')::numeric,(j->>'quantity')::numeric,(j->>'picked_qty')::numeric,0) qty,
   coalesce((j->>'price')::numeric,(j->>'unit_price')::numeric) price,
   lower(trim(coalesce(j->>'source_status',j->>'status',''))) source,
   nullif(replace(coalesce(j->>'vat_percent',j->>'vatRate',j->>'vat_rate',j->>'vat_type'),'%',''),'')::numeric raw_rate
  from raw
 ), lines as (
  select case when not add_vat then 0 when raw_rate=0.2 then 20 when raw_rate=0.05 then 5 else coalesce(raw_rate,0) end rate,
   round(case when source in ('free','promotion free') then 0
    when not add_vat and price is not null then price*qty
    when price is not null and raw_rate is not null then price*qty
    when j->>'net_total' is not null then (j->>'net_total')::numeric
    when j->>'line_total' is not null and raw_rate is not null then (j->>'line_total')::numeric else 0 end,2) net
  from items where qty>0 and source not in ('removed','cancelled','deleted','cannot supply','need supplier','pre-order','pre order','pre-order supply','pre order supply','supply needed','next supplier')
   and (source in ('in stock','available','supplied') or coalesce((j->>'include_in_picking')::boolean,true))
 ), grouped as (select rate,sum(net) net from lines group by rate),
 totals as (select coalesce(sum(net),0)+coalesce(sum(round(net*rate/100,2)),0) gross from grouped)
 select round(case when coalesce(d.order_total,0)>0 and (t.gross=0 or abs(d.order_total-t.gross)<=0.05)
  then d.order_total else coalesce(nullif(t.gross,0),d.order_total,0) end,2)
 from settings d cross join totals t;
$$;
revoke all on function public.fc_invoice_document_total_v1(uuid) from public,anon,authenticated;

commit;
