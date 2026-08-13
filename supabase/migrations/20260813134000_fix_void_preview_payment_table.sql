-- Fix emergency invoice-void preview to use the canonical FairChoice payment table.
-- The previous preview referenced public.central_payments, which is not part of the current schema.
-- This migration changes only the preview function; it does not mutate business data.

begin;

create or replace function public.preview_owner_invoice_correction_v1(
  p_username text,
  p_session_token text,
  p_order_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_invoice jsonb;
  v_ledger jsonb;
  v_allocations jsonb;
  v_payments jsonb;
  v_location_return_qty numeric := 0;
  v_legacy_return_qty numeric := 0;
  v_legacy_order_item_return_qty numeric := 0;
  v_financial_voided boolean := false;
  v_inventory_reversed boolean := false;
begin
  select * into v_actor
  from public.fc_require_nisstaj_admin_session_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Order number is required.';
  end if;

  select * into v_order
  from public.orders
  where upper(trim(order_number)) = upper(trim(p_order_number))
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Order % was not found.', p_order_number;
  end if;

  v_financial_voided := upper(coalesce(v_order.financial_status, 'ACTIVE')) = 'VOID';
  v_inventory_reversed := v_order.duplicate_void_inventory_reversed_at is not null;

  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
    into v_invoice
  from public.customer_invoices i
  where i.order_id = v_order.id
     or upper(trim(i.invoice_number)) = upper(trim(v_order.order_number));

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    into v_ledger
  from public.customer_ledger l
  where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'INVOICE'
    and (
      l.order_id::text = v_order.id::text
      or upper(trim(coalesce(l.order_number, ''))) = upper(trim(v_order.order_number))
      or upper(trim(coalesce(l.reference_no, ''))) = upper(trim(v_order.order_number))
    );

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.customer_account_id = v_order.customer_account_id
    and lower(coalesce(a.status, 'active')) = 'active'
    and (
      upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
      or a.invoice_source_id = v_order.id::text
    );

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    into v_payments
  from public.customer_payments p
  where p.customer_account_id = v_order.customer_account_id
    and exists (
      select 1
      from public.customer_payment_allocations a
      where a.central_payment_id = p.id
        and lower(coalesce(a.status, 'active')) = 'active'
        and (
          upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
          or a.invoice_source_id = v_order.id::text
        )
    );

  if not v_inventory_reversed then
    select coalesce(sum(e.quantity), 0)
      into v_location_return_qty
    from public.order_item_picking_events e
    join public.order_items oi on oi.id = e.order_item_id
    where oi.order_id = v_order.id
      and e.reversed_at is null
      and e.stock_location_id is not null
      and e.stock_product_id is not null;

    select coalesce(sum(abs(sm.qty)), 0)
      into v_legacy_return_qty
    from public.stock_movements sm
    where sm.movement_type = 'SALE'
      and sm.qty < 0
      and upper(trim(coalesce(sm.note, ''))) = upper(trim(v_order.order_number));


    -- Old orders may pre-date both location-aware picking events and SALE
    -- movements. stock_before > stock_after on the order item is the persisted
    -- proof that inventory was deducted.
    select coalesce(sum(greatest(coalesce(oi.stock_before, 0) - coalesce(oi.stock_after, 0), 0)), 0)
      into v_legacy_order_item_return_qty
    from public.order_items oi
    where oi.order_id = v_order.id
      and oi.stock_before is not null
      and oi.stock_after is not null
      and oi.stock_before > oi.stock_after;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'customer_invoices', v_invoice,
    'ledger_invoices', v_ledger,
    'allocations', v_allocations,
    'payments', v_payments,
    'financial_already_voided', v_financial_voided,
    'inventory_already_reversed', v_inventory_reversed,
    'already_voided', v_financial_voided and v_inventory_reversed,
    'location_stock_return_qty', v_location_return_qty,
    'legacy_stock_return_qty', v_legacy_return_qty,
    'legacy_order_item_return_qty', v_legacy_order_item_return_qty,
    'warning', 'This will void the invoice and return its deducted stock to inventory.'
  );
end;
$$;


revoke all on function public.preview_owner_invoice_correction_v1(text, text, text) from public;
grant execute on function public.preview_owner_invoice_correction_v1(text, text, text) to anon, authenticated;

commit;
