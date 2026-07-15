-- FairChoice financial document setup.
-- Covers return invoices, manual invoices, invoice amendments, and customer credit ledger posting.
-- This migration is idempotent and reuses existing orders, order_items, and customer_ledger tables.

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

-- Manual invoices are stored as delivered orders with normal order_items.
alter table public.orders
  add column if not exists customer_account_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists delivery_branch_name text,
  add column if not exists delivery_address text,
  add column if not exists delivery_postcode text,
  add column if not exists customer_country text,
  add column if not exists price_mode text,
  add column if not exists subtotal numeric(12, 2) default 0,
  add column if not exists net_total numeric(12, 2) default 0,
  add column if not exists vat_total numeric(12, 2) default 0,
  add column if not exists order_total numeric(12, 2) default 0,
  add column if not exists discount_percent numeric(8, 4) default 0,
  add column if not exists discount_amount numeric(12, 2) default 0,
  add column if not exists delivered_at timestamptz,
  add column if not exists notes text,
  add column if not exists invoice_type text default 'STANDARD',
  add column if not exists created_by uuid,
  add column if not exists created_by_name text,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_orders_order_number
  on public.orders (order_number);

create index if not exists idx_orders_customer_account_id
  on public.orders (customer_account_id);

create index if not exists idx_orders_customer_branch_id
  on public.orders (customer_branch_id);

create index if not exists idx_orders_status_created_at
  on public.orders (status, created_at);

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.fairchoice_set_updated_at();

alter table public.order_items
  add column if not exists product_code text,
  add column if not exists brand text,
  add column if not exists series text,
  add column if not exists flavour text,
  add column if not exists carton_size text,
  add column if not exists qty numeric default 0,
  add column if not exists picked_qty numeric default 0,
  add column if not exists price numeric(12, 2) default 0,
  add column if not exists unit_price numeric(12, 2),
  add column if not exists line_total numeric(12, 2) default 0,
  add column if not exists net_total numeric(12, 2) default 0,
  add column if not exists vat_total numeric(12, 2) default 0,
  add column if not exists vat_amount numeric(12, 2) default 0,
  add column if not exists vat_rate numeric(8, 4),
  add column if not exists vat_type text,
  add column if not exists gross_total numeric(12, 2) default 0,
  add column if not exists source_status text default 'In Stock',
  add column if not exists include_in_picking boolean default true,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

create index if not exists idx_order_items_product_id
  on public.order_items (product_id);

create index if not exists idx_order_items_source_status
  on public.order_items (source_status);

drop trigger if exists trg_order_items_set_updated_at on public.order_items;
create trigger trg_order_items_set_updated_at
before update on public.order_items
for each row
execute function public.fairchoice_set_updated_at();

-- Customer ledger is the single accounting source used by back office,
-- customer portal payment history, transactions, outstanding balance, and available credit.
alter table public.customer_ledger
  add column if not exists customer_account_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists entry_type text,
  add column if not exists transaction_type text,
  add column if not exists reference_no text,
  add column if not exists description text,
  add column if not exists debit numeric(12, 2) not null default 0,
  add column if not exists credit numeric(12, 2) not null default 0,
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists payment_amount numeric(12, 2) not null default 0,
  add column if not exists amount_collected numeric(12, 2) not null default 0,
  add column if not exists payment_type text,
  add column if not exists payment_method text,
  add column if not exists payment_applies_to text,
  add column if not exists collection_source text,
  add column if not exists who_paid text,
  add column if not exists paid_by text,
  add column if not exists collected_by uuid,
  add column if not exists collected_by_name text,
  add column if not exists collected_by_username text,
  add column if not exists collected_by_role text,
  add column if not exists received_by text,
  add column if not exists received_by_role text,
  add column if not exists confirmed_by text,
  add column if not exists driver_name text,
  add column if not exists driver_username text,
  add column if not exists driver_role text,
  add column if not exists driver_staff_id uuid,
  add column if not exists order_id uuid,
  add column if not exists order_number text,
  add column if not exists price_mode text,
  add column if not exists order_price_mode text,
  add column if not exists invoice_total numeric(12, 2) not null default 0,
  add column if not exists invoice_amount numeric(12, 2) not null default 0,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists remaining_amount numeric(12, 2) not null default 0,
  add column if not exists invoice_status text,
  add column if not exists delivered_date timestamptz,
  add column if not exists invoice_date timestamptz,
  add column if not exists collection_date date,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_customer_ledger_customer_name
  on public.customer_ledger (customer_name);

create index if not exists idx_customer_ledger_customer_account_id
  on public.customer_ledger (customer_account_id);

create index if not exists idx_customer_ledger_customer_branch_id
  on public.customer_ledger (customer_branch_id);

create index if not exists idx_customer_ledger_branch_id
  on public.customer_ledger (branch_id);

create index if not exists idx_customer_ledger_reference_invoice
  on public.customer_ledger (reference_no, entry_type);

create index if not exists idx_customer_ledger_invoice_allocation
  on public.customer_ledger (customer_name, entry_type, invoice_status, created_at);

create index if not exists idx_customer_ledger_order_number
  on public.customer_ledger (order_number);

create index if not exists idx_customer_ledger_transaction_type
  on public.customer_ledger (transaction_type);

drop trigger if exists trg_customer_ledger_set_updated_at on public.customer_ledger;
create trigger trg_customer_ledger_set_updated_at
before update on public.customer_ledger
for each row
execute function public.fairchoice_set_updated_at();

-- Return invoices / return credits.
create table if not exists public.customer_returns (
  id uuid primary key default gen_random_uuid(),
  return_number text unique not null,
  order_id uuid null,
  order_number text null,
  customer_account_id uuid null,
  customer_branch_id uuid null,
  branch_id uuid null,
  branch_name text null,
  customer_name text not null,
  return_type text not null,
  status text not null default 'Pending Warehouse Confirmation',
  source text null,
  total_qty numeric(12, 2) default 0,
  net_total numeric(12, 2) default 0,
  vat_total numeric(12, 2) default 0,
  return_total numeric(12, 2) default 0,
  notes text null,
  created_by uuid null,
  created_by_name text null,
  created_by_role text null,
  confirmed_by uuid null,
  confirmed_by_name text null,
  confirmed_by_role text null,
  confirmed_at timestamptz null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.customer_returns
  add column if not exists order_id uuid,
  add column if not exists order_number text,
  add column if not exists customer_account_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists source text,
  add column if not exists total_qty numeric(12, 2) default 0,
  add column if not exists net_total numeric(12, 2) default 0,
  add column if not exists vat_total numeric(12, 2) default 0,
  add column if not exists return_total numeric(12, 2) default 0,
  add column if not exists notes text,
  add column if not exists created_by uuid,
  add column if not exists created_by_name text,
  add column if not exists created_by_role text,
  add column if not exists confirmed_by uuid,
  add column if not exists confirmed_by_name text,
  add column if not exists confirmed_by_role text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists updated_at timestamptz default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_returns_status_check'
      and conrelid = 'public.customer_returns'::regclass
  ) then
    alter table public.customer_returns
      add constraint customer_returns_status_check
      check (status in (
        'Pending Warehouse Confirmation',
        'Confirmed',
        'Rejected',
        'Cancelled'
      ));
  end if;
end;
$$;

create index if not exists idx_customer_returns_order_number
  on public.customer_returns (order_number);

create index if not exists idx_customer_returns_customer_account_id
  on public.customer_returns (customer_account_id);

create index if not exists idx_customer_returns_customer_branch_id
  on public.customer_returns (customer_branch_id);

create index if not exists idx_customer_returns_customer_name
  on public.customer_returns (customer_name);

create index if not exists idx_customer_returns_status
  on public.customer_returns (status);

create index if not exists idx_customer_returns_created_at
  on public.customer_returns (created_at);

drop trigger if exists trg_customer_returns_set_updated_at on public.customer_returns;
create trigger trg_customer_returns_set_updated_at
before update on public.customer_returns
for each row
execute function public.fairchoice_set_updated_at();

create table if not exists public.customer_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid references public.customer_returns(id) on delete cascade,
  return_number text not null,
  product_id uuid null,
  product_code text null,
  product_name text not null,
  qty numeric(12, 2) not null default 0,
  unit_price numeric(12, 2) default 0,
  net_total numeric(12, 2) default 0,
  vat_total numeric(12, 2) default 0,
  gross_total numeric(12, 2) default 0,
  vat_rate numeric(8, 4),
  vat_type text,
  reason text not null default 'Other',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.customer_return_items
  add column if not exists product_id uuid,
  add column if not exists product_code text,
  add column if not exists qty numeric(12, 2) not null default 0,
  add column if not exists unit_price numeric(12, 2) default 0,
  add column if not exists net_total numeric(12, 2) default 0,
  add column if not exists vat_total numeric(12, 2) default 0,
  add column if not exists gross_total numeric(12, 2) default 0,
  add column if not exists vat_rate numeric(8, 4),
  add column if not exists vat_type text,
  add column if not exists reason text not null default 'Other',
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_customer_return_items_return_id
  on public.customer_return_items (return_id);

create index if not exists idx_customer_return_items_return_number
  on public.customer_return_items (return_number);

create index if not exists idx_customer_return_items_product_id
  on public.customer_return_items (product_id);

drop trigger if exists trg_customer_return_items_set_updated_at on public.customer_return_items;
create trigger trg_customer_return_items_set_updated_at
before update on public.customer_return_items
for each row
execute function public.fairchoice_set_updated_at();

-- Invoice amendment / version audit history.
create table if not exists public.invoice_version_history (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  invoice_number text,
  version_number bigint not null,
  changed_by text,
  changed_by_id text,
  changed_at timestamptz not null default now(),
  changed_date timestamptz default now(),
  reason text not null,
  previous_total numeric(12, 2) not null default 0,
  new_total numeric(12, 2) not null default 0,
  changed_items jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table public.invoice_version_history
  add column if not exists order_number text,
  add column if not exists invoice_number text,
  add column if not exists version_number bigint,
  add column if not exists changed_by text,
  add column if not exists changed_by_id text,
  add column if not exists changed_at timestamptz default now(),
  add column if not exists changed_date timestamptz default now(),
  add column if not exists reason text,
  add column if not exists previous_total numeric(12, 2) default 0,
  add column if not exists new_total numeric(12, 2) default 0,
  add column if not exists changed_items jsonb default '[]'::jsonb;

update public.invoice_version_history
set
  reason = coalesce(nullif(reason, ''), 'Legacy amendment'),
  order_number = coalesce(nullif(order_number, ''), invoice_number, 'UNKNOWN'),
  version_number = coalesce(version_number, extract(epoch from coalesce(changed_at, changed_date, created_at, now()))::bigint),
  changed_at = coalesce(changed_at, changed_date, created_at, now()),
  changed_date = coalesce(changed_date, changed_at, created_at, now()),
  previous_total = coalesce(previous_total, 0),
  new_total = coalesce(new_total, 0),
  changed_items = coalesce(changed_items, '[]'::jsonb);

alter table public.invoice_version_history
  alter column order_number set not null,
  alter column version_number set not null,
  alter column reason set not null,
  alter column previous_total set default 0,
  alter column previous_total set not null,
  alter column new_total set default 0,
  alter column new_total set not null,
  alter column changed_items set default '[]'::jsonb,
  alter column changed_items set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoice_version_history_reason_required'
      and conrelid = 'public.invoice_version_history'::regclass
  ) then
    alter table public.invoice_version_history
      add constraint invoice_version_history_reason_required
      check (length(trim(reason)) > 0);
  end if;
end;
$$;

create index if not exists idx_invoice_version_history_order_number
  on public.invoice_version_history (order_number);

create index if not exists idx_invoice_version_history_invoice_number
  on public.invoice_version_history (invoice_number);

create index if not exists idx_invoice_version_history_changed_at
  on public.invoice_version_history (changed_at);

create index if not exists idx_invoice_version_history_changed_items
  on public.invoice_version_history using gin (changed_items);

do $$
begin
  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'i'
      and c.relname = 'idx_customer_ledger_unique_invoice_reference'
      and n.nspname = 'public'
  )
  and not exists (
    select 1
    from public.customer_ledger
    where entry_type = 'INVOICE'
      and reference_no is not null
    group by reference_no
    having count(*) > 1
  ) then
    create unique index idx_customer_ledger_unique_invoice_reference
      on public.customer_ledger (reference_no)
      where entry_type = 'INVOICE';
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
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'orders_customer_account_id_fk'
        and conrelid = 'public.orders'::regclass
    ) then
    alter table public.orders
      add constraint orders_customer_account_id_fk
      foreign key (customer_account_id)
      references public.customer_accounts(id)
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
      where conname = 'orders_customer_branch_id_fk'
        and conrelid = 'public.orders'::regclass
    ) then
    alter table public.orders
      add constraint orders_customer_branch_id_fk
      foreign key (customer_branch_id)
      references public.customer_branches(id)
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
      where conname = 'customer_ledger_customer_account_id_fk'
        and conrelid = 'public.customer_ledger'::regclass
    ) then
    alter table public.customer_ledger
      add constraint customer_ledger_customer_account_id_fk
      foreign key (customer_account_id)
      references public.customer_accounts(id)
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
      where conname = 'customer_ledger_customer_branch_id_fk'
        and conrelid = 'public.customer_ledger'::regclass
    ) then
    alter table public.customer_ledger
      add constraint customer_ledger_customer_branch_id_fk
      foreign key (customer_branch_id)
      references public.customer_branches(id)
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
      where conname = 'customer_returns_customer_account_id_fk'
        and conrelid = 'public.customer_returns'::regclass
    ) then
    alter table public.customer_returns
      add constraint customer_returns_customer_account_id_fk
      foreign key (customer_account_id)
      references public.customer_accounts(id)
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
      where conname = 'customer_returns_customer_branch_id_fk'
        and conrelid = 'public.customer_returns'::regclass
    ) then
    alter table public.customer_returns
      add constraint customer_returns_customer_branch_id_fk
      foreign key (customer_branch_id)
      references public.customer_branches(id)
      not valid;
  end if;

  if exists (
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
      where conname = 'customer_returns_order_id_fk'
        and conrelid = 'public.customer_returns'::regclass
    ) then
    alter table public.customer_returns
      add constraint customer_returns_order_id_fk
      foreign key (order_id)
      references public.orders(id)
      not valid;
  end if;

  if to_regclass('public.products') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'products'
        and column_name = 'id'
        and udt_name = 'uuid'
    )
    and not exists (
      select 1
      from pg_constraint
      where conname = 'customer_return_items_product_id_fk'
        and conrelid = 'public.customer_return_items'::regclass
    ) then
    alter table public.customer_return_items
      add constraint customer_return_items_product_id_fk
      foreign key (product_id)
      references public.products(id)
      not valid;
  end if;
end;
$$;
