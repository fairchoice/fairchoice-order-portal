-- Narrow, idempotent repair for the Customer Credit opening-balance RPC.
-- This intentionally does not recreate balances or rewrite financial history.

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values (
  'customer_credit.opening_balance_edit',
  'Edit Opening Balance',
  'Customer Credit',
  'Amend a customer or branch opening balance with an audit reason.'
)
on conflict (permission_key) do update
set permission_name = excluded.permission_name,
    category = excluded.category,
    description = excluded.description,
    active = true,
    updated_at = now();

create table if not exists public.customer_opening_balance_audit (
  id uuid primary key default gen_random_uuid(),
  opening_balance_id uuid null
    references public.customer_branch_opening_balances(id) on delete set null,
  customer_account_id uuid not null
    references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null
    references public.customer_branches(id) on delete restrict,
  previous_amount numeric(14,2) not null,
  new_amount numeric(14,2) not null,
  reason text not null,
  changed_by_staff_id uuid null
    references public.staff_users(id) on delete set null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

alter table public.customer_opening_balance_audit enable row level security;
revoke all on table public.customer_opening_balance_audit from anon, authenticated;

do $$
begin
  if exists (
    select 1
    from public.customer_branch_opening_balances
    where customer_branch_id is null
    group by customer_account_id
    having count(*) > 1
  ) then
    raise exception
      'Duplicate account-level opening balances must be reconciled before installing the opening-balance RPC.';
  end if;
end;
$$;

create unique index if not exists
  customer_branch_opening_balances_main_scope_unique
on public.customer_branch_opening_balances (customer_account_id)
where customer_branch_id is null;

create or replace function public.set_customer_opening_balance_v1(
  p_username text,
  p_session_token text,
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.customer_branch_opening_balances%rowtype;
  v_after public.customer_branch_opening_balances%rowtype;
  v_actor_name text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.opening_balance_edit'
  );

  if p_customer_account_id is null then
    raise exception 'Customer account ID is required.';
  end if;
  if p_amount is null then
    raise exception 'Opening balance is required.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Amendment reason is required.';
  end if;
  if p_customer_branch_id is not null and not exists (
    select 1
    from public.customer_branches branch
    where branch.id = p_customer_branch_id
      and branch.customer_account_id = p_customer_account_id
  ) then
    raise exception 'Branch does not belong to the selected customer account.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_customer_account_id::text || ':' || coalesce(p_customer_branch_id::text, 'MAIN'),
      0
    )
  );

  select * into v_before
  from public.customer_branch_opening_balances balance
  where balance.customer_account_id = p_customer_account_id
    and balance.customer_branch_id is not distinct from p_customer_branch_id
  limit 1
  for update;

  v_actor_name := concat_ws(
    ' | ',
    v_actor.staff_name,
    v_actor.username,
    v_actor.staff_code
  );

  if p_customer_branch_id is null then
    insert into public.customer_branch_opening_balances (
      customer_account_id,
      customer_branch_id,
      opening_balance,
      notes,
      created_by,
      updated_by
    )
    values (
      p_customer_account_id,
      null,
      round(p_amount, 2),
      trim(p_reason),
      v_actor_name,
      v_actor_name
    )
    on conflict (customer_account_id) where customer_branch_id is null
    do update
    set opening_balance = excluded.opening_balance,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = now()
    returning * into v_after;
  else
    insert into public.customer_branch_opening_balances (
      customer_account_id,
      customer_branch_id,
      opening_balance,
      notes,
      created_by,
      updated_by
    )
    values (
      p_customer_account_id,
      p_customer_branch_id,
      round(p_amount, 2),
      trim(p_reason),
      v_actor_name,
      v_actor_name
    )
    on conflict (customer_account_id, customer_branch_id)
    do update
    set opening_balance = excluded.opening_balance,
        notes = excluded.notes,
        updated_by = excluded.updated_by,
        updated_at = now()
    returning * into v_after;
  end if;

  insert into public.customer_opening_balance_audit (
    opening_balance_id,
    customer_account_id,
    customer_branch_id,
    previous_amount,
    new_amount,
    reason,
    changed_by_staff_id,
    changed_by
  )
  values (
    v_after.id,
    p_customer_account_id,
    p_customer_branch_id,
    round(coalesce(v_before.opening_balance, 0), 2),
    v_after.opening_balance,
    trim(p_reason),
    v_actor.staff_id,
    v_actor_name
  );

  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  return jsonb_build_object(
    'opening_balance', to_jsonb(v_after),
    'customer_account_id', p_customer_account_id,
    'customer_branch_id', p_customer_branch_id
  );
end;
$$;

revoke all on function public.set_customer_opening_balance_v1(
  text, text, uuid, uuid, numeric, text
) from public;
grant execute on function public.set_customer_opening_balance_v1(
  text, text, uuid, uuid, numeric, text
) to anon, authenticated;

comment on function public.set_customer_opening_balance_v1(
  text, text, uuid, uuid, numeric, text
) is
  'Session-authorized, audited upsert of one customer or branch opening balance.';

notify pgrst, 'reload schema';
