-- Owner-controlled Central Payment security and transaction workflow.
-- ADDITIVE ONLY. This script does not update, delete, seed or rewrite existing business rows.
-- Review before applying to production.

create extension if not exists pgcrypto;

create table if not exists public.owner_financial_security (
  username text primary key,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz null,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint owner_financial_security_username_check check (username = 'nisstaj_admin')
);

alter table public.owner_financial_security enable row level security;
-- No direct table policy is created. Access is only through SECURITY DEFINER functions.

alter table public.customer_payments
  add column if not exists transaction_type text not null default 'PAYMENT',
  add column if not exists verification_status text not null default 'CONFIRMED',
  add column if not exists verified_by text null,
  add column if not exists verified_at timestamptz null,
  add column if not exists mandatory_reason text null,
  add column if not exists collector_role text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customer_payments_transaction_type_check'
  ) then
    alter table public.customer_payments add constraint customer_payments_transaction_type_check
      check (transaction_type in ('PAYMENT','DISCOUNT'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'customer_payments_verification_status_check'
  ) then
    alter table public.customer_payments add constraint customer_payments_verification_status_check
      check (verification_status in ('PENDING_VERIFICATION','CONFIRMED','REJECTED','VOIDED'));
  end if;
end $$;

create sequence if not exists public.central_payment_reference_seq;

create or replace function public.owner_financial_security_status(p_username text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'configured', exists(select 1 from public.owner_financial_security where username = lower(trim(p_username))),
    'locked_until', (select locked_until from public.owner_financial_security where username = lower(trim(p_username)))
  );
$$;

create or replace function public.setup_owner_financial_password(
  p_username text,
  p_current_login_password text,
  p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(trim(p_username)) <> 'nisstaj_admin' then raise exception 'Owner username is invalid.' using errcode='42501'; end if;
  if length(coalesce(p_new_password,'')) < 12 then raise exception 'New password is too short.'; end if;
  if exists(select 1 from public.owner_financial_security where username='nisstaj_admin') then
    raise exception 'Owner financial password is already configured.' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.login_users
    where lower(trim(username))='nisstaj_admin'
      and password = p_current_login_password
      and coalesce(active,true)=true
  ) then
    raise exception 'Current login password is incorrect.' using errcode='42501';
  end if;
  insert into public.owner_financial_security(username,password_hash)
  values ('nisstaj_admin', crypt(p_new_password, gen_salt('bf', 12)));
  insert into public.financial_audit_log(action,entity_type,entity_id,reason,after_data,changed_by)
  values ('OWNER_FINANCIAL_PASSWORD_CONFIGURED','owner_financial_security','nisstaj_admin','Initial secure owner password setup',jsonb_build_object('password_changed_at',now()),'nisstaj_admin');
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.verify_owner_financial_password(p_username text,p_password text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.owner_financial_security%rowtype;
begin
  select * into v_row from public.owner_financial_security where username=lower(trim(p_username)) for update;
  if not found then return false; end if;
  if v_row.locked_until is not null and v_row.locked_until > now() then raise exception 'Owner financial access is temporarily locked.' using errcode='42501'; end if;
  if v_row.password_hash = crypt(p_password,v_row.password_hash) then
    update public.owner_financial_security set failed_attempts=0,locked_until=null,updated_at=now() where username=v_row.username;
    return true;
  end if;
  update public.owner_financial_security
  set failed_attempts=failed_attempts+1,
      locked_until=case when failed_attempts+1>=5 then now()+interval '15 minutes' else locked_until end,
      updated_at=now()
  where username=v_row.username;
  return false;
end;
$$;

create or replace function public.change_owner_financial_password(
  p_username text,p_current_password text,p_new_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.verify_owner_financial_password(p_username,p_current_password) then raise exception 'Current owner password is incorrect.' using errcode='42501'; end if;
  if length(coalesce(p_new_password,'')) < 12 then raise exception 'New password is too short.'; end if;
  update public.owner_financial_security set password_hash=crypt(p_new_password,gen_salt('bf',12)),password_changed_at=now(),updated_at=now() where username='nisstaj_admin';
  insert into public.financial_audit_log(action,entity_type,entity_id,reason,after_data,changed_by)
  values ('OWNER_FINANCIAL_PASSWORD_CHANGED','owner_financial_security','nisstaj_admin','Owner changed secure financial password',jsonb_build_object('password_changed_at',now()),'nisstaj_admin');
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.post_owner_central_transaction(
  p_owner_username text,
  p_owner_password text,
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_transaction_type text,
  p_payment_date timestamptz,
  p_amount numeric,
  p_payment_method text,
  p_paid_by text,
  p_external_reference text,
  p_notes text,
  p_idempotency_key text,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_status text;
  v_reference text;
  v_allocations jsonb := '[]'::jsonb;
begin
  if lower(trim(p_owner_username)) <> 'nisstaj_admin' or not public.verify_owner_financial_password(p_owner_username,p_owner_password) then
    raise exception 'Owner authorisation failed.' using errcode='42501';
  end if;
  if p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if upper(p_transaction_type) not in ('PAYMENT','DISCOUNT') then raise exception 'Invalid transaction type.'; end if;
  if upper(p_transaction_type)='DISCOUNT' and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'A detailed discount reason is compulsory.'; end if;

  v_status := case when upper(p_transaction_type)='PAYMENT' and p_payment_method='Bank Transfer' then 'PENDING_VERIFICATION' else 'CONFIRMED' end;
  v_reference := case when nullif(trim(coalesce(p_external_reference,'')),'') is not null then trim(p_external_reference)
    else 'PAY-'||to_char(coalesce(p_payment_date,now()),'YYYYMMDD')||'-'||lpad(nextval('public.central_payment_reference_seq')::text,6,'0') end;

  insert into public.customer_payments(
    customer_account_id,customer_branch_id,payment_reference,payment_date,amount,payment_method,paid_by,notes,
    source,idempotency_key,status,created_by,transaction_type,verification_status,verified_by,verified_at,mandatory_reason,collector_role
  ) values (
    p_customer_account_id,p_customer_branch_id,v_reference,coalesce(p_payment_date,now()),p_amount,
    case when upper(p_transaction_type)='DISCOUNT' then 'Other' else p_payment_method end,
    p_paid_by,p_notes,'CENTRAL_PAYMENT',p_idempotency_key,
    case when v_status='CONFIRMED' then 'POSTED' else 'POSTED' end,
    'nisstaj_admin',upper(p_transaction_type),v_status,
    case when v_status='CONFIRMED' then 'nisstaj_admin' else null end,
    case when v_status='CONFIRMED' then now() else null end,
    case when upper(p_transaction_type)='DISCOUNT' then p_notes else null end,
    'OWNER'
  ) returning * into v_payment;

  if v_status='CONFIRMED' then
    for v_allocation in select value from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) loop
      insert into public.customer_payment_allocations(payment_id,customer_account_id,customer_branch_id,invoice_reference,invoice_source_id,allocated_amount,allocation_type,status,created_by)
      values(v_payment.id,p_customer_account_id,coalesce(nullif(v_allocation->>'customerBranchId','')::uuid,p_customer_branch_id),v_allocation->>'invoiceReference',v_allocation->>'invoiceSourceId',(v_allocation->>'allocatedAmount')::numeric,'automatic','active','nisstaj_admin');
    end loop;
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into v_allocations from public.customer_payment_allocations a where a.payment_id=v_payment.id;
  insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,after_data,changed_by)
  values(case when upper(p_transaction_type)='DISCOUNT' then 'OWNER_DISCOUNT_CREATED' when v_status='PENDING_VERIFICATION' then 'BANK_TRANSFER_RECORDED_PENDING' else 'OWNER_PAYMENT_POSTED' end,
    'customer_payments',v_payment.id::text,p_customer_account_id,p_customer_branch_id,p_notes,jsonb_build_object('payment',to_jsonb(v_payment),'allocations',v_allocations),'nisstaj_admin');
  return jsonb_build_object('duplicate',false,'payment',to_jsonb(v_payment),'allocations',v_allocations,'verification_status',v_status);
end;
$$;

create or replace function public.confirm_owner_bank_transfer(
  p_owner_username text,
  p_owner_password text,
  p_payment_id uuid,
  p_note text,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
  v_allocation jsonb;
  v_inserted_allocations jsonb := '[]'::jsonb;
begin
  if lower(trim(p_owner_username)) <> 'nisstaj_admin'
     or not public.verify_owner_financial_password(p_owner_username, p_owner_password) then
    raise exception 'Owner authorisation failed.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Bank confirmation note is compulsory.';
  end if;

  select *
    into v_before
  from public.customer_payments
  where id = p_payment_id
    and payment_method = 'Bank Transfer'
  for update;

  if not found then
    raise exception 'Pending bank transfer was not found.';
  end if;

  if v_before.verification_status <> 'PENDING_VERIFICATION' then
    raise exception 'Bank transfer is not pending verification.';
  end if;

  update public.customer_payments
  set verification_status = 'CONFIRMED',
      verified_by = 'nisstaj_admin',
      verified_at = now(),
      updated_at = now(),
      notes = concat_ws(E'
', notes, 'Bank confirmation: ' || trim(p_note))
  where id = p_payment_id
  returning * into v_after;

  for v_allocation in
    select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    insert into public.customer_payment_allocations (
      payment_id,
      customer_account_id,
      customer_branch_id,
      invoice_reference,
      invoice_source_id,
      allocated_amount,
      allocation_type,
      status,
      created_by
    )
    values (
      v_after.id,
      v_after.customer_account_id,
      coalesce(
        nullif(v_allocation->>'customerBranchId', '')::uuid,
        v_after.customer_branch_id
      ),
      v_allocation->>'invoiceReference',
      v_allocation->>'invoiceSourceId',
      (v_allocation->>'allocatedAmount')::numeric,
      'automatic',
      'active',
      'nisstaj_admin'
    )
    on conflict (payment_id, invoice_reference) do nothing;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(allocation)), '[]'::jsonb)
    into v_inserted_allocations
  from public.customer_payment_allocations allocation
  where allocation.payment_id = v_after.id;

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    before_data,
    after_data,
    changed_by
  )
  values (
    'BANK_TRANSFER_CONFIRMED',
    'customer_payments',
    p_payment_id::text,
    v_after.customer_account_id,
    v_after.customer_branch_id,
    trim(p_note),
    to_jsonb(v_before),
    jsonb_build_object(
      'payment', to_jsonb(v_after),
      'allocations', v_inserted_allocations
    ),
    'nisstaj_admin'
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_after),
    'allocations', v_inserted_allocations
  );
end;
$$;

revoke all on table public.owner_financial_security from public, anon, authenticated;
revoke all on function public.setup_owner_financial_password(text,text,text) from public;
revoke all on function public.change_owner_financial_password(text,text,text) from public;
revoke all on function public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb) from public;
revoke all on function public.confirm_owner_bank_transfer(text,text,uuid,text,jsonb) from public;
revoke all on function public.owner_financial_security_status(text) from public;
grant execute on function public.setup_owner_financial_password(text,text,text) to anon, authenticated;
grant execute on function public.change_owner_financial_password(text,text,text) to anon, authenticated;
grant execute on function public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.confirm_owner_bank_transfer(text,text,uuid,text,jsonb) to anon, authenticated;
grant execute on function public.owner_financial_security_status(text) to anon, authenticated;
