begin;

-- Correct driver TODAY_INVOICE payments that were either left unallocated or
-- misdirected by legacy FIFO/rebuild allocation. Exact invoice payments must
-- only apply to the order named by customer_payments.payment_reference.

-- Refuse to guess when a qualifying exact-invoice payment does not resolve to
-- exactly one order in the same customer/branch scope.
do $$
begin
  if exists (
    select 1
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
    group by p.id
    having count(o.id) <> 1
  ) then
    raise exception 'Ambiguous TODAY_INVOICE payment: exact order/customer/branch match is not unique.';
  end if;
end;
$$;

create temporary table _fc_driver_today_invoice_repairs on commit drop as
select
  p.id as payment_id,
  p.payment_reference,
  p.customer_account_id,
  p.customer_branch_id,
  p.branch_id,
  p.amount as payment_amount,
  p.created_by,
  p.collector_staff_id,
  o.id as order_id,
  o.order_number,
  public.canonical_order_invoice_total(o.id)::numeric as invoice_total
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
  and p.voided_at is null;

-- The existing canonical resolver uses active order_items and only falls back
-- to a saved order total when the calculated total is zero. Zero or unresolved
-- targets require manual review; no repair is allowed to infer a value.
do $$
begin
  if exists (
    select 1
    from _fc_driver_today_invoice_repairs r
    where coalesce(r.invoice_total, 0) <= 0
  ) then
    raise exception 'Ambiguous TODAY_INVOICE payment: canonical target invoice total is zero or unresolved.';
  end if;
end;
$$;

-- Every mismatched active allocation must be a rebuild allocation whose source
-- resolves to exactly one positive-value order. This protects valid legacy
-- invoices whose orders.grand_total header is stale or zero.
do $$
begin
  if exists (
    select 1
    from public.customer_payment_allocations a
    join _fc_driver_today_invoice_repairs r on r.payment_id = a.payment_id
    where a.status = 'active'
      and a.reversed_at is null
      and a.voided_at is null
      and not (
        a.invoice_reference = r.order_number
        and (
          a.invoice_source_id = r.order_id::text
          or exists (
            select 1
            from public.customer_invoices exact_invoice
            where exact_invoice.id::text = a.invoice_source_id
              and exact_invoice.customer_account_id = r.customer_account_id
              and coalesce(exact_invoice.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = coalesce(r.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              and (exact_invoice.order_id = r.order_id or exact_invoice.invoice_number = r.order_number)
          )
        )
      )
      and (
        a.allocation_type is distinct from 'rebuild'
        or 1 <> (
          select count(distinct source_order.id)
          from public.orders source_order
          where source_order.customer_account_id = r.customer_account_id
            and coalesce(source_order.customer_branch_id, source_order.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = coalesce(r.customer_branch_id, r.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
            and public.canonical_order_invoice_total(source_order.id) > 0
        )
      )
  ) then
    raise exception 'Ambiguous TODAY_INVOICE allocation: source invoice is not a unique positive-value rebuild target.';
  end if;
end;
$$;

-- Reverse only demonstrably mismatched rebuild allocations from an exact
-- TODAY_INVOICE payment after the ambiguity checks above. Preserve the row as
-- audit history; never delete it.
with conflicts as (
  select
    a.id,
    a.payment_id,
    to_jsonb(a) as before_data
  from public.customer_payment_allocations a
  join _fc_driver_today_invoice_repairs r on r.payment_id = a.payment_id
  where a.status = 'active'
    and a.reversed_at is null
    and a.voided_at is null
    and not (
      a.invoice_reference = r.order_number
      and (
        a.invoice_source_id = r.order_id::text
        or exists (
          select 1
          from public.customer_invoices exact_invoice
          where exact_invoice.id::text = a.invoice_source_id
            and exact_invoice.customer_account_id = r.customer_account_id
            and coalesce(exact_invoice.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = coalesce(r.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            and (exact_invoice.order_id = r.order_id or exact_invoice.invoice_number = r.order_number)
        )
      )
    )
    and a.allocation_type = 'rebuild'
), reversed as (
  update public.customer_payment_allocations a
  set
    status = 'reversed',
    reversed_at = now(),
    reversal_reason = 'Reversed misdirected legacy rebuild allocation for exact driver TODAY_INVOICE payment.',
    updated_at = now()
  from conflicts c
  where a.id = c.id
  returning a.*, c.before_data
)
insert into public.financial_audit_log (
  action, entity_type, entity_id, customer_account_id, customer_branch_id,
  reason, before_data, after_data, changed_by
)
select
  'DRIVER_TODAY_INVOICE_MISDIRECTED_ALLOCATION_REVERSED',
  'customer_payment_allocations',
  r.id::text,
  r.customer_account_id,
  r.customer_branch_id,
  'Reversed a legacy rebuild allocation that conflicted with the exact TODAY_INVOICE order reference.',
  r.before_data,
  to_jsonb(r) - 'before_data',
  '20260803023000_repair_misdirected_driver_today_invoice_allocations'
from reversed r;

-- Ensure the payment itself carries the exact order UUID.
update public.customer_payments p
set
  order_id = r.order_id,
  updated_at = now(),
  metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
    'exact_invoice_allocation_repaired_at', now(),
    'exact_invoice_allocation_repaired_by', '20260803023000_repair_misdirected_driver_today_invoice_allocations'
  )
from _fc_driver_today_invoice_repairs r
where p.id = r.payment_id
  and p.order_id is distinct from r.order_id;

-- Allocate the remaining usable payment amount to the exact intended order.
with amounts as (
  select
    r.*,
    greatest(
      r.payment_amount - coalesce((
        select sum(a.allocated_amount)
        from public.customer_payment_allocations a
        where a.payment_id = r.payment_id
          and a.status = 'active'
          and a.reversed_at is null
          and a.voided_at is null
      ), 0),
      0
    ) as payment_remaining,
    greatest(
      r.invoice_total - coalesce((
        select sum(a.allocated_amount)
        from public.customer_payment_allocations a
        where a.status = 'active'
          and a.reversed_at is null
          and a.voided_at is null
          and a.customer_account_id = r.customer_account_id
          and coalesce(a.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(r.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          and (
            a.invoice_source_id = r.order_id::text
            or a.invoice_reference = r.order_number
          )
      ), 0),
      0
    ) as invoice_remaining
  from _fc_driver_today_invoice_repairs r
), inserted as (
  insert into public.customer_payment_allocations (
    payment_id,
    customer_account_id,
    customer_branch_id,
    branch_id,
    invoice_reference,
    invoice_source_id,
    allocated_amount,
    allocation_type,
    status,
    created_by,
    allocated_at
  )
  select
    a.payment_id,
    a.customer_account_id,
    a.customer_branch_id,
    a.branch_id,
    a.order_number,
    a.order_id::text,
    least(a.payment_remaining, a.invoice_remaining),
    'rebuild',
    'active',
    a.collector_staff_id,
    now()
  from amounts a
  where least(a.payment_remaining, a.invoice_remaining) > 0
    and not exists (
      select 1
      from public.customer_payment_allocations existing
      where existing.payment_id = a.payment_id
        and existing.status = 'active'
        and existing.reversed_at is null
        and existing.voided_at is null
        and existing.invoice_reference = a.order_number
        and (
          existing.invoice_source_id = a.order_id::text
          or exists (
            select 1
            from public.customer_invoices exact_invoice
            where exact_invoice.id::text = existing.invoice_source_id
              and exact_invoice.customer_account_id = a.customer_account_id
              and coalesce(exact_invoice.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = coalesce(a.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              and (exact_invoice.order_id = a.order_id or exact_invoice.invoice_number = a.order_number)
          )
        )
    )
  returning *
)
insert into public.financial_audit_log (
  action, entity_type, entity_id, customer_account_id, customer_branch_id,
  reason, after_data, changed_by
)
select
  'DRIVER_TODAY_INVOICE_EXACT_ALLOCATION_REPAIRED',
  'customer_payment_allocations',
  i.id::text,
  i.customer_account_id,
  i.customer_branch_id,
  'Created the canonical exact-order allocation for a confirmed driver TODAY_INVOICE payment.',
  to_jsonb(i),
  '20260803023000_repair_misdirected_driver_today_invoice_allocations'
from inserted i;

-- Enforce final persisted state at transaction commit. Exact invoice payments
-- may not remain unallocated or point only to a different invoice.
create or replace function public.fc_enforce_driver_today_invoice_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.customer_payments%rowtype;
begin
  select * into v_payment
  from public.customer_payments
  where id = new.id;

  if not found then
    return new;
  end if;

  if v_payment.source = 'DRIVER_DELIVERY_COLLECTION'
     and v_payment.status = 'POSTED'
     and v_payment.verification_status = 'CONFIRMED'
     and coalesce(v_payment.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
     and v_payment.voided_at is null then
    if v_payment.order_id is null then
      raise exception 'TODAY_INVOICE delivery payments require the exact order UUID.';
    end if;

    if not exists (
      select 1
      from public.orders o
      where o.id = v_payment.order_id
        and o.order_number = v_payment.payment_reference
        and o.customer_account_id = v_payment.customer_account_id
        and coalesce(o.customer_branch_id, o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) then
      raise exception 'TODAY_INVOICE payment reference, customer and branch must match the exact order.';
    end if;

    if not exists (
      select 1
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
        and a.status = 'active'
        and a.reversed_at is null
        and a.voided_at is null
        and a.invoice_reference = v_payment.payment_reference
        and (
          a.invoice_source_id = v_payment.order_id::text
          or exists (
            select 1
            from public.customer_invoices exact_invoice
            where exact_invoice.id::text = a.invoice_source_id
              and exact_invoice.customer_account_id = v_payment.customer_account_id
              and coalesce(exact_invoice.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              and (exact_invoice.order_id = v_payment.order_id or exact_invoice.invoice_number = v_payment.payment_reference)
          )
        )
        and a.customer_account_id = v_payment.customer_account_id
        and coalesce(a.customer_branch_id, a.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and a.allocated_amount > 0
    ) then
      raise exception 'TODAY_INVOICE delivery payments require an active allocation to the exact order.';
    end if;

    if exists (
      select 1
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
        and a.status = 'active'
        and a.reversed_at is null
        and a.voided_at is null
        and not (
          a.invoice_reference = v_payment.payment_reference
          and (
            a.invoice_source_id = v_payment.order_id::text
            or exists (
              select 1
              from public.customer_invoices exact_invoice
              where exact_invoice.id::text = a.invoice_source_id
                and exact_invoice.customer_account_id = v_payment.customer_account_id
                and coalesce(exact_invoice.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                    = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                and (exact_invoice.order_id = v_payment.order_id or exact_invoice.invoice_number = v_payment.payment_reference)
            )
          )
          and a.customer_account_id = v_payment.customer_account_id
          and coalesce(a.customer_branch_id, a.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        )
    ) then
      raise exception 'TODAY_INVOICE delivery payments cannot retain an active allocation to another invoice.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_driver_today_invoice_allocation
  on public.customer_payments;

create constraint trigger trg_enforce_driver_today_invoice_allocation
after insert or update
on public.customer_payments
deferrable initially deferred
for each row
execute function public.fc_enforce_driver_today_invoice_allocation_v1();

revoke all on function public.fc_enforce_driver_today_invoice_allocation_v1() from public;

notify pgrst, 'reload schema';
commit;
