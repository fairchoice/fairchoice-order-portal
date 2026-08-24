-- Deterministic collector-role resolution and controlled posted-payout repair.

begin;

do $$
begin
  if to_regclass('public.business_payouts') is null
     or to_regclass('public.supplier_credit_transactions') is null
     or to_regclass('public.staff_cash_expenses') is null
     or to_regclass('public.staff_users') is null
     or to_regclass('public.login_users') is null then
    raise exception 'Payout reconciliation prerequisites are missing';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null then
    raise exception 'The secured FC session permission function is required';
  end if;
end
$$;

create or replace function public.fc_resolve_weekly_collector_identity_v1(
  p_staff_id uuid,
  p_preferred_login_id uuid default null
)
returns table (
  id uuid,
  staff_name text,
  staff_role text,
  login_id uuid,
  username text,
  collector_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    su.id,
    su.staff_name,
    coalesce(nullif(trim(chosen.role), ''), nullif(trim(su.role), ''), 'Staff'),
    chosen.id,
    chosen.username,
    case
      when chosen.normalized_role = 'driver' then 'Driver'
      when chosen.normalized_role in ('salesrep', 'salesrepresentative') then 'Sales Rep'
      else null
    end
  from public.staff_users su
  left join lateral (
    select
      lu.id,
      lu.username,
      lu.role,
      regexp_replace(
        lower(trim(coalesce(lu.role, ''))),
        '[^a-z]+',
        '',
        'g'
      ) as normalized_role
    from public.login_users lu
    where lu.staff_id = su.id
      and lu.active is true
    order by
      case
        when regexp_replace(lower(trim(coalesce(lu.role, ''))), '[^a-z]+', '', 'g')
          in ('driver', 'salesrep', 'salesrepresentative') then 0
        else 1
      end,
      case regexp_replace(lower(trim(coalesce(lu.role, ''))), '[^a-z]+', '', 'g')
        when 'driver' then 0
        when 'salesrep' then 1
        when 'salesrepresentative' then 1
        else 2
      end,
      case when lu.id = p_preferred_login_id then 0 else 1 end,
      lower(lu.username),
      lu.id
    limit 1
  ) chosen on true
  where su.id = p_staff_id
    and su.active is true;
$$;

revoke all on function public.fc_resolve_weekly_collector_identity_v1(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.fc_sync_business_payout_accounting_v1(
  p_payout_id uuid,
  p_actor_login_id uuid,
  p_actor_staff_id uuid,
  p_actor_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout public.business_payouts%rowtype;
  v_expense_type public.expense_types%rowtype;
  v_payer record;
  v_supplier_effect public.supplier_credit_transactions%rowtype;
  v_cash_effect public.staff_cash_expenses%rowtype;
  v_payer_staff_id uuid;
  v_is_staff_cash boolean := false;
  v_collector_type text;
begin
  select * into v_payout
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;

  select * into v_expense_type
  from public.expense_types
  where id = v_payout.expense_type_id;
  if not found then
    raise exception 'Expense type no longer exists.';
  end if;

  v_payer_staff_id := coalesce(
    v_payout.paid_by_staff_id,
    v_payout.recorded_by_staff_id
  );

  select * into v_payer
  from public.fc_resolve_weekly_collector_identity_v1(
    v_payer_staff_id,
    p_actor_login_id
  );
  if not found then
    raise exception 'The expense payer is missing or inactive.';
  end if;

  if v_expense_type.expense_type_code = 'SUPPLIER_PAYMENT' then
    if v_payout.supplier_id is null then
      raise exception 'A supplier is required for a Supplier Payment.';
    end if;

    insert into public.supplier_credit_transactions (
      supplier_id,
      transaction_date,
      transaction_type,
      amount,
      reference,
      description,
      notes,
      status,
      created_by,
      created_by_username,
      created_by_login_id,
      created_by_staff_id,
      business_payout_id,
      created_at,
      updated_at
    )
    values (
      v_payout.supplier_id,
      v_payout.payout_date,
      'payment',
      v_payout.amount,
      v_payout.payout_reference,
      'Supplier Payment',
      v_payout.description,
      'posted',
      coalesce(v_payer.staff_name, v_payer.username, p_actor_username),
      coalesce(v_payer.username, p_actor_username),
      coalesce(v_payer.login_id, p_actor_login_id),
      v_payer.id,
      v_payout.id,
      now(),
      now()
    )
    on conflict (business_payout_id)
      where business_payout_id is not null
    do nothing;

    select * into v_supplier_effect
    from public.supplier_credit_transactions
    where business_payout_id = v_payout.id
    for update;

    if not found
       or v_supplier_effect.supplier_id <> v_payout.supplier_id
       or v_supplier_effect.transaction_date <> v_payout.payout_date
       or v_supplier_effect.transaction_type <> 'payment'
       or v_supplier_effect.amount <> v_payout.amount
       or v_supplier_effect.reference <> v_payout.payout_reference
       or v_supplier_effect.status <> 'posted' then
      raise exception 'The linked Supplier Account effect does not match this expense.';
    end if;
  elsif exists (
    select 1
    from public.supplier_credit_transactions
    where business_payout_id = v_payout.id
  ) then
    raise exception 'A non-supplier expense cannot have a Supplier Account effect.';
  end if;

  v_is_staff_cash :=
    lower(trim(coalesce(v_payout.payment_method, ''))) = 'cash'
    and (
      (
        v_payout.paid_by_staff_id is not null
        and upper(trim(coalesce(v_payout.paid_by_type, ''))) <> 'BUSINESS'
      )
      or upper(trim(coalesce(v_payout.paid_by_type, ''))) in (
        'STAFF',
        'DRIVER',
        'SALES REP'
      )
      or lower(trim(coalesce(v_payout.paid_by_type, ''))) in (
        lower(trim(coalesce(v_payer.staff_name, ''))),
        lower(trim(coalesce(v_payer.username, '')))
      )
    );

  v_collector_type := v_payer.collector_type;

  if v_is_staff_cash and v_collector_type is not null then
    insert into public.staff_cash_expenses (
      collector_type,
      collector_name,
      expense_date,
      amount,
      category,
      reason,
      reference,
      notes,
      status,
      created_by,
      approved_by,
      approved_at,
      business_payout_id,
      paid_by_staff_id,
      created_at,
      updated_at
    )
    values (
      v_collector_type,
      coalesce(v_payer.staff_name, v_payer.username),
      v_payout.payout_date,
      v_payout.amount,
      v_expense_type.expense_type_name,
      coalesce(v_payout.description, v_expense_type.expense_type_name),
      v_payout.payout_reference,
      case
        when v_expense_type.expense_type_code = 'SUPPLIER_PAYMENT'
          then 'Automatic Supplier Payment cash effect'
        else 'Automatic approved business expense cash effect'
      end,
      'APPROVED',
      coalesce(v_payer.username, v_payer.staff_name, p_actor_username),
      p_actor_username,
      now(),
      v_payout.id,
      v_payer.id,
      now(),
      now()
    )
    on conflict (business_payout_id)
      where business_payout_id is not null
    do nothing;

    select * into v_cash_effect
    from public.staff_cash_expenses
    where business_payout_id = v_payout.id
    for update;

    if not found
       or v_cash_effect.paid_by_staff_id <> v_payer.id
       or v_cash_effect.collector_type <> v_collector_type
       or v_cash_effect.collector_name <> coalesce(v_payer.staff_name, v_payer.username)
       or v_cash_effect.expense_date <> v_payout.payout_date
       or v_cash_effect.amount <> v_payout.amount
       or v_cash_effect.reference <> v_payout.payout_reference
       or v_cash_effect.status <> 'APPROVED' then
      raise exception 'The linked Weekly Account effect does not match this expense.';
    end if;
  elsif exists (
    select 1
    from public.staff_cash_expenses
    where business_payout_id = v_payout.id
  ) then
    raise exception 'This expense must not have a Weekly Account cash effect.';
  end if;
end;
$$;

revoke all on function public.fc_sync_business_payout_accounting_v1(
  uuid,uuid,uuid,text
) from public, anon, authenticated;

create or replace function public.fc_reconcile_posted_business_payout_accounting_v1(
  p_username text,
  p_session_token text,
  p_payout_id uuid,
  p_apply boolean default false
)
returns table (
  payout_id uuid,
  payout_reference text,
  supplier_effect_missing boolean,
  weekly_effect_missing boolean,
  resolved_collector_staff_id uuid,
  resolved_collector_name text,
  resolved_collector_type text,
  supplier_unlinked_match_count integer,
  weekly_unlinked_match_count integer,
  historical_match_ids jsonb,
  reconciliation_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_payout public.business_payouts%rowtype;
  v_expense_type public.expense_types%rowtype;
  v_payer record;
  v_supplier_expected boolean := false;
  v_weekly_expected boolean := false;
  v_supplier_missing boolean := false;
  v_weekly_missing boolean := false;
  v_supplier_matches integer := 0;
  v_weekly_matches integer := 0;
  v_supplier_match_ids jsonb := '[]'::jsonb;
  v_weekly_match_ids jsonb := '[]'::jsonb;
  v_status text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'expenses.approve'
  );

  if p_apply then
    select * into v_payout
    from public.business_payouts
    where id = p_payout_id
    for update;
  else
    select * into v_payout
    from public.business_payouts
    where id = p_payout_id;
  end if;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_payout.status <> 'POSTED' then
    raise exception 'Only POSTED expenses can be reconciled.';
  end if;

  select * into v_expense_type
  from public.expense_types
  where id = v_payout.expense_type_id;
  if not found then
    raise exception 'Expense type no longer exists.';
  end if;

  select * into v_payer
  from public.fc_resolve_weekly_collector_identity_v1(
    coalesce(v_payout.paid_by_staff_id, v_payout.recorded_by_staff_id),
    v_actor.login_id
  );
  if not found then
    raise exception 'The expense payer is missing or inactive.';
  end if;

  v_supplier_expected := v_expense_type.expense_type_code = 'SUPPLIER_PAYMENT';
  if v_supplier_expected and v_payout.supplier_id is null then
    raise exception 'A supplier is required for a Supplier Payment.';
  end if;
  v_weekly_expected :=
    v_payout.payment_method = 'Cash'
    and v_payout.paid_by_staff_id is not null
    and upper(trim(coalesce(v_payout.paid_by_type, ''))) <> 'BUSINESS'
    and v_payer.collector_type is not null;

  v_supplier_missing :=
    v_supplier_expected
    and not exists (
      select 1
      from public.supplier_credit_transactions sct
      where sct.business_payout_id = v_payout.id
    );
  v_weekly_missing :=
    v_weekly_expected
    and not exists (
      select 1
      from public.staff_cash_expenses sce
      where sce.business_payout_id = v_payout.id
    );

  if v_supplier_missing then
    select
      count(*)::integer,
      coalesce(jsonb_agg(sct.id order by sct.created_at, sct.id), '[]'::jsonb)
    into v_supplier_matches, v_supplier_match_ids
    from public.supplier_credit_transactions sct
    where sct.business_payout_id is null
      and sct.supplier_id = v_payout.supplier_id
      and sct.transaction_date = v_payout.payout_date
      and sct.amount = v_payout.amount
      and lower(trim(sct.transaction_type)) = 'payment'
      and lower(trim(sct.status)) = 'posted';
  end if;

  if v_weekly_missing then
    select
      count(*)::integer,
      coalesce(jsonb_agg(sce.id order by sce.created_at, sce.id), '[]'::jsonb)
    into v_weekly_matches, v_weekly_match_ids
    from public.staff_cash_expenses sce
    where sce.business_payout_id is null
      and sce.expense_date = v_payout.payout_date
      and sce.amount = v_payout.amount
      and sce.status = 'APPROVED'
      and sce.collector_type = v_payer.collector_type
      and (
        sce.paid_by_staff_id = v_payer.id
        or (
          sce.paid_by_staff_id is null
          and (
            lower(trim(sce.collector_name)) = lower(trim(coalesce(v_payer.staff_name, '')))
            or exists (
              select 1
              from public.login_users alias_login
              where alias_login.staff_id = v_payer.id
                and lower(trim(alias_login.username)) = lower(trim(sce.collector_name))
            )
          )
        )
      );
  end if;

  if v_supplier_matches > 0 or v_weekly_matches > 0 then
    v_status := 'REVIEW_REQUIRED_UNLINKED_MATCH';
  elsif not v_supplier_missing and not v_weekly_missing then
    v_status := 'ALREADY_RECONCILED';
  elsif not p_apply then
    v_status := 'READY_TO_APPLY';
  else
    perform public.fc_sync_business_payout_accounting_v1(
      v_payout.id,
      v_actor.login_id,
      v_actor.staff_id,
      v_actor.username
    );

    if v_supplier_expected and not exists (
      select 1 from public.supplier_credit_transactions
      where business_payout_id = v_payout.id
    ) then
      raise exception 'Supplier Account reconciliation did not create its linked effect.';
    end if;
    if v_weekly_expected and not exists (
      select 1 from public.staff_cash_expenses
      where business_payout_id = v_payout.id
    ) then
      raise exception 'Weekly Account reconciliation did not create its linked effect.';
    end if;
    v_status := 'RECONCILED';
    v_supplier_missing := false;
    v_weekly_missing := false;
  end if;

  return query select
    v_payout.id,
    v_payout.payout_reference,
    v_supplier_missing,
    v_weekly_missing,
    v_payer.id,
    coalesce(v_payer.staff_name, v_payer.username),
    v_payer.collector_type,
    v_supplier_matches,
    v_weekly_matches,
    jsonb_build_object(
      'supplier_credit_transaction_ids', v_supplier_match_ids,
      'staff_cash_expense_ids', v_weekly_match_ids
    ),
    v_status;
end;
$$;

revoke all on function public.fc_reconcile_posted_business_payout_accounting_v1(
  text,text,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.fc_reconcile_posted_business_payout_accounting_v1(
  text,text,uuid,boolean
) to anon, authenticated;

comment on function public.fc_reconcile_posted_business_payout_accounting_v1(
  text,text,uuid,boolean
) is
  'Dry-run-first repair for one POSTED payout. Apply is refused when equivalent unlinked historical effects require manual review.';

notify pgrst, 'reload schema';

commit;
