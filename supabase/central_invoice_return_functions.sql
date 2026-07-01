-- FairChoice central invoice + return support tables
-- Run this in Supabase SQL editor before using the Return option.

create table if not exists customer_returns (
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
  total_qty numeric default 0,
  net_total numeric default 0,
  vat_total numeric default 0,
  return_total numeric default 0,
  notes text null,
  created_by uuid null,
  created_by_name text null,
  created_by_role text null,
  confirmed_by uuid null,
  confirmed_by_name text null,
  confirmed_at timestamptz null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists customer_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid references customer_returns(id) on delete cascade,
  return_number text not null,
  product_id uuid null,
  product_code text null,
  product_name text not null,
  qty numeric not null default 0,
  unit_price numeric default 0,
  net_total numeric default 0,
  vat_total numeric default 0,
  gross_total numeric default 0,
  reason text not null default 'Other',
  created_at timestamptz default now()
);

create index if not exists idx_customer_returns_order_number on customer_returns(order_number);
create index if not exists idx_customer_returns_customer_name on customer_returns(customer_name);
create index if not exists idx_customer_returns_status on customer_returns(status);
create index if not exists idx_customer_return_items_return_id on customer_return_items(return_id);
