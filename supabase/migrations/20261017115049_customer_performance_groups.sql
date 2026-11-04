-- Performance Groups are agency ownership, separate from postal country/city.
-- Existing records are classified once; subsequent edits preserve manual choices.
begin;
alter table public.customer_accounts add column if not exists performance_group text;
create or replace function public.fc_suggest_performance_group_v1(p_country text,p_place text)
returns text language sql immutable security invoker set search_path=pg_catalog as $$
 select case
 when lower(coalesce(p_place,''))~'\m(southampton|portsmouth|shillington)\M' then 'South England'
 when lower(coalesce(p_place,''))~'\mswindon\M' then 'West England'
 when lower(coalesce(p_place,''))~'\mnewport\M' then 'Wales'
 when lower(coalesce(p_place,''))~'\mkent\M' then 'East England'
 when lower(trim(coalesce(p_country,''))) in ('wales','wls','gb-wls') then 'Wales'
 else 'Middleton England' end;
$$;
revoke all on function public.fc_suggest_performance_group_v1(text,text) from public,anon,authenticated;
update public.customer_accounts set performance_group=public.fc_suggest_performance_group_v1(country,
 concat_ws(' ',town_city,address,address_line_1,address_line_2)) where performance_group is null;
alter table public.customer_accounts alter column performance_group set not null;
alter table public.customer_accounts add constraint customer_accounts_performance_group_valid
 check(performance_group in ('Middleton England','South England','West England','East England','Wales'));
-- Older integrations that omit the new column still create a classified record.
-- Explicit blank or invalid choices are rejected; updates cannot clear a group.
create or replace function public.fc_default_customer_performance_group_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.performance_group is null then new.performance_group:=public.fc_suggest_performance_group_v1(new.country,
  concat_ws(' ',new.town_city,new.address,new.address_line_1,new.address_line_2)); end if;
 return new;
end;$$;
revoke all on function public.fc_default_customer_performance_group_v1() from public,anon,authenticated;
create trigger fc_default_customer_performance_group before insert on public.customer_accounts
 for each row execute function public.fc_default_customer_performance_group_v1();
create index if not exists customer_accounts_performance_group_idx on public.customer_accounts(performance_group);

create or replace function public.fc_agency_performance_v2(
 p_username text,p_session_token text,p_date_from date default null,p_date_to date default null,
 p_postcode_prefix text default null,p_city text default null,p_performance_group text default 'Middleton England')
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
 ), payments as materialized (
  select customer_account_id,customer_branch_id,payment_date,amount,payment_method,transaction_type,postcode,city
  from (
   select p.customer_account_id,coalesce(p.customer_branch_id,p.branch_id) customer_branch_id,p.payment_date,abs(p.amount) amount,p.payment_method,p.transaction_type,s.postcode,s.city,
    row_number() over(partition by p.customer_account_id,coalesce(p.customer_branch_id,p.branch_id),
      coalesce(nullif(upper(trim(p.payment_reference)),''),p.id::text),round(abs(p.amount),2),p.payment_date::date order by p.created_at,p.id) rn
   from public.customer_payments p join scoped s on s.account_id=p.customer_account_id and s.branch_id is not distinct from coalesce(p.customer_branch_id,p.branch_id)
   where upper(coalesce(p.status,'POSTED')) in ('POSTED','ACTIVE') and upper(coalesce(p.verification_status,'CONFIRMED')) in ('','CONFIRMED','NOT_REQUIRED')
    and p.voided_at is null and not exists(select 1 from public.central_payment_archive x where x.payment_id=p.id)
  ) canonical where rn=1
  union all
  select customer_account_id,customer_branch_id,payment_date,amount,payment_method,transaction_type,postcode,city from (
   select l.customer_account_id,coalesce(l.customer_branch_id,l.branch_id) customer_branch_id,coalesce(l.payment_date,l.created_at) payment_date,
    abs(coalesce(nullif(l.credit,0),l.amount,0)) amount,coalesce(l.payment_method,l.payment_type) payment_method,coalesce(l.transaction_type,'PAYMENT') transaction_type,s.postcode,s.city,
    row_number() over(partition by l.customer_account_id,coalesce(l.customer_branch_id,l.branch_id),
     coalesce(nullif(upper(trim(coalesce(l.payment_reference,l.reference_no))),''),l.id::text),
     round(abs(coalesce(nullif(l.credit,0),l.amount,0)),2),coalesce(l.payment_date,l.created_at)::date order by l.created_at,l.id) rn
   from public.customer_ledger l join scoped s on s.account_id=l.customer_account_id and s.branch_id is not distinct from coalesce(l.customer_branch_id,l.branch_id)
   where upper(l.entry_type)='PAYMENT' and upper(coalesce(l.payment_status,'POSTED')) in ('POSTED','ACTIVE','CONFIRMED')
    and l.voided_at is null and l.reversed_at is null
    and not exists(select 1 from public.customer_payments p where p.customer_account_id=l.customer_account_id and (
      p.id=l.central_payment_id or p.idempotency_key='legacy-customer-ledger:'||l.id::text
      or (p.metadata->>'legacy_source'='customer_ledger' and p.metadata->>'legacy_source_id'=l.id::text)
      or (nullif(upper(trim(coalesce(l.payment_reference,l.reference_no))),'')=upper(trim(p.payment_reference))
       and round(abs(p.amount),2)=round(abs(coalesce(nullif(l.credit,0),l.amount,0)),2)
       and p.payment_date::date=coalesce(l.payment_date,l.created_at)::date)))
  ) legacy where rn=1
 ), wallet as (
  select w.customer_account_id,w.customer_branch_id,sum(w.amount) amount from public.customer_wallet_transactions w
   join invoices i on i.id=w.invoice_id and i.customer_account_id=w.customer_account_id
  where upper(w.status)='ACTIVE' and upper(w.direction)='DEBIT' and w.voided_at is null
  group by w.customer_account_id,w.customer_branch_id
 ), balances as (
  select s.account_id,s.branch_id,s.postcode,s.city,
   coalesce((select sum(o.opening_balance) from public.customer_branch_opening_balances o where o.customer_account_id=s.account_id and o.customer_branch_id is not distinct from s.branch_id),0)
   +coalesce((select sum(i.invoice_total) from invoices i where i.customer_account_id=s.account_id and i.customer_branch_id is not distinct from s.branch_id),0)
   -coalesce((select sum(abs(p.amount)) from payments p where p.customer_account_id=s.account_id and p.customer_branch_id is not distinct from s.branch_id),0)
   -coalesce((select sum(w.amount) from wallet w where w.customer_account_id=s.account_id and w.customer_branch_id is not distinct from s.branch_id),0) balance
  from scoped s
 ), movements as (
  select postcode,city,invoice_total sales,0::numeric collected from invoices where (v_from is null or invoice_date>=v_from) and (v_to is null or invoice_date<v_to)
  union all
  select postcode,city,0,abs(amount) from payments where (v_from is null or payment_date>=v_from) and (v_to is null or payment_date<v_to)
   and upper(coalesce(transaction_type,'PAYMENT')) not in ('DISCOUNT','RETURN_CREDIT','CREDIT','CREDIT_NOTE')
   and upper(coalesce(payment_method,'')) not in ('DISCOUNT','RETURN CREDIT','WALLET','WALLET CREDIT')
 ), area_rows as (
  select case when postcode~'^MK[0-9]' then 'MK' when postcode~'^LU[0-9]' then 'LU' else 'Other '||case when p_performance_group='Wales' then 'Wales' else 'England' end end area,
   sum(sales) sales,sum(collected) collections from movements group by 1
 ), stock as (
  select l.location_name,sum(s.qty) units,count(distinct s.product_id) products,
   count(*) filter(where s.qty<=s.low_stock_alert) low_stock
  from public.product_location_stock s join public.stock_locations l on l.id=s.location_id
  where l.active is true and case when p_performance_group='Wales' then lower(trim(l.country)) in ('wales','wls','gb-wls') else lower(trim(l.country)) in ('england','eng','gb-eng') end group by l.id,l.location_name
 )
 select jsonb_build_object(
  'performance_group',p_performance_group,'country',case when p_performance_group='Wales' then 'Wales' else 'England' end,'as_of',now(),'sales',coalesce((select sum(sales) from movements),0),
  'collections',coalesce((select sum(collected) from movements),0),
  'outstanding',coalesce((select sum(greatest(0,balance)) from (select account_id,sum(balance) balance from balances group by account_id) b),0),
  'customers', (select count(distinct account_id) from scoped),
  'stock_units',coalesce((select sum(units) from stock),0),
  'stock_locations',coalesce((select jsonb_agg(to_jsonb(stock) order by location_name) from stock),'[]'::jsonb),
  'shared_expenses',coalesce((select sum(amount) from public.business_payouts where upper(status)='POSTED' and voided_at is null and (p_date_from is null or payout_date>=p_date_from) and (p_date_to is null or payout_date<=p_date_to)),0),
  'areas',coalesce((select jsonb_agg(to_jsonb(area_rows) order by area) from area_rows),'[]'::jsonb),
  'cities',coalesce((select jsonb_agg(city order by city) from (select distinct city from england where city<>'Unspecified city') c),'[]'::jsonb),
  'unlocated_accounts',(select count(*) from public.customer_accounts a where not exists(select 1 from england e where e.account_id=a.id))
 ) into result;
 return result;
end; $$;
revoke all on function public.fc_agency_performance_v2(text,text,date,date,text,text,text) from public;
grant execute on function public.fc_agency_performance_v2(text,text,date,date,text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
