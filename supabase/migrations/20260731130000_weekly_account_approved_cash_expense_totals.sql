-- Aggregate approved collector-paid cash expenses for Weekly Account handovers.

begin;

do $$
begin
  if to_regclass('public.business_payouts') is null
     or to_regclass('public.staff_cash_expenses') is null
     or to_regclass('public.staff_users') is null then
    raise exception 'Weekly Account approved-expense prerequisites are missing';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null
     or to_regprocedure('public.fc_sync_business_payout_accounting_v1(uuid,uuid,uuid,text)') is null then
    raise exception 'The secured FC session and automatic expense accounting functions are required';
  end if;
end
$$;

create index if not exists business_payouts_weekly_cash_expense_idx
  on public.business_payouts (paid_by_staff_id, approved_at, id)
  where status = 'POSTED'
    and payment_method = 'Cash'
    and paid_by_staff_id is not null;

create or replace function public.fc_weekly_account_approved_cash_expense_totals_v1(
  p_username text,
  p_session_token text,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null
)
returns table (
  collector_staff_id uuid,
  collector_type text,
  collector_name text,
  approved_expense_total numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fc_require_session_permission(
    p_username,
    p_session_token,
    'access_accounts'
  );

  if p_period_start is not null
     and p_period_end is not null
     and p_period_end < p_period_start then
    raise exception 'Weekly Account period end must not precede its start.';
  end if;

  return query
  with eligible_expenses as (
    -- Canonical automatic effects: the payout supplies the business rules and
    -- the linked cash row supplies the immutable collector snapshots.
    select
      bp.paid_by_staff_id as effect_staff_id,
      sce.collector_type as effect_collector_type,
      sce.collector_name as effect_collector_name,
      bp.amount as effect_amount,
      coalesce(bp.approved_at, bp.updated_at, bp.created_at) as effect_at
    from public.business_payouts bp
    join public.staff_cash_expenses sce
      on sce.business_payout_id = bp.id
    where bp.status = 'POSTED'
      and bp.payment_method = 'Cash'
      and bp.paid_by_staff_id is not null
      and upper(trim(coalesce(bp.paid_by_type, ''))) in (
        'STAFF',
        'DRIVER',
        'SALES REP',
        'SALES REPRESENTATIVE',
        'MY COLLECTED CASH'
      )
      and sce.status = 'APPROVED'
      and sce.paid_by_staff_id = bp.paid_by_staff_id

    union all

    -- Compatibility only: historical Weekly Account rows pre-date stable
    -- payout links. Do not invent a staff UUID when only a name snapshot exists.
    select
      sce.paid_by_staff_id,
      sce.collector_type,
      sce.collector_name,
      sce.amount,
      coalesce(sce.approved_at, sce.updated_at, sce.created_at)
    from public.staff_cash_expenses sce
    where sce.business_payout_id is null
      and sce.status = 'APPROVED'
  )
  select
    ee.effect_staff_id,
    ee.effect_collector_type,
    ee.effect_collector_name,
    sum(ee.effect_amount)::numeric as approved_expense_total
  from eligible_expenses ee
  where (p_period_start is null or ee.effect_at > p_period_start)
    and (p_period_end is null or ee.effect_at <= p_period_end)
  group by
    ee.effect_staff_id,
    ee.effect_collector_type,
    ee.effect_collector_name
  order by
    ee.effect_collector_type,
    lower(ee.effect_collector_name),
    ee.effect_staff_id;
end;
$$;

revoke all on function public.fc_weekly_account_approved_cash_expense_totals_v1(
  text,text,timestamptz,timestamptz
) from public, anon, authenticated;
grant execute on function public.fc_weekly_account_approved_cash_expense_totals_v1(
  text,text,timestamptz,timestamptz
) to anon, authenticated;

comment on function public.fc_weekly_account_approved_cash_expense_totals_v1(
  text,text,timestamptz,timestamptz
) is
  'Returns grouped posted cash expenses paid from collector cash; linked voided payouts/effects are excluded and historical unlinked approved rows remain name-compatible.';

notify pgrst, 'reload schema';

commit;
