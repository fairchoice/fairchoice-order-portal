begin transaction read only;

-- Header totals are compatibility fields only. The deployed Customer Credit
-- source of truth is canonical_order_invoice_total(order UUID), which resolves
-- active order_items and falls back to a saved order total only when needed.
select
  o.id,
  o.order_number,
  o.customer_account_id,
  coalesce(o.customer_branch_id, o.branch_id) as branch_id,
  o.status,
  o.created_at,
  o.grand_total,
  o.order_total,
  o.net_total,
  o.vat_total,
  o.subtotal,
  public.canonical_order_invoice_total(o.id) as canonical_order_items_total,
  ledger.invoice_total as customer_ledger_invoice_total,
  invoice.invoice_total as customer_invoice_total,
  allocations.active_allocated,
  case
    when public.canonical_order_invoice_total(o.id) > 0
      then 'VALID LEGACY INVOICE - order header total stale'
    when lower(trim(coalesce(o.status, ''))) in ('cancelled', 'canceled')
      then 'ZERO-VALUE/CANCELLED ORDER'
    else 'AMBIGUOUS - MANUAL REVIEW REQUIRED'
  end as classification
from public.orders o
left join lateral (
  select max(coalesce(
    nullif(cl.invoice_total, 0),
    nullif(cl.invoice_amount, 0),
    nullif(cl.debit, 0),
    nullif(cl.amount, 0)
  )) as invoice_total
  from public.customer_ledger cl
  where cl.customer_account_id = o.customer_account_id
    and cl.voided_at is null
    and cl.reversed_at is null
    and upper(coalesce(cl.entry_type, cl.transaction_type, '')) = 'INVOICE'
    and (
      upper(trim(cl.reference_no)) = upper(trim(o.order_number))
      or upper(trim(cl.order_number)) = upper(trim(o.order_number))
    )
) ledger on true
left join lateral (
  select max(ci.invoice_total) as invoice_total
  from public.customer_invoices ci
  where ci.status <> 'CANCELLED'
    and ci.customer_account_id = o.customer_account_id
    and (ci.order_id = o.id or upper(trim(ci.invoice_number)) = upper(trim(o.order_number)))
) invoice on true
left join lateral (
  select sum(a.allocated_amount) as active_allocated
  from public.customer_payment_allocations a
  where a.status = 'active'
    and a.reversed_at is null
    and a.voided_at is null
    and (a.invoice_source_id = o.id::text or upper(trim(a.invoice_reference)) = upper(trim(o.order_number)))
) allocations on true
where coalesce(o.grand_total, o.order_total, 0) = 0
  and coalesce(allocations.active_allocated, 0) > 0
order by o.created_at, o.order_number;

-- Must return no rows: a qualifying exact payment must resolve to one order and
-- that order must have a positive canonical total.
select
  p.id as payment_id,
  p.payment_reference,
  p.customer_account_id,
  coalesce(p.customer_branch_id, p.branch_id) as branch_id,
  count(o.id) as exact_order_matches,
  max(public.canonical_order_invoice_total(o.id)) as canonical_target_total
from public.customer_payments p
left join public.orders o
  on o.order_number = p.payment_reference
 and o.customer_account_id = p.customer_account_id
 and coalesce(o.customer_branch_id, o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
     = coalesce(p.customer_branch_id, p.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
where p.source = 'DRIVER_DELIVERY_COLLECTION'
  and p.status = 'POSTED'
  and p.verification_status = 'CONFIRMED'
  and coalesce(p.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
  and p.voided_at is null
group by p.id, p.payment_reference, p.customer_account_id,
         coalesce(p.customer_branch_id, p.branch_id)
having count(o.id) <> 1
    or max(public.canonical_order_invoice_total(o.id)) <= 0;

-- Mismatched allocations to be considered by the repair. A source_order_count
-- other than one, a non-positive source total, or a non-rebuild type is a hard
-- stop requiring manual review.
with exact_payments as (
  select
    p.id as payment_id,
    p.payment_reference,
    p.customer_account_id,
    p.customer_branch_id,
    p.branch_id,
    o.id as exact_order_id
  from public.customer_payments p
  join public.orders o
    on o.order_number = p.payment_reference
   and o.customer_account_id = p.customer_account_id
   and coalesce(o.customer_branch_id, o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p.customer_branch_id, p.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  where p.source = 'DRIVER_DELIVERY_COLLECTION'
    and p.status = 'POSTED'
    and p.verification_status = 'CONFIRMED'
    and coalesce(p.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
    and p.voided_at is null
)
select
  e.payment_id,
  e.payment_reference as exact_invoice_reference,
  a.id as allocation_id,
  a.invoice_reference as allocated_invoice_reference,
  a.invoice_source_id,
  a.allocated_amount,
  a.allocation_type,
  source_resolution.source_order_count,
  source_resolution.source_canonical_total,
  case
    when a.allocation_type is distinct from 'rebuild'
      or source_resolution.source_order_count <> 1
      or coalesce(source_resolution.source_canonical_total, 0) <= 0
      then 'AMBIGUOUS - MANUAL REVIEW REQUIRED'
    else 'PROVABLY MISMATCHED EXACT PAYMENT'
  end as repair_classification
from exact_payments e
join public.customer_payment_allocations a
  on a.payment_id = e.payment_id
 and a.status = 'active'
 and a.reversed_at is null
 and a.voided_at is null
left join lateral (
  select
    count(distinct source_order.id) as source_order_count,
    max(public.canonical_order_invoice_total(source_order.id)) as source_canonical_total
  from public.orders source_order
  where source_order.customer_account_id = e.customer_account_id
    and coalesce(source_order.customer_branch_id, source_order.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(e.customer_branch_id, e.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and (
      a.invoice_source_id = source_order.id::text
      or a.invoice_reference = source_order.order_number
      or exists (
        select 1
        from public.customer_invoices source_invoice
        where source_invoice.id::text = a.invoice_source_id
          and source_invoice.customer_account_id = source_order.customer_account_id
          and (source_invoice.order_id = source_order.id or source_invoice.invoice_number = source_order.order_number)
      )
    )
) source_resolution on true
where not (
  a.invoice_reference = e.payment_reference
  and (
    a.invoice_source_id = e.exact_order_id::text
    or exists (
      select 1
      from public.customer_invoices exact_invoice
      where exact_invoice.id::text = a.invoice_source_id
        and exact_invoice.customer_account_id = e.customer_account_id
        and (exact_invoice.order_id = e.exact_order_id or exact_invoice.invoice_number = e.payment_reference)
    )
  )
)
order by e.payment_reference, a.allocated_at;

rollback;
