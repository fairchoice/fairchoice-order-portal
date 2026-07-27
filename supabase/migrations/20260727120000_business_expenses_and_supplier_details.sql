create extension if not exists pgcrypto;

alter table public.suppliers add column if not exists vat_number text;
alter table public.suppliers add column if not exists contact_number text;
alter table public.suppliers add column if not exists contact_person text;

update public.suppliers set contact_number = coalesce(contact_number, phone) where contact_number is null;
update public.suppliers set contact_person = coalesce(contact_person, contact_name) where contact_person is null;

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  supplier_id uuid null references public.suppliers(id) on delete set null,
  invoice_option text not null check (invoice_option in ('Online','Paper','Paid','Credit','Part Paid')),
  payment_type text not null check (payment_type in ('Cash','Bank','Credit','Card')),
  invoice_number text,
  reference text,
  recurrence text not null default 'None' check (recurrence in ('None','Weekly','Monthly')),
  staff_name text,
  notes text,
  status text not null default 'RECORDED',
  created_by text,
  created_by_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on public.expenses(expense_date desc);
create index if not exists expenses_supplier_idx on public.expenses(supplier_id, expense_date desc);
create index if not exists expenses_category_idx on public.expenses(category, expense_date desc);

alter table public.expenses enable row level security;
drop policy if exists expenses_read on public.expenses;
create policy expenses_read on public.expenses for select to anon, authenticated using (true);
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to anon, authenticated with check (true);
grant select, insert on public.expenses to anon, authenticated;
notify pgrst, 'reload schema';
