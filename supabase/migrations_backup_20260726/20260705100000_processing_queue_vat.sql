-- FairChoice ProcessingQueue foundation.
-- Stores confirmed Server/Manager price-mode transactions for later VAT processing.
-- Schema only: no existing ERP data or app behaviour is changed.

create extension if not exists pgcrypto;

create or replace function public.fairchoice_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.processing_queue (
  id uuid primary key default gen_random_uuid(),

  order_id uuid null,
  order_number text null,
  customer_account_id uuid null,
  customer_branch_id uuid null,
  branch_id uuid null,
  branch_name text null,
  customer_name text null,

  price_mode text not null,
  queue_status text not null default 'queued',
  queue_source text null default 'delivery_confirmation',

  subtotal numeric(12, 2) not null default 0,
  net_total numeric(12, 2) not null default 0,
  vat_total numeric(12, 2) not null default 0,
  grand_total numeric(12, 2) not null default 0,
  total_quantity numeric(12, 2) not null default 0,
  total_lines integer not null default 0,

  transaction_snapshot jsonb not null default '{}'::jsonb,
  line_items jsonb not null default '[]'::jsonb,
  processing_notes text null,
  error_message text null,

  confirmed_at timestamptz null,
  queued_at timestamptz not null default now(),
  processed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  processed_by uuid null
);

alter table public.processing_queue
  add column if not exists order_id uuid,
  add column if not exists order_number text,
  add column if not exists customer_account_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists customer_name text,
  add column if not exists price_mode text not null default 'SERVER',
  add column if not exists queue_status text not null default 'queued',
  add column if not exists queue_source text default 'delivery_confirmation',
  add column if not exists subtotal numeric(12, 2) not null default 0,
  add column if not exists net_total numeric(12, 2) not null default 0,
  add column if not exists vat_total numeric(12, 2) not null default 0,
  add column if not exists grand_total numeric(12, 2) not null default 0,
  add column if not exists total_quantity numeric(12, 2) not null default 0,
  add column if not exists total_lines integer not null default 0,
  add column if not exists transaction_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists processing_notes text,
  add column if not exists error_message text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists queued_at timestamptz not null default now(),
  add column if not exists processed_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists processed_by uuid;

alter table public.processing_queue
  alter column queue_status set default 'queued';

create index if not exists idx_processing_queue_order_id
  on public.processing_queue (order_id);

create index if not exists idx_processing_queue_order_number
  on public.processing_queue (order_number);

create index if not exists idx_processing_queue_customer_account_id
  on public.processing_queue (customer_account_id);

create index if not exists idx_processing_queue_customer_branch_id
  on public.processing_queue (customer_branch_id);

create index if not exists idx_processing_queue_branch_id
  on public.processing_queue (branch_id);

create index if not exists idx_processing_queue_price_mode
  on public.processing_queue (price_mode);

create index if not exists idx_processing_queue_status_queued_at
  on public.processing_queue (queue_status, queued_at);

create index if not exists idx_processing_queue_confirmed_at
  on public.processing_queue (confirmed_at);

create index if not exists idx_processing_queue_processed_at
  on public.processing_queue (processed_at);

create index if not exists idx_processing_queue_transaction_snapshot
  on public.processing_queue using gin (transaction_snapshot);

create index if not exists idx_processing_queue_line_items
  on public.processing_queue using gin (line_items);

create unique index if not exists idx_processing_queue_unique_order_id
  on public.processing_queue (order_id)
  where order_id is not null;

create unique index if not exists idx_processing_queue_unique_order_number
  on public.processing_queue (order_number)
  where order_number is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'processing_queue_price_mode_check'
      and conrelid = 'public.processing_queue'::regclass
  ) then
    alter table public.processing_queue
      add constraint processing_queue_price_mode_check
      check (upper(trim(price_mode)) in ('SERVER', 'MANAGER', 'SERVER OFFER', 'MANAGER OFFER'));
  end if;

  alter table public.processing_queue
    drop constraint if exists processing_queue_status_check;

  alter table public.processing_queue
    add constraint processing_queue_status_check
    check (queue_status in ('queued', 'pending', 'processing', 'processed', 'failed', 'cancelled'));

  if not exists (
    select 1
    from pg_constraint
    where conname = 'processing_queue_totals_nonnegative'
      and conrelid = 'public.processing_queue'::regclass
  ) then
    alter table public.processing_queue
      add constraint processing_queue_totals_nonnegative
      check (
        subtotal >= 0
        and net_total >= 0
        and vat_total >= 0
        and grand_total >= 0
        and total_quantity >= 0
        and total_lines >= 0
      );
  end if;
end;
$$;

drop trigger if exists trg_processing_queue_set_updated_at on public.processing_queue;
create trigger trg_processing_queue_set_updated_at
before update on public.processing_queue
for each row
execute function public.fairchoice_set_updated_at();

-- Guarded NOT VALID relationships for live schemas with compatible key types.
do $$
begin
  if to_regclass('public.orders') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'orders'
        and column_name = 'id'
        and udt_name = 'uuid'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'processing_queue_order_id_fk'
        and conrelid = 'public.processing_queue'::regclass
    ) then
    alter table public.processing_queue
      add constraint processing_queue_order_id_fk
      foreign key (order_id)
      references public.orders(id)
      on delete set null
      not valid;
  end if;

  if to_regclass('public.customer_accounts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_accounts'
        and column_name = 'id'
        and udt_name = 'uuid'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'processing_queue_customer_account_id_fk'
        and conrelid = 'public.processing_queue'::regclass
    ) then
    alter table public.processing_queue
      add constraint processing_queue_customer_account_id_fk
      foreign key (customer_account_id)
      references public.customer_accounts(id)
      on delete set null
      not valid;
  end if;

  if to_regclass('public.customer_branches') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_branches'
        and column_name = 'id'
        and udt_name = 'uuid'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'processing_queue_customer_branch_id_fk'
        and conrelid = 'public.processing_queue'::regclass
    ) then
    alter table public.processing_queue
      add constraint processing_queue_customer_branch_id_fk
      foreign key (customer_branch_id)
      references public.customer_branches(id)
      on delete set null
      not valid;
  end if;
end;
$$;
