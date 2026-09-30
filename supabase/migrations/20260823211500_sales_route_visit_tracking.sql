-- REVIEW ONLY: do not apply until the Sales Route workflow is approved locally.
create extension if not exists pgcrypto;

create table if not exists public.sales_route_assignments (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id),
  customer_branch_id uuid null references public.customer_branches(id),
  assigned_staff_id uuid null references public.staff_users(id),
  day_of_week text not null check (day_of_week in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  visit_sequence integer not null default 1 check (visit_sequence > 0),
  active boolean not null default true,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_route_assignments_day_idx
  on public.sales_route_assignments(day_of_week, active, visit_sequence);
create index if not exists sales_route_assignments_customer_idx
  on public.sales_route_assignments(customer_account_id, customer_branch_id);
create index if not exists sales_route_assignments_staff_idx
  on public.sales_route_assignments(assigned_staff_id, day_of_week) where active is true;

create table if not exists public.sales_route_visits (
  id uuid primary key default gen_random_uuid(),
  route_assignment_id uuid null references public.sales_route_assignments(id),
  customer_account_id uuid not null references public.customer_accounts(id),
  customer_branch_id uuid null references public.customer_branches(id),
  staff_id uuid null references public.staff_users(id),
  staff_name text null,
  business_date date not null default current_date,
  outcome text not null check (outcome in ('ORDER_PLACED','NO_ORDER','VISITED')),
  no_order_reason text null,
  note text null,
  order_number text null,
  visited_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists sales_route_visits_date_idx on public.sales_route_visits(business_date, staff_id);
create index if not exists sales_route_visits_customer_idx on public.sales_route_visits(customer_account_id, business_date desc);
create index if not exists sales_route_visits_route_idx on public.sales_route_visits(route_assignment_id, business_date desc);
create index if not exists sales_route_visits_order_idx on public.sales_route_visits(order_number) where order_number is not null;

-- Access policies / FC session RPCs will be added after the local workflow is approved.
-- Until then the frontend route service intentionally falls back to browser-local test storage
-- when these tables are not installed.
