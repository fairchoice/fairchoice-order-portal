-- Dynamic customer price codes.
-- Exact product/code prices override code percentage calculations.

create table if not exists public.customer_price_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_percent numeric(7,3) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_accounts
  add column if not exists customer_price_code_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customer_accounts_customer_price_code_id_fkey'
  ) then
    alter table public.customer_accounts
      add constraint customer_accounts_customer_price_code_id_fkey
      foreign key (customer_price_code_id)
      references public.customer_price_codes(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.product_price_code_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  price_code_id uuid not null references public.customer_price_codes(id) on delete cascade,
  price numeric(12,2) not null check (price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, price_code_id)
);

create index if not exists idx_customer_accounts_price_code
  on public.customer_accounts(customer_price_code_id);
create index if not exists idx_product_price_code_prices_product
  on public.product_price_code_prices(product_id);
create index if not exists idx_product_price_code_prices_code
  on public.product_price_code_prices(price_code_id);

-- Match the current FairChoice client-access model so these new tables are
-- reachable through supabase-js on the Test project.
grant select, insert, update, delete on table public.customer_price_codes
  to anon, authenticated, service_role;
grant select, insert, update, delete on table public.product_price_code_prices
  to anon, authenticated, service_role;

-- Keep RLS enabled on newly exposed public tables. These policies mirror the
-- current FairChoice client-side access model; application permissions still
-- control who can reach the management screens.
alter table public.customer_price_codes enable row level security;
alter table public.product_price_code_prices enable row level security;

drop policy if exists customer_price_codes_client_select on public.customer_price_codes;
create policy customer_price_codes_client_select
  on public.customer_price_codes for select
  to anon, authenticated
  using (true);

drop policy if exists customer_price_codes_client_insert on public.customer_price_codes;
create policy customer_price_codes_client_insert
  on public.customer_price_codes for insert
  to anon, authenticated
  with check (true);

drop policy if exists customer_price_codes_client_update on public.customer_price_codes;
create policy customer_price_codes_client_update
  on public.customer_price_codes for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists customer_price_codes_client_delete on public.customer_price_codes;
create policy customer_price_codes_client_delete
  on public.customer_price_codes for delete
  to anon, authenticated
  using (true);

drop policy if exists product_price_code_prices_client_select on public.product_price_code_prices;
create policy product_price_code_prices_client_select
  on public.product_price_code_prices for select
  to anon, authenticated
  using (true);

drop policy if exists product_price_code_prices_client_insert on public.product_price_code_prices;
create policy product_price_code_prices_client_insert
  on public.product_price_code_prices for insert
  to anon, authenticated
  with check (true);

drop policy if exists product_price_code_prices_client_update on public.product_price_code_prices;
create policy product_price_code_prices_client_update
  on public.product_price_code_prices for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists product_price_code_prices_client_delete on public.product_price_code_prices;
create policy product_price_code_prices_client_delete
  on public.product_price_code_prices for delete
  to anon, authenticated
  using (true);

notify pgrst, 'reload schema';
