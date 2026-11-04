create role anon;
create role authenticated;
create table customer_accounts(id uuid primary key);
create table customer_branches(id uuid primary key,customer_account_id uuid);
create table customer_invoices(id uuid primary key,customer_account_id uuid,customer_branch_id uuid,invoice_number text unique,invoice_date timestamptz default now()-interval '1 day',invoice_total numeric,status text default 'ISSUED',financial_status text default 'ACTIVE',updated_at timestamptz default now());
create table customer_payments(id uuid primary key default gen_random_uuid(),customer_account_id uuid,customer_branch_id uuid,payment_reference text,payment_date timestamptz default now(),created_at timestamptz default now(),amount numeric,source text,status text default 'POSTED',verification_status text default 'CONFIRMED',voided_at timestamptz,metadata jsonb default '{}');
create table customer_payment_allocations(id uuid primary key default gen_random_uuid(),payment_id uuid,customer_account_id uuid,customer_branch_id uuid,invoice_reference text,invoice_source_id text,allocated_amount numeric,allocation_type text,status text default 'active',created_by uuid,allocated_at timestamptz default now(),reversed_at timestamptz,voided_at timestamptz);
create table central_payment_archive(payment_id uuid);
create table central_payment_balances(scope_key text,customer_account_id uuid,customer_branch_id uuid,opening_balance numeric,invoice_total numeric,payment_total numeric,outstanding_balance numeric,recalculated_at timestamptz);
create table customer_branch_opening_balances(customer_account_id uuid,customer_branch_id uuid,opening_balance numeric);
create table customer_ledger(id uuid primary key default gen_random_uuid(),customer_account_id uuid,customer_branch_id uuid,entry_type text,reference_no text,paid_amount numeric default 0,remaining_amount numeric,invoice_status text default 'UNPAID');
create table financial_audit_log(action text,entity_type text,entity_id text,customer_account_id uuid,customer_branch_id uuid,reason text,before_data jsonb,after_data jsonb,changed_by text);
create table fixture_canonical_calls(id serial);
create function fc_require_session_permission_v2(p_username text,p_session_token text,p_permission_key text)
returns table(session_id uuid,login_id uuid,login_code text,staff_id uuid,staff_code text,username text,staff_name text,staff_role text,customer_account_id uuid,effective_permissions jsonb)
language plpgsql as $$ begin
 if p_username<>'cash_staff' or p_session_token<>'test-session' then raise exception 'Permission denied' using errcode='42501'; end if;
 return query select gen_random_uuid(),gen_random_uuid(),'L-1',gen_random_uuid(),'S-1',p_username,'Staff','Sales Rep',null::uuid,'{}'::jsonb;
end; $$;
create function fc_validate_driver_today_invoice_allocation_v1(uuid,boolean) returns void language sql as $$ select; $$;
-- Fixture adapter for the existing canonical writer: only the new wrapper and
-- production FIFO replacement are under test here; no hosted project is used.
create function post_canonical_customer_payment_v2(
 p_customer_account_id uuid,p_customer_branch_id uuid,p_amount numeric,p_payment_date timestamptz,p_payment_method text,p_payment_source text,p_payment_reference text,p_paid_by text,p_order_id uuid,p_invoice_id uuid,p_idempotency_key text,p_notes text,p_metadata jsonb,p_allocations jsonb,p_fc_username text,p_fc_session_token text)
returns jsonb language plpgsql as $$ declare v_payment customer_payments%rowtype; v_item jsonb; begin
 if p_payment_method='FAIL' then raise exception 'Fixture writer failure'; end if;
 insert into fixture_canonical_calls default values;
 insert into customer_payments(customer_account_id,customer_branch_id,amount,payment_date,payment_reference,source,metadata,verification_status)
 values(p_customer_account_id,p_customer_branch_id,p_amount,p_payment_date,p_payment_reference,p_payment_source,p_metadata,
 case when p_payment_method='Bank Transfer' then 'PENDING_VERIFICATION' else 'CONFIRMED' end) returning * into v_payment;
 for v_item in select value from jsonb_array_elements(p_allocations) loop
 insert into customer_payment_allocations(payment_id,customer_account_id,customer_branch_id,invoice_reference,invoice_source_id,allocated_amount,allocation_type)
 values(v_payment.id,p_customer_account_id,p_customer_branch_id,v_item->>'invoiceReference',v_item->>'invoiceSourceId',(v_item->>'allocatedAmount')::numeric,'automatic');
 end loop;
 perform recalculate_central_payment_fifo(p_customer_account_id);
 return jsonb_build_object('duplicate',false,'payment',to_jsonb(v_payment));
end; $$;
