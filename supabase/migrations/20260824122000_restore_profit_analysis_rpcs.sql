-- Restore tested FairChoice Profit Analysis RPCs from fairchoice-testProfile.
-- Contains both v1 and v2 because v2 depends on v1.

begin;

CREATE OR REPLACE FUNCTION public.fc_profit_analysis_v1(p_username text, p_session_token text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_country text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_product text DEFAULT NULL::text, p_price_mode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare a record; f boolean; d1 date:=coalesce(p_date_from,current_date-30); d2 date:=coalesce(p_date_to,current_date); r jsonb; begin select * into a from public.fc_require_session_permission_v2(p_username,p_session_token,'page.reports.profit'); f:=lower(trim(coalesce(a.username,p_username,'')))='nisstaj_admin'; if d2<d1 then raise exception 'Profit report end date cannot be before start date.' using errcode='22023'; end if; with s as (select o.id,o.order_number,coalesce(o.delivered_at::date,o.created_at::date) sale_date,o.company_name customer_name,coalesce(o.delivery_branch_name,o.branch_name,'') branch_name,coalesce(nullif(o.customer_country,''),'Unknown') country,upper(coalesce(o.price_mode,'VAT')) price_mode,oi.product_id,coalesce(oi.product_code,p.product_code,'') product_code,coalesce(oi.product_name,p.product_name,'Unknown Product') product_name,coalesce(p.main_category,'Uncategorised') category,greatest(coalesce(oi.picked_qty,oi.qty,0),0)::numeric qty,coalesce(oi.net_total,oi.line_total,coalesce(oi.price,oi.unit_price,0)*greatest(coalesce(oi.picked_qty,oi.qty,0),0),0)::numeric net_sales,coalesce(oi.vat_total,oi.vat_amount,0)::numeric vat,coalesce(ch.c,p.cost_price,0)::numeric unit_cost from public.orders o join public.order_items oi on oi.order_id=o.id left join public.products p on p.id=oi.product_id left join lateral(select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c from public.stock_receipts sr where sr.product_id=oi.product_id and coalesce(sr.received_date,sr.created_at)<=coalesce(o.delivered_at,o.created_at::timestamp) and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null) ch on true where lower(trim(coalesce(o.status,'')))='delivered' and upper(coalesce(o.financial_status,'ACTIVE'))='ACTIVE' and o.financial_voided_at is null and coalesce(o.delivered_at::date,o.created_at::date) between d1 and d2 and greatest(coalesce(oi.picked_qty,oi.qty,0),0)>0 and (f or upper(coalesce(o.price_mode,'VAT'))<>'SERVER') and (p_country is null or lower(coalesce(o.customer_country,''))=lower(p_country)) and (p_customer is null or lower(coalesce(o.company_name,'')) like '%'||lower(p_customer)||'%') and (p_product is null or lower(coalesce(oi.product_name,'')) like '%'||lower(p_product)||'%' or lower(coalesce(oi.product_code,p.product_code,'')) like '%'||lower(p_product)||'%') and (p_price_mode is null or upper(coalesce(o.price_mode,'VAT'))=upper(p_price_mode))), sc as(select *,round(qty*unit_cost,2) cogs from s), rr as(select cr.id,cr.return_number,coalesce(cr.confirmed_at::date,cr.created_at::date) return_date,cr.customer_name,cri.product_id,coalesce(cri.product_code,p.product_code,'') product_code,coalesce(cri.product_name,p.product_name,'Unknown Product') product_name,coalesce(cri.qty,0)::numeric qty,coalesce(cri.net_total,cri.unit_price*cri.qty,0)::numeric return_net,coalesce(ch.c,p.cost_price,0)::numeric unit_cost from public.customer_returns cr join public.customer_return_items cri on cri.return_id=cr.id left join public.orders o on o.id=cr.order_id left join public.products p on p.id=cri.product_id left join lateral(select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c from public.stock_receipts sr where sr.product_id=cri.product_id and coalesce(sr.received_date,sr.created_at)<=coalesce(cr.confirmed_at,cr.created_at) and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null) ch on true where lower(coalesce(cr.status,''))='confirmed' and cr.reversed_at is null and coalesce(cr.confirmed_at::date,cr.created_at::date) between d1 and d2 and (f or upper(coalesce(o.price_mode,'VAT'))<>'SERVER') and (p_customer is null or lower(coalesce(cr.customer_name,'')) like '%'||lower(p_customer)||'%') and (p_product is null or lower(coalesce(cri.product_name,'')) like '%'||lower(p_product)||'%' or lower(coalesce(cri.product_code,p.product_code,'')) like '%'||lower(p_product)||'%')), rc as(select *,round(qty*unit_cost,2) cost_recovered from rr), ex as(select coalesce(sum(e.amount),0)::numeric total from public.expenses e where e.status='Approved' and e.expense_date between d1 and d2), prod as(select sc.product_id,max(sc.product_code) product_code,max(sc.product_name) product_name,max(sc.category) category,sum(sc.qty) qty_sold,sum(sc.net_sales) sales,sum(sc.cogs) cogs,coalesce((select sum(rc.return_net) from rc where rc.product_id=sc.product_id),0) returns,coalesce((select sum(rc.cost_recovered) from rc where rc.product_id=sc.product_id),0) cost_recovered from sc group by sc.product_id), pr as(select *,sales-returns adjusted_sales,greatest(cogs-cost_recovered,0) adjusted_cogs,(sales-returns)-greatest(cogs-cost_recovered,0) gross_profit,case when sales-returns=0 then 0 else ((sales-returns)-greatest(cogs-cost_recovered,0))/(sales-returns)*100 end margin_pct from prod), cust as(select sc.customer_name,count(distinct sc.id) orders,sum(sc.net_sales) sales,sum(sc.cogs) cogs,coalesce((select sum(rc.return_net) from rc where rc.customer_name=sc.customer_name),0) returns,coalesce((select sum(rc.cost_recovered) from rc where rc.customer_name=sc.customer_name),0) cost_recovered from sc group by sc.customer_name), crw as(select *,sales-returns adjusted_sales,greatest(cogs-cost_recovered,0) adjusted_cogs,(sales-returns)-greatest(cogs-cost_recovered,0) gross_profit,case when sales-returns=0 then 0 else ((sales-returns)-greatest(cogs-cost_recovered,0))/(sales-returns)*100 end margin_pct from cust), cat as(select category,sum(adjusted_sales) sales,sum(adjusted_cogs) cogs,sum(gross_profit) gross_profit,case when sum(adjusted_sales)=0 then 0 else sum(gross_profit)/sum(adjusted_sales)*100 end margin_pct from pr group by category), daily as(select sale_date,sum(net_sales) sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit from sc group by sale_date), pm as(select price_mode,sum(net_sales) sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit from sc group by price_mode), sm as(select coalesce(sum(net_sales),0) gross_sales,coalesce(sum(cogs),0) sales_cogs,coalesce((select sum(return_net) from rc),0) returns,coalesce((select sum(cost_recovered) from rc),0) return_cost_recovery,coalesce((select total from ex),0) expenses from sc) select jsonb_build_object('rule',jsonb_build_object('full_internal_view',f,'staff_view','SERVER sales excluded unless master Admin','cost_method','Weighted historical stock receipt cost up to sale/return date; product cost fallback'), 'period',jsonb_build_object('date_from',d1,'date_to',d2), 'summary',(select jsonb_build_object('gross_sales',gross_sales,'returns',returns,'net_sales',gross_sales-returns,'cogs',greatest(sales_cogs-return_cost_recovery,0),'gross_profit',(gross_sales-returns)-greatest(sales_cogs-return_cost_recovery,0),'gross_margin_pct',case when gross_sales-returns=0 then 0 else ((gross_sales-returns)-greatest(sales_cogs-return_cost_recovery,0))/(gross_sales-returns)*100 end,'approved_expenses',expenses,'net_profit',(gross_sales-returns)-greatest(sales_cogs-return_cost_recovery,0)-expenses) from sm), 'filters',jsonb_build_object('countries',coalesce((select jsonb_agg(distinct country order by country) from s),'[]'::jsonb),'price_modes',coalesce((select jsonb_agg(distinct price_mode order by price_mode) from s),'[]'::jsonb)), 'rows',jsonb_build_object('products',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from pr x),'[]'::jsonb),'customers',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from crw x),'[]'::jsonb),'categories',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from cat x),'[]'::jsonb),'daily',coalesce((select jsonb_agg(to_jsonb(x) order by sale_date) from daily x),'[]'::jsonb),'price_modes',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from pm x),'[]'::jsonb))) into r; return r; end; $function$;

CREATE OR REPLACE FUNCTION public.fc_profit_analysis_v2(p_username text, p_session_token text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_country text DEFAULT NULL::text, p_customer text DEFAULT NULL::text, p_product text DEFAULT NULL::text, p_price_mode text DEFAULT NULL::text)
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
  base jsonb;
begin
  select * into a from public.fc_require_session_permission_v2(p_username,p_session_token,'page.reports.profit');
  f := lower(trim(coalesce(a.username,p_username,'')))='nisstaj_admin';
  if d2<d1 then raise exception 'Profit report end date cannot be before start date.' using errcode='22023'; end if;
  base := public.fc_profit_analysis_v1(p_username,p_session_token,d1,d2,p_country,p_customer,p_product,p_price_mode);

  with order_base as (
    select o.id,o.order_number,coalesce(o.delivered_at::date,o.created_at::date) sale_date,
      o.company_name customer_name,coalesce(o.delivery_branch_name,o.branch_name,'') branch_name,
      coalesce(nullif(o.customer_country,''),'Unknown') country,upper(coalesce(o.price_mode,'VAT')) price_mode,
      coalesce(o.sales_rep_code,'Unassigned') sales_rep_code,coalesce(o.sales_rep_name,'Unassigned') sales_rep_name,
      coalesce(o.delivery_route,'Unassigned') delivery_route,
      coalesce(o.order_total,o.final_total,o.total,0)::numeric order_value
    from public.orders o
    where lower(trim(coalesce(o.status,'')))='delivered'
      and upper(coalesce(o.financial_status,'ACTIVE'))='ACTIVE'
      and o.financial_voided_at is null
      and coalesce(o.delivered_at::date,o.created_at::date) between d1 and d2
      and (f or upper(coalesce(o.price_mode,'VAT'))<>'SERVER')
      and (p_country is null or lower(coalesce(o.customer_country,''))=lower(p_country))
      and (p_customer is null or lower(coalesce(o.company_name,'')) like '%'||lower(p_customer)||'%')
      and (p_price_mode is null or upper(coalesce(o.price_mode,'VAT'))=upper(p_price_mode))
      and (p_product is null or exists(select 1 from public.order_items oi where oi.order_id=o.id and (lower(coalesce(oi.product_name,'')) like '%'||lower(p_product)||'%' or lower(coalesce(oi.product_code,'')) like '%'||lower(p_product)||'%')))
  ),
  item_sales as (
    select ob.id order_id,ob.order_number,ob.sale_date,ob.customer_name,ob.branch_name,ob.country,ob.price_mode,
      ob.sales_rep_code,ob.sales_rep_name,ob.delivery_route,
      oi.product_id,coalesce(oi.product_code,p.product_code,'') product_code,
      coalesce(oi.product_name,p.product_name,'Unknown Product') product_name,
      coalesce(p.brand,'Unassigned') brand,coalesce(p.series,'Unassigned') series,coalesce(p.main_category,'Uncategorised') category,
      greatest(coalesce(oi.picked_qty,oi.qty,0),0)::numeric qty,
      coalesce(oi.net_total,oi.line_total,coalesce(oi.price,oi.unit_price,0)*greatest(coalesce(oi.picked_qty,oi.qty,0),0),0)::numeric net_sales,
      round(greatest(coalesce(oi.picked_qty,oi.qty,0),0)*coalesce(ch.c,p.cost_price,0),2)::numeric cogs
    from order_base ob
    join public.order_items oi on oi.order_id=ob.id
    left join public.products p on p.id=oi.product_id
    left join lateral (
      select sum(sr.cost_price*sr.qty_received)/nullif(sum(sr.qty_received),0) c
      from public.stock_receipts sr
      where sr.product_id=oi.product_id and coalesce(sr.received_date,sr.created_at)<=ob.sale_date::timestamp + interval '1 day'
        and coalesce(sr.qty_received,0)>0 and sr.cost_price is not null
    ) ch on true
    where greatest(coalesce(oi.picked_qty,oi.qty,0),0)>0
  ),
  rep_rows as (
    select sales_rep_code,sales_rep_name,count(distinct order_id) orders,count(distinct customer_name) customers,
      sum(qty) units,sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit,
      case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct,
      round(sum(net_sales)/nullif(count(distinct order_id),0),2) avg_order_value
    from item_sales group by sales_rep_code,sales_rep_name
  ),
  route_rows as (
    select delivery_route,count(distinct order_id) orders,count(distinct customer_name) customers,
      sum(qty) units,sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit,
      case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct,
      round(sum(net_sales)/nullif(count(distinct order_id),0),2) avg_order_value
    from item_sales group by delivery_route
  ),
  series_rows as (
    select series,count(distinct product_id) products,count(distinct order_id) orders,count(distinct customer_name) customers,
      sum(qty) units,sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit,
      case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct
    from item_sales group by series
  ),
  brand_rows as (
    select brand,count(distinct product_id) products,count(distinct order_id) orders,count(distinct customer_name) customers,
      sum(qty) units,sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit,
      case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct
    from item_sales group by brand
  ),
  invoice_status_rows as (
    select case when coalesce(cia.remaining_amount,0)<=0 then 'Paid' when coalesce(cia.allocated_amount,0)>0 then 'Part Paid' else 'Outstanding' end invoice_status,
      count(*) invoices,sum(coalesce(cia.invoice_amount,0)) invoice_total,sum(coalesce(cia.allocated_amount,0)) paid_amount,sum(coalesce(cia.remaining_amount,0)) outstanding_amount
    from public.customer_invoice_allocations cia
    join order_base ob on ob.id=cia.order_id
    where cia.active is true
    group by 1
  ),
  payment_rows as (
    select coalesce(cp.payment_method,'Unknown') payment_method,count(*) payments,sum(coalesce(cp.amount,0)) amount
    from public.customer_payments cp
    where cp.status='Active' and cp.payment_date between d1 and d2
    group by coalesce(cp.payment_method,'Unknown')
  ),
  discount_rows as (
    select coalesce(nullif(trim(opd.promotion_type),''),'Order Discount') discount_type,
      count(distinct opd.order_id) orders,sum(coalesce(opd.discount_amount,0)) discount_amount
    from public.order_promotion_discount opd
    join order_base ob on ob.id=opd.order_id
    where opd.active is true
    group by 1
  ),
  daily_rows as (
    select sale_date,count(distinct order_id) orders,count(distinct customer_name) customers,sum(qty) units,
      sum(net_sales) net_sales,sum(cogs) cogs,sum(net_sales)-sum(cogs) gross_profit,
      case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct
    from item_sales group by sale_date
  ),
  customer_rows as (
    select customer_name,count(distinct order_id) orders,sum(qty) units,sum(net_sales) net_sales,sum(cogs) cogs,
      sum(net_sales)-sum(cogs) gross_profit,case when sum(net_sales)=0 then 0 else (sum(net_sales)-sum(cogs))/sum(net_sales)*100 end margin_pct,
      min(sale_date) first_sale,max(sale_date) last_sale
    from item_sales group by customer_name
  )
  select base || jsonb_build_object(
    'advanced',jsonb_build_object(
      'sales_reps',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from rep_rows x),'[]'::jsonb),
      'routes',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from route_rows x),'[]'::jsonb),
      'series',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from series_rows x),'[]'::jsonb),
      'brands',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from brand_rows x),'[]'::jsonb),
      'invoice_status',coalesce((select jsonb_agg(to_jsonb(x) order by invoice_status) from invoice_status_rows x),'[]'::jsonb),
      'payment_methods',coalesce((select jsonb_agg(to_jsonb(x) order by amount desc) from payment_rows x),'[]'::jsonb),
      'discounts',coalesce((select jsonb_agg(to_jsonb(x) order by discount_amount desc) from discount_rows x),'[]'::jsonb),
      'daily_advanced',coalesce((select jsonb_agg(to_jsonb(x) order by sale_date) from daily_rows x),'[]'::jsonb),
      'customer_advanced',coalesce((select jsonb_agg(to_jsonb(x) order by gross_profit desc) from customer_rows x),'[]'::jsonb)
    ),
    'filters',coalesce(base->'filters','{}'::jsonb) || jsonb_build_object(
      'sales_reps',coalesce((select jsonb_agg(distinct sales_rep_name order by sales_rep_name) from item_sales),'[]'::jsonb),
      'routes',coalesce((select jsonb_agg(distinct delivery_route order by delivery_route) from item_sales),'[]'::jsonb),
      'series',coalesce((select jsonb_agg(distinct series order by series) from item_sales),'[]'::jsonb),
      'brands',coalesce((select jsonb_agg(distinct brand order by brand) from item_sales),'[]'::jsonb)
    )
  ) into r;
  return r;
end;
$function$;

revoke all on function public.fc_profit_analysis_v1(text,text,date,date,text,text,text,text) from public;
grant execute on function public.fc_profit_analysis_v1(text,text,date,date,text,text,text,text) to anon, authenticated, service_role;

revoke all on function public.fc_profit_analysis_v2(text,text,date,date,text,text,text,text) from public;
grant execute on function public.fc_profit_analysis_v2(text,text,date,date,text,text,text,text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
