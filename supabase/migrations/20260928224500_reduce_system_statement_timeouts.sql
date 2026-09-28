-- Reduce system-wide statement timeouts.
-- Performance-only change: indexes and an index-friendly preorder history reader.
-- No invoice, payment, customer-credit, order, or queue rows are modified.


create index if not exists orders_created_at_desc_idx
  on public.orders (created_at desc);


create index if not exists preorder_supply_events_created_id_idx
  on public.preorder_supply_events (created_at desc, id desc);


create index if not exists customer_invoices_fifo_idx
  on public.customer_invoices
  (customer_account_id, status, invoice_date, invoice_number, id);


create index if not exists customer_payments_fifo_idx
  on public.customer_payments
  (customer_account_id, status, verification_status, payment_date, created_at, id);


create index if not exists customer_payment_allocations_customer_invoice_status_idx
  on public.customer_payment_allocations
  (customer_account_id, invoice_reference, status);


create index if not exists central_payment_balances_customer_idx
  on public.central_payment_balances
  (customer_account_id, customer_branch_id);


create or replace function public.fc_list_preorder_supply_events_v2(
  p_username text,
  p_session_token text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_page_size integer default 500
)
returns setof jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.fc_require_session_permission(
    p_username,
    p_session_token,
    'page.warehouse'
  );


  return query
  select to_jsonb(e)
    || jsonb_build_object(
      'order_status', matched_order.order_status,
      'delivery_confirmed_at', matched_order.delivery_confirmed_at,
      'delivery_confirmed', (
        lower(coalesce(matched_order.order_status, '')) in (
          'delivered',
          'delivery confirmed',
          'confirmed delivered'
        )
        or matched_order.delivery_confirmed_at is not null
      )
    )
  from public.preorder_supply_events e
  left join lateral (
    select
      o.status as order_status,
      coalesce(o.delivered_at, nullif(to_jsonb(o)->>'delivery_confirmed_at','')::timestamptz) as delivery_confirmed_at
    from public.orders o
    where o.order_number = e.order_number


    union all


    select
      o.status as order_status,
      coalesce(o.delivered_at, nullif(to_jsonb(o)->>'delivery_confirmed_at','')::timestamptz) as delivery_confirmed_at
    from public.orders o
    where e.order_number ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and o.id = e.order_number::uuid
      and o.order_number is distinct from e.order_number


    limit 1
  ) matched_order on true
  where p_before_created_at is null
     or (e.created_at, e.id) < (
       p_before_created_at,
       coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
     )
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_page_size, 500), 1000));
end;
$$;


create index if not exists customer_branches_customer_account_idx
  on public.customer_branches (customer_account_id);


create index if not exists customer_payments_driver_today_idx
  on public.customer_payments (customer_account_id, id)
  where source='DRIVER_DELIVERY_COLLECTION'
    and status='POSTED'
    and verification_status='CONFIRMED'
    and coalesce(metadata->>'payment_applies_to','')='TODAY_INVOICE'
    and voided_at is null;


analyze public.orders;
analyze public.processing_queue;
analyze public.preorder_supply_events;
analyze public.customer_invoices;
analyze public.customer_payments;
analyze public.customer_payment_allocations;