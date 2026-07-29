-- Compatibility read model for Weekly Account / Total Collection.
-- This is deliberately read-only and does not migrate or rewrite historical rows.

comment on table public.customer_ledger is
  'DO NOT DELETE - used for historical customer payment reconciliation and audit. Current writes belong in customer_payments.';

do $$
begin
  if to_regclass('public.customer_payment_legacy_migrations') is not null then
    comment on table public.customer_payment_legacy_migrations is
      'DO NOT DELETE - records reviewed links between historical customer_ledger payments and canonical customer_payments.';
  end if;
end
$$;

create or replace view public.v_total_collection_payments
with (security_invoker = true)
as
with canonical_active as (
  select
    'customer_payments:' || p.id::text as canonical_payment_key,
    p.id::text as payment_id,
    p.customer_account_id,
    coalesce(p.customer_branch_id, p.branch_id) as customer_branch_id,
    coalesce(b.branch_name, a.account_name, 'Not available') as customer_name,
    coalesce(nullif(p.payment_reference, ''), 'Not available') as order_number,
    p.payment_date,
    p.created_at,
    p.amount::numeric as amount,
    coalesce(p.payment_method, '') as payment_method,
    coalesce(p.paid_by, '') as who_paid,
    coalesce(
      p.collector_name,
      p.metadata->>'collector_name',
      p.metadata->>'driver_name',
      p.metadata->>'sales_rep_name',
      p.metadata->>'fc_username',
      p.created_by,
      ''
    ) as collected_by,
    case
      when upper(coalesce(p.source, '')) like '%DRIVER%'
        or upper(coalesce(p.collector_role, '')) = 'DRIVER' then 'Driver'
      when upper(coalesce(p.source, '')) like '%SALES_REP%'
        or upper(coalesce(p.collector_role, '')) like '%SALES REP%' then 'Sales Rep Collection'
      else 'Office'
    end as collection_type,
    p.status,
    'customer_payments'::text as source_table,
    p.id::text as source_record_id,
    false as is_legacy
  from public.customer_payments p
  left join public.customer_accounts a on a.id = p.customer_account_id
  left join public.customer_branches b
    on b.id = coalesce(p.customer_branch_id, p.branch_id)
  where upper(coalesce(p.status, '')) in ('POSTED', 'ACTIVE')
    and upper(coalesce(p.verification_status, '')) in ('CONFIRMED', 'NOT_REQUIRED')
),
legacy_candidates as (
  select
    l.*,
    coalesce(
      nullif(l.credit, 0),
      nullif(l.amount, 0),
      nullif(l.payment_amount, 0),
      nullif(l.amount_collected, 0),
      0
    )::numeric as resolved_amount,
    coalesce(l.payment_date, l.collection_date::timestamptz, l.created_at) as resolved_payment_date,
    coalesce(
      nullif(l.payment_reference, ''),
      nullif(l.reference_no, ''),
      nullif(l.order_number, ''),
      'LEDGER-' || l.id::text
    ) as resolved_reference
  from public.customer_ledger l
  where upper(coalesce(l.entry_type, l.transaction_type, '')) in ('PAYMENT', 'COLLECTION')
    and upper(coalesce(l.payment_status, 'POSTED')) not in (
      'PENDING', 'PENDING_VERIFICATION', 'REJECTED', 'VOIDED', 'REVERSED', 'ARCHIVED'
    )
    and l.reversed_at is null
    and coalesce(
      nullif(l.credit, 0),
      nullif(l.amount, 0),
      nullif(l.payment_amount, 0),
      nullif(l.amount_collected, 0),
      0
    ) > 0
),
legacy_ranked as (
  select
    l.*,
    row_number() over (
      partition by
        coalesce(l.customer_account_id::text, lower(trim(l.customer_name)), ''),
        coalesce(l.customer_branch_id::text, l.branch_id::text, ''),
        l.resolved_amount,
        regexp_replace(upper(l.resolved_reference), '[^A-Z0-9]', '', 'g'),
        (l.resolved_payment_date at time zone 'Europe/London')::date
      order by l.created_at nulls last, l.id
    ) as legacy_rank
  from legacy_candidates l
),
legacy_unmatched as (
  select l.*
  from legacy_ranked l
  where l.legacy_rank = 1
    and not exists (
      select 1
      from public.customer_payments p
      where upper(coalesce(p.status, '')) in ('POSTED', 'ACTIVE')
        and upper(coalesce(p.verification_status, '')) in ('CONFIRMED', 'NOT_REQUIRED')
        and (
          p.id = l.central_payment_id
          or p.idempotency_key in (
            'legacy-customer-ledger:' || l.id::text,
            'collection-ledger-' || l.id::text
          )
          or (
            p.customer_account_id = l.customer_account_id
            and (
              coalesce(p.customer_branch_id, p.branch_id) =
                coalesce(l.customer_branch_id, l.branch_id)
              or coalesce(p.customer_branch_id, p.branch_id) is null
              or coalesce(l.customer_branch_id, l.branch_id) is null
            )
            and p.amount = l.resolved_amount
            and regexp_replace(upper(coalesce(p.payment_reference, '')), '[^A-Z0-9]', '', 'g') =
                regexp_replace(upper(l.resolved_reference), '[^A-Z0-9]', '', 'g')
            and (p.payment_date at time zone 'Europe/London')::date =
                (l.resolved_payment_date at time zone 'Europe/London')::date
          )
        )
    )
)
select * from canonical_active
union all
select
  'customer_ledger:' || l.id::text as canonical_payment_key,
  null::text as payment_id,
  l.customer_account_id,
  coalesce(l.customer_branch_id, l.branch_id) as customer_branch_id,
  coalesce(l.branch_name, l.customer_name, a.account_name, 'Not available') as customer_name,
  l.resolved_reference as order_number,
  l.resolved_payment_date as payment_date,
  l.created_at,
  l.resolved_amount as amount,
  coalesce(nullif(l.payment_method, ''), nullif(l.payment_type, ''), '') as payment_method,
  coalesce(nullif(l.who_paid, ''), nullif(l.paid_by, ''), '') as who_paid,
  coalesce(
    nullif(l.collected_by_name, ''),
    nullif(l.collected_by_username, ''),
    nullif(l.received_by, ''),
    nullif(l.paid_by, ''),
    ''
  ) as collected_by,
  case
    when upper(coalesce(l.collection_source, l.source, '')) like '%DRIVER%'
      or upper(coalesce(l.collected_by_role, '')) = 'DRIVER' then 'Driver'
    when upper(coalesce(l.collection_source, l.source, '')) like '%SALES_REP%'
      or upper(coalesce(l.collected_by_role, '')) like '%SALES REP%' then 'Sales Rep Collection'
    else 'Office'
  end as collection_type,
  coalesce(nullif(l.payment_status, ''), 'POSTED') as status,
  'customer_ledger'::text as source_table,
  l.id::text as source_record_id,
  true as is_legacy
from legacy_unmatched l
left join public.customer_accounts a on a.id = l.customer_account_id;

comment on view public.v_total_collection_payments is
  'Canonical-first payment compatibility view. Includes valid unmatched historical customer_ledger payments without copying or changing them.';

revoke all on public.v_total_collection_payments from anon, authenticated;
grant select on public.v_total_collection_payments to anon, authenticated;

notify pgrst, 'reload schema';
