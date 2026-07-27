begin;

alter table public.orders
  add column if not exists picking_status text not null default 'Not Started',
  add column if not exists picking_locked_by text,
  add column if not exists picking_locked_by_name text,
  add column if not exists picking_locked_at timestamptz,
  add column if not exists picking_started_at timestamptz,
  add column if not exists picking_paused_at timestamptz,
  add column if not exists picking_completed_at timestamptz,
  add column if not exists picking_completed_by text,
  add column if not exists picking_completed_by_name text;

alter table public.order_items
  add column if not exists picking_action text,
  add column if not exists picking_decided_by text,
  add column if not exists picking_decided_by_name text,
  add column if not exists picking_decided_at timestamptz,
  add column if not exists replacement_product_id uuid,
  add column if not exists replacement_product_code text,
  add column if not exists replacement_product_name text;

alter table public.orders drop constraint if exists orders_picking_status_check;
alter table public.orders add constraint orders_picking_status_check
  check (picking_status in ('Not Started', 'In Progress', 'Pending', 'Completed'));

alter table public.order_items drop constraint if exists order_items_picking_action_check;
alter table public.order_items add constraint order_items_picking_action_check
  check (picking_action is null or picking_action in ('in_stock', 'pre_order', 'replace'));

create or replace function public.claim_order_for_picking(
  p_order_number text,
  p_picker_id text,
  p_picker_name text
)
returns table(claimed boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order
  from public.orders
  where order_number = p_order_number
  for update;

  if not found then
    return query select false, 'Order not found.'::text;
    return;
  end if;

  if v_order.status not in ('Received', 'In Progress') then
    return query select false, ('Order status is ' || coalesce(v_order.status, 'unknown') || '.')::text;
    return;
  end if;

  if v_order.picking_locked_by is not null and v_order.picking_locked_by <> p_picker_id then
    return query select false, ('This order is being picked by ' || coalesce(v_order.picking_locked_by_name, 'another person') || '.')::text;
    return;
  end if;

  update public.orders
  set status = 'In Progress',
      picking_status = 'In Progress',
      picking_locked_by = p_picker_id,
      picking_locked_by_name = p_picker_name,
      picking_locked_at = now(),
      picking_started_at = coalesce(picking_started_at, now()),
      picking_paused_at = null
  where order_number = p_order_number;

  return query select true, 'Order opened for picking.'::text;
end;
$$;

create or replace function public.pause_order_picking(
  p_order_number text,
  p_picker_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders
  set status = 'In Progress',
      picking_status = 'Pending',
      picking_locked_by = null,
      picking_locked_by_name = null,
      picking_locked_at = null,
      picking_paused_at = now()
  where order_number = p_order_number
    and picking_locked_by = p_picker_id;
  return found;
end;
$$;

create or replace function public.complete_order_picking(
  p_order_number text,
  p_picker_id text
)
returns table(completed boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_picker_name text;
  v_total integer;
  v_decided integer;
begin
  select id, picking_locked_by_name into v_order_id, v_picker_name
  from public.orders
  where order_number = p_order_number
    and picking_locked_by = p_picker_id
  for update;

  if not found then
    return query select false, 'The picking lock is no longer held by this user.'::text;
    return;
  end if;

  select count(*), count(*) filter (where picking_action is not null)
  into v_total, v_decided
  from public.order_items
  where order_id = v_order_id;

  if v_total = 0 or v_decided <> v_total then
    return query select false, 'Every product must have a picking decision.'::text;
    return;
  end if;

  update public.order_items
  set source_status = case picking_action
        when 'in_stock' then 'In Stock'
        when 'pre_order' then 'Need Supplier'
        when 'replace' then 'In Stock'
        else source_status
      end,
      include_in_picking = case when picking_action = 'pre_order' then false else true end,
      picked_qty = case when picking_action = 'pre_order' then 0 else qty end,
      product_id = case when picking_action = 'replace' then replacement_product_id else product_id end,
      product_code = case when picking_action = 'replace' then replacement_product_code else product_code end,
      product_name = case when picking_action = 'replace' then replacement_product_name else product_name end
  where order_id = v_order_id;

  update public.orders
  set status = 'Warehouse Packing',
      picking_status = 'Completed',
      picking_completed_at = now(),
      picking_completed_by = p_picker_id,
      picking_completed_by_name = v_picker_name,
      picking_locked_by = null,
      picking_locked_by_name = null,
      picking_locked_at = null
  where id = v_order_id;

  return query select true, 'Picking completed.'::text;
end;
$$;

grant execute on function public.claim_order_for_picking(text, text, text) to authenticated;
grant execute on function public.pause_order_picking(text, text) to authenticated;
grant execute on function public.complete_order_picking(text, text) to authenticated;

commit;
