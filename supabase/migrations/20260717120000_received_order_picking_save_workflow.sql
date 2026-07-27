-- Atomic received-order picking save workflow.
-- Additive only: does not delete or rewrite existing orders, invoices, payments,
-- allocations, customer history, or picking audit rows.

create or replace function public.update_order_item_picking(
  p_order_item_id uuid,
  p_status text,
  p_quantity numeric default null,
  p_replacement_product_id uuid default null,
  p_replacement_product_name text default null,
  p_changed_by text default 'Admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_order_status text;
  v_total integer;
  v_pending integer;
  v_final integer;
begin
  if p_status not in ('PENDING', 'IN_STOCK', 'PRE_ORDER', 'REPLACED') then
    raise exception 'Invalid picking status';
  end if;

  if p_quantity is not null and p_quantity < 0 then
    raise exception 'Picked quantity cannot be negative';
  end if;

  if p_status = 'REPLACED' and (
    p_replacement_product_id is null or
    nullif(btrim(p_replacement_product_name), '') is null
  ) then
    raise exception 'A replacement product is required';
  end if;

  if nullif(btrim(p_changed_by), '') is null then
    raise exception 'Changed by is required';
  end if;

  select *
  into v_item
  from public.order_items
  where id = p_order_item_id
  for update;

  if not found then
    raise exception 'Order item not found';
  end if;

  select *
  into v_order
  from public.orders
  where id = v_item.order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  v_before := jsonb_build_object(
    'picking_status', coalesce(v_item.picking_status, 'PENDING'),
    'qty', v_item.qty,
    'picked_qty', v_item.picked_qty,
    'include_in_picking', v_item.include_in_picking,
    'product_id', v_item.product_id,
    'product_name', v_item.product_name,
    'replacement_product_id', v_item.replacement_product_id,
    'replacement_product_name', v_item.replacement_product_name
  );

  update public.order_items
  set
    picking_status = p_status,
    qty = case
      when p_quantity is null then qty
      else p_quantity
    end,
    picked_qty = case
      when p_status = 'PRE_ORDER' then 0
      else coalesce(p_quantity, picked_qty, qty)
    end,
    include_in_picking = case
      when p_status = 'PRE_ORDER' then false
      else true
    end,
    original_product_id = case
      when p_status = 'REPLACED' then coalesce(original_product_id, product_id)
      else original_product_id
    end,
    original_product_name = case
      when p_status = 'REPLACED' then coalesce(original_product_name, product_name)
      else original_product_name
    end,
    product_id = case
      when p_status = 'REPLACED' then p_replacement_product_id
      else product_id
    end,
    product_name = case
      when p_status = 'REPLACED' then p_replacement_product_name
      else product_name
    end,
    replacement_product_id = case
      when p_status = 'REPLACED' then p_replacement_product_id
      else replacement_product_id
    end,
    replacement_product_name = case
      when p_status = 'REPLACED' then p_replacement_product_name
      else replacement_product_name
    end,
    source_status = case
      when p_status in ('IN_STOCK', 'REPLACED') then 'In Stock'
      when p_status = 'PRE_ORDER' then 'Need Supplier'
      else source_status
    end,
    picking_updated_at = now(),
    picking_updated_by = p_changed_by,
    updated_at = now()
  where id = p_order_item_id
  returning * into v_item;

  v_after := jsonb_build_object(
    'picking_status', v_item.picking_status,
    'qty', v_item.qty,
    'picked_qty', v_item.picked_qty,
    'include_in_picking', v_item.include_in_picking,
    'product_id', v_item.product_id,
    'product_name', v_item.product_name,
    'replacement_product_id', v_item.replacement_product_id,
    'replacement_product_name', v_item.replacement_product_name
  );

  insert into public.order_picking_audit
    (order_id, order_item_id, order_number, old_status, new_status,
     original_product_id, replacement_product_id, before_values,
     after_values, changed_by)
  values
    (v_item.order_id, v_item.id, v_order.order_number,
     coalesce(v_before->>'picking_status', 'PENDING'), v_item.picking_status,
     coalesce(v_item.original_product_id, v_item.product_id),
     v_item.replacement_product_id, v_before, v_after, p_changed_by);

  select
    count(*),
    count(*) filter (where coalesce(picking_status, 'PENDING') = 'PENDING'),
    count(*) filter (where picking_status in ('IN_STOCK', 'PRE_ORDER', 'REPLACED'))
  into v_total, v_pending, v_final
  from public.order_items
  where order_id = v_item.order_id;

  v_order_status := case
    when v_total > 0 and v_final = v_total then 'COMPLETED'
    when v_total = 0 or v_pending = v_total then 'NOT_PICKED'
    else 'IN_PROGRESS'
  end;

  update public.orders
  set picking_status = v_order_status,
      updated_at = now()
  where id = v_item.order_id;

  return jsonb_build_object(
    'order_id', v_item.order_id,
    'order_picking_status', v_order_status,
    'item', jsonb_build_object(
      'id', v_item.id,
      'picking_status', v_item.picking_status,
      'qty', v_item.qty,
      'picked_qty', v_item.picked_qty,
      'include_in_picking', v_item.include_in_picking,
      'product_id', v_item.product_id,
      'product_name', v_item.product_name,
      'original_product_id', v_item.original_product_id,
      'original_product_name', v_item.original_product_name,
      'replacement_product_id', v_item.replacement_product_id,
      'replacement_product_name', v_item.replacement_product_name,
      'source_status', v_item.source_status
    )
  );
end;
$$;

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

revoke all on function public.update_order_item_picking(uuid, text, numeric, uuid, text, text) from public;
grant execute on function public.update_order_item_picking(uuid, text, numeric, uuid, text, text) to anon, authenticated;

revoke all on function public.save_order_picking(uuid, jsonb, text) from public;
grant execute on function public.save_order_picking(uuid, jsonb, text) to anon, authenticated;
