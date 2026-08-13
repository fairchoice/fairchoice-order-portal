-- Keep financially voided delivered invoices out of canonical customer account history.
-- This migration only defines the repair; it is not applied automatically.

create or replace function public.sync_customer_invoice_from_order_v1(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_invoice_number text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_account_id is null then return; end if;

  v_invoice_number := coalesce(nullif(trim(v_order.order_number), ''), v_order.id::text);

  -- A financial void is final for accounting even though the operational order
  -- remains delivered. Never let a later order update re-issue the invoice.
  if upper(trim(coalesce(v_order.financial_status, 'ACTIVE'))) = 'VOID' then
    update public.customer_invoices
    set status = 'CANCELLED',
        financial_status = 'VOID',
        financial_correction_id = v_order.financial_correction_id,
        void_reason = coalesce(v_order.financial_void_reason, void_reason),
        voided_at = coalesce(v_order.financial_voided_at, voided_at, now()),
        voided_by = coalesce(v_order.financial_voided_by, voided_by),
        updated_at = now()
    where order_id = v_order.id
       or upper(trim(invoice_number)) = upper(trim(v_invoice_number));

    perform public.recalculate_central_payment_fifo(v_order.customer_account_id);
    return;
  end if;

  if lower(trim(coalesce(v_order.status, ''))) in
    ('delivered', 'confirmed', 'delivery confirmed', 'completed') then
    insert into public.customer_invoices (
      customer_account_id, customer_branch_id, order_id, invoice_number,
      invoice_date, invoice_total, price_mode, status, created_by, updated_at
    ) values (
      v_order.customer_account_id,
      coalesce(v_order.customer_branch_id, v_order.branch_id),
      v_order.id,
      v_invoice_number,
      coalesce(v_order.delivered_at, v_order.updated_at, v_order.created_at, now()),
      public.canonical_order_invoice_total(v_order.id),
      to_jsonb(v_order)->>'price_mode',
      'ISSUED',
      'order-invoice-sync',
      now()
    )
    on conflict (invoice_number) do update
    set customer_account_id = excluded.customer_account_id,
        customer_branch_id = excluded.customer_branch_id,
        order_id = excluded.order_id,
        invoice_date = excluded.invoice_date,
        invoice_total = excluded.invoice_total,
        price_mode = excluded.price_mode,
        status = 'ISSUED',
        updated_at = now();
  elsif lower(trim(coalesce(v_order.status, ''))) in ('cancelled', 'canceled') then
    update public.customer_invoices
    set status = 'CANCELLED', updated_at = now()
    where order_id = v_order.id;
  else
    return;
  end if;

  perform public.recalculate_central_payment_fifo(v_order.customer_account_id);
end;
$$;

revoke all on function public.sync_customer_invoice_from_order_v1(uuid)
from public, anon, authenticated;
