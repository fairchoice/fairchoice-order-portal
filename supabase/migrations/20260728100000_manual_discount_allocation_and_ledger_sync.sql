-- Make Central Payment discounts follow the same allocation and read-model
-- contract as posted customer payments.

alter table public.customer_ledger
  add column if not exists central_payment_id uuid null;

create unique index if not exists customer_ledger_central_payment_id_uidx
  on public.customer_ledger (central_payment_id)
  where central_payment_id is not null;

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
  v_existing public.customer_payments%rowtype;
  v_status text;
  v_reference text;
  v_allocation jsonb;
  v_allocations jsonb := '[]'::jsonb;
begin
  perform public.central_payment_require_admin_credentials(
    p_owner_username,
    p_owner_password
  );

  if p_amount <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if upper(p_transaction_type) not in ('PAYMENT', 'DISCOUNT') then
    raise exception 'Invalid transaction type.';
  end if;
  if upper(p_transaction_type) = 'DISCOUNT'
     and nullif(trim(coalesce(p_notes, '')), '') is null then
    raise exception 'A detailed discount reason is compulsory.';
  end if;

  select *
    into v_existing
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and coalesce(
      customer_branch_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ) = coalesce(
      p_customer_branch_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
    and idempotency_key = p_idempotency_key
    and not exists (
      select 1
      from public.central_payment_archive a
      where a.payment_id = customer_payments.id
    )
  limit 1;

  if found then
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
      into v_allocations
    from public.customer_payment_allocations a
    where a.payment_id = v_existing.id
      and lower(coalesce(a.status, 'active')) = 'active';

    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_existing),
      'allocations', v_allocations
    );
  end if;

  v_status := case
    when upper(p_transaction_type) = 'PAYMENT'
      and p_payment_method = 'Bank Transfer'
      then 'PENDING_VERIFICATION'
    else 'CONFIRMED'
  end;
  v_reference := coalesce(
    nullif(trim(p_external_reference), ''),
    'PAY-' || to_char(coalesce(p_payment_date, now()), 'YYYYMMDD')
      || '-' || lpad(
        nextval('public.central_payment_reference_seq')::text,
        6,
        '0'
      )
  );

  insert into public.customer_payments (
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
  )
  values (
    p_customer_account_id,
    p_customer_branch_id,
    v_reference,
    coalesce(p_payment_date, now()),
    round(p_amount, 2),
    case
      when upper(p_transaction_type) = 'DISCOUNT' then 'Other'
      else p_payment_method
    end,
    p_paid_by,
    p_notes,
    'CENTRAL_PAYMENT',
    p_idempotency_key,
    'POSTED',
    'nisstaj_admin',
    upper(p_transaction_type),
    v_status,
    case when v_status = 'CONFIRMED' then 'nisstaj_admin' end,
    case when v_status = 'CONFIRMED' then now() end,
    case when upper(p_transaction_type) = 'DISCOUNT' then p_notes end,
    'OWNER'
  )
  returning * into v_payment;

  -- Rebuild from canonical invoices first. If an order-backed invoice is not
  -- yet mirrored in customer_invoices, retain the already-computed FIFO
  -- allocation supplied by the authoritative frontend snapshot.
  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  if v_status = 'CONFIRMED'
     and jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0
     and not exists (
       select 1
       from public.customer_payment_allocations
       where payment_id = v_payment.id
         and lower(coalesce(status, 'active')) = 'active'
     ) then
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
        round((v_allocation->>'allocatedAmount')::numeric, 2),
        'automatic',
        'active',
        null
      );
    end loop;
  end if;

  if coalesce((
    select sum(allocated_amount)
    from public.customer_payment_allocations
    where payment_id = v_payment.id
      and lower(coalesce(status, 'active')) = 'active'
  ), 0) > v_payment.amount then
    raise exception 'Transaction allocations cannot exceed the transaction amount.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id
    and lower(coalesce(a.status, 'active')) = 'active';

  insert into public.central_payment_lifecycle_audit (
    payment_id,
    payment_reference,
    customer_account_id,
    customer_branch_id,
    action,
    reason,
    after_data,
    changed_by
  )
  values (
    v_payment.id,
    v_payment.payment_reference,
    v_payment.customer_account_id,
    v_payment.customer_branch_id,
    'CREATED',
    coalesce(nullif(trim(p_notes), ''), 'Manual payment created'),
    to_jsonb(v_payment),
    'nisstaj_admin'
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'allocations', v_allocations,
    'verification_status', v_status
  );
end;
$$;

create or replace function public.sync_central_discount_to_customer_ledger_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_name text;
  v_branch_name text;
begin
  if upper(coalesce(new.transaction_type, 'PAYMENT')) <> 'DISCOUNT' then
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
    notes,
    payment_date,
    collection_date,
    payment_status,
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
    'DISCOUNT',
    'Customer discount',
    new.payment_reference,
    new.payment_reference,
    0,
    new.amount,
    new.amount,
    new.amount,
    'Discount',
    new.payment_method,
    'CENTRAL_PAYMENT',
    'CENTRAL_PAYMENT',
    'CENTRAL_PAYMENT',
    new.paid_by,
    new.paid_by,
    new.notes,
    new.payment_date,
    new.payment_date::date,
    case
      when upper(coalesce(new.status, 'POSTED')) in (
        'VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE'
      ) then upper(new.status)
      else 'POSTED'
    end,
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
    credit = excluded.credit,
    amount = excluded.amount,
    payment_amount = excluded.payment_amount,
    payment_method = excluded.payment_method,
    paid_by = excluded.paid_by,
    who_paid = excluded.who_paid,
    notes = excluded.notes,
    payment_date = excluded.payment_date,
    collection_date = excluded.collection_date,
    payment_status = excluded.payment_status,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists customer_payments_sync_discount_ledger_v1
  on public.customer_payments;
create trigger customer_payments_sync_discount_ledger_v1
after insert or update of
  customer_account_id,
  customer_branch_id,
  payment_reference,
  payment_date,
  amount,
  payment_method,
  paid_by,
  notes,
  status,
  transaction_type
on public.customer_payments
for each row
execute function public.sync_central_discount_to_customer_ledger_v1();

revoke all on function public.post_owner_central_transaction(
  text, text, uuid, uuid, text, timestamptz, numeric,
  text, text, text, text, text, jsonb
) from public;
grant execute on function public.post_owner_central_transaction(
  text, text, uuid, uuid, text, timestamptz, numeric,
  text, text, text, text, text, jsonb
) to anon, authenticated;

revoke all on function public.sync_central_discount_to_customer_ledger_v1()
  from public;

comment on function public.sync_central_discount_to_customer_ledger_v1() is
  'Mirrors canonical DISCOUNT transactions into customer_ledger without creating a second payment.';
