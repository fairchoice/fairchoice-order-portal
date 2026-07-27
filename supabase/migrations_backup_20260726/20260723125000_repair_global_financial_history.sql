-- Additive repair for the missing Global Financial Ledger read model.
-- Deliberately contains no payment-table reference, trigger, or backfill.

create extension if not exists pgcrypto;

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  transaction_type text not null,
  customer_account_id uuid null
    references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null
    references public.customer_branches(id) on delete restrict,
  transaction_date timestamptz not null default now(),
  amount numeric(14,2) not null default 0,
  debit_amount numeric(14,2) not null default 0
    check (debit_amount >= 0),
  credit_amount numeric(14,2) not null default 0
    check (credit_amount >= 0),
  payment_method text null,
  reference text null,
  description text null,
  staff_id uuid null,
  staff_name text null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'ARCHIVED', 'VOIDED')),
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_by text null,
  updated_at timestamptz not null default now(),
  archived_by text null,
  archived_at timestamptz null,
  archive_reason text null,
  constraint financial_transactions_source_unique
    unique (source_type, source_id),
  constraint financial_transactions_amount_check
    check (amount >= 0 and debit_amount >= 0 and credit_amount >= 0)
);

create index if not exists financial_transactions_customer_date_idx
  on public.financial_transactions (
    customer_account_id,
    customer_branch_id,
    transaction_date desc
  );
create index if not exists financial_transactions_status_date_idx
  on public.financial_transactions (status, transaction_date desc);
create index if not exists financial_transactions_reference_idx
  on public.financial_transactions (reference);

create table if not exists public.financial_transaction_archive (
  archive_id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null,
  source_type text not null,
  source_id text not null,
  transaction_type text not null,
  customer_account_id uuid null,
  customer_branch_id uuid null,
  transaction_date timestamptz not null,
  amount numeric(14,2) not null default 0,
  debit_amount numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  payment_method text null,
  reference text null,
  description text null,
  staff_id uuid null,
  staff_name text null,
  metadata jsonb not null default '{}'::jsonb,
  original_created_by text null,
  original_created_at timestamptz null,
  archived_by text not null,
  archived_at timestamptz not null default now(),
  archive_reason text not null,
  restored_by text null,
  restored_at timestamptz null,
  permanently_deleted_by text null,
  permanently_deleted_at timestamptz null,
  delete_reason text null
);

create index if not exists financial_transaction_archive_customer_date_idx
  on public.financial_transaction_archive (
    customer_account_id,
    customer_branch_id,
    transaction_date desc
  );
create index if not exists financial_transaction_archive_active_idx
  on public.financial_transaction_archive (archived_at desc)
  where restored_at is null and permanently_deleted_at is null;

create table if not exists public.financial_ledger_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid null,
  archive_id uuid null,
  event_type text not null
    check (
      event_type in (
        'CREATE',
        'UPDATE',
        'ARCHIVE',
        'RESTORE',
        'PERMANENT_DELETE',
        'VOID'
      )
    ),
  actor text not null,
  reason text null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_ledger_events_transaction_idx
  on public.financial_ledger_events (transaction_id, created_at desc);
create unique index if not exists financial_ledger_events_create_unique_idx
  on public.financial_ledger_events (transaction_id)
  where event_type = 'CREATE';

create or replace view public.global_financial_history
with (security_invoker = true) as
select
  ft.id as record_id,
  null::uuid as archive_id,
  ft.source_type,
  ft.source_id,
  ft.transaction_type,
  ft.customer_account_id,
  ft.customer_branch_id,
  ft.transaction_date,
  ft.amount,
  ft.debit_amount,
  ft.credit_amount,
  ft.payment_method,
  ft.reference,
  ft.description,
  ft.staff_id,
  ft.staff_name,
  ft.status,
  ft.metadata,
  ft.created_at,
  ft.archived_at,
  ft.archived_by,
  ft.archive_reason
from public.financial_transactions ft
where ft.status <> 'ARCHIVED'
union all
select
  fa.transaction_id as record_id,
  fa.archive_id,
  fa.source_type,
  fa.source_id,
  fa.transaction_type,
  fa.customer_account_id,
  fa.customer_branch_id,
  fa.transaction_date,
  fa.amount,
  fa.debit_amount,
  fa.credit_amount,
  fa.payment_method,
  fa.reference,
  fa.description,
  fa.staff_id,
  fa.staff_name,
  'ARCHIVED'::text as status,
  fa.metadata,
  fa.original_created_at as created_at,
  fa.archived_at,
  fa.archived_by,
  fa.archive_reason
from public.financial_transaction_archive fa
where fa.restored_at is null
  and fa.permanently_deleted_at is null;

alter table public.financial_transactions enable row level security;
alter table public.financial_transaction_archive enable row level security;
alter table public.financial_ledger_events enable row level security;

revoke all on public.financial_transactions
  from public, anon, authenticated;
revoke all on public.financial_transaction_archive
  from public, anon, authenticated;
revoke all on public.financial_ledger_events
  from public, anon, authenticated;
revoke all on public.global_financial_history
  from public, anon, authenticated;

drop policy if exists global_ledger_owner_select
  on public.financial_transactions;
create policy global_ledger_owner_select
  on public.financial_transactions
  for select
  to authenticated
  using (public.central_payment_is_nisstaj_admin());

drop policy if exists global_archive_owner_select
  on public.financial_transaction_archive;
create policy global_archive_owner_select
  on public.financial_transaction_archive
  for select
  to authenticated
  using (public.central_payment_is_nisstaj_admin());

drop policy if exists global_events_owner_select
  on public.financial_ledger_events;
create policy global_events_owner_select
  on public.financial_ledger_events
  for select
  to authenticated
  using (public.central_payment_is_nisstaj_admin());

grant select on public.financial_transactions to authenticated;
grant select on public.financial_transaction_archive to authenticated;
grant select on public.financial_ledger_events to authenticated;
grant select on public.global_financial_history to authenticated;

create or replace function public.list_global_financial_history_v1(
  p_owner_username text,
  p_owner_password text,
  p_search text default null,
  p_payment_method text default null,
  p_status text default null,
  p_transaction_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_customer_account_id uuid default null,
  p_customer_branch_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint;
  v_records jsonb;
begin
  perform public.central_payment_require_admin_credentials(
    p_owner_username,
    p_owner_password
  );

  with filtered as (
    select h.*
    from public.global_financial_history h
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or h.reference ilike '%' || trim(p_search) || '%'
      or h.description ilike '%' || trim(p_search) || '%'
      or h.staff_name ilike '%' || trim(p_search) || '%'
      or h.source_id ilike '%' || trim(p_search) || '%'
    )
      and (
        nullif(trim(coalesce(p_payment_method, '')), '') is null
        or h.payment_method = trim(p_payment_method)
      )
      and (
        nullif(trim(coalesce(p_status, '')), '') is null
        or h.status = upper(trim(p_status))
      )
      and (
        nullif(trim(coalesce(p_transaction_type, '')), '') is null
        or h.transaction_type = upper(trim(p_transaction_type))
      )
      and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
      and (
        p_date_to is null
        or h.transaction_date < (p_date_to + 1)::timestamptz
      )
      and (
        p_customer_account_id is null
        or h.customer_account_id = p_customer_account_id
      )
      and (
        p_customer_branch_id is null
        or h.customer_branch_id = p_customer_branch_id
      )
  )
  select count(*) into v_total
  from filtered;

  with filtered as (
    select h.*
    from public.global_financial_history h
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or h.reference ilike '%' || trim(p_search) || '%'
      or h.description ilike '%' || trim(p_search) || '%'
      or h.staff_name ilike '%' || trim(p_search) || '%'
      or h.source_id ilike '%' || trim(p_search) || '%'
    )
      and (
        nullif(trim(coalesce(p_payment_method, '')), '') is null
        or h.payment_method = trim(p_payment_method)
      )
      and (
        nullif(trim(coalesce(p_status, '')), '') is null
        or h.status = upper(trim(p_status))
      )
      and (
        nullif(trim(coalesce(p_transaction_type, '')), '') is null
        or h.transaction_type = upper(trim(p_transaction_type))
      )
      and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
      and (
        p_date_to is null
        or h.transaction_date < (p_date_to + 1)::timestamptz
      )
      and (
        p_customer_account_id is null
        or h.customer_account_id = p_customer_account_id
      )
      and (
        p_customer_branch_id is null
        or h.customer_branch_id = p_customer_branch_id
      )
  ),
  page_rows as (
    select *
    from filtered
    order by transaction_date desc, created_at desc, record_id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(page_rows)
      order by
        page_rows.transaction_date desc,
        page_rows.created_at desc,
        page_rows.record_id desc
    ),
    '[]'::jsonb
  )
    into v_records
  from page_rows;

  return jsonb_build_object(
    'records', v_records,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages',
    greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;

revoke all on function public.list_global_financial_history_v1(
  text,text,text,text,text,text,date,date,uuid,uuid,integer,integer
) from public;
grant execute on function public.list_global_financial_history_v1(
  text,text,text,text,text,text,date,date,uuid,uuid,integer,integer
) to anon, authenticated;

do $verification$
begin
  perform *
  from public.global_financial_history
  limit 10;
end
$verification$;

notify pgrst, 'reload schema';
