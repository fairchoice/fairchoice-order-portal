-- Guard atomic picking saves against stale/incomplete browser drafts.
-- This replaces only the already-deployed save function and repairs order-level
-- picking statuses from their persisted item statuses. Item rows are not changed.

create or replace function public.save_order_picking(
  p_order_id uuid,
  p_items jsonb,
  p_changed_by text default 'Admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_entry jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_item_count integer := 0;
  v_saved_total integer;
begin
  if p_order_id is null then
    raise exception 'Order ID is required';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Picking items must be an array';
  end if;

  if nullif(btrim(p_changed_by), '') is null then
    raise exception 'Changed by is required';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) entry
    where coalesce(entry->>'status', 'PENDING') = 'PENDING'
  ) then
    raise exception 'All picking items must be completed before saving';
  end if;

  select count(*) into v_saved_total
  from public.order_items
  where order_id = p_order_id;

  if jsonb_array_length(p_items) <> v_saved_total then
    raise exception 'Picking items contain missing or duplicate order lines';
  end if;

  if exists (
    select 1
    from public.order_items oi
    where oi.order_id = p_order_id
      and not exists (
        select 1
        from jsonb_array_elements(p_items) entry
        where entry->>'orderItemId' = oi.id::text
      )
  ) then
    raise exception 'Every order item must be included before saving picking';
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    if not exists (
      select 1
      from public.order_items
      where id = (v_entry->>'orderItemId')::uuid
        and order_id = p_order_id
    ) then
      raise exception 'Order item does not belong to this order';
    end if;

    v_result := public.update_order_item_picking(
      (v_entry->>'orderItemId')::uuid,
      v_entry->>'status',
      nullif(v_entry->>'quantity', '')::numeric,
      nullif(v_entry->>'replacementProductId', '')::uuid,
      nullif(v_entry->>'replacementProductName', ''),
      p_changed_by
    );

    v_results := v_results || jsonb_build_array(v_result->'item');
    v_item_count := v_item_count + 1;
  end loop;

  update public.orders
  set picking_status = 'COMPLETED',
      updated_at = now()
  where id = p_order_id;

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_picking_status', 'COMPLETED',
    'saved_item_count', v_item_count,
    'items', v_results
  );
end;
$$;

revoke all on function public.save_order_picking(uuid, jsonb, text) from public;
grant execute on function public.save_order_picking(uuid, jsonb, text) to anon, authenticated;

with item_statuses as (
  select
    order_id,
    count(*) as total_count,
    count(*) filter (where coalesce(picking_status, 'PENDING') = 'PENDING') as pending_count,
    count(*) filter (where picking_status in ('IN_STOCK', 'PRE_ORDER', 'REPLACED')) as final_count
  from public.order_items
  group by order_id
), resolved as (
  select
    order_id,
    case
      when total_count > 0 and final_count = total_count then 'COMPLETED'
      when pending_count = total_count then 'NOT_PICKED'
      else 'IN_PROGRESS'
    end as picking_status
  from item_statuses
)
update public.orders o
set picking_status = r.picking_status,
    updated_at = now()
from resolved r
where o.id = r.order_id
  and coalesce(o.picking_status, 'NOT_PICKED') is distinct from r.picking_status;
