-- READ-ONLY TEST PLAN for the July duplicate-delivery/invoice investigation.
-- Safe to run in TEST. Do not apply correction RPCs until each candidate is reviewed.

-- 1. Find delivered orders on the two reported dates.
select
  o.id,
  o.order_number,
  o.company_name,
  o.customer_account_id,
  coalesce(o.customer_branch_id, o.branch_id) as customer_branch_id,
  o.status,
  o.delivered_at,
  o.order_total,
  o.grand_total,
  o.financial_status
from public.orders o
where o.delivered_at >= '2026-07-24 00:00:00'
  and o.delivered_at <  '2026-07-25 00:00:00'
order by o.company_name, o.order_number;

select
  o.id,
  o.order_number,
  o.company_name,
  o.customer_account_id,
  coalesce(o.customer_branch_id, o.branch_id) as customer_branch_id,
  o.status,
  o.delivered_at,
  o.order_total,
  o.grand_total,
  o.financial_status
from public.orders o
where o.delivered_at >= '2026-07-28 00:00:00'
  and o.delivered_at <  '2026-07-29 00:00:00'
order by o.company_name, o.order_number;

-- 2. Find duplicate-looking invoice ledger rows without changing anything.
select
  l.customer_account_id,
  coalesce(l.customer_branch_id, l.branch_id) as branch_id,
  coalesce(l.order_number, l.reference_no) as invoice_reference,
  count(*) as invoice_rows,
  array_agg(l.id order by l.id) as ledger_ids,
  array_agg(l.invoice_total order by l.id) as invoice_totals,
  array_agg(l.created_at order by l.id) as created_times
from public.customer_ledger l
where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'INVOICE'
  and l.created_at >= '2026-07-24 00:00:00'
  and l.created_at <  '2026-07-29 23:59:59.999999'
group by
  l.customer_account_id,
  coalesce(l.customer_branch_id, l.branch_id),
  coalesce(l.order_number, l.reference_no)
having count(*) > 1
order by invoice_rows desc, invoice_reference;

-- 3. Payment 199 reconciliation preview.
select *
from public.reconcile_customer_ledger_payments_v2()
where ledger_id = 199;

-- 4. After installing this migration in TEST, preview a chosen order through
-- preview_owner_invoice_correction_v1(username, session_token, order_number)
-- from the application service. Do not paste live session tokens into SQL history.
