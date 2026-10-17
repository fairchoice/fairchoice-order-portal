create or replace function public.fc_brand_partner_dashboard_v3(
  p_username text,
  p_session_token text,
  p_date_from date default null,
  p_date_to date default null,
  p_series text default null,
  p_promotion_type text default null,
  p_sales_rep text default null,
  p_country text default null,
  p_location_search text default null,
  p_customer_search text default null,
  p_product_search text default null,
  p_customer_page integer default 1,
  p_product_page integer default 1,
  p_rep_page integer default 1,
  p_claim_page integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  d1 date := coalesce(p_date_from, current_date - 30);
  d2 date := coalesce(p_date_to, current_date);
  v_brand text := 'Lost Mary';
  v_page_size integer := 30;
  v_customer_page integer := greatest(coalesce(p_customer_page,1),1);
  v_product_page integer := greatest(coalesce(p_product_page,1),1);
  v_rep_page integer := greatest(coalesce(p_rep_page,1),1);
  v_claim_page integer := greatest(coalesce(p_claim_page,1),1);
  r jsonb;
begin
  select * into a
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'page.reports.brand_performance'
  );

  if d2 < d1 then
    raise exception 'Brand Performance end date cannot be before start date.' using errcode='22023';
  end if;

  with lost_products as (
    select p.id,p.product_code,p.product_name,p.brand,p.series,p.flavour
    from public.products p
    where lower(trim(coalesce(p.brand,''))) = lower(v_brand)
      and lower(coalesce(p.status,'active')) not in ('inactive','disabled','deleted')
      and (p_series is null or lower(coalesce(p.series,'')) = lower(p_series))
  ),
  delivered as (
    select
      o.id order_id,
      o.order_number,
      o.customer_account_id,
      o.customer_branch_id,
      coalesce(nullif(o.delivery_branch_name,''), nullif(o.branch_name,''), ca.account_name, o.company_name, 'Unknown') branch_name,
      coalesce(ca.account_name,o.company_name,'Unknown') customer_name,
      coalesce(nullif(o.delivery_postcode,''), nullif(cb.postcode,''), nullif(ca.postcode,''), '') postcode,
      coalesce(nullif(o.customer_country,''), nullif(cb.country,''), nullif(ca.country,''), 'Unknown') country,
      coalesce(nullif(o.created_by_name,''), su.staff_name, 'Unassigned') sales_rep,
      coalesce(o.delivered_at::date,o.created_at::date) sale_date,
      upper(coalesce(o.price_mode,'VAT')) price_mode,
      oi.id order_item_id,
      oi.product_id,
      lp.product_code,
      coalesce(nullif(oi.product_name,''),lp.product_name) product_name,
      coalesce(nullif(oi.series,''),lp.series,'Unassigned') series,
      greatest(coalesce(oi.picked_qty,oi.qty,0),0)::integer qty,
      coalesce(oi.net_total,oi.line_total,coalesce(oi.price,oi.unit_price,0)*greatest(coalesce(oi.picked_qty,oi.qty,0),0),0)::numeric net_sales
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    join lost_products lp on lp.id=oi.product_id
    left join public.customer_accounts ca on ca.id=o.customer_account_id
    left join public.customer_branches cb on cb.id=o.customer_branch_id
    left join public.staff_users su on su.id=o.created_by
    where lower(trim(coalesce(o.status,'')))='delivered'
      and upper(coalesce(o.financial_status,'ACTIVE'))='ACTIVE'
      and o.financial_voided_at is null
      and coalesce(o.delivered_at::date,o.created_at::date) between d1 and d2
      and greatest(coalesce(oi.picked_qty,oi.qty,0),0)>0
      and (p_country is null or lower(coalesce(nullif(o.customer_country,''),nullif(cb.country,''),nullif(ca.country,''),''))=lower(p_country))
      and (p_location_search is null or trim(p_location_search)='' or concat_ws(' ', coalesce(o.delivery_branch_name,''), coalesce(o.branch_name,''), coalesce(cb.branch_name,''), coalesce(o.delivery_postcode,''), coalesce(cb.postcode,''), coalesce(ca.postcode,''), coalesce(o.customer_country,''), coalesce(cb.country,''), coalesce(ca.country,'')) ilike '%' || trim(p_location_search) || '%')
      and (p_sales_rep is null or lower(coalesce(nullif(o.created_by_name,''),su.staff_name,''))=lower(p_sales_rep))
  ),
  first_brand_sale as (
    select o.customer_account_id, min(coalesce(o.delivered_at::date,o.created_at::date)) first_sale_date
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    join public.products p on p.id=oi.product_id
    where lower(trim(coalesce(p.brand,'')))=lower(v_brand)
      and lower(trim(coalesce(o.status,'')))='delivered'
      and upper(coalesce(o.financial_status,'ACTIVE'))='ACTIVE'
      and o.financial_voided_at is null
      and o.customer_account_id is not null
      and greatest(coalesce(oi.picked_qty,oi.qty,0),0)>0
    group by o.customer_account_id
  ),
  promo_rules as (
    select
      pr.id,
      pr.promotion_name,
      pr.rule_kind,
      pr.trigger_product_id,
      pr.trigger_brand,
      pr.trigger_series,
      pr.buy_qty,
      pr.free_qty,
      pr.start_date,
      pr.end_date,
      pt.type_name promotion_type
    from public.promotion_rules pr
    left join public.promotion_types pt on pt.id=pr.promotion_type_id
    where pr.rule_kind='BULK_BUY_GET_FREE'
      and lower(trim(coalesce(pr.trigger_brand,'')))=lower(v_brand)
      and coalesce(pr.buy_qty,0)>0
      and coalesce(pr.free_qty,0)>0
      and (p_promotion_type is null or lower(coalesce(pt.type_name,pr.promotion_name,''))=lower(p_promotion_type))
  ),
  promo_order_paid as (
    select
      d.order_id,d.order_number,d.customer_account_id,d.customer_branch_id,d.customer_name,d.branch_name,d.postcode,d.country,d.sales_rep,d.sale_date,
      pr.id promotion_rule_id,pr.promotion_name,coalesce(pr.promotion_type,pr.promotion_name,'Promotion') promotion_type,
      pr.buy_qty,pr.free_qty,
      sum(d.qty)::integer paid_qty
    from delivered d
    join promo_rules pr
      on d.price_mode='VAT'
     and (pr.start_date is null or d.sale_date>=pr.start_date)
     and (pr.end_date is null or d.sale_date<=pr.end_date)
     and (pr.trigger_product_id is null or pr.trigger_product_id=d.product_id)
     and (pr.trigger_series is null or lower(coalesce(d.series,''))=lower(pr.trigger_series))
    group by d.order_id,d.order_number,d.customer_account_id,d.customer_branch_id,d.customer_name,d.branch_name,d.postcode,d.country,d.sales_rep,d.sale_date,
      pr.id,pr.promotion_name,pr.promotion_type,pr.buy_qty,pr.free_qty
  ),
  promo_entitlements as (
    select *, floor(paid_qty::numeric/buy_qty)::integer*free_qty::integer free_given_qty
    from promo_order_paid
    where floor(paid_qty::numeric/buy_qty)::integer*free_qty::integer > 0
  ),
  customer_agg as (
    select
      d.customer_account_id,
      d.customer_branch_id,
      d.customer_name,
      d.branch_name,
      d.postcode,
      d.country,
      min(d.sale_date) first_sale_in_period,
      max(d.sale_date) last_sale_date,
      count(distinct d.order_id) orders,
      sum(d.qty)::integer paid_units,
      coalesce((select sum(pe.free_given_qty) from promo_entitlements pe where pe.customer_account_id is not distinct from d.customer_account_id and pe.customer_branch_id is not distinct from d.customer_branch_id),0)::integer free_units,
      bool_or(fbs.first_sale_date between d1 and d2) is_new_customer
    from delivered d
    left join first_brand_sale fbs on fbs.customer_account_id=d.customer_account_id
    where (p_customer_search is null or trim(p_customer_search)='' or concat_ws(' ',d.customer_name,d.branch_name,d.postcode,d.country) ilike '%' || trim(p_customer_search) || '%')
    group by d.customer_account_id,d.customer_branch_id,d.customer_name,d.branch_name,d.postcode,d.country
  ),
  product_agg as (
    select d.product_id,d.product_code,d.product_name,d.series,
      sum(d.qty)::integer paid_units,count(distinct d.order_id)::integer orders,count(distinct d.customer_account_id)::integer customers,
      sum(d.net_sales)::numeric net_sales
    from delivered d
    where (p_product_search is null or trim(p_product_search)='' or concat_ws(' ',d.product_code,d.product_name,d.series) ilike '%' || trim(p_product_search) || '%')
    group by d.product_id,d.product_code,d.product_name,d.series
  ),
  series_agg as (
    select d.series,
      count(distinct d.product_id)::integer products,
      sum(d.qty)::integer paid_units,
      count(distinct d.order_id)::integer orders,
      count(distinct d.customer_account_id)::integer customers,
      count(distinct d.customer_account_id) filter(where fbs.first_sale_date between d1 and d2)::integer new_customers,
      coalesce((select sum(pe.free_given_qty) from promo_entitlements pe join delivered dx on dx.order_id=pe.order_id where dx.series=d.series),0)::integer free_units
    from delivered d
    left join first_brand_sale fbs on fbs.customer_account_id=d.customer_account_id
    group by d.series
  ),
  rep_agg as (
    select d.sales_rep,
      sum(d.qty)::integer paid_units,
      count(distinct d.order_id)::integer orders,
      count(distinct d.customer_account_id)::integer customers,
      count(distinct d.customer_account_id) filter(where fbs.first_sale_date between d1 and d2)::integer new_customers,
      coalesce((select count(distinct pe.order_id) from promo_entitlements pe where pe.sales_rep=d.sales_rep),0)::integer promotion_orders,
      coalesce((select sum(pe.free_given_qty) from promo_entitlements pe where pe.sales_rep=d.sales_rep),0)::integer free_units
    from delivered d
    left join first_brand_sale fbs on fbs.customer_account_id=d.customer_account_id
    group by d.sales_rep
  ),
  claims as (
    select c.id,c.promotion_rule_id,c.claim_reference,c.claim_date,c.claimed_qty,c.status,c.notes,
      coalesce(sum(r.received_qty),0)::integer received_qty,
      greatest(c.claimed_qty-coalesce(sum(r.received_qty),0),0)::integer outstanding_qty
    from public.brand_promotion_claims c
    left join public.brand_promotion_receipts r on r.claim_id=c.id
    where lower(trim(c.brand))=lower(v_brand)
      and c.claim_date between d1 and d2
    group by c.id,c.promotion_rule_id,c.claim_reference,c.claim_date,c.claimed_qty,c.status,c.notes
  ),
  counts as (
    select
      (select count(*) from customer_agg) customer_count,
      (select count(*) from product_agg) product_count,
      (select count(*) from rep_agg) rep_count,
      (select count(*) from claims) claim_count
  ),
  totals as (
    select
      coalesce(sum(d.qty),0)::integer paid_units,
      count(distinct d.order_id)::integer orders,
      count(distinct d.customer_account_id)::integer customers,
      count(distinct d.customer_account_id) filter(where fbs.first_sale_date between d1 and d2)::integer new_customers,
      coalesce((select sum(free_given_qty) from promo_entitlements),0)::integer free_given,
      coalesce((select sum(claimed_qty) from claims),0)::integer claimed_qty,
      coalesce((select sum(received_qty) from claims),0)::integer received_qty,
      coalesce((select sum(outstanding_qty) from claims),0)::integer claim_outstanding
    from delivered d
    left join first_brand_sale fbs on fbs.customer_account_id=d.customer_account_id
  )
  select jsonb_build_object(
    'brand',v_brand,
    'read_only',true,
    'period',jsonb_build_object('date_from',d1,'date_to',d2,'country',coalesce(p_country,'All'),'location',coalesce(nullif(trim(p_location_search),''),'All')),
    'summary',(select jsonb_build_object(
      'paid_units',paid_units,'free_given',free_given,'total_distributed',paid_units+free_given,
      'orders',orders,'customers',customers,'new_customers',new_customers,
      'claimable_qty',free_given,'claimed_qty',claimed_qty,'received_qty',received_qty,
      'claim_outstanding',greatest(free_given-received_qty,0)
    ) from totals),
    'filters',jsonb_build_object(
      'series',coalesce((select jsonb_agg(x order by x) from (select distinct coalesce(series,'Unassigned') x from lost_products) s),'[]'::jsonb),
      'promotion_types',coalesce((select jsonb_agg(x order by x) from (select distinct coalesce(promotion_type,promotion_name,'Promotion') x from promo_rules) q),'[]'::jsonb),
      'sales_reps',coalesce((select jsonb_agg(x order by x) from (select distinct sales_rep x from delivered) q),'[]'::jsonb),
      'countries',coalesce((select jsonb_agg(x order by x) from (select distinct country x from delivered) q),'[]'::jsonb)
    ),
    'rows',jsonb_build_object(
      'series',coalesce((select jsonb_agg(to_jsonb(x) order by paid_units desc,series) from series_agg x),'[]'::jsonb),
      'customers',coalesce((select jsonb_agg(to_jsonb(x) order by paid_units desc,customer_name,branch_name) from (select * from customer_agg order by paid_units desc,customer_name,branch_name offset (v_customer_page-1)*v_page_size limit v_page_size) x),'[]'::jsonb),
      'products',coalesce((select jsonb_agg(to_jsonb(x) order by paid_units desc,product_name) from (select * from product_agg order by paid_units desc,product_name offset (v_product_page-1)*v_page_size limit v_page_size) x),'[]'::jsonb),
      'sales_reps',coalesce((select jsonb_agg(to_jsonb(x) order by paid_units desc,sales_rep) from (select * from rep_agg order by paid_units desc,sales_rep offset (v_rep_page-1)*v_page_size limit v_page_size) x),'[]'::jsonb),
      'promotion_orders',coalesce((select jsonb_agg(to_jsonb(x) order by sale_date desc,order_number) from promo_entitlements x),'[]'::jsonb),
      'claims',coalesce((select jsonb_agg(to_jsonb(x) order by claim_date desc,claim_reference) from (select * from claims order by claim_date desc,claim_reference offset (v_claim_page-1)*v_page_size limit v_page_size) x),'[]'::jsonb)
    ),
    'pagination',(select jsonb_build_object(
      'page_size',v_page_size,
      'customers',jsonb_build_object('page',v_customer_page,'total_rows',customer_count,'total_pages',greatest(ceil(customer_count::numeric/v_page_size)::integer,1)),
      'products',jsonb_build_object('page',v_product_page,'total_rows',product_count,'total_pages',greatest(ceil(product_count::numeric/v_page_size)::integer,1)),
      'sales_reps',jsonb_build_object('page',v_rep_page,'total_rows',rep_count,'total_pages',greatest(ceil(rep_count::numeric/v_page_size)::integer,1)),
      'claims',jsonb_build_object('page',v_claim_page,'total_rows',claim_count,'total_pages',greatest(ceil(claim_count::numeric/v_page_size)::integer,1))
    ) from counts)
  ) into r;

  return r;
end;
$function$;

revoke all on function public.fc_brand_partner_dashboard_v3(text,text,date,date,text,text,text,text,text,text,text,integer,integer,integer,integer) from public;
grant execute on function public.fc_brand_partner_dashboard_v3(text,text,date,date,text,text,text,text,text,text,text,integer,integer,integer,integer) to anon, authenticated, service_role;
