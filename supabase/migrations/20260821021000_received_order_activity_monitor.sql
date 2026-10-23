-- Received Order activity monitor and Picking mismatch audit.
-- Keeps ordinary stock guards intact while recording both approved mismatch directions.

begin;

-- Ensure the Picking event schema matches the RPC expectations before replacing it.
alter table public.order_item_picking_events
  add column if not exists original_product_id uuid references public.products(id) on delete restrict;
alter table public.order_item_picking_events add column if not exists old_status text;
alter table public.order_item_picking_events add column if not exists new_status text;
alter table public.order_item_picking_events add column if not exists reason text;
alter table public.order_item_picking_events add column if not exists reversal_old_status text;
alter table public.order_item_picking_events add column if not exists reversal_new_status text;
alter table public.order_item_picking_events add column if not exists reversal_reason text;

create or replace function public.fc_apply_picking_quantity_v1(
  p_username text,
  p_session_token text,
  p_order_item_id uuid,
  p_action text,
  p_quantity numeric,
  p_client_action_id uuid,
  p_inventory_country text,
  p_replacement_product_id uuid default null,
  p_replacement_product_code text default null,
  p_replacement_product_name text default null
)
returns table(
  picking_ordered_qty numeric,
  picking_in_stock_qty numeric,
  picking_pre_order_qty numeric,
  picking_replaced_qty numeric,
  picking_action text
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor record;
  v_item public.order_items%rowtype;
  v_order public.orders%rowtype;
  v_existing public.order_item_picking_events%rowtype;
  v_resolved numeric;
  v_country text;
  v_replacement uuid;
  v_stock_product_id uuid;
  v_any_location_count integer;
  v_country_location_count integer;
  v_country_location_id uuid;
  v_stock_row_id uuid;
  v_stock_location_id uuid;
  v_stock_qty numeric;
  v_legacy_product jsonb;
  v_legacy_qty numeric;
  v_available_in_country boolean;
  v_new_action text;
  v_allow_stock_mismatch boolean;
  v_source_status text;
  v_is_picking_mismatch boolean;
  v_stock_deduct_qty numeric;
begin
  select *
  into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'warehouse.pick'
  );

  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Picking quantity must be greater than zero.'
      using errcode = '22023';
  end if;

  if p_action not in ('in_stock', 'pre_order', 'replace') then
    raise exception 'Unsupported picking action.'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.order_item_picking_events
  where client_action_id = p_client_action_id;

  if found then
    if v_existing.order_item_id is distinct from p_order_item_id
       or v_existing.action is distinct from p_action
       or v_existing.quantity is distinct from p_quantity
       or v_existing.replacement_product_id
          is distinct from p_replacement_product_id then
      raise exception
        'client_action_id was already used for a different picking event.'
        using errcode = '23505';
    end if;

    select
      oi.picking_ordered_qty,
      oi.picking_in_stock_qty,
      oi.picking_pre_order_qty,
      oi.picking_replaced_qty,
      oi.picking_action
    into
      picking_ordered_qty,
      picking_in_stock_qty,
      picking_pre_order_qty,
      picking_replaced_qty,
      picking_action
    from public.order_items as oi
    where oi.id = p_order_item_id;

    return next;
    return;
  end if;

  select *
  into v_item
  from public.order_items as oi
  where oi.id = p_order_item_id
  for update;

  if not found then
    raise exception 'Order item not found.';
  end if;

  select *
  into v_order
  from public.orders as o
  where o.id = v_item.order_id
  for update;

  if v_order.picking_locked_by is null
     or v_order.picking_locked_by <> v_actor.staff_id::text then
    raise exception
      'The picking lock is not held by the validated staff identity.'
      using errcode = '42501';
  end if;

  if v_item.picking_ordered_qty is null then
    update public.order_items as oi
    set
      picking_ordered_qty = oi.qty,
      picking_root_item_id = coalesce(oi.picking_root_item_id, oi.id)
    where oi.id = v_item.id
    returning oi.*
    into v_item;
  end if;

  v_resolved :=
      coalesce(v_item.picking_in_stock_qty, 0)
    + coalesce(v_item.picking_pre_order_qty, 0)
    + coalesce(v_item.picking_replaced_qty, 0);

  if v_resolved + p_quantity > v_item.picking_ordered_qty then
    raise exception 'Picking quantity exceeds the unresolved quantity.'
      using errcode = '22023';
  end if;

  v_country :=
    public.fc_resolve_order_inventory_country_v1(v_item.order_id);

  v_source_status := case
    when lower(trim(coalesce(v_item.source_status, ''))) in ('in stock','available') then 'In Stock'
    when lower(trim(coalesce(v_item.source_status, ''))) in ('need supplier','pre-order','pre order','preorder','supply needed','next supplier') then 'Pre-Order'
    when lower(trim(coalesce(v_item.source_status, ''))) = 'cannot supply' then 'Cannot Supply'
    else coalesce(nullif(trim(v_item.source_status), ''), 'In Stock')
  end;

  v_allow_stock_mismatch := p_action = 'in_stock' and v_source_status = 'Pre-Order';
  v_is_picking_mismatch :=
    (p_action = 'in_stock' and v_source_status = 'Pre-Order')
    or (p_action = 'pre_order' and v_source_status = 'In Stock');

  /*
   * Pre-order does not check or deduct inventory.
   * In-stock and replacement actions use location inventory.
   */
  if p_action <> 'pre_order' then
    if public.fc_normalize_inventory_country_v1(p_inventory_country)
       is distinct from v_country then
      raise exception
        'Inventory country does not match the persisted order country.'
        using errcode = '22023';
    end if;

    if p_action = 'replace' then
      if p_replacement_product_id is null then
        raise exception 'Replacement product is required.';
      end if;

      select event.replacement_product_id
      into v_replacement
      from public.order_item_picking_events as event
      where event.order_item_id = p_order_item_id
        and event.action = 'replace'
        and event.reversed_at is null
      limit 1;

      if v_replacement is not null
         and v_replacement <> p_replacement_product_id then
        raise exception
          'Only one replacement product is allowed per original order line.';
      end if;
    end if;

    v_stock_product_id :=
      case
        when p_action = 'replace' then p_replacement_product_id
        else v_item.product_id
      end;

    select count(*)
    into v_country_location_count
    from public.product_location_stock as pls
    join public.stock_locations as sl
      on sl.id = pls.location_id
     and sl.active is true
    where pls.product_id = v_stock_product_id
      and public.fc_normalize_inventory_country_v1(sl.country) = v_country;

    if v_country_location_count > 1 then
      raise exception
        'Duplicate active location stock rows exist for this product and country.';
    end if;

    if v_country_location_count = 0 then
      select count(*)
      into v_any_location_count
      from public.product_location_stock as pls
      where pls.product_id = v_stock_product_id;

      if v_any_location_count > 0 then
        raise exception
          'This product has location inventory, but no active % stock row. Add the product to Product Inventory % before picking.',
          v_country,
          v_country;
      end if;

      select count(*)
      into v_country_location_count
      from public.stock_locations as sl
      where sl.active is true
        and public.fc_normalize_inventory_country_v1(sl.country) = v_country;

      select sl.id
      into v_country_location_id
      from public.stock_locations as sl
      where sl.active is true
        and public.fc_normalize_inventory_country_v1(sl.country) = v_country
      order by sl.id
      limit 1;

      if v_country_location_count = 0 then
        raise exception 'No active % stock location is configured.', v_country;
      end if;

      if v_country_location_count > 1 then
        raise exception 'More than one active % stock location is configured.',
          v_country;
      end if;

      select to_jsonb(product_row)
      into v_legacy_product
      from public.products as product_row
      where product_row.id = v_stock_product_id
      for update;

      if v_legacy_product is null then
        raise exception 'Stock product not found.';
      end if;

      v_legacy_qty :=
        nullif(v_legacy_product ->> 'stock', '')::numeric;

      v_available_in_country :=
        case
          when v_country = 'Wales' then
            coalesce(
              (v_legacy_product ->> 'available_in_wales')::boolean,
              true
            )
          else
            coalesce(
              (v_legacy_product ->> 'available_in_england')::boolean,
              true
            )
        end;

      if not v_available_in_country then
        raise exception
          'This product is not enabled for % inventory.',
          v_country;
      end if;

      if v_legacy_qty is null then
        raise exception
          'Legacy product stock is null. Set the product stock before picking.';
      end if;

      if v_legacy_qty < 0 then
        raise exception 'Legacy product stock is negative.';
      end if;

      insert into public.product_location_stock(
        product_id,
        location_id,
        qty,
        low_stock_alert,
        updated_at
      )
      values(
        v_stock_product_id,
        v_country_location_id,
        v_legacy_qty,
        coalesce(
          nullif(v_legacy_product ->> 'low_stock_alert', '')::numeric,
          0
        ),
        now()
      )
      on conflict (product_id, location_id) do nothing;
    end if;

    select
      pls.id,
      pls.location_id,
      pls.qty
    into
      v_stock_row_id,
      v_stock_location_id,
      v_stock_qty
    from public.product_location_stock as pls
    join public.stock_locations as sl
      on sl.id = pls.location_id
     and sl.active is true
    where pls.product_id = v_stock_product_id
      and public.fc_normalize_inventory_country_v1(sl.country) = v_country
    for update;

    if not found then
      raise exception
        'Could not initialise the % inventory row for this product.',
        v_country;
    end if;

    if v_stock_qty is null then
      raise exception 'Location stock quantity is null.';
    end if;

    if v_stock_qty < 0 then
      raise exception 'Location stock quantity is negative.';
    end if;

    if v_stock_qty < p_quantity and not v_allow_stock_mismatch then
      raise exception 'Insufficient location stock.';
    end if;

    /*
     * Picking mismatch rule:
     * A line already marked Pre-Order / Need Supplier may still be physically
     * found by the picker. The picker is allowed to pack it even when tracked
     * country stock is lower than the requested quantity. Only tracked stock
     * that actually exists is deducted, so inventory never becomes negative.
     * The frontend records the corresponding Picking Mismatch warehouse event.
     */
    v_stock_deduct_qty :=
      case
        when v_allow_stock_mismatch then least(p_quantity, greatest(v_stock_qty, 0))
        else p_quantity
      end;

    update public.product_location_stock as pls
    set
      qty = pls.qty - v_stock_deduct_qty,
      updated_at = now()
    where pls.id = v_stock_row_id;
  end if;

  v_new_action :=
    case
      when
        ((coalesce(v_item.picking_in_stock_qty, 0) + case when p_action = 'in_stock' then p_quantity else 0 end) > 0)::integer
        + ((coalesce(v_item.picking_pre_order_qty, 0) + case when p_action = 'pre_order' then p_quantity else 0 end) > 0)::integer
        + ((coalesce(v_item.picking_replaced_qty, 0) + case when p_action = 'replace' then p_quantity else 0 end) > 0)::integer
        > 1
      then 'mixed'
      else p_action
    end;

  insert into public.order_item_picking_events(
    client_action_id,
    order_item_id,
    action,
    quantity,
    inventory_country,
    stock_location_id,
    stock_product_id,
    original_product_id,
    replacement_product_id,
    replacement_product_code,
    replacement_product_name,
    old_status,
    new_status,
    reason,
    actor_login_id,
    actor_staff_id,
    actor_staff_code,
    actor_username,
    actor_name,
    actor_role
  )
  values(
    p_client_action_id,
    p_order_item_id,
    p_action,
    p_quantity,
    case
      when p_action = 'pre_order' then null
      else v_country
    end,
    case
      when p_action = 'pre_order' then null
      else v_stock_location_id
    end,
    case
      when p_action = 'replace' then p_replacement_product_id
      else v_item.product_id
    end,
    v_item.product_id,
    p_replacement_product_id,
    p_replacement_product_code,
    p_replacement_product_name,
    case when v_is_picking_mismatch then v_source_status else coalesce(v_item.picking_action, 'unpicked') end,
    case
      when v_is_picking_mismatch and p_action = 'in_stock' then 'In Stock'
      when v_is_picking_mismatch and p_action = 'pre_order' then 'Pre-Order'
      else v_new_action
    end,
    case
      when v_is_picking_mismatch and p_action = 'in_stock' then 'Picking mismatch: Pre-Order item physically found and picked'
      when v_is_picking_mismatch and p_action = 'pre_order' then 'Picking mismatch: In Stock item marked Pre-Order by picker'
      else 'Picking action'
    end,
    v_actor.login_id,
    v_actor.staff_id,
    v_actor.staff_code,
    v_actor.username,
    v_actor.staff_name,
    v_actor.staff_role
  );

  /*
   * Important fix:
   * Every current order_items value uses the oi alias.
   * This removes ambiguity with the RETURNS TABLE output variables.
   */
  update public.order_items as oi
  set
    picking_in_stock_qty =
      coalesce(oi.picking_in_stock_qty, 0)
      + case
          when p_action = 'in_stock' then p_quantity
          else 0
        end,

    picking_pre_order_qty =
      coalesce(oi.picking_pre_order_qty, 0)
      + case
          when p_action = 'pre_order' then p_quantity
          else 0
        end,

    picking_replaced_qty =
      coalesce(oi.picking_replaced_qty, 0)
      + case
          when p_action = 'replace' then p_quantity
          else 0
        end,

    replacement_product_id =
      case
        when p_action = 'replace' then p_replacement_product_id
        else oi.replacement_product_id
      end,

    replacement_product_code =
      case
        when p_action = 'replace' then p_replacement_product_code
        else oi.replacement_product_code
      end,

    replacement_product_name =
      case
        when p_action = 'replace' then p_replacement_product_name
        else oi.replacement_product_name
      end,

    picking_action = v_new_action,

    picking_decided_by = v_actor.staff_id::text,
    picking_decided_by_name = v_actor.staff_name,
    picking_decided_at = now()

  where oi.id = p_order_item_id

  returning
    oi.picking_ordered_qty,
    oi.picking_in_stock_qty,
    oi.picking_pre_order_qty,
    oi.picking_replaced_qty,
    oi.picking_action
  into
    picking_ordered_qty,
    picking_in_stock_qty,
    picking_pre_order_qty,
    picking_replaced_qty,
    picking_action;

  return next;
end;
$function$;

revoke all on function public.fc_apply_picking_quantity_v1(
  text,
  text,
  uuid,
  text,
  numeric,
  uuid,
  text,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.fc_apply_picking_quantity_v1(
  text,
  text,
  uuid,
  text,
  numeric,
  uuid,
  text,
  uuid,
  text,
  text
) to anon, authenticated;


create or replace function public.fc_list_received_order_activity_v1(
  p_username text,
  p_session_token text,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_page_size integer default 5000
)
returns table(
  id uuid,client_action_id text,order_number text,order_id uuid,order_item_id uuid,
  product_id uuid,product_code text,product_name text,quantity numeric,customer_id uuid,
  customer_name text,branch_name text,country text,warehouse_location text,old_status text,
  new_status text,action_type text,reason text,supplier_id uuid,supplier_name text,
  changed_by_staff_id uuid,changed_by_name text,changed_by_role text,source_module text,
  referenced_event_id uuid,referenced_client_action_id text,created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform public.fc_require_session_permission_v2(
    p_username,p_session_token,'page.reports.warehouse_activity'
  );

  return query
  select
    e.id,
    e.client_action_id::text,
    o.order_number,
    o.id,
    e.order_item_id,
    oi.product_id,
    oi.product_code,
    oi.product_name,
    e.quantity,
    o.customer_account_id,
    o.company_name,
    coalesce(o.branch_name,o.delivery_branch_name),
    coalesce(e.inventory_country,o.customer_country),
    sl.location_name,
    case
      when lower(coalesce(e.reason,'')) like '%pre-order item physically found%' then 'Pre-Order'
      when lower(coalesce(e.reason,'')) like '%pre-order stock physically found%' then 'Pre-Order'
      when lower(coalesce(e.reason,'')) like '%in stock item marked pre-order%' then 'In Stock'
      else public.fc_normalize_warehouse_status_v1(e.old_status)
    end,
    case
      when e.action='in_stock' then 'In Stock'
      when e.action='pre_order' then 'Pre-Order'
      else public.fc_normalize_warehouse_status_v1(e.new_status)
    end,
    'Picking Mismatch'::text,
    e.reason,
    null::uuid,
    null::text,
    e.actor_staff_id,
    e.actor_name,
    e.actor_role,
    'Received Order Picking'::text,
    null::uuid,
    null::text,
    e.created_at
  from public.order_item_picking_events e
  join public.order_items oi on oi.id=e.order_item_id
  join public.orders o on o.id=oi.order_id
  left join public.stock_locations sl on sl.id=e.stock_location_id
  where e.reversed_at is null
    and (
      lower(coalesce(e.reason,'')) like 'picking mismatch%'
      or (public.fc_normalize_warehouse_status_v1(e.old_status)='In Stock' and public.fc_normalize_warehouse_status_v1(e.new_status)='Pre-Order')
      or (public.fc_normalize_warehouse_status_v1(e.old_status)='Pre-Order' and public.fc_normalize_warehouse_status_v1(e.new_status)='In Stock')
    )
    and (p_date_from is null or e.created_at >= p_date_from)
    and (p_date_to is null or e.created_at <= p_date_to)
  order by e.created_at desc,e.id desc
  limit greatest(1,least(coalesce(p_page_size,5000),10000));
end;
$function$;

revoke all on function public.fc_list_received_order_activity_v1(text,text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.fc_list_received_order_activity_v1(text,text,timestamptz,timestamptz,integer) to anon,authenticated;

notify pgrst, 'reload schema';

commit;
