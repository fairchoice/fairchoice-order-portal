-- Complete the canonical payment migration and restore Global Ledger capture.
--
-- Production audit used for this migration:
--   customer_payments: 65
--   reviewed legacy PAYMENT rows classified MISSING: 40
--   approved money-received rows: 39
--   excluded customer-credit row: 1 (ledger 226 at audit time)
--   pending bank transfers: 3
--
-- This migration is deliberately fail-closed. If the reviewed candidate set has
-- changed, it raises an exception before changing business data so the rows can
-- be reviewed again.

create extension if not exists pgcrypto;

-- Restore the canonical payment -> Global Ledger synchronisation function.
create or replace function public.sync_payment_to_global_ledger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_transaction_id uuid;
begin
  if upper(coalesce(new.transaction_type, 'PAYMENT')) <> 'PAYMENT' then
    return new;
  end if;

  insert into public.financial_transactions (
    source_type,
    source_id,
    transaction_type,
    customer_account_id,
    customer_branch_id,
    transaction_date,
    amount,
    debit_amount,
    credit_amount,
    payment_method,
    reference,
    description,
    staff_name,
    status,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  values (
    'CUSTOMER_PAYMENT',
    new.id::text,
    'PAYMENT',
    new.customer_account_id,
    new.customer_branch_id,
    new.payment_date,
    new.amount,
    0,
    case
      when upper(coalesce(new.verification_status, 'CONFIRMED'))
        in ('PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED') then 0
      when upper(coalesce(new.status, 'POSTED'))
        in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE', 'CANCELLED') then 0
      else new.amount
    end,
    new.payment_method,
    new.payment_reference,
    new.notes,
    coalesce(new.collector_name, new.paid_by, new.created_by),
    case
      when upper(coalesce(new.status, 'POSTED'))
        in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE', 'CANCELLED') then 'VOIDED'
      else 'ACTIVE'
    end,
    jsonb_build_object(
      'source_status', new.status,
      'verification_status', new.verification_status,
      'payment_source', new.source,
      'transaction_type', new.transaction_type
    ),
    new.created_by,
    new.created_at,
    now()
  )
  on conflict (source_type, source_id) do update
  set transaction_type = excluded.transaction_type,
      customer_account_id = excluded.customer_account_id,
      customer_branch_id = excluded.customer_branch_id,
      transaction_date = excluded.transaction_date,
      amount = excluded.amount,
      debit_amount = excluded.debit_amount,
      credit_amount = excluded.credit_amount,
      payment_method = excluded.payment_method,
      reference = excluded.reference,
      description = excluded.description,
      staff_name = excluded.staff_name,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_by = excluded.created_by,
      updated_at = now()
  returning id into v_transaction_id;

  insert into public.financial_ledger_events (
    transaction_id,
    event_type,
    actor,
    event_data
  )
  values (
    v_transaction_id,
    'CREATE',
    coalesce(nullif(new.created_by, ''), nullif(new.paid_by, ''), 'SYSTEM'),
    jsonb_build_object(
      'source_type', 'CUSTOMER_PAYMENT',
      'source_id', new.id::text
    )
  )
  on conflict (transaction_id) where event_type = 'CREATE' do nothing;

  return new;
end;
$$;

revoke execute on function public.sync_payment_to_global_ledger()
  from public, anon, authenticated;

drop trigger if exists customer_payments_global_ledger_sync
  on public.customer_payments;

create trigger customer_payments_global_ledger_sync
after insert or update on public.customer_payments
for each row
execute function public.sync_payment_to_global_ledger();

-- Lock and validate the exact reviewed reconciliation shape before inserting.
do $$
declare
  v_missing_count integer;
  v_approved_count integer;
  v_credit_count integer;
  v_bank_count integer;
  v_account_card_count integer;
begin
  lock table public.customer_ledger in share row exclusive mode;
  lock table public.customer_payments in share row exclusive mode;

  select count(*) into v_missing_count
  from public.reconcile_customer_ledger_payments_v2() r
  where r.classification = 'MISSING';

  select count(*) into v_approved_count
  from public.reconcile_customer_ledger_payments_v2() r
  join public.customer_ledger cl on cl.id = r.ledger_id
  where r.classification = 'MISSING'
    and upper(coalesce(cl.entry_type, cl.transaction_type, '')) = 'PAYMENT'
    and lower(coalesce(r.payment_method, '')) <> 'credit'
    and (
      lower(coalesce(r.payment_method, '')) in ('cash', 'bank transfer', 'card', 'cheque')
      or (
        lower(coalesce(r.payment_method, '')) = 'account'
        and lower(coalesce(cl.notes, '')) like '%card%'
      )
    );

  select count(*) into v_credit_count
  from public.reconcile_customer_ledger_payments_v2() r
  where r.classification = 'MISSING'
    and lower(coalesce(r.payment_method, '')) = 'credit';

  select count(*) into v_bank_count
  from public.reconcile_customer_ledger_payments_v2() r
  where r.classification = 'MISSING'
    and lower(coalesce(r.payment_method, '')) = 'bank transfer';

  select count(*) into v_account_card_count
  from public.reconcile_customer_ledger_payments_v2() r
  join public.customer_ledger cl on cl.id = r.ledger_id
  where r.classification = 'MISSING'
    and lower(coalesce(r.payment_method, '')) = 'account'
    and lower(coalesce(cl.notes, '')) like '%card%';

  if v_missing_count <> 40
     or v_approved_count <> 39
     or v_credit_count <> 1
     or v_bank_count <> 3
     or v_account_card_count <> 1 then
    raise exception
      'Reviewed legacy payment set changed (missing %, approved %, credit %, bank %, account-card %). Re-run reconciliation before applying.',
      v_missing_count,
      v_approved_count,
      v_credit_count,
      v_bank_count,
      v_account_card_count;
  end if;
end;
$$;

-- Insert only reviewed, genuine money-received rows. The canonical-payment
-- trigger links each new payment back to its original customer_ledger row using
-- metadata, so no second customer_ledger payment row is created.
with approved as (
  select
    r.*,
    cl.notes as ledger_notes,
    cl.created_at as ledger_created_at,
    cl.paid_by as ledger_paid_by,
    cl.who_paid as ledger_who_paid,
    cl.received_by_staff_id,
    cl.collected_by,
    cl.collected_by_name,
    cl.received_by,
    cl.collected_by_role,
    cl.received_by_role,
    cl.order_id as ledger_order_id
  from public.reconcile_customer_ledger_payments_v2() r
  join public.customer_ledger cl on cl.id = r.ledger_id
  where r.classification = 'MISSING'
    and upper(coalesce(cl.entry_type, cl.transaction_type, '')) = 'PAYMENT'
    and lower(coalesce(r.payment_method, '')) <> 'credit'
    and (
      lower(coalesce(r.payment_method, '')) in ('cash', 'bank transfer', 'card', 'cheque')
      or (
        lower(coalesce(r.payment_method, '')) = 'account'
        and lower(coalesce(cl.notes, '')) like '%card%'
      )
    )
), inserted as (
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
    created_at,
    transaction_type,
    verification_status,
    verified_by,
    verified_at,
    collector_staff_id,
    collector_name,
    collector_role,
    order_id,
    metadata
  )
  select
    a.customer_account_id,
    a.customer_branch_id,
    a.customer_branch_id,
    coalesce(nullif(trim(a.reference), ''), 'LEGACY-PAYMENT-' || a.ledger_id::text),
    a.payment_or_created_date,
    round(a.amount, 2),
    case
      when lower(coalesce(a.payment_method, '')) = 'account'
        and lower(coalesce(a.ledger_notes, '')) like '%card%' then 'Card'
      when lower(coalesce(a.payment_method, '')) = 'bank transfer' then 'Bank Transfer'
      when lower(coalesce(a.payment_method, '')) = 'card' then 'Card'
      when lower(coalesce(a.payment_method, '')) = 'cheque' then 'Cheque'
      else 'Cash'
    end,
    coalesce(a.ledger_paid_by, a.ledger_who_paid),
    a.ledger_notes,
    upper(coalesce(nullif(trim(a.collection_source), ''), 'LEGACY_CUSTOMER_LEDGER')),
    'legacy-customer-ledger:' || a.ledger_id::text,
    'POSTED',
    'SYSTEM_LEGACY_PAYMENT_MIGRATION',
    a.ledger_created_at,
    'PAYMENT',
    case
      when lower(coalesce(a.payment_method, '')) = 'bank transfer'
        then 'PENDING_VERIFICATION'
      else 'CONFIRMED'
    end,
    case
      when lower(coalesce(a.payment_method, '')) = 'bank transfer' then null
      else 'SYSTEM_LEGACY_PAYMENT_MIGRATION'
    end,
    case
      when lower(coalesce(a.payment_method, '')) = 'bank transfer' then null
      else now()
    end,
    coalesce(a.received_by_staff_id, a.collected_by),
    coalesce(a.collected_by_name, a.received_by, a.collector),
    coalesce(a.collected_by_role, a.received_by_role),
    null::uuid,
    jsonb_build_object(
      'legacy_source', 'customer_ledger',
      'legacy_source_id', a.ledger_id::text,
      'legacy_reference', a.reference,
      'legacy_order_id', a.ledger_order_id,
      'legacy_payment_method', a.payment_method,
      'legacy_collection_source', a.collection_source,
      'migration_batch', '20260726130000_complete_canonical_payment_and_global_ledger',
      'reviewed_decision', case
        when lower(coalesce(a.payment_method, '')) = 'bank transfer'
          then 'MIGRATE_PENDING_VERIFICATION'
        when lower(coalesce(a.payment_method, '')) = 'account'
          then 'MAP_ACCOUNT_TO_CARD_FROM_NOTES'
        else 'MIGRATE_CONFIRMED_MONEY_RECEIVED'
      end
    )
  from approved a
  where not exists (
    select 1
    from public.customer_payment_legacy_migrations m
    where m.legacy_source = 'customer_ledger'
      and m.legacy_id = a.ledger_id::text
  )
    and not exists (
      select 1
      from public.customer_payments cp
      where cp.idempotency_key = 'legacy-customer-ledger:' || a.ledger_id::text
    )
  returning *
)
insert into public.customer_payment_legacy_migrations (
  legacy_source,
  legacy_id,
  canonical_payment_id,
  classification,
  decision,
  reviewed_by,
  reviewed_at,
  approved_by,
  approved_at,
  migration_batch,
  notes,
  original_snapshot
)
select
  'customer_ledger',
  cp.metadata->>'legacy_source_id',
  cp.id,
  'MATCHED',
  'MIGRATED_MISSING',
  'SYSTEM_LEGACY_PAYMENT_MIGRATION',
  now(),
  'SYSTEM_LEGACY_PAYMENT_MIGRATION',
  now(),
  '20260726130000_complete_canonical_payment_and_global_ledger',
  'Reviewed production reconciliation: genuine money received; Credit excluded; Account mapped to Card from notes; bank transfers left pending verification.',
  to_jsonb(cl)
from inserted cp
join public.customer_ledger cl
  on cl.id = nullif(cp.metadata->>'legacy_source_id', '')::bigint
on conflict (legacy_source, legacy_id) do nothing;

-- Record an immutable audit entry for each migrated canonical payment.
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
select
  'LEGACY_PAYMENT_MIGRATED',
  'customer_payments',
  cp.id::text,
  cp.customer_account_id,
  cp.customer_branch_id,
  'Reviewed canonical migration from customer_ledger; non-money Credit excluded.',
  to_jsonb(cl),
  jsonb_build_object(
    'payment', to_jsonb(cp),
    'linked_customer_ledger_id', cl.id,
    'migration_batch', '20260726130000_complete_canonical_payment_and_global_ledger'
  ),
  'SYSTEM_LEGACY_PAYMENT_MIGRATION'
from public.customer_payments cp
join public.customer_ledger cl on cl.central_payment_id = cp.id
where cp.metadata->>'migration_batch' = '20260726130000_complete_canonical_payment_and_global_ledger'
  and not exists (
    select 1
    from public.financial_audit_log fal
    where fal.action = 'LEGACY_PAYMENT_MIGRATED'
      and fal.entity_type = 'customer_payments'
      and fal.entity_id = cp.id::text
  );

-- Backfill or reconcile every canonical PAYMENT into financial_transactions.
insert into public.financial_transactions (
  source_type,
  source_id,
  transaction_type,
  customer_account_id,
  customer_branch_id,
  transaction_date,
  amount,
  debit_amount,
  credit_amount,
  payment_method,
  reference,
  description,
  staff_name,
  status,
  metadata,
  created_by,
  created_at,
  updated_at
)
select
  'CUSTOMER_PAYMENT',
  cp.id::text,
  'PAYMENT',
  cp.customer_account_id,
  cp.customer_branch_id,
  cp.payment_date,
  cp.amount,
  0,
  case
    when upper(coalesce(cp.verification_status, 'CONFIRMED'))
      in ('PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED') then 0
    when upper(coalesce(cp.status, 'POSTED'))
      in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE', 'CANCELLED') then 0
    else cp.amount
  end,
  cp.payment_method,
  cp.payment_reference,
  cp.notes,
  coalesce(cp.collector_name, cp.paid_by, cp.created_by),
  case
    when upper(coalesce(cp.status, 'POSTED'))
      in ('VOIDED', 'REVERSED', 'ARCHIVED', 'INACTIVE', 'CANCELLED') then 'VOIDED'
    else 'ACTIVE'
  end,
  jsonb_build_object(
    'source_status', cp.status,
    'verification_status', cp.verification_status,
    'payment_source', cp.source,
    'transaction_type', cp.transaction_type
  ),
  cp.created_by,
  cp.created_at,
  now()
from public.customer_payments cp
where upper(coalesce(cp.transaction_type, 'PAYMENT')) = 'PAYMENT'
on conflict (source_type, source_id) do update
set transaction_type = excluded.transaction_type,
    customer_account_id = excluded.customer_account_id,
    customer_branch_id = excluded.customer_branch_id,
    transaction_date = excluded.transaction_date,
    amount = excluded.amount,
    debit_amount = excluded.debit_amount,
    credit_amount = excluded.credit_amount,
    payment_method = excluded.payment_method,
    reference = excluded.reference,
    description = excluded.description,
    staff_name = excluded.staff_name,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_by = excluded.created_by,
    updated_at = now();

-- Ensure every payment financial transaction has exactly one CREATE event.
insert into public.financial_ledger_events (
  transaction_id,
  event_type,
  actor,
  event_data
)
select
  ft.id,
  'CREATE',
  coalesce(nullif(ft.created_by, ''), 'SYSTEM'),
  jsonb_build_object(
    'source_type', ft.source_type,
    'source_id', ft.source_id,
    'backfilled_by', '20260726130000_complete_canonical_payment_and_global_ledger'
  )
from public.financial_transactions ft
where ft.source_type = 'CUSTOMER_PAYMENT'
on conflict (transaction_id) where event_type = 'CREATE' do nothing;

-- Final fail-closed integrity checks. No hard-coded total is used for all
-- canonical payments because legitimate new canonical payments may be posted
-- between audit and deployment; the reviewed legacy batch itself remains exact.
do $$
declare
  v_batch_payments integer;
  v_batch_links integer;
  v_missing_financial integer;
  v_duplicate_financial integer;
  v_pending_income integer;
  v_credit_migrated integer;
begin
  select count(*) into v_batch_payments
  from public.customer_payments
  where metadata->>'migration_batch' = '20260726130000_complete_canonical_payment_and_global_ledger';

  select count(*) into v_batch_links
  from public.customer_ledger cl
  join public.customer_payments cp on cp.id = cl.central_payment_id
  where cp.metadata->>'migration_batch' = '20260726130000_complete_canonical_payment_and_global_ledger';

  select count(*) into v_missing_financial
  from public.customer_payments cp
  left join public.financial_transactions ft
    on ft.source_type = 'CUSTOMER_PAYMENT'
   and ft.source_id = cp.id::text
  where upper(coalesce(cp.transaction_type, 'PAYMENT')) = 'PAYMENT'
    and ft.id is null;

  select count(*) into v_duplicate_financial
  from (
    select source_id
    from public.financial_transactions
    where source_type = 'CUSTOMER_PAYMENT'
    group by source_id
    having count(*) > 1
  ) d;

  select count(*) into v_pending_income
  from public.customer_payments cp
  join public.financial_transactions ft
    on ft.source_type = 'CUSTOMER_PAYMENT'
   and ft.source_id = cp.id::text
  where upper(coalesce(cp.verification_status, ''))
      in ('PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED')
    and coalesce(ft.credit_amount, 0) <> 0;

  select count(*) into v_credit_migrated
  from public.customer_payments cp
  where cp.metadata->>'migration_batch' = '20260726130000_complete_canonical_payment_and_global_ledger'
    and lower(coalesce(cp.metadata->>'legacy_payment_method', '')) = 'credit';

  if v_batch_payments <> 39 then
    raise exception 'Expected 39 reviewed migrated payments, found %.', v_batch_payments;
  end if;
  if v_batch_links <> 39 then
    raise exception 'Expected 39 linked legacy ledger rows, found %.', v_batch_links;
  end if;
  if v_missing_financial <> 0 then
    raise exception 'Canonical payments missing financial transactions: %.', v_missing_financial;
  end if;
  if v_duplicate_financial <> 0 then
    raise exception 'Duplicate CUSTOMER_PAYMENT financial source mappings: %.', v_duplicate_financial;
  end if;
  if v_pending_income <> 0 then
    raise exception 'Pending/rejected payments contributing financial income: %.', v_pending_income;
  end if;
  if v_credit_migrated <> 0 then
    raise exception 'Customer Credit rows were incorrectly migrated as money received: %.', v_credit_migrated;
  end if;
end;
$$;

comment on function public.sync_payment_to_global_ledger() is
  'Synchronises canonical PAYMENT rows from customer_payments into one Global Ledger financial transaction; pending/rejected/voided payments contribute zero income.';
