-- Owner-only Central Payment deletion and duplicate protection.
-- Additive only: payments are soft-deleted/voided, never physically removed.

alter table public.customer_payments
  add column if not exists status text not null default 'POSTED',
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by text null;

alter table public.customer_payment_allocations
  add column if not exists status text not null default 'active',
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by text null;

alter table public.customer_ledger
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by text null;

create or replace function public.delete_owner_central_payment(
  p_owner_username text,
  p_owner_password text,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
  v_voided_allocations jsonb := '[]'::jsonb;
  v_voided_ledger_rows jsonb := '[]'::jsonb;
begin
  if lower(trim(p_owner_username)) <> 'nisstaj_admin'
     or not public.verify_owner_financial_password(p_owner_username, p_owner_password) then
    raise exception 'Owner authorisation failed.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Deletion reason is required.';
  end if;

  select *
    into v_before
  from public.customer_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment does not exist.';
  end if;

  if upper(coalesce(v_before.status, 'POSTED')) in ('VOIDED', 'DELETED') then
    return jsonb_build_object('payment', to_jsonb(v_before), 'already_deleted', true);
  end if;

  update public.customer_payments
     set status = 'VOIDED',
         verification_status = case
           when verification_status is not null then 'VOIDED'
           else verification_status
         end,
         void_reason = trim(p_reason),
         voided_at = now(),
         voided_by = 'nisstaj_admin',
         updated_at = now()
   where id = p_payment_id
   returning * into v_after;

  update public.customer_payment_allocations
     set status = 'void',
         void_reason = trim(p_reason),
         voided_at = now(),
         voided_by = 'nisstaj_admin',
         updated_at = now()
   where payment_id = p_payment_id
     and lower(coalesce(status, 'active')) not in ('void', 'voided', 'reversed', 'cancelled', 'canceled')
  ;

  with updated_ledger as (
    update public.customer_ledger
       set payment_status = 'VOIDED',
           void_reason = trim(p_reason),
           voided_at = now(),
           voided_by = 'nisstaj_admin',
           updated_at = now()
     where upper(coalesce(entry_type, transaction_type, '')) = 'PAYMENT'
       and coalesce(payment_status, '') <> 'VOIDED'
       and (
         payment_reference = v_before.payment_reference
         or reference_no = v_before.payment_reference
       )
       and (
         customer_account_id = v_before.customer_account_id
         or customer_account_id is null
       )
       and (
         v_before.customer_branch_id is null
         or customer_branch_id = v_before.customer_branch_id
         or customer_branch_id is null
       )
     returning *
  )
  select coalesce(jsonb_agg(to_jsonb(updated_ledger)), '[]'::jsonb)
    into v_voided_ledger_rows
  from updated_ledger;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_voided_allocations
  from public.customer_payment_allocations a
  where a.payment_id = p_payment_id
    and lower(coalesce(a.status, '')) in ('void', 'voided');

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
    'OWNER_PAYMENT_DELETED',
    'customer_payments',
    p_payment_id::text,
    v_before.customer_account_id,
    v_before.customer_branch_id,
    trim(p_reason),
    to_jsonb(v_before),
    jsonb_build_object(
      'payment', to_jsonb(v_after),
      'allocations', v_voided_allocations,
      'legacy_ledger_rows', v_voided_ledger_rows
    ),
    'nisstaj_admin'
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_after),
    'voided_allocations', v_voided_allocations,
    'voided_legacy_ledger_rows', v_voided_ledger_rows
  );
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

  select *
    into v_payment
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and idempotency_key = p_idempotency_key
    and upper(coalesce(status, 'POSTED')) not in ('VOIDED', 'DELETED')
  order by created_at asc
  limit 1;

  if found then
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      into v_allocations
    from public.customer_payment_allocations a
    where a.payment_id = v_payment.id
      and lower(coalesce(a.status, 'active')) not in ('void', 'voided', 'reversed', 'cancelled', 'canceled');

    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_payment),
      'allocations', v_allocations,
      'verification_status', v_payment.verification_status
    );
  end if;

  v_status := case when upper(p_transaction_type)='PAYMENT' and p_payment_method='Bank Transfer' then 'PENDING_VERIFICATION' else 'CONFIRMED' end;
  v_reference := case when nullif(trim(coalesce(p_external_reference,'')),'') is not null then trim(p_external_reference)
    else 'PAY-'||to_char(coalesce(p_payment_date,now()),'YYYYMMDD')||'-'||lpad(nextval('public.central_payment_reference_seq')::text,6,'0') end;

  insert into public.customer_payments(
    customer_account_id,customer_branch_id,payment_reference,payment_date,amount,payment_method,paid_by,notes,
    source,idempotency_key,status,created_by,transaction_type,verification_status,verified_by,verified_at,mandatory_reason,collector_role
  ) values (
    p_customer_account_id,p_customer_branch_id,v_reference,coalesce(p_payment_date,now()),p_amount,
    case when upper(p_transaction_type)='DISCOUNT' then 'Other' else p_payment_method end,
    p_paid_by,p_notes,'CENTRAL_PAYMENT',p_idempotency_key,'POSTED',
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

exception
  when unique_violation then
    select *
      into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and idempotency_key = p_idempotency_key
      and upper(coalesce(status, 'POSTED')) not in ('VOIDED', 'DELETED')
    order by created_at asc
    limit 1;

    if not found then
      raise;
    end if;

    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      into v_allocations
    from public.customer_payment_allocations a
    where a.payment_id = v_payment.id
      and lower(coalesce(a.status, 'active')) not in ('void', 'voided', 'reversed', 'cancelled', 'canceled');

    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_payment),
      'allocations', v_allocations,
      'verification_status', v_payment.verification_status
    );
end;
$$;

revoke all on function public.delete_owner_central_payment(text,text,uuid,text) from public;
grant execute on function public.delete_owner_central_payment(text,text,uuid,text) to anon, authenticated;

revoke all on function public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb) from public;
grant execute on function public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb) to anon, authenticated;
