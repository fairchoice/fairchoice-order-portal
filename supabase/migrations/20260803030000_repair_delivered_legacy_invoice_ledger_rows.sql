-- Repair the two explicitly reviewed delivered legacy orders that have active
-- payment ledger rows but no invoice ledger row.
--
-- Preview compatibility note:
-- public.orders.id is uuid while public.customer_ledger.order_id is bigint.
-- This repair deliberately does not read, compare, or write the ledger order_id.
-- The full order number is the ledger link. The source UUID is audit metadata only.
--
-- READ-ONLY PREVIEW PREFLIGHT (run separately before applying this migration):
--
-- select
--   c.column_name,
--   c.data_type,
--   c.udt_name,
--   c.is_nullable
-- from information_schema.columns c
-- where c.table_schema = 'public'
--   and c.table_name = 'customer_ledger'
--   and c.column_name in (
--     'id', 'customer_account_id', 'customer_id', 'customer_branch_id',
--     'branch_id', 'branch_name', 'customer_name', 'entry_type',
--     'transaction_type', 'reference_no', 'description', 'debit', 'credit',
--     'amount', 'payment_amount', 'invoice_total', 'invoice_amount',
--     'paid_amount', 'remaining_amount', 'invoice_status', 'order_number',
--     'price_mode', 'order_price_mode', 'delivered_date', 'invoice_date',
--     'payment_status', 'voided_at', 'reversed_at', 'source', 'notes',
--     'created_at', 'updated_at'
--   )
-- order by c.ordinal_position;
--
-- select
--   o.id as source_order_uuid,
--   o.order_number,
--   o.status,
--   o.picking_status,
--   o.grand_total,
--   o.order_total,
--   to_jsonb(o)->>'net_total' as net_total,
--   to_jsonb(o)->>'vat_total' as vat_total,
--   to_jsonb(o)->>'customer_account_id' as customer_account_id,
--   to_jsonb(o)->>'customer_id' as customer_id,
--   to_jsonb(o)->>'customer_branch_id' as customer_branch_id,
--   to_jsonb(o)->>'branch_id' as branch_id,
--   to_jsonb(o)->>'company_name' as customer_name,
--   coalesce(
--     nullif(trim(to_jsonb(o)->>'branch_name'), ''),
--     nullif(trim(to_jsonb(o)->>'delivery_branch_name'), '')
--   ) as branch_name,
--   to_jsonb(o)->>'delivered_at' as delivered_at
-- from public.orders o
-- where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- order by o.order_number;
--
-- select
--   coalesce(l.reference_no, l.order_number) as full_order_reference,
--   upper(coalesce(nullif(trim(l.entry_type), ''), nullif(trim(l.transaction_type), ''))) as ledger_type,
--   l.customer_account_id,
--   l.customer_id,
--   l.customer_branch_id,
--   l.branch_id,
--   l.customer_name,
--   l.branch_name,
--   l.debit,
--   l.credit,
--   l.amount,
--   l.payment_amount,
--   l.invoice_total,
--   l.paid_amount,
--   l.remaining_amount,
--   l.invoice_status,
--   l.payment_status,
--   l.voided_at,
--   l.reversed_at,
--   l.created_at
-- from public.customer_ledger l
-- where l.reference_no in ('ORD-1784144566386', 'ORD-1784197506132')
--    or l.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- order by full_order_reference, l.created_at, l.id;
--
-- with target_orders as (
--   select
--     o.order_number,
--     nullif(to_jsonb(o)->>'customer_account_id', '')::uuid as customer_account_id,
--     nullif(to_jsonb(o)->>'customer_branch_id', '')::uuid as customer_branch_id,
--     nullif(to_jsonb(o)->>'branch_id', '')::uuid as branch_id,
--     round(
--       case when coalesce(o.grand_total, 0) > 0
--            then o.grand_total else o.order_total end,
--       2
--     ) as invoice_total
--   from public.orders o
--   where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- )
-- select
--   target.order_number,
--   target.invoice_total,
--   count(*) filter (
--     where upper(coalesce(nullif(trim(ledger.entry_type), ''), nullif(trim(ledger.transaction_type), ''))) = 'INVOICE'
--   ) as invoice_row_count,
--   count(*) filter (
--     where upper(coalesce(nullif(trim(ledger.entry_type), ''), nullif(trim(ledger.transaction_type), ''))) in ('PAYMENT', 'COLLECTION')
--       and upper(coalesce(nullif(trim(ledger.payment_status), ''), 'POSTED'))
--             not in ('VOIDED', 'REVERSED', 'DELETED', 'ARCHIVED', 'INACTIVE', 'REJECTED')
--       and ledger.voided_at is null
--       and ledger.reversed_at is null
--   ) as active_payment_row_count,
--   coalesce(sum(ledger.payment_amount) filter (
--     where upper(coalesce(nullif(trim(ledger.entry_type), ''), nullif(trim(ledger.transaction_type), ''))) in ('PAYMENT', 'COLLECTION')
--       and (target.customer_account_id is null
--            or coalesce(ledger.customer_account_id, ledger.customer_id) is null
--            or coalesce(ledger.customer_account_id, ledger.customer_id) = target.customer_account_id)
--       and (coalesce(target.customer_branch_id, target.branch_id) is null
--            or coalesce(ledger.customer_branch_id, ledger.branch_id) is null
--            or coalesce(ledger.customer_branch_id, ledger.branch_id)
--                 = coalesce(target.customer_branch_id, target.branch_id))
--       and upper(coalesce(nullif(trim(ledger.payment_status), ''), 'POSTED'))
--             not in ('VOIDED', 'REVERSED', 'DELETED', 'ARCHIVED', 'INACTIVE', 'REJECTED')
--       and ledger.voided_at is null
--       and ledger.reversed_at is null
--   ), 0) as active_payment_total
-- from target_orders target
-- left join public.customer_ledger ledger
--   on ledger.reference_no = target.order_number
--   or ledger.order_number = target.order_number
-- group by target.order_number, target.invoice_total
-- order by target.order_number;

begin;

do $$
declare
  v_target_count integer;
  v_order record;
  v_customer_name text;
  v_branch_name text;
  v_payment_row_count integer;
  v_payment_total numeric;
  v_invoice_count integer;
  v_valid_invoice_count integer;
  v_inserted_ledger_id bigint;
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
      o.id as source_order_uuid,
      o.order_number,
      o.status,
      o.picking_status,
      o.grand_total as source_grand_total,
      o.order_total as source_order_total,
      round(
        case
          when coalesce(o.grand_total, 0) > 0 then o.grand_total
          else o.order_total
        end,
        2
      ) as repair_invoice_total,
      nullif(to_jsonb(o)->>'customer_account_id', '')::uuid as customer_account_id,
      nullif(to_jsonb(o)->>'customer_id', '')::uuid as customer_id,
      nullif(to_jsonb(o)->>'customer_branch_id', '')::uuid as customer_branch_id,
      nullif(to_jsonb(o)->>'branch_id', '')::uuid as branch_id,
      nullif(trim(to_jsonb(o)->>'company_name'), '') as order_customer_name,
      nullif(trim(to_jsonb(o)->>'branch_name'), '') as order_branch_name,
      nullif(trim(to_jsonb(o)->>'delivery_branch_name'), '') as delivery_branch_name,
      nullif(to_jsonb(o)->>'price_mode', '') as price_mode,
      nullif(to_jsonb(o)->>'net_total', '')::numeric as source_net_total,
      nullif(to_jsonb(o)->>'vat_total', '')::numeric as source_vat_total,
      coalesce(
        nullif(to_jsonb(o)->>'delivered_at', '')::timestamptz,
        nullif(to_jsonb(o)->>'created_at', '')::timestamptz,
        now()
      ) as invoice_date
    from public.orders o
    where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
    order by o.order_number
    for update of o
  loop
    if upper(coalesce(v_order.status, '')) <> 'DELIVERED' then
      raise exception 'Order % is not Delivered.', v_order.order_number;
    end if;

    if upper(coalesce(v_order.picking_status, '')) <> 'COMPLETED' then
      raise exception 'Order % does not have completed Picking.', v_order.order_number;
    end if;

    if coalesce(v_order.repair_invoice_total, 0) <= 0 then
      raise exception 'Order % has no positive invoice total.', v_order.order_number;
    end if;

    v_customer_name := coalesce(
      v_order.order_customer_name,
      (
        select nullif(trim(account.account_name), '')
        from public.customer_accounts account
        where account.id = v_order.customer_account_id
      ),
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
          )
        order by payment.created_at, payment.id
        limit 1
      )
    );

    v_branch_name := coalesce(
      v_order.order_branch_name,
      v_order.delivery_branch_name,
      (
        select nullif(trim(payment.branch_name), '')
        from public.customer_ledger payment
        where upper(coalesce(
                nullif(trim(payment.entry_type), ''),
                nullif(trim(payment.transaction_type), ''),
                ''
              )) in ('PAYMENT', 'COLLECTION')
          and (
            payment.reference_no = v_order.order_number
            or payment.order_number = v_order.order_number
          )
        order by payment.created_at, payment.id
        limit 1
      )
    );

    if v_customer_name is null then
      raise exception 'Order % has no resolvable customer name.', v_order.order_number;
    end if;

    select
      count(*),
      coalesce(sum(payment.payment_amount), 0)
      into v_payment_row_count, v_payment_total
    from public.customer_ledger payment
    where upper(coalesce(
            nullif(trim(payment.entry_type), ''),
            nullif(trim(payment.transaction_type), ''),
            ''
          )) in ('PAYMENT', 'COLLECTION')
      and (
        payment.reference_no = v_order.order_number
        or payment.order_number = v_order.order_number
      )
      and (
        v_order.customer_account_id is null
        or coalesce(payment.customer_account_id, payment.customer_id) is null
        or coalesce(payment.customer_account_id, payment.customer_id)
             = v_order.customer_account_id
      )
      and (
        coalesce(v_order.customer_branch_id, v_order.branch_id) is null
        or coalesce(payment.customer_branch_id, payment.branch_id) is null
        or coalesce(payment.customer_branch_id, payment.branch_id)
             = coalesce(v_order.customer_branch_id, v_order.branch_id)
      )
      and upper(coalesce(nullif(trim(payment.payment_status), ''), 'POSTED'))
            not in ('VOIDED', 'REVERSED', 'DELETED', 'ARCHIVED', 'INACTIVE', 'REJECTED')
      and payment.voided_at is null
      and payment.reversed_at is null;

    if v_payment_row_count = 0 then
      raise exception 'Order % has no active matching payment ledger row.', v_order.order_number;
    end if;

    if round(v_payment_total, 2) < v_order.repair_invoice_total then
      raise exception
        'Active payment coverage for order % is % but the invoice total is %.',
        v_order.order_number,
        round(v_payment_total, 2),
        v_order.repair_invoice_total;
    end if;

    select count(*)
      into v_invoice_count
    from public.customer_ledger existing_invoice
    where upper(coalesce(
            nullif(trim(existing_invoice.entry_type), ''),
            nullif(trim(existing_invoice.transaction_type), ''),
            ''
          )) = 'INVOICE'
      and (
        existing_invoice.reference_no = v_order.order_number
        or existing_invoice.order_number = v_order.order_number
      );

    if v_invoice_count > 1 then
      raise exception
        'Order % already has % invoice ledger rows; repair will not guess.',
        v_order.order_number,
        v_invoice_count;
    end if;

    if v_invoice_count = 0 then
      v_inserted_ledger_id := null;

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
        order_number,
        price_mode,
        order_price_mode,
        delivered_date,
        invoice_date,
        source,
        notes,
        created_at,
        updated_at
      ) values (
        v_order.customer_account_id,
        v_order.customer_id,
        v_order.customer_branch_id,
        v_order.branch_id,
        v_branch_name,
        v_customer_name,
        'INVOICE',
        'INVOICE',
        v_order.order_number,
        'Invoice',
        v_order.repair_invoice_total,
        0,
        v_order.repair_invoice_total,
        0,
        v_order.repair_invoice_total,
        v_order.repair_invoice_total,
        v_order.repair_invoice_total,
        0,
        'PAID',
        v_order.order_number,
        v_order.price_mode,
        v_order.price_mode,
        v_order.invoice_date,
        v_order.invoice_date,
        'LEGACY_DELIVERED_INVOICE_REPAIR',
        'Repaired missing delivered-order invoice ledger row; existing payment rows were not changed.',
        v_order.invoice_date,
        now()
      )
      on conflict do nothing
      returning id into v_inserted_ledger_id;

      if v_inserted_ledger_id is not null then
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
          inserted_invoice.id::text,
          inserted_invoice.customer_account_id,
          inserted_invoice.customer_branch_id,
          'Inserted one missing PAID invoice ledger row without creating or modifying payment rows.',
          to_jsonb(inserted_invoice) || jsonb_build_object(
            'source_order_uuid', v_order.source_order_uuid,
            'source_order_number', v_order.order_number,
            'source_grand_total', v_order.source_grand_total,
            'source_order_total', v_order.source_order_total,
            'preserved_net_total', v_order.source_net_total,
            'preserved_vat_total', v_order.source_vat_total,
            'active_payment_row_count', v_payment_row_count,
            'active_payment_total', round(v_payment_total, 2)
          ),
          '20260803030000_repair_delivered_legacy_invoice_ledger_rows'
        from public.customer_ledger inserted_invoice
        where inserted_invoice.id = v_inserted_ledger_id;
      end if;
    end if;

    select
      count(*),
      count(*) filter (
        where invoice.entry_type = 'INVOICE'
          and invoice.transaction_type = 'INVOICE'
          and invoice.reference_no = v_order.order_number
          and invoice.order_number = v_order.order_number
          and invoice.customer_account_id is not distinct from v_order.customer_account_id
          and invoice.customer_id is not distinct from v_order.customer_id
          and invoice.customer_branch_id is not distinct from v_order.customer_branch_id
          and invoice.branch_id is not distinct from v_order.branch_id
          and invoice.customer_name = v_customer_name
          and invoice.branch_name is not distinct from v_branch_name
          and round(invoice.debit, 2) = v_order.repair_invoice_total
          and round(invoice.credit, 2) = 0
          and round(invoice.amount, 2) = v_order.repair_invoice_total
          and round(invoice.payment_amount, 2) = 0
          and round(invoice.invoice_total, 2) = v_order.repair_invoice_total
          and round(invoice.invoice_amount, 2) = v_order.repair_invoice_total
          and round(invoice.paid_amount, 2) = v_order.repair_invoice_total
          and round(invoice.remaining_amount, 2) = 0
          and upper(coalesce(invoice.invoice_status, '')) = 'PAID'
          and invoice.delivered_date = v_order.invoice_date
          and invoice.invoice_date = v_order.invoice_date
          and invoice.source = 'LEGACY_DELIVERED_INVOICE_REPAIR'
          and invoice.description = 'Invoice'
      )
      into v_invoice_count, v_valid_invoice_count
    from public.customer_ledger invoice
    where upper(coalesce(
            nullif(trim(invoice.entry_type), ''),
            nullif(trim(invoice.transaction_type), ''),
            ''
          )) = 'INVOICE'
      and (
        invoice.reference_no = v_order.order_number
        or invoice.order_number = v_order.order_number
      );

    if v_invoice_count <> 1 then
      raise exception
        'Order % must have exactly one invoice ledger row after repair; found %.',
        v_order.order_number,
        v_invoice_count;
    end if;

    if v_valid_invoice_count <> 1 then
      raise exception
        'Order % invoice ledger row does not satisfy the required repaired values.',
        v_order.order_number;
    end if;
  end loop;
end
$$;

commit;

-- READ-ONLY POST-DEPLOYMENT VERIFICATION:
--
-- select
--   o.order_number,
--   count(invoice.id) as invoice_row_count,
--   count(invoice.id) filter (
--     where invoice.entry_type = 'INVOICE'
--       and invoice.transaction_type = 'INVOICE'
--       and invoice.reference_no = o.order_number
--       and invoice.order_number = o.order_number
--       and invoice.invoice_status = 'PAID'
--       and invoice.paid_amount = invoice.invoice_total
--       and invoice.remaining_amount = 0
--   ) as valid_paid_invoice_row_count
-- from public.orders o
-- left join public.customer_ledger invoice
--   on (
--     invoice.reference_no = o.order_number
--     or invoice.order_number = o.order_number
--   )
--   and upper(coalesce(nullif(trim(invoice.entry_type), ''), nullif(trim(invoice.transaction_type), ''))) = 'INVOICE'
-- where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
-- group by o.order_number
-- order by o.order_number;
--
-- select
--   o.id as source_order_uuid,
--   o.order_number,
--   o.status,
--   o.picking_status,
--   o.grand_total,
--   o.order_total,
--   to_jsonb(o)->>'net_total' as net_total,
--   to_jsonb(o)->>'vat_total' as vat_total,
--   invoice.id as invoice_ledger_id,
--   invoice.entry_type,
--   invoice.transaction_type,
--   invoice.reference_no,
--   invoice.order_number as ledger_order_number,
--   invoice.customer_account_id,
--   invoice.customer_id,
--   invoice.customer_branch_id,
--   invoice.branch_id,
--   invoice.customer_name,
--   invoice.branch_name,
--   invoice.debit,
--   invoice.credit,
--   invoice.amount,
--   invoice.payment_amount,
--   invoice.invoice_total,
--   invoice.invoice_amount,
--   invoice.paid_amount,
--   invoice.remaining_amount,
--   invoice.invoice_status,
--   invoice.delivered_date,
--   invoice.invoice_date,
--   invoice.source,
--   invoice.description
-- from public.orders o
-- join public.customer_ledger invoice
--   on invoice.reference_no = o.order_number
--   or invoice.order_number = o.order_number
-- where o.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
--   and upper(coalesce(nullif(trim(invoice.entry_type), ''), nullif(trim(invoice.transaction_type), ''))) = 'INVOICE'
-- order by o.order_number, invoice.id;
--
-- select
--   coalesce(payment.reference_no, payment.order_number) as full_order_reference,
--   count(*) as payment_row_count,
--   sum(payment.payment_amount) as recorded_payment_total,
--   min(payment.created_at) as first_payment_created_at,
--   max(payment.created_at) as last_payment_created_at
-- from public.customer_ledger payment
-- where upper(coalesce(nullif(trim(payment.entry_type), ''), nullif(trim(payment.transaction_type), ''))) in ('PAYMENT', 'COLLECTION')
--   and (
--     payment.reference_no in ('ORD-1784144566386', 'ORD-1784197506132')
--     or payment.order_number in ('ORD-1784144566386', 'ORD-1784197506132')
--   )
-- group by coalesce(payment.reference_no, payment.order_number)
-- order by full_order_reference;
