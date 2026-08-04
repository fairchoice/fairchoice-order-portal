begin;

-- Repair confirmed driver TODAY_INVOICE payments that were posted without
-- linking the payment to the delivered order. This migration is additive and
-- idempotent: it only touches exact customer/order matches with no active
-- allocation for the payment.

-- Stop instead of guessing when an unallocated qualifying payment cannot be
-- tied to one positive-value canonical order in the same account/branch.
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
      and not exists (
        select 1
        from public.customer_payment_allocations existing
        where existing.payment_id = p.id
          and existing.status = 'active'
          and existing.reversed_at is null
          and existing.voided_at is null
      )
    group by p.id
    having count(o.id) <> 1
       or max(public.canonical_order_invoice_total(o.id)) <= 0
  ) then
    raise exception 'Ambiguous unallocated TODAY_INVOICE payment: canonical exact order is not uniquely resolvable.';
  end if;
end;
$$;

with candidate_payments as (
  select
    p.id as payment_id,
    p.customer_account_id,
    p.customer_branch_id,
    p.amount as payment_amount,
    p.payment_reference,
    p.collector_staff_id,
    p.created_by,
    o.id as order_id,
    o.order_number,
    public.canonical_order_invoice_total(o.id) as invoice_total,
    greatest(
      public.canonical_order_invoice_total(o.id)
      - coalesce((
          select sum(a.allocated_amount)
          from public.customer_payment_allocations a
          where a.status = 'active'
            and a.reversed_at is null
            and a.voided_at is null
            and a.customer_account_id = o.customer_account_id
            and coalesce(a.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = coalesce(o.customer_branch_id, o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            and (
              a.invoice_source_id = o.id::text
              or a.invoice_reference = o.order_number
            )
        ), 0),
      0
    ) as invoice_outstanding
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
    and public.canonical_order_invoice_total(o.id) > 0
    and not exists (
      select 1
      from public.customer_payment_allocations existing
      where existing.payment_id = p.id
        and existing.status = 'active'
        and existing.reversed_at is null
        and existing.voided_at is null
    )
), repaired_payments as (
  update public.customer_payments p
  set
    order_id = c.order_id,
    updated_at = now(),
    metadata = coalesce(p.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'allocation_reconciled_at', now(),
        'allocation_reconciled_by', '20260803020000_reconcile_driver_today_invoice_allocations'
      )
  from candidate_payments c
  where p.id = c.payment_id
    and p.order_id is null
    and least(c.payment_amount, c.invoice_outstanding) > 0
  returning p.id
), inserted_allocations as (
  insert into public.customer_payment_allocations (
    payment_id,
    customer_account_id,
    customer_branch_id,
    invoice_reference,
    invoice_source_id,
    allocated_amount,
    allocation_type,
    status,
    created_by,
    allocated_at
  )
  select
    c.payment_id,
    c.customer_account_id,
    c.customer_branch_id,
    c.order_number,
    c.order_id::text,
    least(c.payment_amount, c.invoice_outstanding),
    -- Repair/recalculation allocations use the schema's established rebuild
    -- category. Normal canonical writer allocations use automatic.
    'rebuild',
    'active',
    c.collector_staff_id,
    now()
  from candidate_payments c
  where least(c.payment_amount, c.invoice_outstanding) > 0
    and not exists (
      select 1
      from public.customer_payment_allocations existing
      where existing.payment_id = c.payment_id
        and existing.status = 'active'
        and existing.reversed_at is null
        and existing.voided_at is null
    )
  returning *
)
insert into public.financial_audit_log (
  action,
  entity_type,
  entity_id,
  customer_account_id,
  customer_branch_id,
  reason,
  after_data,
  changed_by
)
select
  'DRIVER_TODAY_INVOICE_ALLOCATION_RECONCILED',
  'customer_payment_allocations',
  a.id::text,
  a.customer_account_id,
  a.customer_branch_id,
  'Reconciled a confirmed driver TODAY_INVOICE payment that had no canonical invoice allocation.',
  to_jsonb(a),
  '20260803020000_reconcile_driver_today_invoice_allocations'
from inserted_allocations a;

-- Future driver TODAY_INVOICE payments are checked at transaction commit.
-- The canonical writer inserts the payment first and its allocations second, so
-- a deferred constraint trigger verifies the final atomic result.
create or replace function public.fc_enforce_driver_today_invoice_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.customer_payments%rowtype;
begin
  -- Since this trigger is deferred, validate the row's final state. A queued
  -- NEW image can pre-date a later void/update in the same transaction.
  select p.*
  into v_payment
  from public.customer_payments p
  where p.id = new.id;

  if not found then
    return new;
  end if;

  if v_payment.source = 'DRIVER_DELIVERY_COLLECTION'
     and v_payment.status = 'POSTED'
     and v_payment.verification_status = 'CONFIRMED'
     and coalesce(v_payment.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
     and v_payment.voided_at is null then
    if v_payment.order_id is null then
      raise exception 'TODAY_INVOICE delivery payments require the order UUID.';
    end if;

    if not exists (
      select 1
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
        and a.customer_account_id = v_payment.customer_account_id
        and coalesce(a.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
            = coalesce(v_payment.customer_branch_id, v_payment.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and a.status = 'active'
        and a.reversed_at is null
        and a.voided_at is null
        and a.invoice_source_id = v_payment.order_id::text
        and a.allocated_amount > 0
    ) then
      raise exception 'TODAY_INVOICE delivery payments require an active invoice allocation.';
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
