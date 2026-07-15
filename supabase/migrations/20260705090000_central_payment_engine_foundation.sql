-- FairChoice central payment engine foundation.
-- Idempotent payment/allocation schema only; does not rewrite existing payment data.

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

-- customer_ledger remains the main financial table.
-- Add only payment-engine metadata and invoice status support columns that may be missing.
alter table public.customer_ledger
  add column if not exists payment_reference text,
  add column if not exists payment_method text,
  add column if not exists payment_date timestamptz,
  add column if not exists source text,
  add column if not exists payment_status text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text,
  add column if not exists original_payment_ledger_id bigint,
  add column if not exists original_payment_reference text,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists remaining_amount numeric(12, 2) not null default 0,
  add column if not exists invoice_status text,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_customer_ledger_payment_reference
  on public.customer_ledger (payment_reference);

create index if not exists idx_customer_ledger_payment_date
  on public.customer_ledger (payment_date);

create index if not exists idx_customer_ledger_payment_status
  on public.customer_ledger (payment_status);

create index if not exists idx_customer_ledger_source
  on public.customer_ledger (source);

create index if not exists idx_customer_ledger_invoice_status
  on public.customer_ledger (invoice_status);

create index if not exists idx_customer_ledger_payment_reversal
  on public.customer_ledger (original_payment_ledger_id, payment_status);

drop trigger if exists trg_customer_ledger_set_updated_at on public.customer_ledger;
create trigger trg_customer_ledger_set_updated_at
before update on public.customer_ledger
for each row
execute function public.fairchoice_set_updated_at();

create table if not exists public.customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_ledger_id bigint null,
  invoice_ledger_id bigint null,
  customer_account_id uuid null,
  customer_branch_id uuid null,
  allocated_amount numeric(12, 2) not null default 0,
  allocation_type text not null default 'automatic',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null,
  reversed_at timestamptz null,
  reversed_by uuid null,
  reversal_reason text null
);

alter table public.customer_payment_allocations
  add column if not exists payment_ledger_id bigint,
  add column if not exists invoice_ledger_id bigint,
  add column if not exists customer_account_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists allocated_amount numeric(12, 2) not null default 0,
  add column if not exists allocation_type text not null default 'automatic',
  add column if not exists status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid,
  add column if not exists reversal_reason text;

create index if not exists idx_customer_payment_allocations_payment
  on public.customer_payment_allocations (payment_ledger_id);

create index if not exists idx_customer_payment_allocations_invoice
  on public.customer_payment_allocations (invoice_ledger_id);

create index if not exists idx_customer_payment_allocations_customer_account
  on public.customer_payment_allocations (customer_account_id);

create index if not exists idx_customer_payment_allocations_customer_branch
  on public.customer_payment_allocations (customer_branch_id);

create index if not exists idx_customer_payment_allocations_status
  on public.customer_payment_allocations (status);

create index if not exists idx_customer_payment_allocations_active_invoice
  on public.customer_payment_allocations (invoice_ledger_id, status);

create unique index if not exists idx_customer_payment_allocations_one_active_pair
  on public.customer_payment_allocations (payment_ledger_id, invoice_ledger_id)
  where status = 'active'
    and payment_ledger_id is not null
    and invoice_ledger_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_allocations_amount_nonnegative'
      and conrelid = 'public.customer_payment_allocations'::regclass
  ) then
    alter table public.customer_payment_allocations
      add constraint customer_payment_allocations_amount_nonnegative
      check (allocated_amount >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_allocations_status_check'
      and conrelid = 'public.customer_payment_allocations'::regclass
  ) then
    alter table public.customer_payment_allocations
      add constraint customer_payment_allocations_status_check
      check (status in ('active', 'reversed', 'void'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_allocations_type_check'
      and conrelid = 'public.customer_payment_allocations'::regclass
  ) then
    alter table public.customer_payment_allocations
      add constraint customer_payment_allocations_type_check
      check (allocation_type in ('automatic', 'manual', 'specific_invoice', 'rebuild'));
  end if;
end;
$$;

drop trigger if exists trg_customer_payment_allocations_set_updated_at
  on public.customer_payment_allocations;
create trigger trg_customer_payment_allocations_set_updated_at
before update on public.customer_payment_allocations
for each row
execute function public.fairchoice_set_updated_at();

-- Add NOT VALID foreign keys only when the referenced tables/column types are compatible.
do $$
declare
  ledger_id_type text;
begin
  select data_type
    into ledger_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'customer_ledger'
    and column_name = 'id';

  if ledger_id_type in ('bigint', 'integer') then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'customer_payment_allocations_payment_ledger_fk'
        and conrelid = 'public.customer_payment_allocations'::regclass
    ) then
      alter table public.customer_payment_allocations
        add constraint customer_payment_allocations_payment_ledger_fk
        foreign key (payment_ledger_id)
        references public.customer_ledger(id)
        on delete set null
        not valid;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'customer_payment_allocations_invoice_ledger_fk'
        and conrelid = 'public.customer_payment_allocations'::regclass
    ) then
      alter table public.customer_payment_allocations
        add constraint customer_payment_allocations_invoice_ledger_fk
        foreign key (invoice_ledger_id)
        references public.customer_ledger(id)
        on delete set null
        not valid;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'customer_ledger_original_payment_fk'
        and conrelid = 'public.customer_ledger'::regclass
    ) then
      alter table public.customer_ledger
        add constraint customer_ledger_original_payment_fk
        foreign key (original_payment_ledger_id)
        references public.customer_ledger(id)
        on delete set null
        not valid;
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.customer_accounts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_accounts'
        and column_name = 'id'
        and udt_name = 'uuid'
    ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'customer_payment_allocations_customer_account_fk'
        and conrelid = 'public.customer_payment_allocations'::regclass
    ) then
      alter table public.customer_payment_allocations
        add constraint customer_payment_allocations_customer_account_fk
        foreign key (customer_account_id)
        references public.customer_accounts(id)
        on delete set null
        not valid;
    end if;
  end if;

  if to_regclass('public.customer_branches') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'customer_branches'
        and column_name = 'id'
        and udt_name = 'uuid'
    ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'customer_payment_allocations_customer_branch_fk'
        and conrelid = 'public.customer_payment_allocations'::regclass
    ) then
      alter table public.customer_payment_allocations
        add constraint customer_payment_allocations_customer_branch_fk
        foreign key (customer_branch_id)
        references public.customer_branches(id)
        on delete set null
        not valid;
    end if;
  end if;
end;
$$;
