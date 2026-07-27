-- Weekly Account cash-expense ledger.
-- Customer payments remain immutable and canonical. Staff expenses are stored
-- separately and only APPROVED rows reduce the staff member's cash holding.

create extension if not exists pgcrypto;

create table if not exists public.staff_cash_expenses (
  id uuid primary key default gen_random_uuid(),
  collector_type text not null check (collector_type in ('Driver', 'Sales Rep')),
  collector_name text not null,
  expense_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  category text not null default 'Other',
  reason text not null,
  reference text null,
  notes text null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'VOIDED')),
  created_by text null,
  approved_by text null,
  approved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_cash_expenses_collector_date_idx
  on public.staff_cash_expenses (collector_type, collector_name, expense_date desc);

create index if not exists staff_cash_expenses_status_idx
  on public.staff_cash_expenses (status, expense_date desc);

alter table public.staff_cash_expenses enable row level security;

-- FairChoice currently authenticates application users through its own login
-- system, while Supabase requests use the configured anon/authenticated client.
-- Match the existing operational tables: allow application clients to read and
-- write, with page-level permission checks controlling access.
drop policy if exists staff_cash_expenses_read on public.staff_cash_expenses;
create policy staff_cash_expenses_read
  on public.staff_cash_expenses for select
  to anon, authenticated
  using (true);

drop policy if exists staff_cash_expenses_insert on public.staff_cash_expenses;
create policy staff_cash_expenses_insert
  on public.staff_cash_expenses for insert
  to anon, authenticated
  with check (true);

drop policy if exists staff_cash_expenses_update on public.staff_cash_expenses;
create policy staff_cash_expenses_update
  on public.staff_cash_expenses for update
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.staff_cash_expenses to anon, authenticated;

comment on table public.staff_cash_expenses is
  'Separate staff expense/pay-out ledger. APPROVED rows reduce Weekly Account cash holding; canonical customer payments are never edited.';
