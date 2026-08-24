-- Supplier Payment accounting integration.
-- One approved business payout is the canonical source for its Global Ledger,
-- Supplier Account, and qualifying Weekly Account effects.

begin;

do $$
begin
  if to_regclass('public.business_payouts') is null
     or to_regclass('public.expense_types') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.supplier_credit_transactions') is null
     or to_regclass('public.staff_cash_expenses') is null then
    raise exception 'Supplier Payment integration requires the expense, ledger, supplier-credit, and Weekly Account foundations';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null
     or to_regprocedure('public.archive_financial_transactions(uuid[],text,text)') is null then
    raise exception 'Supplier Payment integration requires the secured FC expense workflow';
  end if;
end
$$;

alter table public.supplier_credit_transactions
  add column if not exists business_payout_id uuid;

alter table public.staff_cash_expenses
  add column if not exists business_payout_id uuid,
  add column if not exists paid_by_staff_id uuid,
  add column if not exists void_reason text,
  add column if not exists voided_by text,
  add column if not exists voided_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_business_payout_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_business_payout_fk
      foreign key (business_payout_id)
      references public.business_payouts(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_cash_expenses'::regclass
      and conname = 'staff_cash_expenses_business_payout_fk'
  ) then
    alter table public.staff_cash_expenses
      add constraint staff_cash_expenses_business_payout_fk
      foreign key (business_payout_id)
      references public.business_payouts(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.staff_cash_expenses'::regclass
      and conname = 'staff_cash_expenses_paid_by_staff_fk'
  ) then
    alter table public.staff_cash_expenses
      add constraint staff_cash_expenses_paid_by_staff_fk
      foreign key (paid_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
end
$$;

create unique index if not exists supplier_credit_business_payout_uidx
  on public.supplier_credit_transactions (business_payout_id)
  where business_payout_id is not null;

create unique index if not exists staff_cash_expenses_business_payout_uidx
  on public.staff_cash_expenses (business_payout_id)
  where business_payout_id is not null;

create index if not exists staff_cash_expenses_paid_by_staff_date_idx
  on public.staff_cash_expenses (paid_by_staff_id, expense_date desc)
  where paid_by_staff_id is not null;

-- Keep the existing manual Weekly Account workflow, but reserve payout-linked
-- rows for the secured expense functions. SECURITY DEFINER owners bypass RLS;
-- anon/authenticated clients may only insert or update unlinked manual rows.
drop policy if exists staff_cash_expenses_insert
  on public.staff_cash_expenses;
create policy staff_cash_expenses_insert
  on public.staff_cash_expenses for insert
  to anon, authenticated
  with check (business_payout_id is null);

drop policy if exists staff_cash_expenses_update
  on public.staff_cash_expenses;
create policy staff_cash_expenses_update
  on public.staff_cash_expenses for update
  to anon, authenticated
  using (business_payout_id is null)
  with check (business_payout_id is null);

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

  select
    su.id,
    su.staff_name,
    coalesce(nullif(trim(lu.role), ''), nullif(trim(su.role), ''), 'Staff') as staff_role,
    lu.id as login_id,
    lu.username
  into v_payer
  from public.staff_users su
  left join lateral (
    select l.id, l.username, l.role
    from public.login_users l
    where l.staff_id = su.id
      and l.active is true
    order by
      case when l.id = p_actor_login_id then 0 else 1 end,
      l.created_at,
      l.id
    limit 1
  ) lu on true
  where su.id = v_payer_staff_id
    and su.active is true;

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

  v_collector_type := case
    when lower(replace(coalesce(v_payer.staff_role, ''), ' ', '')) = 'driver'
      then 'Driver'
    when lower(replace(coalesce(v_payer.staff_role, ''), ' ', '')) in (
      'salesrep',
      'salesrepresentative'
    ) then 'Sales Rep'
    else null
  end;

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

create or replace function public.fc_approve_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
  v_expense_type public.expense_types%rowtype;
  v_ledger public.financial_transactions%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.approve'
  );

  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;

  if v_before.status = 'POSTED' then
    if v_before.ledger_transaction_id is null then
      raise exception 'Posted expense is missing its ledger transaction.';
    end if;
    if not exists (
      select 1
      from public.financial_transactions ft
      where ft.id = v_before.ledger_transaction_id
        and ft.source_type = 'business_payouts'
        and ft.source_id = v_before.id::text
        and ft.status = 'ACTIVE'
        and ft.amount = v_before.amount
        and ft.debit_amount = v_before.amount
        and ft.credit_amount = 0
    ) then
      raise exception 'Posted expense does not have one matching active ledger effect.';
    end if;

    perform public.fc_sync_business_payout_accounting_v1(
      v_before.id,
      v_actor.login_id,
      v_actor.staff_id,
      v_actor.username
    );
    return v_before;
  end if;

  if v_before.status <> 'SUBMITTED' then
    raise exception 'Only a SUBMITTED expense may be approved.';
  end if;
  if v_before.voided_at is not null then
    raise exception 'A voided expense cannot be approved.';
  end if;

  select * into v_expense_type
  from public.expense_types
  where id = v_before.expense_type_id;
  if not found then
    raise exception 'Expense type no longer exists.';
  end if;

  select * into v_ledger
  from public.financial_transactions
  where source_type = 'business_payouts'
    and source_id = v_before.id::text
  for update;

  if found then
    if v_ledger.status <> 'ACTIVE'
       or v_ledger.amount <> v_before.amount
       or v_ledger.debit_amount <> v_before.amount
       or v_ledger.credit_amount <> 0 then
      raise exception 'Existing ledger transaction does not match this expense.';
    end if;
  else
    insert into public.financial_transactions (
      source_type,
      source_id,
      transaction_type,
      transaction_date,
      amount,
      debit_amount,
      credit_amount,
      payment_method,
      reference,
      description,
      staff_id,
      staff_name,
      status,
      metadata,
      created_by
    )
    values (
      'business_payouts',
      v_before.id::text,
      'EXPENSE',
      v_before.payout_date::timestamptz,
      v_before.amount,
      v_before.amount,
      0,
      v_before.payment_method,
      v_before.payout_reference,
      coalesce(v_before.description, v_expense_type.expense_type_name),
      v_actor.staff_id,
      v_actor.staff_name,
      'ACTIVE',
      jsonb_build_object(
        'direction', 'OUT',
        'source_table', 'business_payouts',
        'payout_id', v_before.id,
        'expense_type_id', v_before.expense_type_id,
        'expense_type_code', v_expense_type.expense_type_code,
        'supplier_id', v_before.supplier_id,
        'recorded_by_staff_id', v_before.recorded_by_staff_id,
        'approved_by_staff_id', v_actor.staff_id
      ),
      v_actor.username
    )
    returning * into v_ledger;

    insert into public.financial_ledger_events (
      transaction_id,
      event_type,
      actor,
      reason,
      event_data
    )
    values (
      v_ledger.id,
      'CREATE',
      v_actor.username,
      'Approved business expense',
      jsonb_build_object(
        'source_type', 'business_payouts',
        'source_id', v_before.id,
        'direction', 'OUT',
        'amount', v_before.amount
      )
    )
    on conflict do nothing;
  end if;

  perform public.fc_sync_business_payout_accounting_v1(
    v_before.id,
    v_actor.login_id,
    v_actor.staff_id,
    v_actor.username
  );

  update public.business_payouts
  set
    status = 'POSTED',
    approved_by_staff_id = v_actor.staff_id,
    approved_at = now(),
    ledger_transaction_id = v_ledger.id
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'APPROVE', 'BUSINESS_PAYOUT', v_after.id::text,
    'Approved and posted once to the Global Ledger and linked account effects',
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );

  return v_after;
end;
$$;

create or replace function public.fc_void_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid,
  p_reason text
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
  v_archive_count integer := 0;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.void'
  );
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Void reason is required.';
  end if;

  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status = 'VOIDED' then
    return v_before;
  end if;

  if v_before.ledger_transaction_id is not null then
    v_archive_count := public.archive_financial_transactions(
      array[v_before.ledger_transaction_id],
      v_actor.username,
      trim(p_reason)
    );
    if v_archive_count <> 1
       and not exists (
         select 1
         from public.financial_transactions
         where id = v_before.ledger_transaction_id
           and status in ('ARCHIVED', 'VOIDED')
       ) then
      raise exception 'The linked Global Ledger effect could not be voided.';
    end if;
  end if;

  update public.supplier_credit_transactions
  set
    status = 'voided',
    void_reason = trim(p_reason),
    voided_by_login_id = v_actor.login_id,
    voided_by_staff_id = v_actor.staff_id,
    voided_by_username = v_actor.username,
    voided_at = now(),
    updated_at = now()
  where business_payout_id = v_before.id
    and status = 'posted';

  if exists (
    select 1
    from public.supplier_credit_transactions
    where business_payout_id = v_before.id
      and status = 'posted'
  ) then
    raise exception 'The linked Supplier Account effect could not be voided.';
  end if;

  update public.staff_cash_expenses
  set
    status = 'VOIDED',
    void_reason = trim(p_reason),
    voided_by = v_actor.username,
    voided_at = now(),
    updated_at = now()
  where business_payout_id = v_before.id
    and status <> 'VOIDED';

  if exists (
    select 1
    from public.staff_cash_expenses
    where business_payout_id = v_before.id
      and status = 'APPROVED'
  ) then
    raise exception 'The linked Weekly Account effect could not be voided.';
  end if;

  update public.business_payouts
  set
    status = 'VOIDED',
    voided_by_staff_id = v_actor.staff_id,
    voided_at = now(),
    void_reason = trim(p_reason)
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'VOID', 'BUSINESS_PAYOUT', v_after.id::text, trim(p_reason),
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );

  return v_after;
end;
$$;

create or replace function public.fc_void_supplier_credit_transaction_v1(
  p_username text,
  p_session_token text,
  p_transaction_id uuid,
  p_reason text
)
returns public.supplier_credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_before public.supplier_credit_transactions%rowtype;
  v_after public.supplier_credit_transactions%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'suppliers.pay'
  );

  if p_transaction_id is null then
    raise exception 'Supplier transaction ID is required.';
  end if;
  if v_reason is null then
    raise exception 'A void reason is required.';
  end if;

  select * into v_before
  from public.supplier_credit_transactions
  where id = p_transaction_id
  for update;

  if not found then
    raise exception 'Supplier transaction not found.';
  end if;
  if v_before.business_payout_id is not null then
    raise exception 'Void the original expense to reverse this Supplier Payment.';
  end if;
  if v_before.status <> 'posted' then
    raise exception 'Only posted supplier transactions may be voided.';
  end if;

  update public.supplier_credit_transactions
  set
    status = 'voided',
    void_reason = v_reason,
    voided_by_login_id = v_actor.login_id,
    voided_by_staff_id = v_actor.staff_id,
    voided_by_username = v_actor.username,
    voided_at = now(),
    updated_at = now()
  where id = p_transaction_id
  returning * into v_after;

  return v_after;
end;
$$;

revoke all on function public.fc_sync_business_payout_accounting_v1(
  uuid,uuid,uuid,text
) from public, anon, authenticated;
revoke all on function public.fc_approve_business_payout(
  text,text,uuid
) from public, anon, authenticated;
revoke all on function public.fc_void_business_payout(
  text,text,uuid,text
) from public, anon, authenticated;
revoke all on function public.fc_void_supplier_credit_transaction_v1(
  text,text,uuid,text
) from public, anon, authenticated;

grant execute on function public.fc_approve_business_payout(
  text,text,uuid
) to anon, authenticated;
grant execute on function public.fc_void_business_payout(
  text,text,uuid,text
) to anon, authenticated;
grant execute on function public.fc_void_supplier_credit_transaction_v1(
  text,text,uuid,text
) to anon, authenticated;

comment on column public.supplier_credit_transactions.business_payout_id is
  'Canonical source link for an automatically posted Supplier Payment.';
comment on column public.staff_cash_expenses.business_payout_id is
  'Canonical source link for an automatically posted staff-paid cash expense.';

commit;

notify pgrst, 'reload schema';
