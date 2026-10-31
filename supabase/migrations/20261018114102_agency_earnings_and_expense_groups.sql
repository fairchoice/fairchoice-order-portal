-- Read-only agency earnings; expense allocation changes metadata only.
begin;
alter table public.business_payouts add column if not exists performance_group text;
alter table public.business_payouts add constraint business_payouts_performance_group_valid
 check(performance_group is null or performance_group in ('Middleton England','South England','West England','East England','Wales'));
create index if not exists business_payouts_agency_date_idx on public.business_payouts(performance_group,payout_date) where status='POSTED' and voided_at is null;
create index if not exists stock_receipts_agency_cost_idx on public.stock_receipts(product_id,(coalesce(received_date,created_at))) where qty_received>0 and cost_price>=0;

-- Preserve the current agency guard while reducing the fixed customer page size.
do $pages$
declare d text;
begin
 d:=pg_get_functiondef('public.fc_agency_customer_sales_v1(text,text,date,date,text,text,text,integer)'::regprocedure);
 if position('fc_require_agency_access_v1' in d)=0 then raise exception 'Customer sales agency guard differs; review before applying.';end if;
 if position('count(*)/30.0' in d)=0 then raise exception 'Customer sales pagination differs; review before applying.';end if;
 d:=replace(replace(replace(d,'count(*)/30.0','count(*)/10.0'),'::bigint*30','::bigint*10'),$needle$'page_size',30$needle$,$needle$'page_size',10$needle$);
 execute d;
end;$pages$;

-- Internal allocation writer. Public entry points below retain existing expense
-- create/approve checks. No amount, status, payment or ledger movement is changed.
create or replace function public.fc_write_payout_group_v1(p_id uuid,p_group text,p_actor text,p_staff uuid)
returns public.business_payouts language plpgsql security invoker set search_path=pg_catalog,public as $$
declare before_row public.business_payouts%rowtype;after_row public.business_payouts%rowtype;
begin
 if p_group is not null and p_group not in ('Middleton England','South England','West England','East England','Wales') then raise exception 'Select a valid expense agency or Shared / unassigned.';end if;
 select * into strict before_row from public.business_payouts where id=p_id for update;
 if before_row.performance_group is not distinct from p_group then return before_row;end if;
 update public.business_payouts set performance_group=p_group,updated_at=now() where id=p_id returning * into after_row;
 insert into public.financial_audit_log(action,entity_type,entity_id,reason,before_data,after_data,changed_by,actor_staff_id)
 values('UPDATE','BUSINESS_PAYOUT',p_id::text,'Expense agency allocation changed',to_jsonb(before_row),to_jsonb(after_row),p_actor,p_staff);
 return after_row;
end;$$;
revoke all on function public.fc_write_payout_group_v1(uuid,text,text,uuid) from public,anon,authenticated;

create or replace function public.fc_create_business_payout_v2(
 p_username text,p_session_token text,p_payout_date date,p_expense_type_id uuid,p_supplier_id uuid,p_amount numeric,p_payment_method text,
 p_description text default null,p_receipt_reference text default null,p_receipt_url text default null,p_paid_by_type text default 'BUSINESS',p_paid_by_staff_id uuid default null,p_submit boolean default false,p_performance_group text default null)
returns public.business_payouts language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;r public.business_payouts%rowtype;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'expenses.create');
 if actor.staff_id is null or lower(trim(p_username))='admin' then raise exception 'An authorised staff expense login is required.' using errcode='42501';end if;
 r:=public.fc_create_business_payout(p_username,p_session_token,p_payout_date,p_expense_type_id,p_supplier_id,p_amount,p_payment_method,p_description,p_receipt_reference,p_receipt_url,p_paid_by_type,p_paid_by_staff_id,p_submit);
 return public.fc_write_payout_group_v1(r.id,p_performance_group,p_username,actor.staff_id);
end;$$;
revoke all on function public.fc_create_business_payout_v2(text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean,text) from public;
grant execute on function public.fc_create_business_payout_v2(text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean,text) to anon,authenticated;

create or replace function public.fc_update_business_payout_v2(
 p_username text,p_session_token text,p_payout_id uuid,p_payout_date date,p_expense_type_id uuid,p_supplier_id uuid,p_amount numeric,p_payment_method text,
 p_description text default null,p_receipt_reference text default null,p_receipt_url text default null,p_paid_by_type text default 'BUSINESS',p_paid_by_staff_id uuid default null,p_performance_group text default null)
returns public.business_payouts language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;r public.business_payouts%rowtype;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'expenses.create');
 if actor.staff_id is null or lower(trim(p_username))='admin' then raise exception 'An authorised staff expense login is required.' using errcode='42501';end if;
 r:=public.fc_update_business_payout(p_username,p_session_token,p_payout_id,p_payout_date,p_expense_type_id,p_supplier_id,p_amount,p_payment_method,p_description,p_receipt_reference,p_receipt_url,p_paid_by_type,p_paid_by_staff_id);
 return public.fc_write_payout_group_v1(r.id,p_performance_group,p_username,actor.staff_id);
end;$$;
revoke all on function public.fc_update_business_payout_v2(text,text,uuid,date,uuid,uuid,numeric,text,text,text,text,text,uuid,text) from public;
grant execute on function public.fc_update_business_payout_v2(text,text,uuid,date,uuid,uuid,numeric,text,text,text,text,text,uuid,text) to anon,authenticated;

create or replace function public.fc_list_business_payouts_v2(p_username text,p_session_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 return (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('performance_group',p.performance_group) order by r.payout_date desc,r.created_at desc,r.id),'[]'::jsonb)
  from public.fc_list_business_payouts(p_username,p_session_token) r join public.business_payouts p on p.id=r.id);
end;$$;
revoke all on function public.fc_list_business_payouts_v2(text,text) from public;
grant execute on function public.fc_list_business_payouts_v2(text,text) to anon,authenticated;

create or replace function public.fc_assign_business_payout_agency_v1(p_username text,p_session_token text,p_payout_id uuid,p_performance_group text)
returns public.business_payouts language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;r public.business_payouts%rowtype;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'expenses.approve');
 if actor.staff_id is null then raise exception 'An authorised expense approver is required.' using errcode='42501';end if;
 select * into strict r from public.business_payouts where id=p_payout_id for update;
 if r.status<>'POSTED' or r.voided_at is not null then raise exception 'Only posted active expenses can be allocated here. Edit drafts through the expense form.';end if;
 return public.fc_write_payout_group_v1(r.id,p_performance_group,p_username,actor.staff_id);
end;$$;
revoke all on function public.fc_assign_business_payout_agency_v1(text,text,uuid,text) from public;
grant execute on function public.fc_assign_business_payout_agency_v1(text,text,uuid,text) to anon,authenticated;

create or replace function public.fc_agency_earnings_v1(
 p_username text,p_session_token text,p_date_from date default null,p_date_to date default null,
 p_postcode_prefix text default null,p_city text default null,p_performance_group text default 'Middleton England')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;v_from timestamptz;v_to timestamptz;result jsonb;
begin
 select * into strict actor from public.fc_require_agency_access_v1(p_username,p_session_token,p_performance_group);
 if p_performance_group is null then raise exception 'Select a Performance Group.';end if;
 if p_date_from is not null and p_date_to is not null and p_date_from>p_date_to then raise exception 'Date From must be before Date To.';end if;
 if length(coalesce(p_postcode_prefix,''))>8 or length(coalesce(p_city,''))>120 then raise exception 'Invalid area filter.';end if;
 v_from:=p_date_from::timestamp at time zone 'Europe/London';v_to:=(p_date_to+1)::timestamp at time zone 'Europe/London';
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

 ), docs as materialized (
 select i.id,i.order_id,i.invoice_number,i.customer_account_id,i.customer_branch_id,i.invoice_date,i.invoice_total
 from public.customer_invoices i join scoped s on s.account_id=i.customer_account_id and s.branch_id is not distinct from i.customer_branch_id
 where i.status='ISSUED' and upper(coalesce(i.financial_status,'ACTIVE')) not in ('VOID','VOIDED','ARCHIVED','CANCELLED') and i.voided_at is null
  and (v_from is null or i.invoice_date>=v_from) and (v_to is null or i.invoice_date<v_to)
 union all
 select o.id,o.id,o.order_number,o.customer_account_id,coalesce(o.customer_branch_id,o.branch_id),coalesce(o.delivered_at,o.created_at) at time zone 'UTC',coalesce(o.order_total,o.grand_total,0)
 from public.orders o join scoped s on s.account_id=o.customer_account_id and s.branch_id is not distinct from coalesce(o.customer_branch_id,o.branch_id)
 where lower(trim(o.status)) in ('delivered','confirmed','delivery confirmed','completed') and upper(coalesce(o.financial_status,'ACTIVE')) not in ('VOID','VOIDED','ARCHIVED','CANCELLED') and o.financial_voided_at is null
  and (v_from is null or (coalesce(o.delivered_at,o.created_at) at time zone 'UTC')>=v_from) and (v_to is null or (coalesce(o.delivered_at,o.created_at) at time zone 'UTC')<v_to)
  and not exists(select 1 from public.customer_invoices i where i.order_id=o.id or (i.customer_account_id=o.customer_account_id and upper(trim(i.invoice_number)) in (upper(trim(o.order_number)),upper('INV-'||trim(o.order_number)))))
 ), linked as materialized (
 select d.*,o.id linked_order_id,o.price_mode from docs d left join lateral (
  select min(x.id::text)::uuid id,min(x.price_mode) price_mode from public.orders x
  where x.customer_account_id=d.customer_account_id and (x.id=d.order_id or (d.order_id is null and upper(trim(d.invoice_number)) in (upper(trim(x.order_number)),upper('INV-'||trim(x.order_number))))) having count(*)=1
 ) o on true
 ), raw_lines as materialized (
 select d.id doc_id,d.invoice_total,d.invoice_date,d.price_mode,i.*,p.cost_price fallback_cost,
  coalesce(i.vat_rate,case when replace(coalesce(i.vat_type,p.vat_type,''),'%','')~'^[0-9]+([.][0-9]+)?$' then replace(coalesce(i.vat_type,p.vat_type),'%','')::numeric end,0) raw_rate,
  h.unit_cost receipt_cost
 from linked d join public.order_items i on i.order_id=d.linked_order_id left join public.products p on p.id=i.product_id
 left join lateral (select sum(r.cost_price*r.qty_received)/nullif(sum(r.qty_received),0) unit_cost from public.stock_receipts r
  where r.product_id=i.product_id and coalesce(r.received_date,r.created_at)<=d.invoice_date and r.qty_received>0 and r.cost_price>=0) h on true
 where coalesce(i.qty,i.picked_qty,0)>0 and lower(trim(coalesce(i.source_status,''))) not in ('removed','cancelled','deleted','cannot supply','need supplier','pre-order','pre order','pre-order supply','pre order supply','supply needed','next supplier')
  and (lower(trim(coalesce(i.source_status,''))) in ('in stock','available','supplied') or coalesce(i.include_in_picking,true))
 ), rated as (
 select *,case when raw_rate=0.2 then 20 when raw_rate=0.05 then 5 else greatest(0,least(100,raw_rate)) end rate,
  lower(trim(coalesce(price_mode,''))) in ('server','royalty','inc vat','inc.vat','incvat','owner offer','manager','manager offer')
   or (lower(price_mode) like 'code:%' and lower(split_part(price_mode,'|',2)) in ('','inc vat','inc.vat','incvat','server')) inc_mode
 from raw_lines
 ), valued as (
 select *,case when lower(trim(source_status)) in ('free','promotion free') then 0
  when inc_mode then coalesce(price,unit_price,0)*qty
  else coalesce(net_total,line_total,coalesce(price,unit_price,0)*qty,0)*(1+rate/100) end gross_weight,
  coalesce(receipt_cost,nullif(greatest(fallback_cost,0),0)) unit_cost from rated
 ), doc_totals as (
 select doc_id,sum(gross_weight) gross_weight,sum(gross_weight/(1+rate/100)) net_weight,
  sum(qty*coalesce(unit_cost,0)) cogs,count(*) filter(where unit_cost is null) missing_cost_lines,
  count(*) filter(where receipt_cost is null and unit_cost is not null) fallback_cost_lines
 from valued group by doc_id
 ), sales as (
 select coalesce(sum(case when t.gross_weight>0 then round(d.invoice_total*t.net_weight/t.gross_weight,2) else 0 end),0) revenue_ex_vat,
  coalesce(sum(t.cogs),0) cogs,coalesce(sum(t.missing_cost_lines),0) missing_cost_lines,coalesce(sum(t.fallback_cost_lines),0) fallback_cost_lines,
  count(*) filter(where t.doc_id is null or (d.invoice_total<>0 and coalesce(t.gross_weight,0)=0)) unmapped_invoices
 from docs d left join doc_totals t on t.doc_id=d.id
 ), credits as materialized (
 select r.id,r.return_total,r.net_total,r.vat_total from public.customer_returns r join scoped s on s.account_id=r.customer_account_id and s.branch_id is not distinct from coalesce(r.customer_branch_id,r.branch_id)
 where lower(trim(r.status)) in ('confirmed','credited') and r.financial_disposition='CUSTOMER_CREDIT' and r.reversed_at is null
  and (v_from is null or coalesce(r.confirmed_at,r.created_at)>=v_from) and (v_to is null or coalesce(r.confirmed_at,r.created_at)<v_to)
 ), return_values as (
 -- Use the credited header's saved net/VAT ratio. Without tax details the
 -- earnings figure remains unavailable rather than treating VAT as profit.
 select coalesce(sum(case when coalesce(net_total,0)+coalesce(vat_total,0)>0 then round(return_total*net_total/(net_total+coalesce(vat_total,0)),2) else 0 end),0) net_credit,
 count(*) filter(where return_total<>0 and coalesce(net_total,0)+coalesce(vat_total,0)<=0) unknown_returns from credits
 ), expense_totals as (
 select coalesce(sum(amount) filter(where performance_group=p_performance_group),0) agency_expenses,
  coalesce(sum(amount) filter(where performance_group is null),0) unassigned_expenses
 from public.business_payouts where status='POSTED' and voided_at is null and (p_date_from is null or payout_date>=p_date_from) and (p_date_to is null or payout_date<=p_date_to)
 )
 select jsonb_build_object('sales_ex_vat',round(s.revenue_ex_vat,2),'return_credits_ex_vat',round(r.net_credit,2),
 'net_sales_ex_vat',round(s.revenue_ex_vat-r.net_credit,2),'known_cost_of_goods',round(s.cogs,2),
 'missing_cost_lines',s.missing_cost_lines,'fallback_cost_lines',s.fallback_cost_lines,'unmapped_invoices',s.unmapped_invoices,'unknown_returns',r.unknown_returns,
 'gross_profit',case when s.missing_cost_lines+s.unmapped_invoices+r.unknown_returns=0 then round(s.revenue_ex_vat-r.net_credit-s.cogs,2) end,
 'agency_expenses',round(e.agency_expenses,2),'unassigned_expenses',case when actor.can_view_shared_totals then round(e.unassigned_expenses,2) end,
 'net_earnings',case when s.missing_cost_lines+s.unmapped_invoices+r.unknown_returns=0 and nullif(trim(p_city),'') is null and nullif(trim(p_postcode_prefix),'') is null then round(s.revenue_ex_vat-r.net_credit-s.cogs-e.agency_expenses,2) end,
 'expenses_cover_whole_group',true,'area_filtered',nullif(trim(p_city),'') is not null or nullif(trim(p_postcode_prefix),'') is not null,
 'cost_method','Weighted stock-receipt costs up to each invoice date; current product cost fallback. Return credits reduce sales; returned-stock cost recovery is not included. Unassigned expenses are excluded from agency earnings.')
 into result from sales s cross join return_values r cross join expense_totals e;
 return result;
end;$$;
revoke all on function public.fc_agency_earnings_v1(text,text,date,date,text,text,text) from public;
grant execute on function public.fc_agency_earnings_v1(text,text,date,date,text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
