-- Repair the two explicitly reviewed delivered legacy orders that have payment
-- ledger rows but no invoice ledger row.
--
-- READ-ONLY PREVIEW PREFLIGHT (run separately before applying this migration):
--
-- select
--   o.id,
--   o.order_number,
--   o.status,
--   o.picking_status,
--   o.customer_account_id,
--   o.customer_branch_id,
--   o.branch_id,
--   o.company_name,
--   o.grand_total,
--   o.order_total,
--   o.net_total,
--   o.vat_total,
--   o.delivered_at
-- from public.orders o
-- where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- order by o.order_number;
--
-- select
--   l.order_id,
--   coalesce(l.reference_no, l.order_number, l.payment_reference) as reference,
--   upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) as ledger_type,
--   l.customer_account_id,
--   l.customer_branch_id,
--   l.branch_id,
--   l.debit,
--   l.credit,
--   l.amount,
--   l.payment_amount,
--   l.paid_amount,
--   l.payment_status,
--   l.voided_at,
--   l.reversed_at,
--   l.created_at
-- from public.customer_ledger l
-- where l.reference_no in ('ORD-1784144566386', 'ORD-1784197506132')
--    or l.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
--    or l.payment_reference in ('ORD-1784144566386', 'ORD-1784197506132')
-- order by reference, l.created_at, l.id;
--
-- with target_orders as (
--   select
--     o.*,
--     round(case when coalesce(o.grand_total, 0) > 0
--                then o.grand_total else o.order_total end, 2) as invoice_total
--   from public.orders o
--   where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- )
-- select
--   o.order_number,
--   o.invoice_total,
--   count(*) filter (
--     where upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) = 'INVOICE'
--   ) as invoice_row_count,
--   coalesce(sum(
--     greatest(
--       coalesce(l.credit, 0),
--       coalesce(l.payment_amount, 0),
--       coalesce(l.amount_collected, 0),
--       coalesce(l.amount, 0),
--       coalesce(l.paid_amount, 0)
--     )
--   ) filter (
--     where upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) in ('PAYMENT', 'COLLECTION')
--       and (
--         o.customer_account_id is null
--         or coalesce(l.customer_account_id, l.customer_id) = o.customer_account_id
--       )
--       and (
--         coalesce(o.customer_branch_id, o.branch_id) is null
--         or coalesce(l.customer_branch_id, l.branch_id) is null
--         or coalesce(l.customer_branch_id, l.branch_id)
--              = coalesce(o.customer_branch_id, o.branch_id)
--       )
--       and upper(coalesce(l.payment_status, 'POSTED')) not in ('VOIDED', 'REVERSED', 'DELETED', 'ARCHIVED', 'INACTIVE', 'REJECTED')
--       and l.voided_at is null
--       and l.reversed_at is null
--   ), 0) as active_payment_total
-- from target_orders o
-- left join public.customer_ledger l
--   on l.reference_no = o.order_number
--   or l.order_number = o.order_number
--   or l.payment_reference = o.order_number
-- group by o.order_number, o.invoice_total
-- order by o.order_number;

begin;

do $$
declare
  v_target_count integer;
  v_order record;
  v_payment_total numeric;
  v_customer_name text;
begin
  select count(*)
    into v_target_count
  from public.orders o
  where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132');

  if v_target_count <> 2 then
    raise exception
      'Legacy invoice repair expected exactly two target orders, found %.',
      v_target_count;
  end if;

  for v_order in
    select
      o.*,
      round(
        case
          when coalesce(o.grand_total, 0) > 0 then o.grand_total
          else o.order_total
        end,
        2
      ) as repair_invoice_total
    from public.orders o
    where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
    order by o.order_number
    for update
  loop
    if upper(coalesce(v_order.status, '')) <> 'DELIVERED' then
      raise exception 'Order % is not Delivered.', v_order.order_number;
    end if;

    if upper(coalesce(v_order.picking_status, '')) <> 'COMPLETED' then
      raise exception 'Order % does not have completed Picking.', v_order.order_number;
    end if;

    -- A rerun must be a no-op for an order that already has its one invoice.
 if exists (
      select 1
      from public.customer_ledger existing_invoice
      where upper(coalesce(
              nullif(trim(existing_invoice.entry_type), ''),
              nullif(trim(existing_invoice.transaction_type), ''),
              ''
            )) = 'INVOICE'
        and (
          existing_invoice.reference_no = v_order.order_number
          or existing_invoice.order_number = v_order.order_number
        )
    ) then
      continue;
    end if;

    if coalesce(v_order.repair_invoice_total, 0) <= 0 then
      raise exception 'Order % has no positive invoice total.', v_order.order_number;
    end if;

    select coalesce(
             nullif(trim(v_order.company_name), ''),
             nullif(trim(account.account_name), ''),
             (
               select nullif(trim(payment.customer_name), '')
               from public.customer_ledger payment
               where upper(coalesce(
                       nullif(trim(payment.entry_type), ''),
                       nullif(trim(payment.transaction_type), ''),
                       ''
                     )) in ('PAYMENT', 'COLLECTION')
                 and (
                   payment.reference_no = v_order.order_number
                   or payment.order_number = v_order.order_number
                   or payment.payment_reference = v_order.order_number
                 )
               order by payment.created_at, payment.id
               limit 1
             )
           )
      into v_customer_name
    from (select 1) anchor
    left join public.customer_accounts account
      on account.id = v_order.customer_account_id;

    if v_customer_name is null then
      raise exception 'Order % has no resolvable customer name.', v_order.order_number;
    end if;

    select coalesce(sum(
             greatest(
               coalesce(payment.credit, 0),
               coalesce(payment.payment_amount, 0),
               coalesce(payment.amount_collected, 0),
               coalesce(payment.amount, 0),
               coalesce(payment.paid_amount, 0)
             )
           ), 0)
      into v_payment_total
    from public.customer_ledger payment
    where upper(coalesce(
            nullif(trim(payment.entry_type), ''),
            nullif(trim(payment.transaction_type), ''),
            ''
          )) in ('PAYMENT', 'COLLECTION')
      and (
        payment.reference_no = v_order.order_number
        or payment.order_number = v_order.order_number
        or payment.payment_reference = v_order.order_number
      )
      and (
        v_order.customer_account_id is null
        or coalesce(payment.customer_account_id, payment.customer_id) = v_order.customer_account_id
      )
      and (
        coalesce(v_order.customer_branch_id, v_order.branch_id) is null
        or coalesce(payment.customer_branch_id, payment.branch_id) is null
        or coalesce(payment.customer_branch_id, payment.branch_id)
             = coalesce(v_order.customer_branch_id, v_order.branch_id)
      )
      and upper(coalesce(payment.payment_status, 'POSTED'))
            not in ('VOIDED', 'REVERSED', 'DELETED', 'ARCHIVED', 'INACTIVE', 'REJECTED')
      and payment.voided_at is null
      and payment.reversed_at is null;

    if round(v_payment_total, 2) < v_order.repair_invoice_total then
      raise exception
        'Active payment coverage for order % is % but the invoice total is %.',
        v_order.order_number,
        round(v_payment_total, 2),
        v_order.repair_invoice_total;
    end if;
  end loop;
end
$$;

with target_orders as (
  select
    o.*,
    round(
      case
        when coalesce(o.grand_total, 0) > 0 then o.grand_total
        else o.order_total
      end,
      2
    ) as repair_invoice_total,
    coalesce(
      nullif(trim(o.company_name), ''),
      nullif(trim(account.account_name), ''),
      (
        select nullif(trim(payment.customer_name), '')
        from public.customer_ledger payment
        where upper(coalesce(
                nullif(trim(payment.entry_type), ''),
                nullif(trim(payment.transaction_type), ''),
                ''
              )) in ('PAYMENT', 'COLLECTION')
          and (
            payment.reference_no = o.order_number
            or payment.order_number = o.order_number
            or payment.payment_reference = o.order_number
          )
        order by payment.created_at, payment.id
        limit 1
      )
    ) as repair_customer_name
  from public.orders o
  left join public.customer_accounts account
    on account.id = o.customer_account_id
  where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
), inserted as (
  insert into public.customer_ledger (
    customer_account_id,
    customer_id,
    customer_branch_id,
    branch_id,
    branch_name,
    customer_name,
    entry_type,
    transaction_type,
    reference_no,
    description,
    debit,
    credit,
    amount,
    payment_amount,
    invoice_total,
    invoice_amount,
    paid_amount,
    remaining_amount,
    invoice_status,
    order_id,
    order_number,
    price_mode,
    order_price_mode,
    delivered_date,
    invoice_date,
    source,
    notes,
    created_at,
    updated_at
  )
select
    target.customer_account_id,
    nullif(to_jsonb(target)->>'customer_id', '')::uuid,
    target.customer_branch_id,
    target.branch_id,
    coalesce(
      nullif(trim(to_jsonb(target)->>'branch_name'), ''),
      nullif(trim(to_jsonb(target)->>'delivery_branch_name'), '')
    ),
    target.repair_customer_name,
    'INVOICE',
    'INVOICE',
    target.order_number,
    'Invoice',
    target.repair_invoice_total,
    0,
    target.repair_invoice_total,
    0,
    target.repair_invoice_total,
    target.repair_invoice_total,
    target.repair_invoice_total,
    0,
    'PAID',
    target.id,
    target.order_number,
    target.price_mode,
    target.price_mode,
    coalesce(target.delivered_at, target.created_at),
    coalesce(target.delivered_at, target.created_at),
    'LEGACY_DELIVERED_INVOICE_REPAIR',
    'Repaired missing delivered-order invoice ledger row; existing payment rows were not changed.',
    coalesce(target.delivered_at, target.created_at, now()),
    now()
  from target_orders target
  where not exists (
    select 1
    from public.customer_ledger existing_invoice
    where upper(coalesce(
            nullif(trim(existing_invoice.entry_type), ''),
            nullif(trim(existing_invoice.transaction_type), ''),
            ''
          )) = 'INVOICE'
      and (
  existing_invoice.reference_no = target.order_number
  or existing_invoice.order_number = target.order_number
)
  )
  on conflict do nothing
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
  'LEGACY_DELIVERED_INVOICE_LEDGER_REPAIRED',
  'customer_ledger',
  inserted.id::text,
  inserted.customer_account_id,
  inserted.customer_branch_id,
  'Inserted one missing PAID invoice ledger row without creating or modifying payment rows.',
  jsonb_build_object(
    'ledger_row', to_jsonb(inserted),
    'source_order_number', target.order_number,
    'source_grand_total', target.grand_total,
    'source_order_total', target.order_total,
    'preserved_net_total', target.net_total,
    'preserved_vat_total', target.vat_total
  ),
  '20260803030000_repair_delivered_legacy_invoice_ledger_rows'
from inserted
join target_orders target
  on target.order_number = inserted.order_number;

do $$
declare
  v_order_number text;
  v_invoice_count integer;
  v_valid_invoice_count integer;
begin
  foreach v_order_number in array array[
    'ORD-1784144566386',
    'ORD-1784197506132'
  ]
  loop
    select
      count(*),
      count(*) filter (
        where invoice.reference_no = o.order_number
          and invoice.order_number = o.order_number
          and (
  invoice.reference_no = o.order_number
  or invoice.order_number = o.order_number
)
          and invoice.customer_account_id is not distinct from o.customer_account_id
          and invoice.customer_branch_id is not distinct from o.customer_branch_id
          and invoice.branch_id is not distinct from o.branch_id
          and round(invoice.invoice_total, 2) = round(
            case when coalesce(o.grand_total, 0) > 0
                 then o.grand_total else o.order_total end,
            2
          )
          and round(invoice.paid_amount, 2) = round(
            case when coalesce(o.grand_total, 0) > 0
                 then o.grand_total else o.order_total end,
            2
          )
          and round(invoice.remaining_amount, 2) = 0
          and upper(coalesce(invoice.invoice_status, '')) = 'PAID'
      )
      into v_invoice_count, v_valid_invoice_count
    from public.customer_ledger invoice
    join public.orders o on o.order_number = v_order_number
    where upper(coalesce(
            nullif(trim(invoice.entry_type), ''),
            nullif(trim(invoice.transaction_type), ''),
            ''
          )) = 'INVOICE'
      and (
        invoice.reference_no = v_order_number
        or invoice.order_number = v_order_number
        
      );

    if v_invoice_count <> 1 then
      raise exception
        'Order % must have exactly one invoice ledger row after repair; found %.',
        v_order_number,
        v_invoice_count;
    end if;

    if v_valid_invoice_count <> 1 then
      raise exception
        'Order % invoice ledger row does not satisfy the required repaired values.',
        v_order_number;
    end if;
  end loop;
end
$$;

commit;

-- READ-ONLY POST-DEPLOYMENT VERIFICATION:
--
-- select
--   o.order_number,
--   o.status,
--   o.picking_status,
--   o.grand_total,
--   o.order_total,
--   o.net_total,
--   o.vat_total,
--   l.id as invoice_ledger_id,
--   l.entry_type,
--   l.transaction_type,
--   l.reference_no,
--   l.order_number as ledger_order_number,
--   l.order_id,
--   l.customer_account_id,
--   l.customer_branch_id,
--   l.branch_id,
--   l.debit,
--   l.invoice_total,
--   l.invoice_amount,
--   l.paid_amount,
--   l.remaining_amount,
--   l.invoice_status,
--   l.source
-- from public.orders o
-- join public.customer_ledger l
--   on l.order_id = o.id
--   or l.reference_no = o.order_number
--   or l.order_number = o.order_number
-- where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
--   and upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) = 'INVOICE'
-- order by o.order_number, l.id;
--
-- select
--   coalesce(l.reference_no, l.order_number, l.payment_reference) as reference,
--   count(*) as payment_row_count,
--   sum(greatest(
--     coalesce(l.credit, 0),
--     coalesce(l.payment_amount, 0),
--     coalesce(l.amount_collected, 0),
--     coalesce(l.amount, 0),
--     coalesce(l.paid_amount, 0)
--   )) as recorded_payment_total
-- from public.customer_ledger l
-- where upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) in ('PAYMENT', 'COLLECTION')
--   and (
--     l.reference_no in ('ORD-1784144566386', 'ORD-1784197506132')
--     or l.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
--     or l.payment_reference in ('ORD-1784144566386', 'ORD-1784197506132')
--   )
-- group by coalesce(l.reference_no, l.order_number, l.payment_reference)
-- order by reference;
