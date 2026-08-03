begin;

-- Preserve the Received Orders status that existed before the first picking
-- decision so Recall All can restore it. Picking events remain the permanent
-- audit trail for actor, timestamp, action, quantity and replacement details.
alter table public.order_items
  add column if not exists picking_original_source_status text;

create or replace function public.fc_sync_received_order_status_from_picking_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_old_resolved numeric :=
      coalesce(old.picking_in_stock_qty, 0)
    + coalesce(old.picking_pre_order_qty, 0)
    + coalesce(old.picking_replaced_qty, 0);
  v_new_resolved numeric :=
      coalesce(new.picking_in_stock_qty, 0)
    + coalesce(new.picking_pre_order_qty, 0)
    + coalesce(new.picking_replaced_qty, 0);
begin
  if v_old_resolved = 0 and v_new_resolved > 0
     and new.picking_original_source_status is null then
    new.picking_original_source_status := coalesce(old.source_status, 'In Stock');
  end if;

  if v_new_resolved = 0 then
    new.source_status := coalesce(
      new.picking_original_source_status,
      old.picking_original_source_status,
      old.source_status,
      'In Stock'
    );
    new.include_in_picking :=
      new.source_status not in ('Need Supplier', 'Pre-Order', 'Pre Order', 'Cannot Supply');
    new.picked_qty := case when new.include_in_picking then coalesce(new.qty, 0) else 0 end;
    new.picking_original_source_status := null;
    return new;
  end if;

  -- Any unresolved supplier requirement must remain visible as Pre-order in
  -- Received Orders. Fully picked or replaced lines are shown as In Stock.
  if coalesce(new.picking_pre_order_qty, 0) > 0 then
    new.source_status := 'Need Supplier';
    new.include_in_picking := false;
  else
    new.source_status := 'In Stock';
    new.include_in_picking := true;
  end if;

  new.picked_qty :=
      coalesce(new.picking_in_stock_qty, 0)
    + coalesce(new.picking_replaced_qty, 0);

  return new;
end;
$function$;

revoke all on function public.fc_sync_received_order_status_from_picking_v1()
  from public, anon, authenticated;

drop trigger if exists order_items_sync_received_status_from_picking
  on public.order_items;

create trigger order_items_sync_received_status_from_picking
before update of
  picking_in_stock_qty,
  picking_pre_order_qty,
  picking_replaced_qty,
  replacement_product_id,
  replacement_product_code,
  replacement_product_name
on public.order_items
for each row
execute function public.fc_sync_received_order_status_from_picking_v1();

comment on column public.order_items.picking_original_source_status is
  'Received Orders source status captured before the first picking decision and restored when all picking decisions are recalled.';

notify pgrst, 'reload schema';
commit;
