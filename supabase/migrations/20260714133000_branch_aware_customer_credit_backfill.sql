-- Branch-aware customer credit cleanup.
-- Only maps rows when customer_account_id and normalized branch name identify
-- exactly one customer_branches row. Ambiguous or blank legacy rows stay
-- account-level and must not be shown in a specific branch view.

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
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_branch_opening_balances_scope_coalesced_idx
  on public.customer_branch_opening_balances (
    customer_account_id,
    coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists customer_branch_opening_balances_branch_idx
  on public.customer_branch_opening_balances (customer_account_id, customer_branch_id);

alter table public.orders
  add column if not exists customer_branch_id uuid null,
  add column if not exists branch_id uuid null;

alter table public.customer_ledger
  add column if not exists customer_account_id uuid null,
  add column if not exists customer_branch_id uuid null,
  add column if not exists branch_id uuid null;

alter table public.customer_payment_allocations
  add column if not exists customer_branch_id uuid null,
  add column if not exists branch_id uuid null;

alter table public.customer_payments
  add column if not exists customer_branch_id uuid null,
  add column if not exists branch_id uuid null;

do $$
begin
  if to_regclass('public.central_payments') is not null then
    alter table public.central_payments
      add column if not exists customer_branch_id uuid null,
      add column if not exists branch_id uuid null;
  end if;
end $$;

with branch_candidates as (
  select
    b.customer_account_id,
    regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g') as normalized_branch_name,
    min(b.id) as customer_branch_id,
    count(*) as match_count
  from public.customer_branches b
  where coalesce(trim(b.branch_name), '') <> ''
  group by b.customer_account_id, regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g')
),
unique_branches as (
  select customer_account_id, normalized_branch_name, customer_branch_id
  from branch_candidates
  where match_count = 1
)
update public.orders o
set
  customer_branch_id = u.customer_branch_id,
  branch_id = coalesce(o.branch_id, u.customer_branch_id)
from unique_branches u
where o.customer_branch_id is null
  and o.customer_account_id = u.customer_account_id
  and regexp_replace(
    lower(trim(coalesce(o.delivery_branch_name, o.branch_name, o.shop_name, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  ) = u.normalized_branch_name;

with branch_candidates as (
  select
    b.customer_account_id,
    regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g') as normalized_branch_name,
    min(b.id) as customer_branch_id,
    count(*) as match_count
  from public.customer_branches b
  where coalesce(trim(b.branch_name), '') <> ''
  group by b.customer_account_id, regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g')
),
unique_branches as (
  select customer_account_id, normalized_branch_name, customer_branch_id
  from branch_candidates
  where match_count = 1
)
update public.customer_ledger l
set
  customer_branch_id = u.customer_branch_id,
  branch_id = coalesce(l.branch_id, u.customer_branch_id)
from unique_branches u
where l.customer_branch_id is null
  and l.customer_account_id = u.customer_account_id
  and regexp_replace(
    lower(trim(coalesce(l.branch_name, l.delivery_branch_name, l.shop_name, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  ) = u.normalized_branch_name;

with branch_candidates as (
  select
    b.customer_account_id,
    regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g') as normalized_branch_name,
    min(b.id) as customer_branch_id,
    count(*) as match_count
  from public.customer_branches b
  where coalesce(trim(b.branch_name), '') <> ''
  group by b.customer_account_id, regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g')
),
unique_branches as (
  select customer_account_id, normalized_branch_name, customer_branch_id
  from branch_candidates
  where match_count = 1
)
update public.customer_payments p
set
  customer_branch_id = u.customer_branch_id,
  branch_id = coalesce(p.branch_id, u.customer_branch_id)
from unique_branches u
where p.customer_branch_id is null
  and p.customer_account_id = u.customer_account_id
  and regexp_replace(
    lower(trim(coalesce(p.branch_name, ''))),
    '[^a-z0-9]+',
    ' ',
    'g'
  ) = u.normalized_branch_name;

update public.customer_payment_allocations a
set
  customer_branch_id = p.customer_branch_id,
  branch_id = coalesce(a.branch_id, p.customer_branch_id)
from public.customer_payments p
where a.payment_id = p.id
  and a.customer_branch_id is null
  and p.customer_branch_id is not null;

update public.customer_payment_allocations a
set
  customer_branch_id = i.customer_branch_id,
  branch_id = coalesce(a.branch_id, i.customer_branch_id)
from public.customer_invoices i
where a.customer_branch_id is null
  and a.customer_account_id = i.customer_account_id
  and a.invoice_reference = i.invoice_number
  and i.customer_branch_id is not null;

do $$
begin
  if to_regclass('public.central_payments') is not null then
    with branch_candidates as (
      select
        b.customer_account_id,
        regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g') as normalized_branch_name,
        min(b.id) as customer_branch_id,
        count(*) as match_count
      from public.customer_branches b
      where coalesce(trim(b.branch_name), '') <> ''
      group by b.customer_account_id, regexp_replace(lower(trim(coalesce(b.branch_name, ''))), '[^a-z0-9]+', ' ', 'g')
    ),
    unique_branches as (
      select customer_account_id, normalized_branch_name, customer_branch_id
      from branch_candidates
      where match_count = 1
    )
    update public.central_payments p
    set
      customer_branch_id = u.customer_branch_id,
      branch_id = coalesce(p.branch_id, u.customer_branch_id)
    from unique_branches u
    where p.customer_branch_id is null
      and p.customer_account_id = u.customer_account_id
      and regexp_replace(
        lower(trim(coalesce(p.branch_name, ''))),
        '[^a-z0-9]+',
        ' ',
        'g'
      ) = u.normalized_branch_name;
  end if;
end $$;
