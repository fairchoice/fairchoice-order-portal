-- Collection must use canonical invoice IDs even when direct table reads are
-- hidden by RLS. Keep table access closed and validate the FC staff session.
create or replace function public.fc_invoice_collection_snapshot_v1(
  p_customer_account_id uuid, p_customer_branch_id uuid,
  p_username text, p_session_token text
)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare v_actor record; v_result jsonb;
begin
  select * into strict v_actor from public.fc_require_session_permission_v2(
    p_username,p_session_token,'payments.collect_cash');
  if lower(coalesce(v_actor.staff_role,''))='customer' then
    raise exception 'Staff cash collection access is required.' using errcode='42501';
  end if;
  if not exists(select 1 from public.customer_accounts where id=p_customer_account_id) then
    raise exception 'Customer account does not exist.';
  end if;
  if p_customer_branch_id is not null and not exists(
    select 1 from public.customer_branches where id=p_customer_branch_id
      and customer_account_id=p_customer_account_id) then
    raise exception 'Branch does not belong to the selected customer.';
  end if;
  with scoped as (
    select i.*,public.fc_collection_allocated_amount_v1(i.id) as allocated_amount
    from public.customer_invoices i
    where i.customer_account_id=p_customer_account_id
      and i.customer_branch_id is not distinct from p_customer_branch_id
      and i.status='ISSUED' and upper(coalesce(i.financial_status,'ACTIVE'))<>'VOID'
  )
  select jsonb_build_object(
    'invoices',coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'customer_account_id',customer_account_id,'customer_branch_id',customer_branch_id,
      'invoice_number',invoice_number,'invoice_date',invoice_date,'invoice_total',invoice_total,
      'status',status,'financial_status',financial_status,'source','customer_invoices',
      'collection_previous_paid_amount',collection_previous_paid_amount,
      'collection_previous_allocated_amount',collection_previous_allocated_amount
    ) order by invoice_date,id),'[]'::jsonb),
    'allocations',coalesce(jsonb_agg(jsonb_build_object(
      'invoice_reference',invoice_number,'allocated_amount',allocated_amount,'status','active'
    ) order by invoice_date,id),'[]'::jsonb)
  ) into v_result from scoped;
  return v_result;
end;
$$;
revoke all on function public.fc_invoice_collection_snapshot_v1(uuid,uuid,text,text) from public;
grant execute on function public.fc_invoice_collection_snapshot_v1(uuid,uuid,text,text) to anon,authenticated;
