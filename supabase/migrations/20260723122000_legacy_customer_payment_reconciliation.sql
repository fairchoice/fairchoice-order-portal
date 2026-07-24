-- Read-only reconciliation plus explicitly reviewed historical payment migration.
-- This migration installs reporting and controlled functions only. It does not
-- migrate, link, update, or backfill any business row automatically.

create table if not exists public.customer_payment_legacy_migrations (
  id uuid primary key default gen_random_uuid(),
  legacy_source text not null,
  legacy_id text not null,
  canonical_payment_id uuid null references public.customer_payments(id) on delete restrict,
  classification text not null check (
    classification in (
      'MATCHED',
      'MISSING',
      'AMBIGUOUS',
      'DUPLICATE',
      'VOIDED_OR_INACTIVE',
      'INVALID'
    )
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
  constraint customer_payment_legacy_migrations_source_unique
    unique (legacy_source, legacy_id),
  constraint customer_payment_legacy_migrations_payment_unique
    unique (canonical_payment_id)
);

create index if not exists customer_payment_legacy_migrations_batch_idx
  on public.customer_payment_legacy_migrations (migration_batch, created_at desc);

alter table public.customer_payment_legacy_migrations enable row level security;
revoke all on table public.customer_payment_legacy_migrations
  from public, anon, authenticated;
grant select on table public.customer_payment_legacy_migrations
  to authenticated;

create or replace function public.reconcile_customer_ledger_payments_v2()
returns table (
  ledger_id bigint,
  canonical_payment_id uuid,
  customer_account_id uuid,
  customer_branch_id uuid,
  amount numeric,
  payment_or_created_date timestamptz,
  reference text,
  payment_method text,
  collection_source text,
  collector text,
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
    coalesce(
      nullif(l.credit, 0),
      nullif(l.payment_amount, 0),
      nullif(l.amount, 0),
      0
    )::numeric as effective_amount,
    coalesce(l.payment_date, l.collection_date, l.created_at) as effective_date,
    coalesce(
      nullif(trim(l.payment_reference), ''),
      nullif(trim(l.reference_no), ''),
      nullif(trim(l.order_number), '')
    ) as effective_reference,
    coalesce(l.customer_branch_id, l.branch_id) as effective_branch_id
  from public.customer_ledger l
  where upper(coalesce(
    nullif(trim(l.entry_type), ''),
    nullif(trim(l.transaction_type), ''),
    ''
  )) = 'PAYMENT'
),
scored as (
  select
    l.*,
    exists (
      select 1 from public.customer_accounts a
      where a.id = l.customer_account_id
    ) as account_valid,
    (
      l.effective_branch_id is null
      or exists (
        select 1
        from public.customer_branches b
        where b.id = l.effective_branch_id
          and b.customer_account_id = l.customer_account_id
      )
    ) as branch_valid,
    (
      upper(coalesce(l.payment_status, '')) in (
        'VOIDED', 'REVERSED', 'REJECTED', 'ARCHIVED', 'INACTIVE', 'CANCELLED'
      )
      or l.voided_at is not null
      or l.reversed_at is not null
    ) as inactive,
    (
      select count(*)::integer
      from ledger_payments d
      where d.id <> l.id
        and d.customer_account_id = l.customer_account_id
        and coalesce(
          d.effective_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          l.effective_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        and d.effective_amount = l.effective_amount
        and upper(coalesce(d.effective_reference, ''))
          = upper(coalesce(l.effective_reference, ''))
        and d.effective_date::date = l.effective_date::date
        and upper(coalesce(d.payment_status, '')) not in (
          'VOIDED', 'REVERSED', 'REJECTED', 'ARCHIVED', 'INACTIVE', 'CANCELLED'
        )
        and d.voided_at is null
        and d.reversed_at is null
    ) as legacy_duplicate_count,
    (
      select count(*)::integer
      from public.customer_payments p
      where p.id = l.central_payment_id
    ) as link_count,
    (
      select count(*)::integer
      from public.customer_payments p
      where p.metadata->>'legacy_source' = 'customer_ledger'
        and p.metadata->>'legacy_source_id' = l.id::text
    ) as metadata_count,
    (
      select count(*)::integer
      from public.customer_payments p
      where p.idempotency_key = 'legacy-customer-ledger:' || l.id::text
    ) as idempotency_count,
    (
      select count(*)::integer
      from public.customer_payments p
      where p.customer_account_id = l.customer_account_id
        and coalesce(
          p.customer_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          l.effective_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        and p.amount = l.effective_amount
        and upper(coalesce(p.payment_reference, ''))
          = upper(coalesce(l.effective_reference, ''))
        and p.payment_date::date = l.effective_date::date
    ) as exact_count,
    (
      select count(*)::integer
      from public.customer_payments p
      where p.customer_account_id = l.customer_account_id
        and coalesce(
          p.customer_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          l.effective_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        and p.amount = l.effective_amount
        and abs(extract(epoch from (p.payment_date - l.effective_date))) <= 300
    ) as close_count,
    (
      select p.id
      from public.customer_payments p
      where p.id = l.central_payment_id
      limit 1
    ) as linked_payment_id,
    (
      select p.id
      from public.customer_payments p
      where p.metadata->>'legacy_source' = 'customer_ledger'
        and p.metadata->>'legacy_source_id' = l.id::text
      order by p.created_at
      limit 1
    ) as metadata_payment_id,
    (
      select p.id
      from public.customer_payments p
      where p.idempotency_key = 'legacy-customer-ledger:' || l.id::text
      order by p.created_at
      limit 1
    ) as idempotency_payment_id,
    (
      select p.id
      from public.customer_payments p
      where p.customer_account_id = l.customer_account_id
        and coalesce(
          p.customer_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        ) = coalesce(
          l.effective_branch_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
        and p.amount = l.effective_amount
        and upper(coalesce(p.payment_reference, ''))
          = upper(coalesce(l.effective_reference, ''))
        and p.payment_date::date = l.effective_date::date
      order by p.created_at
      limit 1
    ) as exact_payment_id
  from ledger_payments l
)
select
  s.id,
  case
    when s.link_count = 1 then s.linked_payment_id
    when s.metadata_count = 1 then s.metadata_payment_id
    when s.idempotency_count = 1 then s.idempotency_payment_id
    when s.exact_count = 1 then s.exact_payment_id
    else null
  end,
  s.customer_account_id,
  s.effective_branch_id,
  s.effective_amount,
  s.effective_date,
  s.effective_reference,
  coalesce(nullif(trim(s.payment_method), ''), nullif(trim(s.payment_type), '')),
  coalesce(nullif(trim(s.collection_source), ''), nullif(trim(s.source), '')),
  coalesce(
    nullif(trim(s.collected_by_name), ''),
    nullif(trim(s.received_by), ''),
    nullif(trim(s.paid_by), '')
  ),
  case
    when s.effective_amount <= 0 or not s.account_valid or not s.branch_valid
      then 'INVALID'
    when s.inactive
      then 'VOIDED_OR_INACTIVE'
    when s.legacy_duplicate_count > 0
      or s.link_count > 1
      or s.metadata_count > 1
      or s.idempotency_count > 1
      or s.exact_count > 1
      then 'DUPLICATE'
    when s.link_count = 1
      or s.metadata_count = 1
      or s.idempotency_count = 1
      or s.exact_count = 1
      then 'MATCHED'
    when s.close_count > 0
      then 'AMBIGUOUS'
    else 'MISSING'
  end,
  case
    when s.legacy_duplicate_count > 0 then s.legacy_duplicate_count + 1
    when s.link_count > 0 then s.link_count
    when s.metadata_count > 0 then s.metadata_count
    when s.idempotency_count > 0 then s.idempotency_count
    when s.exact_count > 0 then s.exact_count
    else s.close_count
  end,
  case
    when s.effective_amount <= 0 or not s.account_valid or not s.branch_valid
      or s.inactive then 'NONE'
    when s.link_count = 1 or s.metadata_count = 1 or s.idempotency_count = 1
      then 'CERTAIN'
    when s.exact_count = 1
      then 'HIGH'
    when s.legacy_duplicate_count > 0
      or s.link_count > 1
      or s.metadata_count > 1
      or s.idempotency_count > 1
      or s.exact_count > 1
      then 'CONFLICT'
    when s.close_count > 0
      then 'LOW'
    else 'NONE'
  end,
  case
    when s.effective_amount <= 0 then 'Payment amount is zero or negative.'
    when not s.account_valid then 'Customer account does not exist.'
    when not s.branch_valid then 'Branch does not belong to the customer account.'
    when s.inactive then 'Ledger payment is voided, reversed, rejected, archived, or inactive.'
    when s.legacy_duplicate_count > 0
      then 'Another active ledger payment has the same account, branch, amount, reference, and date.'
    when s.link_count > 1
      or s.metadata_count > 1
      or s.idempotency_count > 1
      or s.exact_count > 1
      then 'More than one canonical payment matches the ledger row.'
    when s.link_count = 1 then 'Matched by customer_ledger.central_payment_id.'
    when s.metadata_count = 1 then 'Matched by canonical legacy-source metadata.'
    when s.idempotency_count = 1 then 'Matched by deterministic legacy idempotency key.'
    when s.exact_count = 1
      then 'Matched by exact account, branch, amount, reference, and payment date.'
    when s.close_count > 0
      then 'A close account, branch, amount, and timestamp candidate requires review.'
    else 'No canonical counterpart was found.'
  end
from scored s;
$$;

create or replace function public.apply_reviewed_customer_ledger_payment_migration_v1(
  p_ledger_ids bigint[],
  p_reason text,
  p_migration_batch text
)
returns table (
  ledger_id bigint,
  canonical_payment_id uuid,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_actor_name text;
  v_ledger public.customer_ledger%rowtype;
  v_reconciliation record;
  v_payment public.customer_payments%rowtype;
  v_ledger_id bigint;
  v_amount numeric;
  v_date timestamptz;
  v_reference text;
  v_source text;
  v_method text;
begin
  if coalesce(array_length(p_ledger_ids, 1), 0) = 0 then
    raise exception 'At least one explicitly reviewed ledger ID is required.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'A migration reason is required.';
  end if;
  if nullif(trim(coalesce(p_migration_batch, '')), '') is null then
    raise exception 'A migration batch identifier is required.';
  end if;

  select *
    into v_actor
  from public.fairchoice_current_staff_profile();
  if not found or lower(coalesce(v_actor.staff_role, '')) <> 'super admin' then
    raise exception 'Only an authenticated Super Admin may migrate reviewed payments.'
      using errcode = '42501';
  end if;
  v_actor_name := coalesce(v_actor.staff_name, v_actor.staff_email);

  foreach v_ledger_id in array p_ledger_ids
  loop
    select *
      into v_ledger
    from public.customer_ledger
    where id = v_ledger_id
    for update;

    if not found then
      raise exception 'Ledger payment % does not exist.', v_ledger_id;
    end if;

    select *
      into v_reconciliation
    from public.reconcile_customer_ledger_payments_v2() r
    where r.ledger_id = v_ledger_id;

    if not found then
      raise exception 'Ledger row % is not a PAYMENT row.', v_ledger_id;
    end if;
    if v_reconciliation.classification not in ('MATCHED', 'MISSING') then
      raise exception
        'Ledger payment % is classified as % and cannot be migrated automatically.',
        v_ledger_id,
        v_reconciliation.classification;
    end if;

    if v_reconciliation.classification = 'MATCHED' then
      v_payment.id := v_reconciliation.canonical_payment_id;
      update public.customer_ledger
      set central_payment_id = v_payment.id,
          updated_at = now()
      where id = v_ledger_id
        and central_payment_id is distinct from v_payment.id;

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
      values (
        'customer_ledger',
        v_ledger_id::text,
        v_payment.id,
        'MATCHED',
        'LINKED_EXISTING',
        v_actor_name,
        now(),
        v_actor_name,
        now(),
        trim(p_migration_batch),
        trim(p_reason),
        to_jsonb(v_ledger)
      )
      on conflict (legacy_source, legacy_id) do nothing;

      ledger_id := v_ledger_id;
      canonical_payment_id := v_payment.id;
      action := 'LINKED_EXISTING';
      return next;
      continue;
    end if;

    v_amount := v_reconciliation.amount;
    v_date := v_reconciliation.payment_or_created_date;
    v_reference := coalesce(
      nullif(trim(v_reconciliation.reference), ''),
      'LEGACY-PAYMENT-' || v_ledger_id::text
    );
    v_source := upper(coalesce(
      nullif(trim(v_reconciliation.collection_source), ''),
      'LEGACY_CUSTOMER_LEDGER'
    ));
    v_method := case lower(trim(coalesce(v_reconciliation.payment_method, '')))
      when 'cash' then 'Cash'
      when 'card' then 'Card'
      when 'bank transfer' then 'Bank Transfer'
      when 'cheque' then 'Cheque'
      else 'Other'
    end;

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
    values (
      v_reconciliation.customer_account_id,
      v_reconciliation.customer_branch_id,
      v_reconciliation.customer_branch_id,
      v_reference,
      v_date,
      round(v_amount, 2),
      v_method,
      coalesce(v_ledger.paid_by, v_ledger.who_paid),
      v_ledger.notes,
      v_source,
      'legacy-customer-ledger:' || v_ledger_id::text,
      'POSTED',
      v_actor_name,
      v_ledger.created_at,
      'PAYMENT',
      'CONFIRMED',
      v_actor_name,
      now(),
      coalesce(v_ledger.received_by_staff_id, v_ledger.collected_by),
      coalesce(v_ledger.collected_by_name, v_ledger.received_by),
      coalesce(v_ledger.collected_by_role, v_ledger.received_by_role),
      v_ledger.order_id,
      jsonb_build_object(
        'legacy_source', 'customer_ledger',
        'legacy_source_id', v_ledger_id::text,
        'legacy_reference', v_reconciliation.reference,
        'legacy_payment_method', v_reconciliation.payment_method,
        'legacy_collection_source', v_reconciliation.collection_source,
        'migration_batch', trim(p_migration_batch)
      )
    )
    returning * into v_payment;

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
    values (
      'customer_ledger',
      v_ledger_id::text,
      v_payment.id,
      'MATCHED',
      'MIGRATED_MISSING',
      v_actor_name,
      now(),
      v_actor_name,
      now(),
      trim(p_migration_batch),
      trim(p_reason),
      to_jsonb(v_ledger)
    );

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
      'LEGACY_PAYMENT_MIGRATED',
      'customer_payments',
      v_payment.id::text,
      v_payment.customer_account_id,
      v_payment.customer_branch_id,
      trim(p_reason),
      to_jsonb(v_ledger),
      jsonb_build_object(
        'payment', to_jsonb(v_payment),
        'linked_customer_ledger_id', v_ledger_id,
        'migration_batch', trim(p_migration_batch)
      ),
      v_actor_name
    );

    ledger_id := v_ledger_id;
    canonical_payment_id := v_payment.id;
    action := 'MIGRATED_MISSING';
    return next;
  end loop;
end;
$$;

revoke all on function public.reconcile_customer_ledger_payments_v2()
  from public;
grant execute on function public.reconcile_customer_ledger_payments_v2()
  to authenticated;

revoke all on function public.apply_reviewed_customer_ledger_payment_migration_v1(
  bigint[],text,text
) from public;
grant execute on function public.apply_reviewed_customer_ledger_payment_migration_v1(
  bigint[],text,text
) to authenticated;

comment on function public.reconcile_customer_ledger_payments_v2() is
  'Read-only reconciliation of genuine customer_ledger PAYMENT rows against canonical customer_payments.';
comment on function public.apply_reviewed_customer_ledger_payment_migration_v1(
  bigint[],text,text
) is
  'Migrates or links only explicitly reviewed MATCHED/MISSING legacy payment IDs; ambiguous, duplicate, inactive, and invalid rows are rejected.';
