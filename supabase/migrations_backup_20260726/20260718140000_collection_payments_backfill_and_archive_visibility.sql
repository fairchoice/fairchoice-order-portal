-- Copy historical collection rows into customer_payments so Central Payment actions
-- operate on real payment records. Archived rows remain VOIDED and therefore are
-- excluded from Customer Credit calculations.

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
  created_at,
  updated_at
)
select
  l.customer_account_id,
  l.customer_branch_id,
  coalesce(nullif(trim(l.reference_no), ''), 'LEDGER-' || l.id::text),
  coalesce(l.created_at, now()),
  coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0)),
  case
    when l.payment_type in ('Cash','Card','Bank Transfer','Cheque','Other') then l.payment_type
    else 'Other'
  end,
  coalesce(l.paid_by, l.who_paid, l.collected_by_name, l.received_by, ''),
  concat_ws(E'\n',
    nullif(l.notes, ''),
    'Collection type: ' || coalesce(nullif(l.collection_source, ''), 'Collection')
  ),
  'COLLECTION',
  'collection-ledger-' || l.id::text,
  'POSTED',
  coalesce(l.collected_by_name, l.received_by, l.paid_by, 'collection-backfill'),
  coalesce(l.created_at, now()),
  now()
from public.customer_ledger l
where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'PAYMENT'
  and l.customer_account_id is not null
  and coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0), 0) > 0
on conflict do nothing;

-- The archive lifecycle sets customer_payments.status to VOIDED. Customer Credit
-- already filters VOIDED records; this index keeps those reads efficient.
create index if not exists customer_payments_active_customer_date_idx
  on public.customer_payments (customer_account_id, payment_date desc)
  where status <> 'VOIDED';
