-- Restore the tested Product Line Analysis RPC from FairChoice test-profile.
-- Source: test-profile Supabase function public.fc_product_line_analysis_v1
-- Safe additive migration: creates/replaces the RPC and grants app execution.

begin;

CREATE OR REPLACE FUNCTION public.fc_product_line_analysis_v1(p_username text, p_session_token text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_country text DEFAULT NULL::text, p_product_line text DEFAULT NULL::text, p_supplier text DEFAULT NULL::text, p_product text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a record;
  f boolean;
  d1 date := coalesce(p_date_from,current_date-30);
  d2 date := coalesce(p_date_to,current_date);
  r jsonb;
begin
  select * into a from public.fc_require_session_permission_v2(p_username,p_session_token,'page.reports.product_line');
  f := lower(trim(coalesce(a.username,p_username,'')))='nisstaj_admin';
  if d2<d1 then raise exception 'Product Line report end date cannot be before start date.' using errcode='22023'; end if;

  with product_base as (
    select p.id,p.product_code,p.product_name,p.main_category,p.brand,p.series,
      coalesce(nullif(trim(p.series),''),nullif(trim(p.brand),''),nullif(trim(p.main_category),''),'Unassigned') product_line,
      coalesce(p.cost_price,0)::numeric fallback_cost
    from public.products p
    where lower(coalesce(p.status,'active')) not in ('inactive','disabled','deleted')
  ),
  supplier_now as (
    select spp.product_id,
      count(distinct spp.supplier_id) supplier_count,
      min(spp.unit_cost) min_supplier_cost,
      max(spp.unit_cost) max_supplier_cost,
      avg(spp.unit_cost) avg_supplier_cost,
      string_agg(distinct s.supplier_name, ', ' order by s.supplier_name) suppliers
    from public.supplier_product_pricing spp
    join public.suppliers s on s.id=spp.supplier_id
    where spp.active is true and spp.effective_to is null
      and (p_supplier is null or lower(s.supplier_name) like '%'||lower(p_supplier)||'%')
    group by spp.product_id
  ),
  sales_raw as (
    select o.id order_id,o.order_number,coalesce(o.delivered_at::date,o.created_at::date) sale_date,
      coalesce(nullif(o.customer_country,''),'Unknown') country,
      oi.product_id,pb.product_code,pb.product_name,pb.main_category,pb.brand,pb.series,pb.product_line,
      greatest(coalesce(oi.picked_qty,oi.qty,0),0)::numeric qty,
      coalesce(oi.net_total,oi.line_total,coalesce(oi.price,oi.unit_price,0)*greatest(coalesce(oi.picked_qty,oi.qty,0),0),0)::numeric net_sales,
      coalesce(ch.c,pb.fallback_cost,0)::numeric unit_cost
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    join product_base pb on pb.id=oi.product_id
    left join lateral (
      select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c
      from public.stock_receipts sr
      where sr.product_id=oi.product_id
        and coalesce(sr.received_date,sr.created_at)<=coalesce(o.delivered_at,o.created_at::timestamp)
        and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null
    ) ch on true
    where lower(trim(coalesce(o.status,'')))='delivered'
      and upper(coalesce(o.financial_status,'ACTIVE'))='ACTIVE'
      and o.financial_voided_at is null
      and coalesce(o.delivered_at::date,o.created_at::date) between d1 and d2
      and greatest(coalesce(oi.picked_qty,oi.qty,0),0)>0
      and (f or upper(coalesce(o.price_mode,'VAT'))<>'SERVER')
      and (p_country is null or lower(coalesce(o.customer_country,''))=lower(p_country))
      and (p_product_line is null or lower(pb.product_line) like '%'||lower(p_product_line)||'%')
      and (p_product is null or lower(pb.product_name) like '%'||lower(p_product)||'%' or lower(pb.product_code) like '%'||lower(p_product)||'%')
      and (p_supplier is null or exists(select 1 from supplier_now sn where sn.product_id=pb.id))
  ),
  sales as (
    select *,round(qty*unit_cost,2) cogs from sales_raw
  ),
  returns as (
    select cri.product_id,pb.product_line,coalesce(cri.qty,0)::numeric return_qty,
      coalesce(cri.net_total,cri.unit_price*cri.qty,0)::numeric returns_net,
      round(coalesce(cri.qty,0)*coalesce(ch.c,pb.fallback_cost,0),2) cost_recovered
    from public.customer_returns cr
    join public.customer_return_items cri on cri.return_id=cr.id
    left join public.orders o on o.id=cr.order_id
    join product_base pb on pb.id=cri.product_id
    left join lateral (
      select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c
      from public.stock_receipts sr
      where sr.product_id=cri.product_id
        and coalesce(sr.received_date,sr.created_at)<=coalesce(cr.confirmed_at,cr.created_at)
        and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null
    ) ch on true
    where lower(coalesce(cr.status,''))='confirmed' and cr.reversed_at is null
      and coalesce(cr.confirmed_at::date,cr.created_at::date) between d1 and d2
      and (f or upper(coalesce(o.price_mode,'VAT'))<>'SERVER')
      and (p_product_line is null or lower(pb.product_line) like '%'||lower(p_product_line)||'%')
      and (p_product is null or lower(pb.product_name) like '%'||lower(p_product)||'%' or lower(pb.product_code) like '%'||lower(p_product)||'%')
      and (p_supplier is null or exists(select 1 from supplier_now sn where sn.product_id=pb.id))
  ),
  stock_cost as (
    select pb.id product_id,pb.product_line,
      coalesce(ch.c,pb.fallback_cost,0)::numeric unit_cost
    from product_base pb
    left join lateral (
      select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c
      from public.stock_receipts sr where sr.product_id=pb.id and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null
    ) ch on true
  ),
  stock as (
    select pls.product_id,pb.product_line,sum(pls.qty)::numeric stock_qty,
      sum(pls.qty*sc.unit_cost)::numeric stock_value,
      sum(case when lower(coalesce(sl.country,''))='england' then pls.qty else 0 end)::numeric england_stock,
      sum(case when lower(coalesce(sl.country,''))='wales' then pls.qty else 0 end)::numeric wales_stock
    from public.product_location_stock pls
    join public.stock_locations sl on sl.id=pls.location_id
    join product_base pb on pb.id=pls.product_id
    join stock_cost sc on sc.product_id=pls.product_id
    where p_country is null or lower(sl.country)=lower(p_country)
    group by pls.product_id,pb.product_line
  ),
  product_sales as (
    select s.product_id,s.product_code,s.product_name,s.product_line,
      count(distinct s.order_id) orders,sum(s.qty) qty_sold,sum(s.net_sales) net_sales,sum(s.cogs) cogs,
      sum(s.net_sales)-sum(s.cogs) gross_profit,
      case when sum(s.net_sales)=0 then 0 else (sum(s.net_sales)-sum(s.cogs))/sum(s.net_sales)*100 end margin_pct,
      min(s.sale_date) first_sale,max(s.sale_date) last_sale
    from sales s group by s.product_id,s.product_code,s.product_name,s.product_line
  ),
  product_returns as (
    select product_id,sum(return_qty) return_qty,sum(returns_net) returns_net,sum(cost_recovered) cost_recovered
    from returns group by product_id
  ),
  product_rows as (
    select pb.id product_id,pb.product_code,pb.product_name,pb.product_line,
      coalesce(ps.orders,0) orders,coalesce(ps.qty_sold,0) qty_sold,coalesce(ps.net_sales,0) net_sales,
      greatest(coalesce(ps.cogs,0)-coalesce(pr.cost_recovered,0),0) cogs,
      coalesce(ps.net_sales,0)-coalesce(pr.returns_net,0) adjusted_sales,
      (coalesce(ps.net_sales,0)-coalesce(pr.returns_net,0))-greatest(coalesce(ps.cogs,0)-coalesce(pr.cost_recovered,0),0) gross_profit,
      case when (coalesce(ps.net_sales,0)-coalesce(pr.returns_net,0))=0 then 0 else ((coalesce(ps.net_sales,0)-coalesce(pr.returns_net,0))-greatest(coalesce(ps.cogs,0)-coalesce(pr.cost_recovered,0),0))/(coalesce(ps.net_sales,0)-coalesce(pr.returns_net,0))*100 end margin_pct,
      coalesce(pr.return_qty,0) return_qty,coalesce(pr.returns_net,0) returns_net,
      coalesce(st.stock_qty,0) stock_qty,coalesce(st.stock_value,0) stock_value,coalesce(st.england_stock,0) england_stock,coalesce(st.wales_stock,0) wales_stock,
      ps.last_sale,
      case when coalesce(ps.qty_sold,0)=0 then null else round(coalesce(st.stock_qty,0)/(coalesce(ps.qty_sold,0)/greatest((d2-d1+1),1)::numeric),1) end days_stock,
      coalesce(sn.supplier_count,0) supplier_count,coalesce(sn.min_supplier_cost,0) min_supplier_cost,coalesce(sn.max_supplier_cost,0) max_supplier_cost,coalesce(sn.avg_supplier_cost,0) avg_supplier_cost,coalesce(sn.suppliers,'') suppliers
    from product_base pb
    left join product_sales ps on ps.product_id=pb.id
    left join product_returns pr on pr.product_id=pb.id
    left join stock st on st.product_id=pb.id
    left join supplier_now sn on sn.product_id=pb.id
    where (p_product_line is null or lower(pb.product_line) like '%'||lower(p_product_line)||'%')
      and (p_product is null or lower(pb.product_name) like '%'||lower(p_product)||'%' or lower(pb.product_code) like '%'||lower(p_product)||'%')
      and (p_supplier is null or sn.product_id is not null)
  ),
  line_rows as (
    select product_line,count(*) products,
      sum(qty_sold) qty_sold,sum(adjusted_sales) net_sales,sum(cogs) cogs,sum(gross_profit) gross_profit,
      case when sum(adjusted_sales)=0 then 0 else sum(gross_profit)/sum(adjusted_sales)*100 end margin_pct,
      sum(return_qty) return_qty,sum(returns_net) returns_net,sum(stock_qty) stock_qty,sum(stock_value) stock_value,
      sum(england_stock) england_stock,sum(wales_stock) wales_stock,
      case when sum(qty_sold)=0 then null else round(sum(stock_qty)/(sum(qty_sold)/greatest((d2-d1+1),1)::numeric),1) end days_stock,
      count(*) filter(where qty_sold=0 and stock_qty>0) dead_products,
      count(*) filter(where qty_sold>0 and stock_qty>0 and (stock_qty/(qty_sold/greatest((d2-d1+1),1)::numeric))>60) slow_products
    from product_rows group by product_line
  ),
  trend as (
    select sale_date,product_line,sum(qty) qty_sold,sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit
    from sales group by sale_date,product_line
  ),
  summary as (
    select coalesce(sum(net_sales),0) net_sales,coalesce(sum(cogs),0) cogs,coalesce(sum(gross_profit),0) gross_profit,
      coalesce(sum(qty_sold),0) qty_sold,coalesce(sum(return_qty),0) return_qty,coalesce(sum(returns_net),0) returns_net,
      coalesce(sum(stock_qty),0) stock_qty,coalesce(sum(stock_value),0) stock_value,count(*) product_lines
    from line_rows
  )
  select jsonb_build_object(
    'rule',jsonb_build_object('full_internal_view',f,'cost_method','Weighted historical stock receipt cost up to transaction date; product cost fallback','product_line_method','Product series; brand/category fallback'),
    'period',jsonb_build_object('date_from',d1,'date_to',d2,'country',coalesce(p_country,'All')),
    'summary',(select jsonb_build_object('net_sales',net_sales,'cogs',cogs,'gross_profit',gross_profit,'margin_pct',case when net_sales=0 then 0 else gross_profit/net_sales*100 end,'qty_sold',qty_sold,'return_qty',return_qty,'returns_net',returns_net,'stock_qty',stock_qty,'stock_value',stock_value,'product_lines',product_lines) from summary),
    'filters',jsonb_build_object('product_lines',coalesce((select jsonb_agg(distinct product_line order by product_line) from product_base),'[]'::jsonb),'suppliers',coalesce((select jsonb_agg(supplier_name order by supplier_name) from public.suppliers where active is not false),'[]'::jsonb)),
    'rows',jsonb_build_object(
      'lines',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from line_rows x),'[]'::jsonb),
      'products',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from product_rows x),'[]'::jsonb),
      'trend',coalesce((select jsonb_agg(to_jsonb(x) order by sale_date,product_line) from trend x),'[]'::jsonb),
      'slow_stock',coalesce((select jsonb_agg(to_jsonb(x) order by stock_value desc) from product_rows x where stock_qty>0 and (qty_sold=0 or days_stock>60)),'[]'::jsonb),
      'supplier_costs',coalesce((select jsonb_agg(jsonb_build_object('product_id',product_id,'product_code',product_code,'product_name',product_name,'product_line',product_line,'supplier_count',supplier_count,'min_supplier_cost',min_supplier_cost,'max_supplier_cost',max_supplier_cost,'avg_supplier_cost',avg_supplier_cost,'suppliers',suppliers) order by product_line,product_name) from product_rows where supplier_count>0),'[]'::jsonb)
    )
  ) into r;
  return r;
end;
$function$;

revoke all on function public.fc_product_line_analysis_v1(text,text,date,date,text,text,text,text) from public;
grant execute on function public.fc_product_line_analysis_v1(text,text,date,date,text,text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
