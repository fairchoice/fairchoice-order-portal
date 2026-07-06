create table if not exists public.invoice_version_history (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  invoice_number text,
  version_number bigint,
  changed_by text,
  changed_by_id text,
  changed_date timestamptz default now(),
  reason text,
  previous_total numeric(12, 2),
  new_total numeric(12, 2),
  changed_items jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

alter table public.invoice_version_history
  add column if not exists changed_items jsonb default '[]'::jsonb;
