-- Stable Weekly Account collector identities and collision-safe short expense references.

begin;

do $$
begin
  if to_regclass('public.driver_handovers') is null
     or to_regclass('public.staff_users') is null
     or to_regclass('public.login_users') is null then
    raise exception 'Weekly Account collector identity prerequisites are missing';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null
     or to_regprocedure('public.fc_create_business_payout(text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean)') is null then
    raise exception 'Secured FC session and expense functions are required';
  end if;
end
$$;

alter table public.driver_handovers
  add column if not exists collector_staff_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.driver_handovers'::regclass
      and conname = 'driver_handovers_collector_staff_fk'
  ) then
    alter table public.driver_handovers
      add constraint driver_handovers_collector_staff_fk
      foreign key (collector_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists driver_handovers_collector_staff_date_idx
  on public.driver_handovers (collector_staff_id, handover_date desc)
  where collector_staff_id is not null;

comment on column public.driver_handovers.collector_staff_id is
  'Stable collector identity for new handovers. Null is retained for unresolved historical name-only rows.';

create or replace function public.fc_list_weekly_account_collectors_v1(
  p_username text,
  p_session_token text
)
returns table (
  staff_id uuid,
  staff_name text,
  username text,
  collector_type text,
  login_aliases text[]
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

  return query
  with eligible as (
    select
      su.id as eligible_staff_id,
      nullif(trim(su.staff_name), '') as eligible_staff_name,
      lu.username as eligible_username,
      case
        when regexp_replace(
          lower(trim(coalesce(nullif(lu.role, ''), nullif(su.role, ''), nullif(su.job_role, '')))),
          '[^a-z]+',
          '',
          'g'
        ) = 'driver' then 'Driver'
        else 'Sales Rep'
      end as eligible_collector_type,
      row_number() over (
        partition by su.id
        order by lower(lu.username), lu.id
      ) as identity_rank
    from public.staff_users su
    join public.login_users lu
      on lu.staff_id = su.id
     and lu.active is true
    where su.active is true
      and regexp_replace(
        lower(trim(coalesce(nullif(lu.role, ''), nullif(su.role, ''), nullif(su.job_role, '')))),
        '[^a-z]+',
        '',
        'g'
      ) in ('driver', 'salesrep', 'salesrepresentative')
  )
  select
    e.eligible_staff_id,
    e.eligible_staff_name,
    e.eligible_username,
    e.eligible_collector_type,
    array(
      select distinct alias_login.username
      from public.login_users alias_login
      where alias_login.staff_id = e.eligible_staff_id
        and alias_login.active is true
      order by alias_login.username
    )
  from eligible e
  where e.identity_rank = 1
  order by e.eligible_collector_type, lower(coalesce(e.eligible_staff_name, e.eligible_username));
end;
$$;

revoke all on function public.fc_list_weekly_account_collectors_v1(text,text)
  from public, anon, authenticated;
grant execute on function public.fc_list_weekly_account_collectors_v1(text,text)
  to anon, authenticated;

create or replace function public.fc_create_business_payout(
  p_username text,
  p_session_token text,
  p_payout_date date,
  p_expense_type_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_description text default null,
  p_receipt_reference text default null,
  p_receipt_url text default null,
  p_paid_by_type text default 'BUSINESS',
  p_paid_by_staff_id uuid default null,
  p_submit boolean default false
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_submit_actor record;
  v_row public.business_payouts%rowtype;
  v_reference text;
  v_suffix text;
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_attempt integer;
  v_character integer;
  v_constraint_name text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'expenses.create'
  );
  if v_actor.staff_id is null then
    raise exception 'An active FC staff identity is required.'
      using errcode = '42501';
  end if;
  if p_submit then
    select * into v_submit_actor
    from public.fc_require_session_permission(
      p_username,
      p_session_token,
      'expenses.submit'
    );
  end if;
  if p_payout_date is null then
    raise exception 'Payout date is required.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_payment_method not in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other') then
    raise exception 'Unsupported payment method.';
  end if;
  if not exists (
    select 1 from public.expense_types
    where id = p_expense_type_id and active is true
  ) then
    raise exception 'Expense type is missing or inactive.';
  end if;
  if p_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where id = p_supplier_id
         and coalesce(active, true) is true
     ) then
    raise exception 'Supplier is missing or inactive.';
  end if;
  if p_paid_by_staff_id is not null
     and not exists (
       select 1 from public.staff_users
       where id = p_paid_by_staff_id and active is true
     ) then
    raise exception 'Paid-by staff identity is missing or inactive.';
  end if;

  for v_attempt in 1..8 loop
    v_suffix := '';
    for v_character in 1..6 loop
      v_suffix := v_suffix || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::integer,
        1
      );
    end loop;
    v_reference := 'E-' || to_char(p_payout_date, 'YYMMDD') || '-' || v_suffix;

    begin
      insert into public.business_payouts (
        payout_reference,
        payout_date,
        expense_type_id,
        supplier_id,
        amount,
        payment_method,
        description,
        receipt_reference,
        receipt_url,
        paid_by_type,
        paid_by_staff_id,
        recorded_by_staff_id,
        status,
        submitted_at
      )
      values (
        v_reference,
        p_payout_date,
        p_expense_type_id,
        p_supplier_id,
        round(p_amount, 2),
        p_payment_method,
        nullif(trim(coalesce(p_description, '')), ''),
        nullif(trim(coalesce(p_receipt_reference, '')), ''),
        nullif(trim(coalesce(p_receipt_url, '')), ''),
        nullif(trim(coalesce(p_paid_by_type, '')), ''),
        p_paid_by_staff_id,
        v_actor.staff_id,
        case when p_submit then 'SUBMITTED' else 'DRAFT' end,
        case when p_submit then now() else null end
      )
      returning * into v_row;
      exit;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;
        if v_constraint_name <> 'business_payouts_reference_uidx' then
          raise;
        end if;
        if v_attempt = 8 then
          raise exception 'Could not allocate a unique expense reference after 8 attempts.';
        end if;
    end;
  end loop;

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    reason,
    before_data,
    after_data,
    changed_by,
    actor_staff_id
  )
  values (
    'CREATE',
    'BUSINESS_PAYOUT',
    v_row.id::text,
    case when p_submit then 'Created and submitted' else 'Created as draft' end,
    null,
    to_jsonb(v_row),
    v_actor.username,
    v_actor.staff_id
  );

  return v_row;
end;
$$;

revoke all on function public.fc_create_business_payout(
  text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean
) from public, anon, authenticated;
grant execute on function public.fc_create_business_payout(
  text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean
) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
