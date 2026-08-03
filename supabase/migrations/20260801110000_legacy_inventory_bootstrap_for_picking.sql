begin;

-- Daily picking compatibility patch.
-- For a legacy product with no location rows anywhere, initialise exactly one
-- order-country row from products.stock, then continue with normal locked
-- country-specific deduction. Existing location inventory never falls back.

create or replace function public.fc_apply_picking_quantity_v1(p_username text,p_session_token text,p_order_item_id uuid,p_action text,p_quantity numeric,p_client_action_id uuid,p_inventory_country text,p_replacement_product_id uuid default null,p_replacement_product_code text default null,p_replacement_product_name text default null)
returns table(picking_ordered_qty numeric,picking_in_stock_qty numeric,picking_pre_order_qty numeric,picking_replaced_qty numeric,picking_action text) language plpgsql security definer set search_path=public as $$
declare v_actor record; v_item public.order_items%rowtype; v_order public.orders%rowtype; v_existing public.order_item_picking_events%rowtype; v_resolved numeric; v_country text; v_replacement uuid; v_stock_product_id uuid; v_any_location_count integer; v_country_location_count integer; v_country_location_id uuid; v_stock_row_id uuid; v_stock_location_id uuid; v_stock_qty numeric; v_legacy_product jsonb; v_legacy_qty numeric; v_available_in_country boolean;
begin
 select * into v_actor from public.fc_require_session_permission(p_username,p_session_token,'warehouse.pick');
 if p_quantity is null or p_quantity<=0 then raise exception 'Picking quantity must be greater than zero.' using errcode='22023'; end if;
 if p_action not in ('in_stock','pre_order','replace') then raise exception 'Unsupported picking action.' using errcode='22023'; end if;
 select * into v_existing from public.order_item_picking_events where client_action_id=p_client_action_id;
 if found then
  if v_existing.order_item_id is distinct from p_order_item_id or v_existing.action is distinct from p_action or v_existing.quantity is distinct from p_quantity or v_existing.replacement_product_id is distinct from p_replacement_product_id then raise exception 'client_action_id was already used for a different picking event.' using errcode='23505'; end if;
  select oi.picking_ordered_qty,oi.picking_in_stock_qty,oi.picking_pre_order_qty,oi.picking_replaced_qty,oi.picking_action into picking_ordered_qty,picking_in_stock_qty,picking_pre_order_qty,picking_replaced_qty,picking_action from public.order_items oi where oi.id=p_order_item_id; return next; return;
 end if;
 select * into v_item from public.order_items where id=p_order_item_id for update;
 if not found then raise exception 'Order item not found.'; end if;
 select * into v_order from public.orders where id=v_item.order_id for update;
 if v_order.picking_locked_by is null or v_order.picking_locked_by<>v_actor.staff_id::text then raise exception 'The picking lock is not held by the validated staff identity.' using errcode='42501'; end if;
 if v_item.picking_ordered_qty is null then update public.order_items set picking_ordered_qty=qty,picking_root_item_id=coalesce(picking_root_item_id,id) where id=v_item.id returning * into v_item; end if;
 v_resolved:=v_item.picking_in_stock_qty+v_item.picking_pre_order_qty+v_item.picking_replaced_qty;
 if v_resolved+p_quantity>v_item.picking_ordered_qty then raise exception 'Picking quantity exceeds the unresolved quantity.' using errcode='22023'; end if;
 v_country:=public.fc_resolve_order_inventory_country_v1(v_item.order_id);
 if p_action<>'pre_order' then
  if public.fc_normalize_inventory_country_v1(p_inventory_country) is distinct from v_country then raise exception 'Inventory country does not match the persisted order country.' using errcode='22023'; end if;
  if p_action='replace' then
    if p_replacement_product_id is null then raise exception 'Replacement product is required.'; end if;
    select replacement_product_id into v_replacement from public.order_item_picking_events where order_item_id=p_order_item_id and action='replace' and reversed_at is null limit 1;
    if v_replacement is not null and v_replacement<>p_replacement_product_id then raise exception 'Only one replacement product is allowed per original order line.'; end if;
  end if;
  v_stock_product_id:=case when p_action='replace' then p_replacement_product_id else v_item.product_id end;
  select count(*) into v_country_location_count
  from public.product_location_stock pls
  join public.stock_locations sl on sl.id=pls.location_id and sl.active is true
  where pls.product_id=v_stock_product_id
    and public.fc_normalize_inventory_country_v1(sl.country)=v_country;
  if v_country_location_count>1 then raise exception 'Duplicate active location stock rows exist for this product and country.'; end if;

  if v_country_location_count=0 then
    select count(*) into v_any_location_count
    from public.product_location_stock
    where product_id=v_stock_product_id;

    if v_any_location_count>0 then
      raise exception 'This product has location inventory, but no active % stock row. Add the product to Product Inventory % before picking.',v_country,v_country;
    end if;

    select count(*) into v_country_location_count
    from public.stock_locations
    where active is true
      and public.fc_normalize_inventory_country_v1(country)=v_country;
    select id into v_country_location_id
    from public.stock_locations
    where active is true
      and public.fc_normalize_inventory_country_v1(country)=v_country
    order by id
    limit 1;
    if v_country_location_count=0 then raise exception 'No active % stock location is configured.',v_country; end if;
    if v_country_location_count>1 then raise exception 'More than one active % stock location is configured.',v_country; end if;

    select to_jsonb(p) into v_legacy_product from public.products p where p.id=v_stock_product_id for update;
    if v_legacy_product is null then raise exception 'Stock product not found.'; end if;
    v_legacy_qty:=nullif(v_legacy_product->>'stock','')::numeric;
    v_available_in_country:=case when v_country='Wales'
      then coalesce((v_legacy_product->>'available_in_wales')::boolean,true)
      else coalesce((v_legacy_product->>'available_in_england')::boolean,true)
    end;
    if not v_available_in_country then raise exception 'This product is not enabled for % inventory.',v_country; end if;
    if v_legacy_qty is null then raise exception 'Legacy product stock is null. Set the product stock before picking.'; end if;
    if v_legacy_qty<0 then raise exception 'Legacy product stock is negative.'; end if;

    insert into public.product_location_stock(product_id,location_id,qty,low_stock_alert,updated_at)
    values(v_stock_product_id,v_country_location_id,v_legacy_qty,coalesce(nullif(v_legacy_product->>'low_stock_alert','')::numeric,0),now())
    on conflict(product_id,location_id) do nothing;
  end if;

  select pls.id,pls.location_id,pls.qty into v_stock_row_id,v_stock_location_id,v_stock_qty
  from public.product_location_stock pls
  join public.stock_locations sl on sl.id=pls.location_id and sl.active is true
  where pls.product_id=v_stock_product_id
    and public.fc_normalize_inventory_country_v1(sl.country)=v_country
  for update;
  if not found then raise exception 'Could not initialise the % inventory row for this product.',v_country; end if;
  if v_stock_qty is null then raise exception 'Location stock quantity is null.'; end if;
  if v_stock_qty<0 then raise exception 'Location stock quantity is negative.'; end if;
  if v_stock_qty<p_quantity then raise exception 'Insufficient location stock.'; end if;
  update public.product_location_stock set qty=qty-p_quantity,updated_at=now() where id=v_stock_row_id;
 end if;
 insert into public.order_item_picking_events(client_action_id,order_item_id,action,quantity,inventory_country,stock_location_id,stock_product_id,replacement_product_id,replacement_product_code,replacement_product_name,actor_login_id,actor_staff_id,actor_staff_code,actor_username,actor_name,actor_role)
 values(p_client_action_id,p_order_item_id,p_action,p_quantity,case when p_action='pre_order' then null else v_country end,case when p_action='pre_order' then null else v_stock_location_id end,case when p_action='replace' then p_replacement_product_id else v_item.product_id end,p_replacement_product_id,p_replacement_product_code,p_replacement_product_name,v_actor.login_id,v_actor.staff_id,v_actor.staff_code,v_actor.username,v_actor.staff_name,v_actor.staff_role);
 update public.order_items set picking_in_stock_qty=picking_in_stock_qty+case when p_action='in_stock' then p_quantity else 0 end,picking_pre_order_qty=picking_pre_order_qty+case when p_action='pre_order' then p_quantity else 0 end,picking_replaced_qty=picking_replaced_qty+case when p_action='replace' then p_quantity else 0 end,replacement_product_id=case when p_action='replace' then p_replacement_product_id else replacement_product_id end,replacement_product_code=case when p_action='replace' then p_replacement_product_code else replacement_product_code end,replacement_product_name=case when p_action='replace' then p_replacement_product_name else replacement_product_name end,picking_action=case when ((picking_in_stock_qty+case when p_action='in_stock' then p_quantity else 0 end)>0)::int+((picking_pre_order_qty+case when p_action='pre_order' then p_quantity else 0 end)>0)::int+((picking_replaced_qty+case when p_action='replace' then p_quantity else 0 end)>0)::int>1 then 'mixed' else p_action end,picking_decided_by=v_actor.staff_id::text,picking_decided_by_name=v_actor.staff_name,picking_decided_at=now() where id=p_order_item_id
 returning order_items.picking_ordered_qty,order_items.picking_in_stock_qty,order_items.picking_pre_order_qty,order_items.picking_replaced_qty,order_items.picking_action into picking_ordered_qty,picking_in_stock_qty,picking_pre_order_qty,picking_replaced_qty,picking_action;
 return next;
end $$;

revoke all on function public.fc_apply_picking_quantity_v1(text,text,uuid,text,numeric,uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.fc_apply_picking_quantity_v1(text,text,uuid,text,numeric,uuid,text,uuid,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
