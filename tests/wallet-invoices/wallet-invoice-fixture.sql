alter table customer_invoices add order_id uuid,add wallet_applied_amount numeric not null default 0,
 add amount_to_collect numeric,add wallet_application_mode text,add wallet_preserve_paid_watermark boolean default false;
create table customer_wallet_transactions(id uuid primary key default gen_random_uuid(),customer_account_id uuid not null,
 customer_branch_id uuid,transaction_type text not null,direction text not null check(direction in ('CREDIT','DEBIT')),amount numeric not null check(amount>0),
 source_type text not null,source_id text,invoice_id uuid,order_id uuid,reference text,notes text,created_by text,created_at timestamptz default now(),
 status text default 'ACTIVE',metadata jsonb);
create function fc_customer_wallet_balance_v1(p_customer_account_id uuid) returns numeric language sql as $$
 select coalesce(sum(case when direction='CREDIT' then amount else -amount end),0) from customer_wallet_transactions where customer_account_id=p_customer_account_id and status='ACTIVE'; $$;
create or replace function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text)
returns table(session_id uuid,login_id uuid,login_code text,staff_id uuid,staff_code text,username text,staff_name text,staff_role text,customer_account_id uuid,effective_permissions jsonb)
language plpgsql as $$ begin
 if p_session_token<>'test-session' or p_username not in ('cash_staff','customer','denied_staff') then raise exception 'Permission denied' using errcode='42501'; end if;
 if p_username='customer' and p_permission_key<>'customer.portal.payment' then raise exception 'Permission denied' using errcode='42501'; end if;
 return query select gen_random_uuid(),gen_random_uuid(),'L-1',gen_random_uuid(),'S-1',p_username,'Fixture staff',
 case when p_username='customer' then 'Customer' else 'Admin' end,
 case when p_username='customer' then current_setting('fixture.customer_id')::uuid else null::uuid end,
 case when p_username='cash_staff' then '{"all_access":true}'::jsonb else '{}'::jsonb end;
end; $$;
