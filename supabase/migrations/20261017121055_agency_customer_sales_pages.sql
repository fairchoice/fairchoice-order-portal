-- Customer names and sales only, scoped to the same Performance Group/date/area rules as the summary.
-- Every active staff session may view this read-only report; customers are denied.
begin;
create or replace function public.fc_agency_customer_sales_v1(
 p_username text,p_session_token text,p_date_from date default null,p_date_to date default null,
 p_postcode_prefix text default null,p_city text default null,p_performance_group text default 'Middleton England',p_page integer default 1)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record; result jsonb;
 v_from timestamptz; v_to timestamptz;
begin
 -- The existing all-staff guard validates FC login, staff activity, token expiry,
 -- revocation and auth_version; customers are denied. It grants no finance writes.
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'order.checkout.payment');
 if actor.staff_id is null or lower(actor.staff_role)='customer' then
  raise exception 'Active staff access required.' using errcode='42501';
 end if;
 if p_performance_group is null or p_performance_group not in ('Middleton England','South England','West England','East England','Wales') then raise exception 'Invalid Performance Group.'; end if;
 if p_page is null or p_page<1 then raise exception 'Page must be a positive number.'; end if;
 if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then
  raise exception 'Date From must be before Date To.';
 end if;
 if length(coalesce(p_postcode_prefix,''))>8 or length(coalesce(p_city,''))>120 then raise exception 'Invalid area filter.'; end if;
 v_from:=p_date_from::timestamp at time zone 'Europe/London';
 v_to:=(p_date_to+1)::timestamp at time zone 'Europe/London';
 with places as materialized (
  select a.id account_id,b.id branch_id,a.performance_group,
   coalesce(nullif(trim(b.country),''),nullif(trim(a.country),''),'') country,
   upper(regexp_replace(coalesce(nullif(trim(b.postcode),''),a.postcode,''),'\s','','g')) postcode,
   coalesce(nullif(trim(a.town_city),''),'Unspecified city') city,
   coalesce(b.delivery_address,a.address,'') address
  from public.customer_accounts a left join public.customer_branches b on b.customer_account_id=a.id
  union all
  select a.id,null::uuid,a.performance_group,coalesce(a.country,''),upper(regexp_replace(coalesce(a.postcode,''),'\s','','g')),
   coalesce(nullif(trim(a.town_city),''),'Unspecified city'),coalesce(a.address,'')
  from public.customer_accounts a where exists(select 1 from public.customer_branches b where b.customer_account_id=a.id)
 ), england as materialized (
  select * from places where performance_group=p_performance_group
 ), scoped as materialized (
  select * from england where (nullif(trim(p_postcode_prefix),'') is null or starts_with(postcode,upper(regexp_replace(trim(p_postcode_prefix),'\s','','g'))))
   and (nullif(trim(p_city),'') is null or lower(city)=lower(trim(p_city))
     or (lower(trim(p_city))='bedford' and lower(address)~'\mbedford\M'))
 ), invoices as materialized (
  select i.id,i.customer_account_id,i.customer_branch_id,i.invoice_number,i.invoice_date,i.invoice_total,s.postcode,s.city from public.customer_invoices i join scoped s on s.account_id=i.customer_account_id and s.branch_id is not distinct from i.customer_branch_id
  where upper(i.status)='ISSUED' and upper(coalesce(i.financial_status,'ACTIVE')) not in ('VOID','VOIDED','ARCHIVED','CANCELLED') and i.voided_at is null
  union all
  -- Older delivered orders may predate canonical invoices. Never resurrect an
  -- order whose canonical invoice exists (including void/cancelled invoices).
  select o.id,o.customer_account_id,coalesce(o.customer_branch_id,o.branch_id),o.order_number,
   coalesce(o.delivered_at,o.created_at) at time zone 'UTC',
   coalesce(o.order_total,o.grand_total,0),s.postcode,s.city
  from public.orders o join scoped s on s.account_id=o.customer_account_id and s.branch_id is not distinct from coalesce(o.customer_branch_id,o.branch_id)
  where lower(trim(o.status)) in ('delivered','confirmed','delivery confirmed','completed')
   and upper(coalesce(o.financial_status,'ACTIVE')) not in ('VOID','VOIDED','ARCHIVED','CANCELLED')
   and o.financial_voided_at is null
   and not exists(select 1 from public.customer_invoices i where i.order_id=o.id or
    (i.customer_account_id=o.customer_account_id and upper(trim(i.invoice_number)) in (upper(trim(o.order_number)),upper('INV-'||trim(o.order_number)))))
 ), customer_totals as materialized (
  select s.account_id customer_id,a.account_name customer_name,count(i.id) invoice_count,
   coalesce(sum(i.invoice_total),0) sales
  from (select distinct account_id from scoped) s
  join public.customer_accounts a on a.id=s.account_id
  left join invoices i on i.customer_account_id=s.account_id
   and (v_from is null or i.invoice_date>=v_from) and (v_to is null or i.invoice_date<v_to)
  group by s.account_id,a.account_name
 ), meta as (
  select count(*) total_rows,greatest(1,ceil(count(*)/30.0)::integer) total_pages,
   coalesce(sum(sales),0) total_sales from customer_totals
 ), page_meta as (select *,least(p_page,total_pages) page from meta),
 ranked as (
  select *,row_number() over(order by sales desc,lower(coalesce(customer_name,'')),customer_id) rn from customer_totals
 ), paged as (
  select r.* from ranked r cross join page_meta m where r.rn>(m.page-1)::bigint*30 and r.rn<=m.page::bigint*30
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object(
  'customer_id',customer_id,'customer_name',customer_name,'sales',sales,'invoice_count',invoice_count) order by rn) from paged),'[]'::jsonb),
  'page',page,'page_size',30,'total_rows',total_rows,'total_pages',total_pages,'total_sales',total_sales)
 into result from page_meta;
 return result;
end; $$;
revoke all on function public.fc_agency_customer_sales_v1(text,text,date,date,text,text,text,integer) from public;
grant execute on function public.fc_agency_customer_sales_v1(text,text,date,date,text,text,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;
