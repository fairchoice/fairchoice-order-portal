begin;

alter table public.order_items add column if not exists picking_ordered_qty numeric;
alter table public.order_items add column if not exists picking_in_stock_qty numeric not null default 0;
alter table public.order_items add column if not exists picking_pre_order_qty numeric not null default 0;
alter table public.order_items add column if not exists picking_replaced_qty numeric not null default 0;
alter table public.order_items add column if not exists picking_root_item_id uuid;

do $$ begin
  if exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where o.status in ('Received','In Progress') and (oi.qty is null or oi.qty<0)) then raise exception 'Preflight failed: an active picking order contains null or negative qty.'; end if;
  if exists(select 1 from public.order_items oi join public.orders o on o.id=oi.order_id where o.status in ('Received','In Progress') and oi.picking_action is not null and oi.picking_action not in ('in_stock','pre_order','replace','mixed')) then raise exception 'Preflight failed: an active picking order has an unsupported legacy picking_action.'; end if;
end $$;

update public.order_items set
 picking_ordered_qty=qty,
 picking_in_stock_qty=case when picking_action='in_stock' then qty else 0 end,
 picking_pre_order_qty=case when picking_action='pre_order' then qty else 0 end,
 picking_replaced_qty=case when picking_action='replace' then qty else 0 end,
 picking_root_item_id=coalesce(picking_root_item_id,id)
from public.orders o
where o.id=order_items.order_id
  and o.status in ('Received','In Progress')
  and picking_ordered_qty is null
  and picking_action in ('in_stock','pre_order','replace');

create or replace function public.fc_set_order_item_picking_ordered_qty_v1() returns trigger language plpgsql set search_path=public as $$
begin
  if new.qty is null or new.qty<0 then raise exception 'Order item quantity must be non-negative.'; end if;
  new.picking_ordered_qty:=coalesce(new.picking_ordered_qty,new.qty);
  new.picking_root_item_id:=coalesce(new.picking_root_item_id,new.id);
  return new;
end $$;
drop trigger if exists order_items_set_picking_ordered_qty on public.order_items;
create trigger order_items_set_picking_ordered_qty before insert or update of qty on public.order_items for each row execute function public.fc_set_order_item_picking_ordered_qty_v1();

alter table public.order_items drop constraint if exists order_items_picking_quantities_nonnegative;
alter table public.order_items add constraint order_items_picking_quantities_nonnegative check (coalesce(picking_ordered_qty,0)>=0 and picking_in_stock_qty>=0 and picking_pre_order_qty>=0 and picking_replaced_qty>=0);
alter table public.order_items drop constraint if exists order_items_picking_quantities_reconcile;
alter table public.order_items add constraint order_items_picking_quantities_reconcile check (picking_ordered_qty is null or picking_in_stock_qty+picking_pre_order_qty+picking_replaced_qty<=picking_ordered_qty);
alter table public.order_items drop constraint if exists order_items_picking_action_check;
alter table public.order_items add constraint order_items_picking_action_check check (picking_action is null or picking_action in ('in_stock','pre_order','replace','mixed'));

create table if not exists public.order_item_picking_events(
 id uuid primary key default gen_random_uuid(), client_action_id uuid not null unique,
 order_item_id uuid not null references public.order_items(id) on delete restrict,
 action text not null check(action in ('in_stock','pre_order','replace')),
 quantity numeric not null check(quantity>0), inventory_country text,
 stock_location_id uuid references public.stock_locations(id) on delete restrict,
 stock_product_id uuid references public.products(id) on delete restrict,
 replacement_product_id uuid references public.products(id) on delete restrict,
 replacement_product_code text,replacement_product_name text,
 actor_login_id uuid,actor_staff_id uuid,actor_staff_code text,actor_username text,actor_name text,actor_role text,
 reversed_at timestamptz,reversed_by_staff_id uuid,created_at timestamptz not null default now()
);
alter table public.order_item_picking_events add column if not exists original_product_id uuid references public.products(id) on delete restrict;
alter table public.order_item_picking_events add column if not exists old_status text;
alter table public.order_item_picking_events add column if not exists new_status text;
alter table public.order_item_picking_events add column if not exists reason text;
alter table public.order_item_picking_events add column if not exists reversal_old_status text;
alter table public.order_item_picking_events add column if not exists reversal_new_status text;
alter table public.order_item_picking_events add column if not exists reversal_reason text;
create index if not exists order_item_picking_events_item_active_idx on public.order_item_picking_events(order_item_id,created_at) where reversed_at is null;
alter table public.order_item_picking_events enable row level security;
revoke all on public.order_item_picking_events from public,anon,authenticated;

create or replace function public.fc_normalize_inventory_country_v1(p_value text) returns text language sql immutable as $$
 select case upper(replace(trim(coalesce(p_value,'')),'_','-')) when 'ENGLAND' then 'England' when 'ENG' then 'England' when 'GB-ENG' then 'England' when 'WALES' then 'Wales' when 'WLS' then 'Wales' when 'GB-WLS' then 'Wales' else null end
$$;

create or replace function public.fc_resolve_order_inventory_country_v1(p_order_id uuid) returns text language plpgsql security definer set search_path=public as $$
declare v_order public.orders%rowtype; v_country text;
begin
 select * into v_order from public.orders where id=p_order_id;
 if not found then raise exception 'Order not found.'; end if;
 v_country:=coalesce(public.fc_normalize_inventory_country_v1(to_jsonb(v_order)->>'delivery_country'),public.fc_normalize_inventory_country_v1(to_jsonb(v_order)->>'branch_country'),public.fc_normalize_inventory_country_v1(to_jsonb(v_order)->>'customer_country'),public.fc_normalize_inventory_country_v1(to_jsonb(v_order)->>'country'));
 if v_country is null then raise exception 'Order inventory country cannot be resolved safely.' using errcode='22023'; end if;
 return v_country;
end $$;

create or replace function public.fc_apply_picking_quantity_v1(p_username text,p_session_token text,p_order_item_id uuid,p_action text,p_quantity numeric,p_client_action_id uuid,p_inventory_country text,p_replacement_product_id uuid default null,p_replacement_product_code text default null,p_replacement_product_name text default null)
returns table(picking_ordered_qty numeric,picking_in_stock_qty numeric,picking_pre_order_qty numeric,picking_replaced_qty numeric,picking_action text) language plpgsql security definer set search_path=public as $$
declare v_actor record; v_item public.order_items%rowtype; v_order public.orders%rowtype; v_existing public.order_item_picking_events%rowtype; v_resolved numeric; v_country text; v_replacement uuid; v_stock_product_id uuid; v_any_location_count integer; v_country_location_count integer; v_country_location_id uuid; v_stock_row_id uuid; v_stock_location_id uuid; v_stock_qty numeric; v_legacy_product jsonb; v_legacy_qty numeric; v_available_in_country boolean; v_new_action text;
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
 v_new_action:=case when ((v_item.picking_in_stock_qty+case when p_action='in_stock' then p_quantity else 0 end)>0)::int+((v_item.picking_pre_order_qty+case when p_action='pre_order' then p_quantity else 0 end)>0)::int+((v_item.picking_replaced_qty+case when p_action='replace' then p_quantity else 0 end)>0)::int>1 then 'mixed' else p_action end;
 insert into public.order_item_picking_events(client_action_id,order_item_id,action,quantity,inventory_country,stock_location_id,stock_product_id,original_product_id,replacement_product_id,replacement_product_code,replacement_product_name,old_status,new_status,reason,actor_login_id,actor_staff_id,actor_staff_code,actor_username,actor_name,actor_role)
 values(p_client_action_id,p_order_item_id,p_action,p_quantity,case when p_action='pre_order' then null else v_country end,case when p_action='pre_order' then null else v_stock_location_id end,case when p_action='replace' then p_replacement_product_id else v_item.product_id end,v_item.product_id,p_replacement_product_id,p_replacement_product_code,p_replacement_product_name,coalesce(v_item.picking_action,'unpicked'),v_new_action,'Picking action',v_actor.login_id,v_actor.staff_id,v_actor.staff_code,v_actor.username,v_actor.staff_name,v_actor.staff_role);
 update public.order_items set picking_in_stock_qty=picking_in_stock_qty+case when p_action='in_stock' then p_quantity else 0 end,picking_pre_order_qty=picking_pre_order_qty+case when p_action='pre_order' then p_quantity else 0 end,picking_replaced_qty=picking_replaced_qty+case when p_action='replace' then p_quantity else 0 end,replacement_product_id=case when p_action='replace' then p_replacement_product_id else replacement_product_id end,replacement_product_code=case when p_action='replace' then p_replacement_product_code else replacement_product_code end,replacement_product_name=case when p_action='replace' then p_replacement_product_name else replacement_product_name end,picking_action=v_new_action,picking_decided_by=v_actor.staff_id::text,picking_decided_by_name=v_actor.staff_name,picking_decided_at=now() where id=p_order_item_id
 returning order_items.picking_ordered_qty,order_items.picking_in_stock_qty,order_items.picking_pre_order_qty,order_items.picking_replaced_qty,order_items.picking_action into picking_ordered_qty,picking_in_stock_qty,picking_pre_order_qty,picking_replaced_qty,picking_action;
 return next;
end $$;

create or replace function public.fc_recall_picking_quantities_v1(p_username text,p_session_token text,p_order_item_id uuid)
returns table(picking_ordered_qty numeric,picking_in_stock_qty numeric,picking_pre_order_qty numeric,picking_replaced_qty numeric,picking_action text) language plpgsql security definer set search_path=public as $$
declare v_actor record; v_item public.order_items%rowtype; e record;
begin
 select * into v_actor from public.fc_require_session_permission(p_username,p_session_token,'warehouse.pick');
 select * into v_item from public.order_items where id=p_order_item_id for update;
 if not found then raise exception 'Order item not found.'; end if;
 if not exists(select 1 from public.orders where id=v_item.order_id and picking_locked_by=v_actor.staff_id::text) then raise exception 'The picking lock is not held by the validated staff identity.' using errcode='42501'; end if;
 for e in select * from public.order_item_picking_events where order_item_id=p_order_item_id and reversed_at is null for update loop
  if e.stock_location_id is not null then update public.product_location_stock set qty=coalesce(qty,0)+e.quantity,updated_at=now() where product_id=e.stock_product_id and location_id=e.stock_location_id; end if;
   update public.order_item_picking_events set reversed_at=now(),reversed_by_staff_id=v_actor.staff_id,reversal_old_status=coalesce(v_item.picking_action,'unpicked'),reversal_new_status='unpicked',reversal_reason='Picker recall' where id=e.id;
 end loop;
 update public.order_items set picking_in_stock_qty=0,picking_pre_order_qty=0,picking_replaced_qty=0,picking_action=null,picking_decided_by=null,picking_decided_by_name=null,picking_decided_at=null,replacement_product_id=null,replacement_product_code=null,replacement_product_name=null where id=p_order_item_id
 returning order_items.picking_ordered_qty,order_items.picking_in_stock_qty,order_items.picking_pre_order_qty,order_items.picking_replaced_qty,order_items.picking_action into picking_ordered_qty,picking_in_stock_qty,picking_pre_order_qty,picking_replaced_qty,picking_action;
 return next;
end $$;

create or replace function public.complete_order_picking(p_username text,p_session_token text,p_order_number text)
returns table(completed boolean,message text) language plpgsql security definer set search_path=public as $$
declare v_actor record; v_order public.orders%rowtype; v_item public.order_items%rowtype; v_original public.order_items%rowtype; v_segment record; v_segments int; v_index int; v_qty numeric; v_line_remaining numeric; v_net_remaining numeric; v_gross_remaining numeric; v_vat_amount_remaining numeric; v_vat_total_remaining numeric; v_line numeric; v_net numeric; v_gross numeric; v_vat_amount numeric; v_vat_total numeric; v_segment_status text; v_segment_product_id uuid; v_segment_product_code text; v_segment_product_name text;
begin
 select * into v_actor from public.fc_require_session_permission(p_username,p_session_token,'warehouse.pick');
 select * into v_order from public.orders where order_number=p_order_number for update;
 if not found then return query select false,'Order not found.';return;end if;
 if v_order.picking_locked_by<>v_actor.staff_id::text then return query select false,'The picking lock is no longer held by this user.';return;end if;
 if exists(select 1 from public.order_items where order_id=v_order.id and coalesce(picking_in_stock_qty,0)+coalesce(picking_pre_order_qty,0)+coalesce(picking_replaced_qty,0)<>coalesce(picking_ordered_qty,qty)) then return query select false,'Every ordered unit must have a picking decision.';return;end if;
 for v_item in select * from public.order_items where order_id=v_order.id order by id for update loop
  v_original:=v_item; v_segments:=(v_item.picking_in_stock_qty>0)::int+(v_item.picking_pre_order_qty>0)::int+(v_item.picking_replaced_qty>0)::int; v_index:=0;
  if v_segments=1 then
   update public.order_items set source_status=case when picking_pre_order_qty>0 then 'Need Supplier' else 'In Stock' end,include_in_picking=picking_pre_order_qty=0,picked_qty=picking_in_stock_qty+picking_replaced_qty,product_id=case when picking_replaced_qty>0 then replacement_product_id else product_id end,product_code=case when picking_replaced_qty>0 then replacement_product_code else product_code end,product_name=case when picking_replaced_qty>0 then replacement_product_name else product_name end,qty=picking_ordered_qty where id=v_item.id;
   else
    v_line_remaining:=coalesce(v_original.line_total,0); v_net_remaining:=coalesce(v_original.net_total,0); v_gross_remaining:=coalesce(v_original.gross_total,0); v_vat_amount_remaining:=coalesce(v_original.vat_amount,0); v_vat_total_remaining:=coalesce(v_original.vat_total,0);
    for v_segment in select * from (values('in_stock',v_original.picking_in_stock_qty),('pre_order',v_original.picking_pre_order_qty),('replace',v_original.picking_replaced_qty)) s(action,qty) where qty>0 loop
     v_index:=v_index+1; v_qty:=v_segment.qty;
     v_line:=case when v_index=v_segments then v_line_remaining else round(coalesce(v_original.line_total,0)*v_qty/v_original.picking_ordered_qty,2) end;
     v_net:=case when v_index=v_segments then v_net_remaining else round(coalesce(v_original.net_total,0)*v_qty/v_original.picking_ordered_qty,2) end;
     v_gross:=case when v_index=v_segments then v_gross_remaining else round(coalesce(v_original.gross_total,0)*v_qty/v_original.picking_ordered_qty,2) end;
     v_vat_amount:=case when v_index=v_segments then v_vat_amount_remaining else round(coalesce(v_original.vat_amount,0)*v_qty/v_original.picking_ordered_qty,2) end;
     v_vat_total:=case when v_index=v_segments then v_vat_total_remaining else round(coalesce(v_original.vat_total,0)*v_qty/v_original.picking_ordered_qty,2) end;
     v_line_remaining:=v_line_remaining-v_line; v_net_remaining:=v_net_remaining-v_net; v_gross_remaining:=v_gross_remaining-v_gross; v_vat_amount_remaining:=v_vat_amount_remaining-v_vat_amount; v_vat_total_remaining:=v_vat_total_remaining-v_vat_total;
     v_segment_status:=case when v_segment.action='pre_order' then 'Need Supplier' else 'In Stock' end;
     v_segment_product_id:=case when v_segment.action='replace' then v_original.replacement_product_id else v_original.product_id end;
     v_segment_product_code:=case when v_segment.action='replace' then v_original.replacement_product_code else v_original.product_code end;
     v_segment_product_name:=case when v_segment.action='replace' then v_original.replacement_product_name else v_original.product_name end;
     if v_index=1 then
      update public.order_items set qty=v_qty,picking_ordered_qty=v_qty,picking_in_stock_qty=case when v_segment.action='in_stock' then v_qty else 0 end,picking_pre_order_qty=case when v_segment.action='pre_order' then v_qty else 0 end,picking_replaced_qty=case when v_segment.action='replace' then v_qty else 0 end,picking_action=v_segment.action,source_status=v_segment_status,include_in_picking=v_segment.action<>'pre_order',picked_qty=case when v_segment.action='pre_order' then 0 else v_qty end,product_id=v_segment_product_id,product_code=v_segment_product_code,product_name=v_segment_product_name,line_total=v_line,net_total=v_net,gross_total=v_gross,vat_amount=v_vat_amount,vat_total=v_vat_total where id=v_original.id;
     else
      v_item:=v_original; v_item.id:=gen_random_uuid(); v_item.qty:=v_qty; v_item.picking_ordered_qty:=v_qty; v_item.picking_in_stock_qty:=case when v_segment.action='in_stock' then v_qty else 0 end; v_item.picking_pre_order_qty:=case when v_segment.action='pre_order' then v_qty else 0 end; v_item.picking_replaced_qty:=case when v_segment.action='replace' then v_qty else 0 end; v_item.picking_action:=v_segment.action; v_item.source_status:=v_segment_status; v_item.include_in_picking:=v_segment.action<>'pre_order'; v_item.picked_qty:=case when v_segment.action='pre_order' then 0 else v_qty end; v_item.product_id:=v_segment_product_id; v_item.product_code:=v_segment_product_code; v_item.product_name:=v_segment_product_name; v_item.line_total:=v_line; v_item.net_total:=v_net; v_item.gross_total:=v_gross; v_item.vat_amount:=v_vat_amount; v_item.vat_total:=v_vat_total; v_item.picking_root_item_id:=coalesce(v_original.picking_root_item_id,v_original.id); v_item.preorder_supply_client_action_id:=null;
      insert into public.order_items select (v_item).*;
     end if;
    end loop;
   end if;
 end loop;
 update public.orders set status='Warehouse Packing',picking_status='Completed',picking_completed_at=now(),picking_completed_by=v_actor.staff_id::text,picking_completed_by_name=v_actor.staff_name,picking_locked_by=null,picking_locked_by_name=null,picking_locked_at=null where id=v_order.id;
 return query select true,'Picking completed.';
end $$;

drop function if exists public.complete_order_picking(text,text);
revoke all on function public.fc_set_order_item_picking_ordered_qty_v1() from public,anon,authenticated;
revoke all on function public.fc_normalize_inventory_country_v1(text) from public,anon,authenticated;
revoke all on function public.fc_resolve_order_inventory_country_v1(uuid) from public,anon,authenticated;
revoke all on function public.fc_apply_picking_quantity_v1(text,text,uuid,text,numeric,uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.fc_recall_picking_quantities_v1(text,text,uuid) from public,anon,authenticated;
revoke all on function public.complete_order_picking(text,text,text) from public,anon,authenticated;
grant execute on function public.fc_apply_picking_quantity_v1(text,text,uuid,text,numeric,uuid,text,uuid,text,text) to anon,authenticated;
grant execute on function public.fc_recall_picking_quantities_v1(text,text,uuid) to anon,authenticated;
grant execute on function public.complete_order_picking(text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
