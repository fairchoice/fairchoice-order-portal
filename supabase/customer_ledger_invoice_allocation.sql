alter table public.customer_ledger
  add column if not exists customer_account_id uuid,
  add column if not exists customer_branch_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists description text,
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists payment_amount numeric(12, 2) not null default 0,
  add column if not exists payment_type text,
  add column if not exists payment_applies_to text,
  add column if not exists collection_source text,
  add column if not exists who_paid text,
  add column if not exists paid_by text,
  add column if not exists collected_by uuid,
  add column if not exists collected_by_name text,
  add column if not exists collected_by_username text,
  add column if not exists collected_by_role text,
  add column if not exists invoice_total numeric(12, 2) not null default 0,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists remaining_amount numeric(12, 2) not null default 0,
  add column if not exists delivered_date timestamptz,
  add column if not exists invoice_date timestamptz;

create index if not exists customer_ledger_invoice_allocation_idx
  on public.customer_ledger (customer_name, entry_type, invoice_status, created_at);
