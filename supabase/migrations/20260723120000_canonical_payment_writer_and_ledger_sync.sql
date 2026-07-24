-- Canonical FairChoice payment writer and one-way Payment Ledger synchronisation.
-- Forward-only schema/function change. This migration does not backfill business data.

create extension if not exists pgcrypto;

alter table public.customer_payments
  add column if not exists collector_staff_id uuid null,
  add column if not exists collector_name text null,
  add column if not exists order_id uuid null references public.orders(id) on delete restrict,
  add column if not exists invoice_id uuid null references public.customer_invoices(id) on delete restrict,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.customer_ledger
  add column if not exists central_payment_id uuid null;

create unique index if not exists customer_ledger_canonical_payment_unique_idx
  on public.customer_ledger (central_payment_id)
  where central_payment_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_ledger_central_payment_fk'
      and conrelid = 'public.customer_ledger'::regclass
  ) then
    alter table public.customer_ledger
      add constraint customer_ledger_central_payment_fk
      foreign key (central_payment_id)
      references public.customer_payments(id)
      on delete restrict
      not valid;
  end if;
end
$$;

create or replace function public.sync_canonical_payment_to_customer_ledger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_name text;
  v_branch_name text;
  v_payment_status text;
  v_collection_source text;
begin
  if upper(coalesce(new.transaction_type, 'PAYMENT')) <> 'PAYMENT' then
    return new;
  end if;

  -- A historical payment already has its original ledger row. Link that row
  -- here so the canonical insert cannot create a second ledger payment.
  if coalesce(new.metadata->>'legacy_source', '') = 'customer_ledger' then
    update public.customer_ledger
    set central_payment_id = new.id,
        updated_at = now()
    where id = nullif(new.metadata->>'legacy_source_id', '')::bigint
      and upper(coalesce(
        nullif(trim(entry_type), ''),
        nullif(trim(transaction_type), ''),
        ''
      )) = 'PAYMENT'
      and central_payment_id is null;

    if not found then
      raise exception
        'Legacy customer_ledger payment % could not be linked safely.',
        new.metadata->>'legacy_source_id';
    end if;
    return new;
  end if;

  select account_name
    into v_account_name
  from public.customer_accounts
  where id = new.customer_account_id;

  if new.customer_branch_id is not null then
    select branch_name
      into v_branch_name
    from public.customer_branches
    where id = new.customer_branch_id
      and customer_account_id = new.customer_account_id;
  end if;

  v_payment_status := case
    when upper(coalesce(new.status, 'POSTED')) in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE')
      then upper(new.status)
    when upper(coalesce(new.verification_status, 'CONFIRMED')) in ('PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED')
      then upper(new.verification_status)
    else 'POSTED'
  end;
  v_collection_source := upper(coalesce(nullif(trim(new.source), ''), 'CENTRAL_PAYMENT'));

  insert into public.customer_ledger (
    central_payment_id,
    customer_account_id,
    customer_id,
    customer_branch_id,
    branch_id,
    customer_name,
    branch_name,
    entry_type,
    transaction_type,
    description,
    reference_no,
    payment_reference,
    order_id,
    order_number,
    debit,
    credit,
    amount,
    payment_amount,
    payment_type,
    payment_method,
    payment_applies_to,
    collection_source,
    source,
    paid_by,
    who_paid,
    received_by,
    received_by_staff_id,
    received_by_role,
    collected_by,
    collected_by_name,
    collected_by_role,
    notes,
    payment_date,
    collection_date,
    payment_status,
    void_reason,
    voided_at,
    voided_by,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.customer_account_id,
    new.customer_account_id,
    new.customer_branch_id,
    new.customer_branch_id,
    v_account_name,
    v_branch_name,
    'PAYMENT',
    'PAYMENT',
    'Payment',
    new.payment_reference,
    new.payment_reference,
    new.order_id,
    coalesce(new.order_id::text, new.payment_reference),
    0,
    new.amount,
    new.amount,
    new.amount,
    new.payment_method,
    new.payment_method,
    v_collection_source,
    v_collection_source,
    v_collection_source,
    new.paid_by,
    new.paid_by,
    coalesce(new.collector_name, new.created_by),
    new.collector_staff_id,
    new.collector_role,
    new.collector_staff_id,
    new.collector_name,
    new.collector_role,
    new.notes,
    new.payment_date,
    new.payment_date,
    v_payment_status,
    new.void_reason,
    new.voided_at,
    new.voided_by,
    new.created_at,
    new.updated_at
  )
  on conflict (central_payment_id) where central_payment_id is not null
  do update set
    customer_account_id = excluded.customer_account_id,
    customer_id = excluded.customer_id,
    customer_branch_id = excluded.customer_branch_id,
    branch_id = excluded.branch_id,
    customer_name = excluded.customer_name,
    branch_name = excluded.branch_name,
    reference_no = excluded.reference_no,
    payment_reference = excluded.payment_reference,
    order_id = excluded.order_id,
    order_number = excluded.order_number,
    credit = excluded.credit,
    amount = excluded.amount,
    payment_amount = excluded.payment_amount,
    payment_type = excluded.payment_type,
    payment_method = excluded.payment_method,
    payment_applies_to = excluded.payment_applies_to,
    collection_source = excluded.collection_source,
    source = excluded.source,
    paid_by = excluded.paid_by,
    who_paid = excluded.who_paid,
    received_by = excluded.received_by,
    received_by_staff_id = excluded.received_by_staff_id,
    received_by_role = excluded.received_by_role,
    collected_by = excluded.collected_by,
    collected_by_name = excluded.collected_by_name,
    collected_by_role = excluded.collected_by_role,
    notes = excluded.notes,
    payment_date = excluded.payment_date,
    collection_date = excluded.collection_date,
    payment_status = excluded.payment_status,
    void_reason = excluded.void_reason,
    voided_at = excluded.voided_at,
    voided_by = excluded.voided_by,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists customer_payments_sync_customer_ledger_v1
  on public.customer_payments;
create trigger customer_payments_sync_customer_ledger_v1
after insert or update of
  customer_account_id,
  customer_branch_id,
  payment_reference,
  payment_date,
  amount,
  payment_method,
  paid_by,
  notes,
  source,
  status,
  verification_status,
  void_reason,
  voided_at,
  voided_by,
  collector_staff_id,
  collector_name,
  collector_role,
  order_id,
  invoice_id,
  metadata
on public.customer_payments
for each row
execute function public.sync_canonical_payment_to_customer_ledger_v1();

create or replace function public.post_canonical_customer_payment_v1(
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_payment_date timestamptz,
  p_payment_method text,
  p_payment_source text,
  p_payment_reference text,
  p_paid_by text,
  p_collector_name text,
  p_collector_staff_id uuid,
  p_collector_role text,
  p_order_id uuid,
  p_invoice_id uuid,
  p_idempotency_key text,
  p_notes text default '',
  p_metadata jsonb default '{}'::jsonb,
  p_allocations jsonb default '[]'::jsonb,
  p_owner_username text default null,
  p_owner_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_actor_name text;
  v_actor_role text;
  v_actor_customer_account_id uuid;
  v_source text;
  v_method text;
  v_reference text;
  v_verification_status text;
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_allocations jsonb := '[]'::jsonb;
begin
  v_source := upper(trim(coalesce(p_payment_source, '')));
  if v_source not in (
    'CENTRAL_PAYMENT',
    'OFFICE_PAYMENT',
    'MANUAL_PAYMENT',
    'BANK_TRANSFER',
    'CASH_COLLECTION',
    'ORDER_PAYMENT',
    'DRIVER_DELIVERY_COLLECTION',
    'PREVIOUS_BALANCE_COLLECTION',
    'SALES_REP_COLLECTION',
    'CUSTOMER_PORTAL_PAYMENT'
  ) then
    raise exception 'Unsupported payment source.';
  end if;

  if nullif(trim(coalesce(p_owner_password, '')), '') is not null then
    v_actor_name := public.central_payment_require_admin_credentials(
      coalesce(nullif(trim(p_owner_username), ''), 'nisstaj_admin'),
      p_owner_password
    );
    v_actor_role := 'OWNER';
  else
    select *
      into v_actor
    from public.fairchoice_current_staff_profile();

    if not found then
      raise exception 'An authenticated active staff profile is required.'
        using errcode = '42501';
    end if;

    v_actor_name := coalesce(v_actor.staff_name, v_actor.staff_email);
    v_actor_role := v_actor.staff_role;
    select s.customer_account_id
      into v_actor_customer_account_id
    from public.staff_users s
    where s.id = v_actor.staff_id;

    if v_source = 'CUSTOMER_PORTAL_PAYMENT'
       and not (
         (
           lower(coalesce(v_actor.staff_role, '')) = 'customer'
           and v_actor_customer_account_id = p_customer_account_id
         )
         or lower(coalesce(v_actor.staff_role, '')) in ('admin', 'super admin')
       ) then
      raise exception 'A customer may post payments only to their own account.'
        using errcode = '42501';
    elsif v_source in ('DRIVER_DELIVERY_COLLECTION', 'PREVIOUS_BALANCE_COLLECTION')
       and lower(coalesce(v_actor.staff_role, '')) not in ('driver', 'admin', 'super admin')
       and not coalesce((v_actor.staff_permissions->>'access_accounts')::boolean, false) then
      raise exception 'This staff user is not authorised for driver collections.'
        using errcode = '42501';
    elsif v_source = 'SALES_REP_COLLECTION'
       and replace(lower(coalesce(v_actor.staff_role, '')), ' ', '') not in (
         'salesrep', 'salesrepresentative', 'admin', 'superadmin'
       )
       and not coalesce((v_actor.staff_permissions->>'access_accounts')::boolean, false) then
      raise exception 'This staff user is not authorised for sales-rep collections.'
        using errcode = '42501';
    elsif v_source not in (
      'DRIVER_DELIVERY_COLLECTION',
      'PREVIOUS_BALANCE_COLLECTION',
      'SALES_REP_COLLECTION',
      'CUSTOMER_PORTAL_PAYMENT'
    )
       and lower(coalesce(v_actor.staff_role, '')) not in ('admin', 'super admin')
       and not coalesce((v_actor.staff_permissions->>'access_accounts')::boolean, false) then
      raise exception 'This staff user is not authorised to post customer payments.'
        using errcode = '42501';
    end if;
  end if;

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'A stable idempotency key is required.';
  end if;
  if not exists (
    select 1 from public.customer_accounts
    where id = p_customer_account_id
  ) then
    raise exception 'Customer account does not exist.';
  end if;
  if p_customer_branch_id is not null and not exists (
    select 1
    from public.customer_branches
    where id = p_customer_branch_id
      and customer_account_id = p_customer_account_id
  ) then
    raise exception 'Selected branch does not belong to the customer account.';
  end if;

  v_method := case lower(trim(coalesce(p_payment_method, '')))
    when 'cash' then 'Cash'
    when 'card' then 'Card'
    when 'bank transfer' then 'Bank Transfer'
    when 'cheque' then 'Cheque'
    when 'other' then 'Other'
    else null
  end;
  if v_method is null then
    raise exception 'Unsupported payment method.';
  end if;

  select *
    into v_payment
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and idempotency_key = trim(p_idempotency_key)
  limit 1;

  if found then
    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_payment),
      'allocations', coalesce((
        select jsonb_agg(to_jsonb(a))
        from public.customer_payment_allocations a
        where a.payment_id = v_payment.id
      ), '[]'::jsonb)
    );
  end if;

  v_verification_status := case
    when v_method = 'Bank Transfer' then 'PENDING_VERIFICATION'
    else 'CONFIRMED'
  end;
  v_reference := coalesce(
    nullif(trim(p_payment_reference), ''),
    'PAY-' || to_char(coalesce(p_payment_date, now()), 'YYYYMMDD')
      || '-' || lpad(nextval('public.central_payment_reference_seq')::text, 6, '0')
  );

  insert into public.customer_payments (
    customer_account_id,
    customer_branch_id,
    branch_id,
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
    collector_staff_id,
    collector_name,
    collector_role,
    order_id,
    invoice_id,
    metadata
  )
  values (
    p_customer_account_id,
    p_customer_branch_id,
    p_customer_branch_id,
    v_reference,
    coalesce(p_payment_date, now()),
    round(p_amount, 2),
    v_method,
    nullif(trim(p_paid_by), ''),
    nullif(trim(p_notes), ''),
    v_source,
    trim(p_idempotency_key),
    'POSTED',
    v_actor_name,
    'PAYMENT',
    v_verification_status,
    case when v_verification_status = 'CONFIRMED' then v_actor_name end,
    case when v_verification_status = 'CONFIRMED' then now() end,
    p_collector_staff_id,
    coalesce(nullif(trim(p_collector_name), ''), v_actor_name),
    coalesce(nullif(trim(p_collector_role), ''), v_actor_role),
    p_order_id,
    p_invoice_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_payment;

  if v_verification_status = 'CONFIRMED' then
    for v_allocation in
      select value
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
    loop
      if coalesce((v_allocation->>'allocatedAmount')::numeric, 0) <= 0 then
        raise exception 'Allocation amount must be greater than zero.';
      end if;
      if nullif(trim(v_allocation->>'invoiceReference'), '') is null then
        raise exception 'Allocation invoice reference is required.';
      end if;

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
        v_payment.id,
        p_customer_account_id,
        coalesce(
          nullif(v_allocation->>'customerBranchId', '')::uuid,
          p_customer_branch_id
        ),
        v_allocation->>'invoiceReference',
        nullif(v_allocation->>'invoiceSourceId', ''),
        (v_allocation->>'allocatedAmount')::numeric,
        'automatic',
        'active',
        v_actor_name
      );
    end loop;

    if coalesce((
      select sum(a.allocated_amount)
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
    ), 0) > v_payment.amount then
      raise exception 'Payment allocations cannot exceed the payment amount.';
    end if;
  elsif jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    raise exception 'Pending bank transfers cannot be allocated before confirmation.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id;

  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    after_data,
    changed_by
  )
  values (
    case
      when v_verification_status = 'PENDING_VERIFICATION'
        then 'BANK_TRANSFER_RECORDED_PENDING'
      else 'PAYMENT_POSTED'
    end,
    'customer_payments',
    v_payment.id::text,
    p_customer_account_id,
    p_customer_branch_id,
    coalesce(nullif(trim(p_notes), ''), v_source),
    jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'allocations', v_allocations,
      'ledger_sync', true
    ),
    v_actor_name
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'allocations', v_allocations
  );
exception
  when unique_violation then
    select *
      into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and idempotency_key = trim(p_idempotency_key)
    limit 1;
    if found then
      return jsonb_build_object(
        'duplicate', true,
        'payment', to_jsonb(v_payment),
        'allocations', coalesce((
          select jsonb_agg(to_jsonb(a))
          from public.customer_payment_allocations a
          where a.payment_id = v_payment.id
        ), '[]'::jsonb)
      );
    end if;
    raise;
end;
$$;

revoke all on function public.sync_canonical_payment_to_customer_ledger_v1()
  from public;
revoke all on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) from public;
grant execute on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) to anon, authenticated;

comment on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) is
  'Authorised idempotent writer for canonical customer payments, allocations, audit, and one-way customer_ledger synchronisation.';
