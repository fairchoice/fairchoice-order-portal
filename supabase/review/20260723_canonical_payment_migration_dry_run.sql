-- READ-ONLY REVIEW SCRIPT.
-- Run only after 20260723122000_legacy_customer_payment_reconciliation.sql
-- has been installed. This file performs SELECT statements only.

select count(*) as total_customer_ledger_rows
from public.customer_ledger;

select
  upper(coalesce(nullif(trim(entry_type), ''), nullif(trim(transaction_type), ''), 'UNKNOWN'))
    as transaction_category,
  count(*) as row_count
from public.customer_ledger
group by 1
order by 1;

select
  classification,
  confidence,
  count(*) as row_count,
  round(sum(amount), 2) as payment_total
from public.reconcile_customer_ledger_payments_v2()
group by classification, confidence
order by classification, confidence;

select *
from public.reconcile_customer_ledger_payments_v2()
where classification in ('DUPLICATE', 'AMBIGUOUS', 'INVALID', 'VOIDED_OR_INACTIVE')
order by classification, ledger_id;

select *
from public.reconcile_customer_ledger_payments_v2()
where classification = 'MISSING'
order by payment_or_created_date, ledger_id;

select
  p.id as canonical_payment_id,
  p.idempotency_key,
  l.id as customer_ledger_id,
  l.central_payment_id,
  p.customer_account_id,
  p.customer_branch_id,
  p.amount,
  p.payment_date,
  p.payment_reference
from public.customer_payments p
left join public.customer_ledger l
  on l.central_payment_id = p.id
where upper(coalesce(p.transaction_type, 'PAYMENT')) = 'PAYMENT'
order by p.payment_date, p.id;
