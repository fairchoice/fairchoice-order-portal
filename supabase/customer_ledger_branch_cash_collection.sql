alter table customer_ledger
add column if not exists customer_id uuid null,
add column if not exists branch_id uuid null,
add column if not exists customer_branch_id uuid null,
add column if not exists branch_name text null,
add column if not exists amount_collected numeric(10,2) default 0,
add column if not exists payment_method text null,
add column if not exists collection_date date null;

create index if not exists idx_customer_ledger_customer_branch_id
on customer_ledger (customer_branch_id);

create index if not exists idx_customer_ledger_branch_id
on customer_ledger (branch_id);
