-- Collector-scoped Approved Expenses drill-down for Weekly Account handovers.

begin;

do $$
begin
  if to_regclass('public.business_payouts') is null
     or to_regclass('public.staff_cash_expenses') is null
     or to_regclass('public.expense_types') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.staff_users') is null then
    raise exception 'Weekly Account approved-expense detail prerequisites are missing';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null
     or to_regprocedure('public.fc_resolve_weekly_collector_identity_v1(uuid,uuid)') is null then
    raise exception 'Secured FC session and collector identity functions are required';
  end if;
end
$$;

create or replace function public.fc_weekly_account_approved_cash_expense_details_v1(
  p_username text,
  p_session_token text,
  p_collector_staff_id uuid,
  p_period_start date default null,
  p_period_end date default null
)
returns table (
  business_payout_id uuid,
  payout_reference text,
  payout_date date,
  expense_type_name text,
  supplier_id uuid,
  supplier_name text,
  description text,
  receipt_reference text,
  payment_method text,
  paid_by_type text,
  amount numeric,
  approved_at timestamptz,
  approved_by_staff_id uuid,
  approved_by_name text,
  weekly_effect_id uuid,
  weekly_effect_status text,
  is_legacy_compatibility boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_collector record;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'access_accounts'
  );

  if p_collector_staff_id is null then
    raise exception 'A collector staff identity is required.';
  end if;
  if p_period_start is not null
     and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Weekly Account period end must not precede its start.';
  end if;

  select * into v_collector
  from public.fc_resolve_weekly_collector_identity_v1(
    p_collector_staff_id,
    v_actor.login_id
  );
  if not found or v_collector.collector_type is null then
    raise exception 'The selected staff identity is not an active Driver or Sales Rep.';
  end if;

  return query
  with canonical_details as (
    select
      bp.id as detail_business_payout_id,
      bp.payout_reference as detail_payout_reference,
      bp.payout_date as detail_payout_date,
      et.expense_type_name as detail_expense_type_name,
      bp.supplier_id as detail_supplier_id,
      supplier.supplier_name as detail_supplier_name,
      bp.description as detail_description,
      bp.receipt_reference as detail_receipt_reference,
      bp.payment_method as detail_payment_method,
      bp.paid_by_type as detail_paid_by_type,
      bp.amount as detail_amount,
      coalesce(bp.approved_at, sce.approved_at) as detail_approved_at,
      bp.approved_by_staff_id as detail_approved_by_staff_id,
      coalesce(approver.staff_name, sce.approved_by) as detail_approved_by_name,
      sce.id as detail_weekly_effect_id,
      sce.status as detail_weekly_effect_status,
      false as detail_is_legacy
    from public.business_payouts bp
    join public.expense_types et
      on et.id = bp.expense_type_id
    join public.staff_cash_expenses sce
      on sce.business_payout_id = bp.id
     and sce.paid_by_staff_id = bp.paid_by_staff_id
    left join public.suppliers supplier
      on supplier.id = bp.supplier_id
    left join public.staff_users approver
      on approver.id = bp.approved_by_staff_id
    where bp.status = 'POSTED'
      and bp.payment_method = 'Cash'
      and bp.paid_by_staff_id = p_collector_staff_id
      and upper(trim(coalesce(bp.paid_by_type, ''))) in (
        'STAFF',
        'DRIVER',
        'SALES REP',
        'SALES REPRESENTATIVE',
        'MY COLLECTED CASH'
      )
      and sce.status = 'APPROVED'
      and (p_period_start is null or bp.payout_date >= p_period_start)
      and (p_period_end is null or bp.payout_date <= p_period_end)
  ),
  legacy_details as (
    select
      null::uuid,
      sce.reference,
      sce.expense_date,
      sce.category,
      null::uuid,
      null::text,
      coalesce(nullif(trim(sce.reason), ''), nullif(trim(sce.notes), '')),
      null::text,
      'Cash'::text,
      'Legacy Weekly Account entry'::text,
      sce.amount,
      coalesce(sce.approved_at, sce.created_at),
      null::uuid,
      sce.approved_by,
      sce.id,
      sce.status,
      true
    from public.staff_cash_expenses sce
    where sce.business_payout_id is null
      and sce.status = 'APPROVED'
      and sce.collector_type = v_collector.collector_type
      and (
        sce.paid_by_staff_id = p_collector_staff_id
        or (
          sce.paid_by_staff_id is null
          and (
            lower(trim(sce.collector_name)) = lower(trim(coalesce(v_collector.staff_name, '')))
            or exists (
              select 1
              from public.login_users alias_login
              where alias_login.staff_id = p_collector_staff_id
                and lower(trim(alias_login.username)) = lower(trim(sce.collector_name))
            )
          )
        )
      )
      and (p_period_start is null or sce.expense_date >= p_period_start)
      and (p_period_end is null or sce.expense_date <= p_period_end)
  )
  select *
  from (
    select * from canonical_details
    union all
    select * from legacy_details
  ) detail_rows
  order by
    detail_payout_date desc,
    detail_approved_at desc nulls last,
    detail_weekly_effect_id;
end;
$$;

revoke all on function public.fc_weekly_account_approved_cash_expense_details_v1(
  text,text,uuid,date,date
) from public, anon, authenticated;
grant execute on function public.fc_weekly_account_approved_cash_expense_details_v1(
  text,text,uuid,date,date
) to anon, authenticated;

comment on function public.fc_weekly_account_approved_cash_expense_details_v1(
  text,text,uuid,date,date
) is
  'Returns the exact canonical and legacy-compatible expense rows deducted from one collector handover for an optional inclusive payout-date range.';

notify pgrst, 'reload schema';

commit;
