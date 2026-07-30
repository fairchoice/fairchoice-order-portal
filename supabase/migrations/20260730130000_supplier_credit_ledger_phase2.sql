-- Phase 2 Supplier Credit Ledger.
-- Positive balances mean Fair Choice owes the supplier:
-- debit entries increase the balance; credit entries reduce it.

do $$
begin
  if to_regclass('public.suppliers') is null
     or to_regclass('public.supplier_credit_transactions') is null then
    raise exception 'Supplier Credit Ledger prerequisites are missing';
  end if;
  if to_regprocedure(
       'public.fc_require_session_permission(text,text,text)'
     ) is null then
    raise exception 'Supplier Credit Ledger requires FC session permissions';
  end if;
  if to_regprocedure(
       'public.fc_supplier_credit_statement(uuid)'
     ) is null then
    raise exception 'Supplier Credit Ledger requires the legacy statement RPC';
  end if;
end
$$;

alter table public.supplier_credit_transactions
  add column if not exists description text,
  add column if not exists status text not null default 'posted',
  add column if not exists created_by_login_id uuid,
  add column if not exists created_by_staff_id uuid,
  add column if not exists voided_by_login_id uuid,
  add column if not exists voided_by_staff_id uuid,
  add column if not exists voided_by_username text,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists reversal_of_transaction_id uuid,
  add column if not exists updated_at timestamptz not null default now();

update public.supplier_credit_transactions
set
  transaction_type = trim(transaction_type),
  reference = nullif(trim(reference), ''),
  invoice_number = nullif(trim(invoice_number), ''),
  description = nullif(trim(description), ''),
  notes = nullif(trim(notes), ''),
  created_by = nullif(trim(created_by), ''),
  created_by_username = nullif(trim(created_by_username), ''),
  status = case
    when lower(trim(coalesce(status, 'posted'))) in ('posted', 'voided', 'cancelled')
      then lower(trim(status))
    else 'posted'
  end;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.supplier_credit_transactions'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%transaction_type%'
  loop
    execute format(
      'alter table public.supplier_credit_transactions drop constraint %I',
      v_constraint.conname
    );
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_transaction_type_v2_check'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_transaction_type_v2_check
      check (
        transaction_type in (
          'Credit Purchase',
          'Payment',
          'Credit Note',
          'Adjustment',
          'opening_balance',
          'purchase_invoice',
          'payment',
          'credit_note',
          'refund',
          'debit_adjustment',
          'credit_adjustment'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_status_check'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_status_check
      check (status in ('posted', 'voided', 'cancelled'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_void_audit_check'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_void_audit_check
      check (
        status <> 'voided'
        or (
          voided_at is not null
          and nullif(trim(coalesce(void_reason, '')), '') is not null
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_created_login_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_created_login_fk
      foreign key (created_by_login_id)
      references public.login_users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_created_staff_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_created_staff_fk
      foreign key (created_by_staff_id)
      references public.staff_users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_voided_login_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_voided_login_fk
      foreign key (voided_by_login_id)
      references public.login_users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_voided_staff_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_voided_staff_fk
      foreign key (voided_by_staff_id)
      references public.staff_users(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_credit_transactions'::regclass
      and conname = 'supplier_credit_reversal_source_fk'
  ) then
    alter table public.supplier_credit_transactions
      add constraint supplier_credit_reversal_source_fk
      foreign key (reversal_of_transaction_id)
      references public.supplier_credit_transactions(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists supplier_credit_statement_order_idx
  on public.supplier_credit_transactions (
    supplier_id,
    transaction_date,
    created_at,
    id
  );

create index if not exists supplier_credit_active_balance_idx
  on public.supplier_credit_transactions (
    supplier_id,
    transaction_date,
    created_at,
    id
  )
  where status = 'posted';

create unique index if not exists supplier_credit_one_active_opening_idx
  on public.supplier_credit_transactions (supplier_id)
  where transaction_type = 'opening_balance' and status = 'posted';

drop policy if exists supplier_credit_transactions_all
  on public.supplier_credit_transactions;

revoke all on table public.supplier_credit_transactions
  from public, anon, authenticated;

create or replace function public.fc_list_supplier_accounts_v1(
  p_username text,
  p_session_token text
)
returns table (
  id uuid,
  supplier_name text,
  active boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'suppliers.view'
  );

  return query
  select s.id, s.supplier_name, s.active
  from public.suppliers s
  order by lower(s.supplier_name), s.id;
end;
$$;

create or replace function public.fc_supplier_credit_statement_v2(
  p_username text,
  p_session_token text,
  p_supplier_id uuid,
  p_date_from date default null,
  p_date_to date default null,
  p_transaction_types text[] default null,
  p_search text default null
)
returns table (
  row_key text,
  transaction_id uuid,
  source text,
  transaction_date date,
  transaction_type text,
  invoice_number text,
  reference text,
  description text,
  notes text,
  status text,
  created_by text,
  created_at timestamptz,
  debit numeric,
  credit numeric,
  running_balance numeric,
  opening_balance numeric,
  current_balance numeric,
  is_opening_balance boolean,
  void_reason text,
  voided_by text,
  voided_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'suppliers.view'
  );

  if p_supplier_id is null then
    raise exception 'Supplier is required.';
  end if;
  if not exists (
    select 1 from public.suppliers where id = p_supplier_id
  ) then
    raise exception 'Supplier not found.';
  end if;
  if p_date_from is not null
     and p_date_to is not null
     and p_date_from > p_date_to then
    raise exception 'From date must not be after To date.';
  end if;

  return query
  with source_rows as (
    select
      'supplier_credit:' || sct.id::text as source_row_key,
      sct.id as source_transaction_id,
      'supplier_credit'::text as source_name,
      sct.transaction_date as source_transaction_date,
      case sct.transaction_type
        when 'Credit Purchase' then 'purchase_invoice'
        when 'Payment' then 'payment'
        when 'Credit Note' then 'credit_note'
        when 'Adjustment' then 'debit_adjustment'
        else sct.transaction_type
      end as canonical_type,
      sct.invoice_number as source_invoice_number,
      sct.reference as source_reference,
      coalesce(sct.description, sct.notes) as source_description,
      sct.notes as source_notes,
      lower(coalesce(sct.status, 'posted')) as source_status,
      coalesce(
        sct.created_by_username,
        sct.created_by,
        'Unknown'
      ) as source_created_by,
      sct.created_at as source_created_at,
      case
        when lower(coalesce(sct.status, 'posted')) <> 'posted' then 0::numeric
        when sct.transaction_type in (
          'Credit Purchase',
          'Adjustment',
          'opening_balance',
          'purchase_invoice',
          'debit_adjustment'
        ) then sct.amount
        else 0::numeric
      end as source_debit,
      case
        when lower(coalesce(sct.status, 'posted')) <> 'posted' then 0::numeric
        when sct.transaction_type in (
          'Payment',
          'Credit Note',
          'payment',
          'credit_note',
          'refund',
          'credit_adjustment'
        ) then sct.amount
        else 0::numeric
      end as source_credit,
      sct.void_reason as source_void_reason,
      sct.voided_by_username as source_voided_by,
      sct.voided_at as source_voided_at
    from public.supplier_credit_transactions sct
    where sct.supplier_id = p_supplier_id

    union all

    select
      'stock_receipt:' || sr.id::text,
      null::uuid,
      'stock_receipt'::text,
      sr.received_date::date,
      'purchase_invoice'::text,
      sr.invoice_number,
      sr.purchase_type,
      coalesce(sr.purchase_type, 'Stock receipt'),
      null::text,
      'posted'::text,
      'Stock receiving'::text,
      sr.received_date::timestamptz,
      greatest(coalesce(sr.total_cost, 0), 0)::numeric,
      0::numeric,
      null::text,
      null::text,
      null::timestamptz
    from public.stock_receipts sr
    join public.suppliers s
      on lower(trim(s.supplier_name)) = lower(trim(sr.supplier_name))
    where s.id = p_supplier_id
      and lower(coalesce(sr.payment_method, '')) in ('account', 'credit')
      and coalesce(sr.total_cost, 0) > 0
  ),
  totals as (
    select
      coalesce(sum(
        case
          when p_date_from is not null
               and r.source_transaction_date < p_date_from
            then r.source_debit - r.source_credit
          else 0
        end
      ), 0)::numeric as calculated_opening_balance,
      coalesce(sum(r.source_debit - r.source_credit), 0)::numeric
        as calculated_current_balance
    from source_rows r
  ),
  visible_rows as (
    select r.*
    from source_rows r
    where (p_date_from is null or r.source_transaction_date >= p_date_from)
      and (p_date_to is null or r.source_transaction_date <= p_date_to)
      and (
        p_transaction_types is null
        or cardinality(p_transaction_types) = 0
        or r.canonical_type = any(p_transaction_types)
      )
      and (
        v_search = ''
        or position(
          v_search in lower(concat_ws(
            ' ',
            r.source_reference,
            r.source_description,
            r.source_invoice_number,
            r.source_notes,
            r.source_created_by
          ))
        ) > 0
      )
  ),
  statement_rows as (
    select
      'opening_balance'::text as result_row_key,
      null::uuid as result_transaction_id,
      'calculated'::text as result_source,
      p_date_from as result_transaction_date,
      'opening_balance'::text as result_transaction_type,
      null::text as result_invoice_number,
      null::text as result_reference,
      'Opening balance before selected date range'::text as result_description,
      null::text as result_notes,
      'posted'::text as result_status,
      null::text as result_created_by,
      null::timestamptz as result_created_at,
      0::numeric as result_debit,
      0::numeric as result_credit,
      t.calculated_opening_balance as result_running_balance,
      t.calculated_opening_balance as result_opening_balance,
      t.calculated_current_balance as result_current_balance,
      true as result_is_opening_balance,
      null::text as result_void_reason,
      null::text as result_voided_by,
      null::timestamptz as result_voided_at
    from totals t
    where p_date_from is not null

    union all

    select
      r.source_row_key,
      r.source_transaction_id,
      r.source_name,
      r.source_transaction_date,
      r.canonical_type,
      r.source_invoice_number,
      r.source_reference,
      r.source_description,
      r.source_notes,
      r.source_status,
      r.source_created_by,
      r.source_created_at,
      r.source_debit,
      r.source_credit,
      (
        t.calculated_opening_balance
        + sum(r.source_debit - r.source_credit) over (
          order by
            r.source_transaction_date,
            r.source_created_at,
            r.source_row_key
          rows between unbounded preceding and current row
        )
      )::numeric,
      t.calculated_opening_balance,
      t.calculated_current_balance,
      false,
      r.source_void_reason,
      r.source_voided_by,
      r.source_voided_at
    from visible_rows r
    cross join totals t
  )
  select
    sr.result_row_key,
    sr.result_transaction_id,
    sr.result_source,
    sr.result_transaction_date,
    sr.result_transaction_type,
    sr.result_invoice_number,
    sr.result_reference,
    sr.result_description,
    sr.result_notes,
    sr.result_status,
    sr.result_created_by,
    sr.result_created_at,
    sr.result_debit,
    sr.result_credit,
    sr.result_running_balance,
    sr.result_opening_balance,
    sr.result_current_balance,
    sr.result_is_opening_balance,
    sr.result_void_reason,
    sr.result_voided_by,
    sr.result_voided_at
  from statement_rows sr
  order by
    sr.result_is_opening_balance desc,
    sr.result_transaction_date,
    sr.result_created_at nulls first,
    sr.result_row_key;
end;
$$;

create or replace function public.fc_post_supplier_credit_adjustment_v1(
  p_username text,
  p_session_token text,
  p_supplier_id uuid,
  p_transaction_date date,
  p_transaction_type text,
  p_amount numeric,
  p_reference text,
  p_description text
)
returns public.supplier_credit_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_type text := lower(trim(coalesce(p_transaction_type, '')));
  v_reference text := nullif(trim(coalesce(p_reference, '')), '');
  v_description text := nullif(trim(coalesce(p_description, '')), '');
  v_row public.supplier_credit_transactions%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'suppliers.pay'
  );

  if p_supplier_id is null then
    raise exception 'Supplier is required.';
  end if;
  if not exists (
    select 1
    from public.suppliers
    where id = p_supplier_id and active is true
  ) then
    raise exception 'Supplier is missing or inactive.';
  end if;
  if p_transaction_date is null then
    raise exception 'Transaction date is required.';
  end if;
  if v_type not in (
    'opening_balance',
    'debit_adjustment',
    'credit_adjustment'
  ) then
    raise exception 'Only opening balances and authorised adjustments may be posted manually.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if v_reference is null then
    raise exception 'Reference is required.';
  end if;
  if v_description is null then
    raise exception 'Reason or description is required.';
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
    created_at,
    updated_at
  )
  values (
    p_supplier_id,
    p_transaction_date,
    v_type,
    p_amount,
    v_reference,
    v_description,
    v_description,
    'posted',
    v_actor.staff_name,
    v_actor.username,
    v_actor.login_id,
    v_actor.staff_id,
    now(),
    now()
  )
  returning * into v_row;

  return v_row;
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

revoke all on function public.fc_list_supplier_accounts_v1(text,text)
  from public;
revoke all on function public.fc_supplier_credit_statement_v2(
  text,text,uuid,date,date,text[],text
) from public;
revoke all on function public.fc_post_supplier_credit_adjustment_v1(
  text,text,uuid,date,text,numeric,text,text
) from public;
revoke all on function public.fc_void_supplier_credit_transaction_v1(
  text,text,uuid,text
) from public;

grant execute on function public.fc_list_supplier_accounts_v1(text,text)
  to anon, authenticated;
grant execute on function public.fc_supplier_credit_statement_v2(
  text,text,uuid,date,date,text[],text
) to anon, authenticated;
grant execute on function public.fc_post_supplier_credit_adjustment_v1(
  text,text,uuid,date,text,numeric,text,text
) to anon, authenticated;
grant execute on function public.fc_void_supplier_credit_transaction_v1(
  text,text,uuid,text
) to anon, authenticated;

notify pgrst, 'reload schema';
