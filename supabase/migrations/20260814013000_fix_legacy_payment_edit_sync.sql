-- Allow safe edits of canonical payments that originated from customer_ledger.
--
-- The existing sync trigger runs after UPDATE as well as INSERT. Previously,
-- a legacy-linked payment edit failed because the ledger row already had the
-- same central_payment_id and the trigger only accepted NULL links. This keeps
-- the safety boundary (a row linked to another payment is still rejected) and
-- synchronizes the corrected canonical financial fields back to that one
-- historical ledger row. No business data is changed by applying this migration.

-- Fix canonical UUID -> legacy bigint order_id mismatch

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

  -- A historical payment already has its original ledger row. On the first
  -- canonical insert, link that row. On later edits, the same trigger fires
  -- again: allow the row when it is already linked to THIS canonical payment
  -- and keep its financial fields synchronized with the corrected canonical
  -- values. A row linked to any different canonical payment still fails safe.
  if coalesce(new.metadata->>'legacy_source', '') = 'customer_ledger' then
    update public.customer_ledger
    set central_payment_id = new.id,
        reference_no = coalesce(nullif(trim(new.payment_reference), ''), reference_no),
        payment_reference = coalesce(nullif(trim(new.payment_reference), ''), payment_reference),
        credit = round(coalesce(new.amount, 0), 2),
        amount = round(coalesce(new.amount, 0), 2),
        payment_amount = round(coalesce(new.amount, 0), 2),
        payment_type = coalesce(nullif(trim(new.payment_method), ''), payment_type),
        payment_method = coalesce(nullif(trim(new.payment_method), ''), payment_method),
        paid_by = coalesce(nullif(trim(new.paid_by), ''), paid_by),
        who_paid = coalesce(nullif(trim(new.paid_by), ''), who_paid),
        notes = new.notes,
        payment_date = coalesce(new.payment_date, payment_date),
        collection_date = coalesce(new.payment_date, collection_date),
        payment_status = case
          when upper(coalesce(new.status, 'POSTED')) in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE')
            then upper(new.status)
          when upper(coalesce(new.verification_status, 'CONFIRMED')) in ('PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED')
            then upper(new.verification_status)
          else 'POSTED'
        end,
        void_reason = new.void_reason,
        voided_at = new.voided_at,
        voided_by = new.voided_by,
        updated_at = now()
    where id = nullif(new.metadata->>'legacy_source_id', '')::bigint
      and upper(coalesce(
        nullif(trim(entry_type), ''),
        nullif(trim(transaction_type), ''),
        ''
      )) = 'PAYMENT'
      and (central_payment_id is null or central_payment_id = new.id);

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
    null::bigint,
    coalesce(
      nullif(new.metadata->>'order_number', ''),
      new.payment_reference,
      new.order_id::text
    ),
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
