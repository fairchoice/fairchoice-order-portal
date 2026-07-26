-- Received-order picking state and audit trail.
-- Additive only: this does not alter invoice, payment, allocation, or ledger data.

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists picking_status text not null default 'NOT_PICKED';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_picking_status_check' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint orders_picking_status_check
      check (picking_status in ('NOT_PICKED', 'IN_PROGRESS', 'COMPLETED'));
  end if;
end;
$$;

alter table public.order_items
  add column if not exists picking_status text not null default 'PENDING',
  add column if not exists original_product_id uuid,
  add column if not exists original_product_name text,
  add column if not exists replacement_product_id uuid,
  add column if not exists replacement_product_name text,
  add column if not exists picking_updated_at timestamptz,
  add column if not exists picking_updated_by text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_picking_status_check' and conrelid = 'public.order_items'::regclass) then
    alter table public.order_items add constraint order_items_picking_status_check
      check (picking_status in ('PENDING', 'IN_STOCK', 'PRE_ORDER', 'REPLACED'));
  end if;
end;
$$;

create index if not exists orders_picking_status_created_idx
  on public.orders (picking_status, created_at desc);
create index if not exists order_items_picking_status_idx
  on public.order_items (order_id, picking_status);

create table if not exists public.order_picking_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  order_number text,
  old_status text not null,
  new_status text not null,
  original_product_id uuid,
  replacement_product_id uuid,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists order_picking_audit_order_time_idx
  on public.order_picking_audit (order_id, changed_at desc);

alter table public.order_picking_audit enable row level security;
revoke all on public.order_picking_audit from anon, authenticated;

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
  if p_status = 'REPLACED' and (p_replacement_product_id is null or nullif(btrim(p_replacement_product_name), '') is null) then
    raise exception 'A replacement product is required';
  end if;
  if nullif(btrim(p_changed_by), '') is null then
    raise exception 'Changed by is required';
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then raise exception 'Order item not found'; end if;
  select * into v_order from public.orders where id = v_item.order_id for update;
  if not found then raise exception 'Order not found'; end if;

  v_before := jsonb_build_object(
    'picking_status', coalesce(v_item.picking_status, 'PENDING'),
    'picked_qty', v_item.picked_qty,
    'replacement_product_id', v_item.replacement_product_id,
    'replacement_product_name', v_item.replacement_product_name
  );

  update public.order_items set
    picking_status = p_status,
    picked_qty = coalesce(p_quantity, picked_qty, qty),
    include_in_picking = case when p_status = 'PRE_ORDER' then false else true end,
    original_product_id = case when p_status = 'REPLACED' then coalesce(original_product_id, product_id) else original_product_id end,
    original_product_name = case when p_status = 'REPLACED' then coalesce(original_product_name, product_name) else original_product_name end,
    replacement_product_id = case when p_status = 'REPLACED' then p_replacement_product_id else replacement_product_id end,
    replacement_product_name = case when p_status = 'REPLACED' then p_replacement_product_name else replacement_product_name end,
    picking_updated_at = now(),
    picking_updated_by = p_changed_by,
    updated_at = now()
  where id = p_order_item_id
  returning * into v_item;

  v_after := jsonb_build_object(
    'picking_status', v_item.picking_status,
    'picked_qty', v_item.picked_qty,
    'replacement_product_id', v_item.replacement_product_id,
    'replacement_product_name', v_item.replacement_product_name
  );

  insert into public.order_picking_audit
    (order_id, order_item_id, order_number, old_status, new_status, original_product_id,
     replacement_product_id, before_values, after_values, changed_by)
  values
    (v_item.order_id, v_item.id, v_order.order_number, coalesce(v_before->>'picking_status', 'PENDING'),
     v_item.picking_status, coalesce(v_item.original_product_id, v_item.product_id),
     v_item.replacement_product_id, v_before, v_after, p_changed_by);

  select count(*),
         count(*) filter (where coalesce(picking_status, 'PENDING') = 'PENDING'),
         count(*) filter (where picking_status in ('IN_STOCK', 'PRE_ORDER'))
    into v_total, v_pending, v_final
  from public.order_items
  where order_id = v_item.order_id;

  v_order_status := case
    when v_total > 0 and v_final = v_total then 'COMPLETED'
    when v_total = 0 or v_pending = v_total then 'NOT_PICKED'
    else 'IN_PROGRESS'
  end;

  update public.orders
  set picking_status = v_order_status, updated_at = now()
  where id = v_item.order_id;

  return jsonb_build_object(
    'order_id', v_item.order_id,
    'order_picking_status', v_order_status,
    'item', jsonb_build_object(
      'id', v_item.id,
      'picking_status', v_item.picking_status,
      'picked_qty', v_item.picked_qty,
      'original_product_id', v_item.original_product_id,
      'original_product_name', v_item.original_product_name,
      'replacement_product_id', v_item.replacement_product_id,
      'replacement_product_name', v_item.replacement_product_name
    )
  );
end;
$$;

revoke all on function public.update_order_item_picking(uuid, text, numeric, uuid, text, text) from public;
grant execute on function public.update_order_item_picking(uuid, text, numeric, uuid, text, text) to anon, authenticated;
