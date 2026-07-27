-- Reviewed, forward-only support for canonical previous-balance collections.
-- This migration does not backfill or modify customer_ledger rows.

create extension if not exists pgcrypto;

alter table public.customer_payments
  add column if not exists collector_staff_id uuid null,
  add column if not exists collector_name text null,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.customer_payment_legacy_migrations (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null,
  legacy_id text not null,
  canonical_payment_id uuid null references public.customer_payments(id) on delete restrict,
  classification text not null check (
    classification in ('MATCHED','MISSING','AMBIGUOUS','DUPLICATE','VOIDED_OR_INACTIVE','INVALID')
  ),
  decision text not null,
  reviewed_by text null,
  reviewed_at timestamptz null,
  approved_by text null,
  approved_at timestamptz null,
  migration_batch text null,
  notes text null,
  original_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint customer_payment_legacy_migrations_source_unique unique (legacy_source, legacy_id),
  constraint customer_payment_legacy_migrations_payment_unique unique (canonical_payment_id)
);

create index if not exists customer_payment_legacy_migrations_batch_idx
  on public.customer_payment_legacy_migrations (migration_batch, created_at desc);

alter table public.customer_payment_legacy_migrations enable row level security;
revoke all on table public.customer_payment_legacy_migrations from public, anon, authenticated;
grant select on table public.customer_payment_legacy_migrations to authenticated;

create or replace function public.reconcile_customer_ledger_payments_v1()
returns table (
  ledger_id bigint,
  canonical_payment_id uuid,
  customer_account_id uuid,
  customer_branch_id uuid,
  amount numeric,
  payment_or_created_date timestamptz,
  reference text,
  collection_source text,
  payer text,
  receiver text,
  classification text,
  candidate_count integer,
  confidence text,
  reason text
)
language sql
stable
security definer
set search_path = public
as $$
with ledger_payments as (
  select
    l.*,
    coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0), 0)::numeric as effective_amount,
    coalesce(l.payment_date, l.collection_date, l.created_at) as effective_date,
    coalesce(nullif(trim(l.payment_reference), ''), nullif(trim(l.reference_no), ''), nullif(trim(l.order_number), '')) as effective_reference,
    nullif(l.customer_account_id::text, '')::uuid as effective_account_id,
    coalesce(l.customer_branch_id, l.branch_id) as effective_branch_id
  from public.customer_ledger l
  where upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''), '')) = 'PAYMENT'
     or upper(coalesce(nullif(trim(l.transaction_type), ''), '')) = 'PAYMENT'
), scored as (
  select
    l.*,
    exists(select 1 from public.customer_accounts a where a.id = l.effective_account_id) as account_valid,
    (
      l.effective_branch_id is null
      or exists(
        select 1 from public.customer_branches b
        where b.id = l.effective_branch_id and b.customer_account_id = l.effective_account_id
      )
    ) as branch_valid,
    (
      upper(coalesce(l.entry_type, '')) in ('INVOICE','OPENING')
      or upper(coalesce(l.transaction_type, '')) in ('INVOICE','OPENING')
    ) as prohibited_type,
    (
      upper(coalesce(l.payment_status, '')) in ('VOIDED','REVERSED','REJECTED','ARCHIVED','INACTIVE')
      or l.voided_at is not null
      or l.reversed_at is not null
    ) as inactive,
    (select count(*)::integer from public.customer_payments p
      where p.metadata->>'legacy_source' = 'customer_ledger'
        and p.metadata->>'legacy_source_id' = l.id::text) as metadata_count,
    (select count(*)::integer from public.customer_payments p
      where p.idempotency_key = 'legacy-customer-ledger:' || l.id::text) as idempotency_count,
    (select count(*)::integer from public.customer_payments p
      where p.customer_account_id = l.effective_account_id
        and coalesce(p.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(l.effective_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and p.amount = l.effective_amount
        and upper(coalesce(p.payment_reference, '')) = upper(coalesce(l.effective_reference, ''))
        and p.payment_date::date = l.effective_date::date) as exact_count,
    (select count(*)::integer from public.customer_payments p
      where p.customer_account_id = l.effective_account_id
        and coalesce(p.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(l.effective_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and p.amount = l.effective_amount
        and abs(extract(epoch from (p.payment_date - l.effective_date))) <= 300) as close_count,
    (select p.id from public.customer_payments p
      where p.metadata->>'legacy_source' = 'customer_ledger'
        and p.metadata->>'legacy_source_id' = l.id::text
      order by p.created_at limit 1) as metadata_payment_id,
    (select p.id from public.customer_payments p
      where p.idempotency_key = 'legacy-customer-ledger:' || l.id::text
      order by p.created_at limit 1) as idempotency_payment_id,
    (select p.id from public.customer_payments p
      where p.customer_account_id = l.effective_account_id
        and coalesce(p.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(l.effective_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and p.amount = l.effective_amount
        and upper(coalesce(p.payment_reference, '')) = upper(coalesce(l.effective_reference, ''))
        and p.payment_date::date = l.effective_date::date
      order by p.created_at limit 1) as exact_payment_id,
    (select p.id from public.customer_payments p
      where p.customer_account_id = l.effective_account_id
        and coalesce(p.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(l.effective_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and p.amount = l.effective_amount
        and abs(extract(epoch from (p.payment_date - l.effective_date))) <= 300
      order by p.created_at limit 1) as close_payment_id
  from ledger_payments l
)
select
  s.id,
  case
    when s.metadata_count = 1 then s.metadata_payment_id
    when s.idempotency_count = 1 then s.idempotency_payment_id
    when s.exact_count = 1 then s.exact_payment_id
    else null
  end,
  s.effective_account_id,
  s.effective_branch_id,
  s.effective_amount,
  s.effective_date,
  s.effective_reference,
  coalesce(s.collection_source, s.source),
  coalesce(s.paid_by, s.who_paid),
  coalesce(s.received_by, s.collected_by_name),
  case
    when s.prohibited_type or s.effective_amount <= 0 or not s.account_valid or not s.branch_valid then 'INVALID'
    when s.inactive then 'VOIDED_OR_INACTIVE'
    when s.metadata_count > 1 or s.idempotency_count > 1 or s.exact_count > 1 then 'DUPLICATE'
    when s.metadata_count = 1 or s.idempotency_count = 1 or s.exact_count = 1 then 'MATCHED'
    when s.close_count > 0 then 'AMBIGUOUS'
    else 'MISSING'
  end,
  case
    when s.metadata_count > 0 then s.metadata_count
    when s.idempotency_count > 0 then s.idempotency_count
    when s.exact_count > 0 then s.exact_count
    else s.close_count
  end,
  case
    when s.prohibited_type or s.effective_amount <= 0 or not s.account_valid or not s.branch_valid then 'NONE'
    when s.inactive then 'NONE'
    when s.metadata_count = 1 or s.idempotency_count = 1 then 'CERTAIN'
    when s.exact_count = 1 then 'HIGH'
    when s.metadata_count > 1 or s.idempotency_count > 1 or s.exact_count > 1 then 'CONFLICT'
    when s.close_count > 0 then 'LOW'
    else 'NONE'
  end,
  case
    when s.prohibited_type then 'Ledger row is an INVOICE or OPENING record, not a payment.'
    when s.effective_amount <= 0 then 'Payment amount is zero or negative.'
    when not s.account_valid then 'Customer account does not exist.'
    when not s.branch_valid then 'Branch does not belong to the customer account.'
    when s.inactive then 'Ledger payment is voided, reversed, rejected, archived, or inactive.'
    when s.metadata_count > 1 or s.idempotency_count > 1 or s.exact_count > 1 then 'More than one canonical payment matches the legacy row.'
    when s.metadata_count = 1 then 'Matched by canonical legacy-source metadata.'
    when s.idempotency_count = 1 then 'Matched by legacy customer-ledger idempotency key.'
    when s.exact_count = 1 then 'Matched by exact account, branch, amount, reference, and date.'
    when s.close_count > 0 then 'A close date/amount candidate exists but is not certain.'
    else 'No canonical counterpart was found.'
  end
from scored s;
$$;

revoke all on function public.reconcile_customer_ledger_payments_v1() from public;
grant execute on function public.reconcile_customer_ledger_payments_v1() to authenticated;

create or replace function public.post_previous_balance_collection_v1(
  p_owner_username text,
  p_owner_password text,
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date timestamptz,
  p_payer_name text,
  p_collector_name text,
  p_collector_staff_id uuid,
  p_collector_role text,
  p_notes text,
  p_payment_intent_id uuid,
  p_legacy_ledger_id bigint default null,
  p_migration_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text;
  v_payment public.customer_payments%rowtype;
  v_ledger public.customer_ledger%rowtype;
  v_idempotency_key text;
  v_reference text;
  v_payment_date timestamptz;
  v_method text;
  v_reconciliation record;
  v_metadata jsonb;
begin
  v_actor := public.central_payment_require_admin_credentials(p_owner_username, p_owner_password);

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if p_payment_intent_id is null then
    raise exception 'A stable payment intent UUID is required.';
  end if;
  if not exists(select 1 from public.customer_accounts where id = p_customer_account_id) then
    raise exception 'Customer account does not exist.';
  end if;
  if p_customer_branch_id is not null and not exists(
    select 1 from public.customer_branches
    where id = p_customer_branch_id and customer_account_id = p_customer_account_id
  ) then
    raise exception 'Selected branch does not belong to the customer account.';
  end if;

  v_method := case
    when p_payment_method in ('Cash','Card','Bank Transfer','Cheque','Other') then p_payment_method
    else null
  end;
  if v_method is null then raise exception 'Unsupported payment method.'; end if;

  if p_legacy_ledger_id is not null then
    select * into v_ledger from public.customer_ledger where id = p_legacy_ledger_id for update;
    if not found then raise exception 'Legacy customer_ledger payment does not exist.'; end if;
    if upper(coalesce(nullif(trim(v_ledger.entry_type), ''), nullif(trim(v_ledger.transaction_type), ''), '')) <> 'PAYMENT'
       or upper(coalesce(v_ledger.entry_type, '')) in ('INVOICE','OPENING')
       or upper(coalesce(v_ledger.transaction_type, '')) in ('INVOICE','OPENING') then
      raise exception 'Only genuine customer_ledger PAYMENT rows can be migrated.';
    end if;
    if upper(coalesce(v_ledger.payment_status, '')) in ('VOIDED','REVERSED','REJECTED','ARCHIVED','INACTIVE')
       or v_ledger.voided_at is not null or v_ledger.reversed_at is not null then
      raise exception 'Voided or inactive ledger payments cannot be migrated.';
    end if;
    if coalesce(nullif(v_ledger.credit, 0), nullif(v_ledger.payment_amount, 0), nullif(v_ledger.amount, 0), 0) <= 0 then
      raise exception 'Legacy payment amount must be greater than zero.';
    end if;
    if v_ledger.customer_account_id is distinct from p_customer_account_id
       or coalesce(v_ledger.customer_branch_id, v_ledger.branch_id) is distinct from p_customer_branch_id
       or round(coalesce(nullif(v_ledger.credit, 0), nullif(v_ledger.payment_amount, 0), nullif(v_ledger.amount, 0), 0), 2) <> round(p_amount, 2) then
      raise exception 'Requested account, branch, or amount does not match the locked legacy row.';
    end if;

    v_idempotency_key := 'legacy-customer-ledger:' || p_legacy_ledger_id::text;
    select * into v_payment from public.customer_payments where idempotency_key = v_idempotency_key limit 1;
    if found then
      return jsonb_build_object('duplicate', true, 'payment', to_jsonb(v_payment));
    end if;
    if exists(
      select 1 from public.customer_payment_legacy_migrations
      where legacy_source = 'customer_ledger' and legacy_id = p_legacy_ledger_id::text
    ) then
      raise exception 'This legacy row already has a migration decision.';
    end if;

    select * into v_reconciliation
    from public.reconcile_customer_ledger_payments_v1()
    where ledger_id = p_legacy_ledger_id;
    if not found or v_reconciliation.classification <> 'MISSING' then
      raise exception 'Legacy payment classification must be MISSING before migration. Current classification: %', coalesce(v_reconciliation.classification, 'INVALID');
    end if;

    v_payment_date := coalesce(v_ledger.payment_date, v_ledger.collection_date, v_ledger.created_at);
    v_reference := 'PBC-' || to_char(v_payment_date, 'YYYYMMDD') || '-L' || p_legacy_ledger_id::text;
    v_metadata := jsonb_build_object(
      'legacy_source', 'customer_ledger',
      'legacy_source_id', p_legacy_ledger_id::text,
      'legacy_created_at', v_ledger.created_at,
      'legacy_reference', coalesce(v_ledger.payment_reference, v_ledger.reference_no),
      'legacy_collection_source', coalesce(v_ledger.collection_source, v_ledger.source),
      'legacy_receiver', coalesce(v_ledger.received_by, v_ledger.collected_by_name),
      'migration_reason', p_migration_reason
    );
  else
    v_idempotency_key := 'previous-balance-intent:' || p_payment_intent_id::text;
    select * into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and idempotency_key = v_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object('duplicate', true, 'payment', to_jsonb(v_payment));
    end if;
    v_payment_date := coalesce(p_payment_date, now());
    v_reference := 'PBC-' || to_char(v_payment_date, 'YYYYMMDD') || '-' || left(replace(p_payment_intent_id::text, '-', ''), 10);
    v_metadata := jsonb_build_object('payment_intent_id', p_payment_intent_id, 'collection_kind', 'PREVIOUS_BALANCE');
  end if;

  begin
    insert into public.customer_payments (
      customer_account_id, customer_branch_id, payment_reference, payment_date,
      amount, payment_method, paid_by, notes, source, idempotency_key,
      status, created_by, transaction_type, verification_status,
      collector_staff_id, collector_name, collector_role, metadata
    ) values (
      p_customer_account_id, p_customer_branch_id, v_reference, v_payment_date,
      round(p_amount, 2), v_method, nullif(trim(p_payer_name), ''), p_notes,
      'PREVIOUS_BALANCE_COLLECTION', v_idempotency_key,
      'POSTED', v_actor, 'PAYMENT', 'CONFIRMED',
      p_collector_staff_id, nullif(trim(p_collector_name), ''), nullif(trim(p_collector_role), ''), v_metadata
    ) returning * into v_payment;
  exception when unique_violation then
    select * into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and idempotency_key = v_idempotency_key
    limit 1;
    if found then
      return jsonb_build_object('duplicate', true, 'payment', to_jsonb(v_payment));
    end if;
    raise;
  end;

  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  insert into public.financial_audit_log (
    action, entity_type, entity_id, customer_account_id, customer_branch_id,
    reason, before_data, after_data, changed_by
  ) values (
    case when p_legacy_ledger_id is null then 'PREVIOUS_BALANCE_COLLECTION_POSTED' else 'LEGACY_PAYMENT_MIGRATED' end,
    'customer_payments', v_payment.id::text, p_customer_account_id, p_customer_branch_id,
    coalesce(nullif(trim(p_migration_reason), ''), 'Previous balance collection'),
    case when p_legacy_ledger_id is null then null else to_jsonb(v_ledger) end,
    jsonb_build_object('payment', to_jsonb(v_payment), 'source_table', case when p_legacy_ledger_id is null then null else 'customer_ledger' end, 'source_record_id', p_legacy_ledger_id),
    v_actor
  );

  if p_legacy_ledger_id is not null then
    insert into public.customer_payment_legacy_migrations (
      legacy_source, legacy_id, canonical_payment_id, classification, decision,
      reviewed_by, reviewed_at, approved_by, approved_at, migration_batch,
      notes, original_snapshot
    ) values (
      'customer_ledger', p_legacy_ledger_id::text, v_payment.id, 'MATCHED', 'MIGRATED',
      v_actor, now(), v_actor, now(), 'controlled-one-record-repair',
      p_migration_reason, to_jsonb(v_ledger)
    );
  end if;

  return jsonb_build_object('duplicate', false, 'payment', to_jsonb(v_payment));
end;
$$;

revoke all on function public.post_previous_balance_collection_v1(
  text,text,uuid,uuid,numeric,text,timestamptz,text,text,uuid,text,text,uuid,bigint,text
) from public;
grant execute on function public.post_previous_balance_collection_v1(
  text,text,uuid,uuid,numeric,text,timestamptz,text,text,uuid,text,text,uuid,bigint,text
) to anon, authenticated;

comment on function public.reconcile_customer_ledger_payments_v1() is
  'Read-only classification of genuine legacy customer_ledger payment rows against canonical customer_payments.';
comment on function public.post_previous_balance_collection_v1(
  text,text,uuid,uuid,numeric,text,timestamptz,text,text,uuid,text,text,uuid,bigint,text
) is 'Owner-authorised, idempotent canonical writer for previous-balance collections and controlled one-record legacy repairs.';
