-- FairChoice global financial ledger foundation.
-- Additive only: existing orders, invoices, payments, allocations, accounts and branches are preserved.

create extension if not exists pgcrypto;

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  transaction_type text not null,
  customer_account_id uuid null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  transaction_date timestamptz not null default now(),
  amount numeric(14,2) not null default 0,
  debit_amount numeric(14,2) not null default 0 check (debit_amount >= 0),
  credit_amount numeric(14,2) not null default 0 check (credit_amount >= 0),
  payment_method text null,
  reference text null,
  description text null,
  staff_id uuid null,
  staff_name text null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED','VOIDED')),
  metadata jsonb not null default '{}'::jsonb,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_by text null,
  updated_at timestamptz not null default now(),
  archived_by text null,
  archived_at timestamptz null,
  archive_reason text null,
  constraint financial_transactions_source_unique unique (source_type, source_id),
  constraint financial_transactions_amount_check check (
    amount >= 0 and debit_amount >= 0 and credit_amount >= 0
  )
);

create index if not exists financial_transactions_customer_date_idx
  on public.financial_transactions (customer_account_id, customer_branch_id, transaction_date desc);
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
  on public.financial_transaction_archive (customer_account_id, customer_branch_id, transaction_date desc);
create index if not exists financial_transaction_archive_active_idx
  on public.financial_transaction_archive (archived_at desc)
  where restored_at is null and permanently_deleted_at is null;

create table if not exists public.financial_ledger_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid null,
  archive_id uuid null,
  event_type text not null check (event_type in ('CREATE','UPDATE','ARCHIVE','RESTORE','PERMANENT_DELETE','VOID')),
  actor text not null,
  reason text null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_ledger_events_transaction_idx
  on public.financial_ledger_events (transaction_id, created_at desc);

create or replace function public.touch_financial_transaction_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists financial_transactions_touch_updated_at on public.financial_transactions;
create trigger financial_transactions_touch_updated_at
before update on public.financial_transactions
for each row execute function public.touch_financial_transaction_updated_at();

create or replace function public.archive_financial_transactions(
  p_transaction_ids uuid[],
  p_actor text,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_row public.financial_transactions%rowtype;
begin
  if coalesce(array_length(p_transaction_ids, 1), 0) = 0 then
    return 0;
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Actor is required';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Archive reason is required';
  end if;

  for v_row in
    select * from public.financial_transactions
    where id = any(p_transaction_ids) and status = 'ACTIVE'
    for update
  loop
    insert into public.financial_transaction_archive (
      transaction_id, source_type, source_id, transaction_type,
      customer_account_id, customer_branch_id, transaction_date,
      amount, debit_amount, credit_amount, payment_method, reference,
      description, staff_id, staff_name, metadata,
      original_created_by, original_created_at,
      archived_by, archived_at, archive_reason
    ) values (
      v_row.id, v_row.source_type, v_row.source_id, v_row.transaction_type,
      v_row.customer_account_id, v_row.customer_branch_id, v_row.transaction_date,
      v_row.amount, v_row.debit_amount, v_row.credit_amount, v_row.payment_method,
      v_row.reference, v_row.description, v_row.staff_id, v_row.staff_name,
      v_row.metadata, v_row.created_by, v_row.created_at,
      p_actor, now(), p_reason
    );

    update public.financial_transactions
      set status = 'ARCHIVED', archived_by = p_actor, archived_at = now(),
          archive_reason = p_reason, updated_by = p_actor
      where id = v_row.id;

    insert into public.financial_ledger_events (
      transaction_id, event_type, actor, reason, event_data
    ) values (
      v_row.id, 'ARCHIVE', p_actor, p_reason,
      jsonb_build_object('source_type', v_row.source_type, 'source_id', v_row.source_id)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.restore_financial_transaction(
  p_archive_id uuid,
  p_actor text,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archive public.financial_transaction_archive%rowtype;
begin
  select * into v_archive
  from public.financial_transaction_archive
  where archive_id = p_archive_id
    and restored_at is null
    and permanently_deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  update public.financial_transactions
    set status = 'ACTIVE', archived_by = null, archived_at = null,
        archive_reason = null, updated_by = p_actor
    where id = v_archive.transaction_id;

  update public.financial_transaction_archive
    set restored_by = p_actor, restored_at = now()
    where archive_id = p_archive_id;

  insert into public.financial_ledger_events (
    transaction_id, archive_id, event_type, actor, reason
  ) values (
    v_archive.transaction_id, p_archive_id, 'RESTORE', p_actor, p_reason
  );
  return true;
end;
$$;

create or replace function public.permanently_delete_financial_archive(
  p_archive_id uuid,
  p_actor text,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archive public.financial_transaction_archive%rowtype;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'Permanent delete reason is required';
  end if;

  select * into v_archive
  from public.financial_transaction_archive
  where archive_id = p_archive_id
    and restored_at is null
    and permanently_deleted_at is null
  for update;

  if not found then
    return false;
  end if;

  update public.financial_transaction_archive
    set permanently_deleted_by = p_actor,
        permanently_deleted_at = now(),
        delete_reason = p_reason
    where archive_id = p_archive_id;

  delete from public.financial_transactions
    where id = v_archive.transaction_id and status = 'ARCHIVED';

  insert into public.financial_ledger_events (
    transaction_id, archive_id, event_type, actor, reason
  ) values (
    v_archive.transaction_id, p_archive_id, 'PERMANENT_DELETE', p_actor, p_reason
  );
  return true;
end;
$$;

create or replace view public.global_financial_history as
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
where fa.restored_at is null and fa.permanently_deleted_at is null;

insert into public.financial_transactions (
  source_type, source_id, transaction_type, customer_account_id,
  customer_branch_id, transaction_date, amount, debit_amount, credit_amount,
  payment_method, reference, description, staff_name, metadata,
  created_by, created_at
)
select
  'CUSTOMER_PAYMENT', cp.id::text, 'PAYMENT', cp.customer_account_id,
  cp.customer_branch_id, cp.payment_date, cp.amount, 0, cp.amount,
  cp.payment_method, cp.payment_reference, cp.notes,
  coalesce(cp.paid_by, cp.created_by),
  jsonb_build_object('legacy_status', cp.status, 'legacy_source', cp.source),
  cp.created_by, cp.created_at
from public.customer_payments cp
on conflict (source_type, source_id) do nothing;

alter table public.financial_transactions enable row level security;
alter table public.financial_transaction_archive enable row level security;
alter table public.financial_ledger_events enable row level security;

grant select, insert, update on public.financial_transactions to authenticated;
grant select on public.financial_transaction_archive to authenticated;
grant select on public.financial_ledger_events to authenticated;
grant select on public.global_financial_history to authenticated;
grant execute on function public.archive_financial_transactions(uuid[], text, text) to authenticated;
grant execute on function public.restore_financial_transaction(uuid, text, text) to authenticated;
grant execute on function public.permanently_delete_financial_archive(uuid, text, text) to authenticated;

comment on table public.financial_transactions is 'Canonical active FairChoice financial ledger. Existing source records remain untouched.';
comment on table public.financial_transaction_archive is 'Soft-deleted ledger snapshots retained for restore or audited permanent deletion.';
comment on view public.global_financial_history is 'Global active and archived financial history for the owner finance UI.';
