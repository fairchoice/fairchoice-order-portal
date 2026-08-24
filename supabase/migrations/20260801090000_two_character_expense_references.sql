-- Two-character, collision-safe references for newly created expenses only.

begin;

do $$
begin
  if to_regclass('public.business_payouts') is null
     or to_regclass('public.expense_types') is null
     or to_regclass('public.suppliers') is null
     or to_regclass('public.staff_users') is null then
    raise exception 'Expense reference prerequisites are missing';
  end if;
  if to_regprocedure('public.fc_require_session_permission(text,text,text)') is null then
    raise exception 'The secured FC session permission function is required';
  end if;
  if not exists (
    select 1
    from pg_class index_class
    join pg_namespace index_namespace
      on index_namespace.oid = index_class.relnamespace
    where index_namespace.nspname = 'public'
      and index_class.relname = 'business_payouts_reference_uidx'
      and index_class.relkind = 'i'
  ) then
    raise exception 'The unique payout-reference index is required';
  end if;
end
$$;

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

  for v_attempt in 1..20 loop
    v_suffix := '';
    for v_character in 1..2 loop
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
        if v_attempt = 20 then
          raise exception 'Could not allocate a unique expense reference after 20 attempts.';
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

comment on function public.fc_create_business_payout(
  text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean
) is
  'Creates an expense with a unique E-YYMMDD-XX display reference; UUID remains the canonical identity and historical references are unchanged.';

notify pgrst, 'reload schema';

commit;
