-- Central Payment / Customer Credit foundation
-- Additive only: this migration does not rename, update, delete, or copy existing production rows.

create extension if not exists pgcrypto;

-- Minimal clean-install prerequisites. Existing production tables are left untouched.
create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  active boolean not null default true,
  credit_limit numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_branches (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  branch_name text not null,
  postcode text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text null,
  customer_account_id uuid null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  branch_id uuid null,
  company_name text null,
  status text null,
  order_total numeric(14,2) not null default 0,
  final_total numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  branch_name text null,
  delivery_branch_name text null,
  shop_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  delivered_at timestamptz null
);

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  order_id uuid null references public.orders(id) on delete restrict,
  invoice_number text not null,
  invoice_date timestamptz not null default now(),
  invoice_total numeric(14,2) not null check (invoice_total >= 0),
  price_mode text null,
  status text not null default 'ISSUED' check (status in ('DRAFT','ISSUED','CANCELLED')),
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_invoices_number_unique unique (invoice_number),
  constraint customer_invoices_order_unique unique (order_id)
);

create index if not exists customer_invoices_customer_date_idx
  on public.customer_invoices (customer_account_id, customer_branch_id, invoice_date desc);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  payment_reference text not null,
  payment_date timestamptz not null default now(),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Cash','Card','Bank Transfer','Cheque','Other')),
  paid_by text null,
  notes text null,
  source text not null default 'CENTRAL_PAYMENT',
  idempotency_key text not null,
  status text not null default 'POSTED' check (status in ('POSTED','VOIDED')),
  void_reason text null,
  voided_by text null,
  voided_at timestamptz null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payments_branch_scope_unique unique (customer_account_id, customer_branch_id, idempotency_key)
);

create index if not exists customer_payments_customer_date_idx
  on public.customer_payments (customer_account_id, customer_branch_id, payment_date desc);

create index if not exists customer_payments_reference_idx
  on public.customer_payments (payment_reference);

create table if not exists public.customer_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.customer_payments(id) on delete restrict,
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  invoice_reference text not null,
  invoice_source_id text null,
  allocated_amount numeric(14,2) not null check (allocated_amount > 0),
  allocation_type text not null default 'automatic' check (allocation_type in ('automatic','manual','specific_invoice','rebuild')),
  status text not null default 'active' check (status in ('active','reversed','void')),
  allocated_at timestamptz not null default now(),
  created_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_payment_allocations_payment_invoice_unique unique (payment_id, invoice_reference)
);

create index if not exists customer_payment_allocations_invoice_idx
  on public.customer_payment_allocations (customer_account_id, customer_branch_id, invoice_reference);

create table if not exists public.customer_branch_opening_balances (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  opening_balance numeric(14,2) not null default 0,
  effective_at timestamptz not null default now(),
  notes text null,
  created_by text null,
  created_at timestamptz not null default now(),
  updated_by text null,
  updated_at timestamptz not null default now(),
  constraint customer_branch_opening_balances_scope_unique unique (customer_account_id, customer_branch_id)
);

create table if not exists public.branch_separation_requests (
  id uuid primary key default gen_random_uuid(),
  source_customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  source_branch_id uuid not null references public.customer_branches(id) on delete restrict,
  destination_customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  reason text not null,
  preview_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'DRAFT' check (status in ('DRAFT','PREVIEWED','CONFIRMED','APPLIED','FAILED','ROLLED_BACK')),
  confirmation_token text null,
  requested_by text null,
  requested_at timestamptz not null default now(),
  confirmed_by text null,
  confirmed_at timestamptz null,
  applied_by text null,
  applied_at timestamptz null,
  error_message text null,
  constraint branch_separation_source_destination_check check (source_customer_account_id <> destination_customer_account_id)
);

create table if not exists public.financial_audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id text null,
  customer_account_id uuid null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  reason text null,
  before_data jsonb null,
  after_data jsonb null,
  changed_by text null,
  changed_at timestamptz not null default now()
);

create index if not exists financial_audit_log_customer_idx
  on public.financial_audit_log (customer_account_id, customer_branch_id, changed_at desc);

alter table public.customer_invoices enable row level security;
alter table public.customer_payments enable row level security;
alter table public.customer_payment_allocations enable row level security;
alter table public.customer_branch_opening_balances enable row level security;
alter table public.branch_separation_requests enable row level security;
alter table public.financial_audit_log enable row level security;

-- Policies are intentionally not added here because the application currently uses its own
-- profile/permission model. Apply environment-specific RLS policies after confirming the
-- authenticated Supabase role and JWT claims used in production.
