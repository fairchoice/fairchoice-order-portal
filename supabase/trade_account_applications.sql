create extension if not exists pgcrypto;

create table if not exists trade_account_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text,
  contact_name text,
  phone text,
  email text,
  shop_address text,
  postcode text,
  country text,
  business_type text,
  vat_number text,
  company_number text,
  notes text,
  status text default 'Pending',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists trade_account_applications_status_idx
  on trade_account_applications (status);

create index if not exists trade_account_applications_created_at_idx
  on trade_account_applications (created_at desc);
