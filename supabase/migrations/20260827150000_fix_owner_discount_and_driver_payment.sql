-- Fix Central Payment audited discount allocation created_by type.
-- customer_payment_allocations.created_by is UUID and must receive FC staff_id.

create or replace function public.post_owner_central_discount_v2(
  p_fc_username text,
  p_fc_session_token text,
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_payment_date timestamptz,
  p_amount numeric,
  p_paid_by text,
  p_external_reference text,
  p_notes text,
  p_idempotency_key text,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_invoice public.customer_invoices%rowtype;
  v_allocated numeric;
  v_requested numeric;
  v_reference text;
  v_allocations jsonb := '[]'::jsonb;
  v_seen text[] := array[]::text[];
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_fc_username,
    p_fc_session_token,
    'payments.collect_cash'
  )
  limit 1;

  if lower(trim(coalesce(v_actor.username, ''))) <> 'nisstaj_admin' then
    raise exception 'Only nisstaj_admin can post Central Payment discounts.' using errcode='42501';
  end if;

  if v_actor.staff_id is null then
    raise exception 'The authenticated owner login is not linked to an FC Staff Identity.';
  end if;

  if p_customer_account_id is null then
    raise exception 'Customer account is required.';
  end if;

  if round(coalesce(p_amount,0),2) <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;

  if nullif(trim(coalesce(p_notes,'')),'') is null then
    raise exception 'A detailed discount reason is compulsory.';
  end if;

  if nullif(trim(coalesce(p_idempotency_key,'')),'') is not null then
    select * into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and idempotency_key = p_idempotency_key
      and upper(coalesce(status,'POSTED')) not in
        ('VOID','VOIDED','REVERSED','CANCELLED','CANCELED')
    order by created_at desc
    limit 1;

    if found then
      select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)
      into v_allocations
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
        and lower(coalesce(a.status,'active')) = 'active';

      return jsonb_build_object(
        'duplicate',true,
        'payment',to_jsonb(v_payment),
        'allocations',v_allocations
      );
    end if;
  end if;

  for v_allocation in
    select value
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb))
  loop
    if nullif(trim(coalesce(v_allocation->>'invoiceReference','')),'') is null then
      raise exception 'Invoice allocation reference is required.';
    end if;

    if (v_allocation->>'invoiceReference') = any(v_seen) then
      raise exception 'Duplicate invoice allocation is not permitted.';
    end if;

    v_seen := array_append(v_seen, v_allocation->>'invoiceReference');

    v_requested :=
      round(coalesce((v_allocation->>'allocatedAmount')::numeric,0),2);

    if v_requested <= 0 then
      raise exception 'Allocation amount must be greater than zero.';
    end if;

    select * into v_invoice
    from public.customer_invoices i
    where i.invoice_number = v_allocation->>'invoiceReference'
      and i.customer_account_id = p_customer_account_id
      and i.status <> 'CANCELLED'
    for update;

    if not found then
      raise exception 'Invoice allocation target was not found.';
    end if;

    select coalesce(sum(a.allocated_amount),0)
    into v_allocated
    from public.customer_payment_allocations a
    where a.customer_account_id = p_customer_account_id
      and a.invoice_reference = v_invoice.invoice_number
      and lower(coalesce(a.status,'active')) = 'active';

    if v_requested >
       greatest(0, round(v_invoice.invoice_total - v_allocated,2)) then
      raise exception 'Allocation exceeds the invoice remaining balance.';
    end if;
  end loop;

  v_reference := case
    when nullif(trim(coalesce(p_external_reference,'')),'') is not null
      then trim(p_external_reference)
    else
      'DISC-' ||
      to_char(coalesce(p_payment_date,now()),'YYYYMMDD') ||
      '-' ||
      lpad(nextval('public.central_payment_reference_seq')::text,6,'0')
  end;

  insert into public.customer_payments(
    customer_account_id,
    customer_branch_id,
    payment_reference,
    payment_date,
    amount,
    payment_method,
    paid_by,
    notes,
    source,
    idempotency_key,
    status,
    created_by,
    transaction_type,
    verification_status,
    verified_by,
    verified_at,
    mandatory_reason,
    collector_role
  ) values (
    p_customer_account_id,
    p_customer_branch_id,
    v_reference,
    coalesce(p_payment_date,now()),
    round(p_amount,2),
    'Other',
    coalesce(p_paid_by,''),
    trim(p_notes),
    'CENTRAL_PAYMENT',
    p_idempotency_key,
    'POSTED',
    v_actor.username,
    'DISCOUNT',
    'CONFIRMED',
    v_actor.username,
    now(),
    trim(p_notes),
    'OWNER'
  )
  returning * into v_payment;

  for v_allocation in
    select value
    from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb))
  loop
    insert into public.customer_payment_allocations(
      payment_id,
      customer_account_id,
      customer_branch_id,
      invoice_reference,
      invoice_source_id,
      allocated_amount,
      allocation_type,
      status,
      created_by
    ) values (
      v_payment.id,
      p_customer_account_id,
      coalesce(
        nullif(v_allocation->>'customerBranchId','')::uuid,
        p_customer_branch_id
      ),
      v_allocation->>'invoiceReference',
      nullif(v_allocation->>'invoiceSourceId',''),
      round((v_allocation->>'allocatedAmount')::numeric,2),
      'automatic',
      'active',
      v_actor.staff_id
    );
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb)
  into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id;

  insert into public.financial_audit_log(
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    after_data,
    changed_by
  ) values (
    'OWNER_DISCOUNT_CREATED',
    'customer_payments',
    v_payment.id::text,
    p_customer_account_id,
    p_customer_branch_id,
    trim(p_notes),
    jsonb_build_object(
      'payment',to_jsonb(v_payment),
      'allocations',v_allocations,
      'authorisation','FC_SESSION_V2'
    ),
    v_actor.username
  );

  return jsonb_build_object(
    'duplicate',false,
    'payment',to_jsonb(v_payment),
    'allocations',v_allocations,
    'verification_status','CONFIRMED'
  );
end;
$$;

grant execute on function public.sync_customer_invoice_from_order_v1(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
