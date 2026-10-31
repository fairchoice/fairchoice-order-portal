create role anon;
create role authenticated;
create table customer_accounts(id uuid primary key default gen_random_uuid(),account_name text not null);
create table customer_branches(id uuid primary key default gen_random_uuid(),customer_account_id uuid references customer_accounts,branch_name text);
create table orders(id uuid primary key,customer_account_id uuid references customer_accounts,customer_branch_id uuid,branch_id uuid);
create table customer_returns(id uuid primary key default gen_random_uuid(),return_number text not null unique,
 order_id uuid references orders,order_number text,customer_account_id uuid references customer_accounts,customer_branch_id uuid,branch_id uuid,branch_name text,
 customer_name text not null,status text not null default 'Pending Warehouse Confirmation',return_total numeric,
 financial_disposition text,approval_note text,ledger_transaction_id uuid,reversal_ledger_transaction_id uuid,
 confirmed_by uuid,confirmed_by_name text,confirmed_by_role text,confirmed_at timestamptz,
 reversed_by uuid,reversed_by_name text,reversed_at timestamptz,reversal_reason text,updated_at timestamptz);
create table financial_transactions(id uuid primary key default gen_random_uuid(),source_type text,source_id text,transaction_type text,
 customer_account_id uuid references customer_accounts,customer_branch_id uuid,transaction_date timestamptz,amount numeric,
 debit_amount numeric,credit_amount numeric,reference text,description text,staff_id uuid,staff_name text,status text,metadata jsonb,created_by text,
 unique(source_type,source_id),check(amount>=0 and debit_amount>=0 and credit_amount>=0));
create table customer_ledger(id bigserial primary key,customer_name text not null,entry_type text not null,reference_no text,debit numeric default 0,credit numeric default 0,
 notes text,confirmed_by text,customer_account_id uuid references customer_accounts,customer_branch_id uuid,branch_id uuid,branch_name text,description text,amount numeric,
 order_number text,price_mode text,source text,transaction_type text,financial_status text);
create table customer_wallet_transactions(id uuid primary key default gen_random_uuid(),customer_account_id uuid not null references customer_accounts,
 customer_branch_id uuid references customer_branches,transaction_type text not null,direction text not null check(direction in ('CREDIT','DEBIT')),amount numeric not null check(amount>0),
 source_type text not null,source_id text,return_id uuid references customer_returns,order_id uuid references orders,reference text,notes text,
 status text not null default 'ACTIVE' check(status in ('ACTIVE','VOID')),created_by text,metadata jsonb default '{}');
create unique index customer_wallet_unique_source_txn on customer_wallet_transactions(source_type,source_id,transaction_type) where source_id is not null and status='ACTIVE';
create table financial_audit_log(action text,entity_type text,entity_id text,customer_account_id uuid,customer_branch_id uuid,reason text,before_data jsonb,after_data jsonb,changed_by text);
create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text)
returns table(username text,staff_id uuid,staff_name text,staff_role text) language plpgsql as $$ begin
 if p_session_token<>'test-session' or p_username not in ('admin','warehouse') then raise exception 'Permission denied' using errcode='42501'; end if;
 return query select p_username,'10000000-0000-4000-8000-000000000001'::uuid,'Test staff',p_username;
end; $$;
create function fc_customer_wallet_balance_v1(p_customer_account_id uuid) returns numeric language sql as $$
 select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0) from customer_wallet_transactions
 where customer_account_id=p_customer_account_id and status='ACTIVE'; $$;
