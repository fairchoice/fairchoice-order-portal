begin;

-- Additive only: supplier events remain in preorder_supply_events. This table
-- stores non-supplier Warehouse observations such as Available and exceptions.
insert into public.fc_permissions(permission_key, permission_name, category, description)
values (
  'page.reports.warehouse_activity',
  'Warehouse Activity',
  'Page Access / Reports',
  'View the Warehouse Activity Monitor.'
)
on conflict(permission_key) do update set
  permission_name = excluded.permission_name,
  category = excluded.category,
  description = excluded.description,
  active = true;

create table if not exists public.warehouse_operational_events (
  id uuid primary key default gen_random_uuid(),
  client_action_id text not null,
  order_number text not null,
  order_id uuid,
  order_item_id uuid not null,
  product_id uuid,
  product_code text,
  product_name text not null,
  quantity numeric not null check (quantity >= 0),
  customer_id uuid,
  customer_name text,
  branch_name text,
  country text,
  warehouse_location text,
  old_status text not null check (old_status in ('In Stock','Pre-Order','Cannot Supply')),
  new_status text not null check (new_status in ('In Stock','Pre-Order','Cannot Supply')),
  action_type text not null check (action_type in (
    'Cannot Supply','Available','Recall Available'
  )),
  reason text,
  source_module text not null default 'Warehouse',
  referenced_event_id uuid references public.warehouse_operational_events(id),
  referenced_client_action_id text,
  changed_by_login_id uuid,
  changed_by_staff_id uuid,
  changed_by_staff_code text,
  changed_by_username text,
  changed_by_name text,
  changed_by_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(client_action_id)
);

create index if not exists warehouse_operational_events_created_idx
  on public.warehouse_operational_events(created_at desc, id desc);
create index if not exists warehouse_operational_events_item_created_idx
  on public.warehouse_operational_events(order_item_id, created_at desc, id desc);
create index if not exists warehouse_operational_events_product_created_idx
  on public.warehouse_operational_events(product_id, created_at desc)
  where product_id is not null;
create index if not exists warehouse_operational_events_reference_idx
  on public.warehouse_operational_events(referenced_event_id)
  where referenced_event_id is not null;

alter table public.warehouse_operational_events enable row level security;
revoke all on public.warehouse_operational_events from public, anon, authenticated;

create or replace function public.fc_normalize_warehouse_status_v1(p_status text)
returns text
language sql
immutable
set search_path = public
as $$
  select case lower(regexp_replace(trim(coalesce(p_status,'')), '[_-]+', ' ', 'g'))
    when 'in stock' then 'In Stock'
    when 'available' then 'In Stock'
    when 'need supplier' then 'Pre-Order'
    when 'pre order' then 'Pre-Order'
    when 'preorder' then 'Pre-Order'
    when 'supply needed' then 'Pre-Order'
    when 'next supplier' then 'Pre-Order'
    when 'cannot supply' then 'Cannot Supply'
    else null
  end
$$;

create or replace function public.fc_record_warehouse_operational_event_v1(
  p_username text,
  p_session_token text,
  p_event jsonb
)
returns public.warehouse_operational_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_item public.order_items%rowtype;
  v_existing public.warehouse_operational_events%rowtype;
  v_result public.warehouse_operational_events%rowtype;
  v_original public.warehouse_operational_events%rowtype;
  v_client text := nullif(trim(p_event->>'client_action_id'),'');
  v_action text := nullif(trim(p_event->>'action_type'),'');
  v_reason text := nullif(trim(p_event->>'reason'),'');
  v_old_status text;
  v_new_status text := public.fc_normalize_warehouse_status_v1(p_event->>'new_status');
  v_item_id uuid := nullif(p_event->>'order_item_id','')::uuid;
begin
  begin
    select * into v_actor
    from public.fc_require_session_permission_v2(
      p_username, p_session_token, 'page.operations.warehouse'
    );
  exception when insufficient_privilege then
    select * into v_actor
    from public.fc_require_session_permission_v2(
      p_username, p_session_token, 'page.operations.pre_order_supply'
    );
  end;

  if v_client is null or v_item_id is null then
    raise exception 'client_action_id and order_item_id are required' using errcode='22023';
  end if;

  select * into v_existing
  from public.warehouse_operational_events
  where client_action_id = v_client;
  if found then return v_existing; end if;

  select * into v_item from public.order_items where id = v_item_id for update;
  if not found then raise exception 'Warehouse order item was not found' using errcode='P0002'; end if;
  v_old_status := public.fc_normalize_warehouse_status_v1(v_item.source_status);

  if v_old_status is null or v_new_status is null or v_old_status = v_new_status then
    raise exception 'A valid Warehouse status transition is required' using errcode='22023';
  end if;

  -- A reason is optional for every approved Warehouse operational transition.
  -- Confirmation remains a frontend concern; this RPC validates the transition
  -- and records the nullable reason when one is supplied.
  if v_action = 'Available' and not (
    v_old_status in ('Pre-Order','Cannot Supply') and v_new_status='In Stock'
  ) then
    raise exception 'Available must change Pre-Order or Cannot Supply to In Stock' using errcode='22023';
  elsif v_action = 'Recall Available' then
    if not (v_old_status='In Stock' and v_new_status='Cannot Supply') then
      raise exception 'Recall Available must change In Stock to Cannot Supply' using errcode='22023';
    end if;
    select * into v_original
    from public.warehouse_operational_events
    where (
      id = nullif(p_event->>'referenced_event_id','')::uuid
      or client_action_id = nullif(p_event->>'referenced_client_action_id','')
    )
      and action_type = 'Available'
      and old_status = 'Cannot Supply'
      and order_item_id = v_item_id
    order by created_at desc limit 1;
    if not found then
      raise exception 'Recall Available requires the original Available event' using errcode='22023';
    end if;
    if exists (
      select 1 from public.warehouse_operational_events r
      where r.action_type='Recall Available' and r.referenced_event_id=v_original.id
    ) then
      raise exception 'This Available action has already been recalled' using errcode='23505';
    end if;
  elsif v_action = 'Cannot Supply' and not (
    v_old_status='In Stock' and v_new_status='Cannot Supply'
  ) then
    raise exception 'Cannot Supply must change In Stock to Cannot Supply' using errcode='22023';
  elsif v_action not in ('Available','Recall Available','Cannot Supply') then
    raise exception 'Unsupported Warehouse operational action' using errcode='22023';
  end if;

  update public.order_items
  set source_status = v_new_status,
      include_in_picking = (v_new_status = 'In Stock'),
      picked_qty = case when v_new_status = 'In Stock' then qty else 0 end
  where id = v_item_id;

  insert into public.warehouse_operational_events(
    client_action_id,order_number,order_id,order_item_id,product_id,product_code,
    product_name,quantity,customer_id,customer_name,branch_name,country,
    warehouse_location,old_status,new_status,action_type,reason,source_module,
    referenced_event_id,referenced_client_action_id,changed_by_login_id,
    changed_by_staff_id,changed_by_staff_code,changed_by_username,changed_by_name,
    changed_by_role,metadata
  ) values (
    v_client,p_event->>'order_number',nullif(p_event->>'order_id','')::uuid,v_item_id,
    nullif(p_event->>'product_id','')::uuid,p_event->>'product_code',
    coalesce(nullif(p_event->>'product_name',''),'Unnamed Product'),v_item.qty,
    nullif(p_event->>'customer_id','')::uuid,p_event->>'customer_name',
    p_event->>'branch_name',p_event->>'country',p_event->>'warehouse_location',
    v_old_status,v_new_status,v_action,v_reason,
    coalesce(nullif(p_event->>'source_module',''),'Warehouse'),
    case when v_action='Recall Available' then v_original.id else null end,
    case when v_action='Recall Available' then v_original.client_action_id
         else nullif(p_event->>'referenced_client_action_id','') end,
    v_actor.login_id,v_actor.staff_id,v_actor.staff_code,v_actor.username,
    v_actor.staff_name,v_actor.staff_role,coalesce(p_event->'metadata','{}'::jsonb)
  ) returning * into v_result;
  return v_result;
end
$$;

create or replace function public.fc_list_warehouse_operational_events_v1(
  p_username text,
  p_session_token text,
  p_page_size integer default 1000
)
returns setof public.warehouse_operational_events
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.fc_require_session_permission_v2(
      p_username,p_session_token,'page.operations.warehouse'
    );
  exception when insufficient_privilege then
    perform public.fc_require_session_permission_v2(
      p_username,p_session_token,'page.operations.pre_order_supply'
    );
  end;
  return query
  select e.* from public.warehouse_operational_events e
  order by e.created_at desc,e.id desc
  limit greatest(1,least(coalesce(p_page_size,1000),5000));
end
$$;

create or replace function public.fc_list_warehouse_activity_v1(
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
as $$
begin
  perform public.fc_require_session_permission_v2(
    p_username,p_session_token,'page.reports.warehouse_activity'
  );
  return query
  with combined as (
    select
      w.id,w.client_action_id,w.order_number,w.order_id,w.order_item_id,w.product_id,
      w.product_code,w.product_name,w.quantity,w.customer_id,w.customer_name,w.branch_name,
      w.country,w.warehouse_location,w.old_status,w.new_status,w.action_type,w.reason,
      null::uuid supplier_id,null::text supplier_name,w.changed_by_staff_id,w.changed_by_name,
      w.changed_by_role,w.source_module,w.referenced_event_id,w.referenced_client_action_id,
      w.created_at
    from public.warehouse_operational_events w
    union all
    select
      p.id,p.client_action_id,p.order_number,null::uuid,p.order_item_id,p.product_id,
      p.metadata->>'productCode',coalesce(p.product_name,'Unnamed Product'),p.quantity,
      p.customer_id,p.customer_name,p.metadata->>'branchName',p.metadata->>'country',
      p.metadata->>'warehouseLocation',
      case
        when p.action_type='Recall' and original.action_type in ('Buy','PartialBuy') then 'In Stock'
        when p.action_type='Recall' and original.action_type='Remove' then 'Cannot Supply'
        when p.action_type='Recall' and original.action_type='NextSup' then 'Next Supplier'
        when p.action_type in ('Buy','PartialBuy','Remove')
          and lower(regexp_replace(coalesce(p.previous_status,''),'[_-]+',' ','g'))='next supplier'
          then 'Next Supplier'
        else coalesce(public.fc_normalize_warehouse_status_v1(p.previous_status),'Pre-Order')
      end,
      case
        when p.action_type in ('Buy','PartialBuy') then 'In Stock'
        when p.action_type='NextSup' then 'Next Supplier'
        when p.action_type='Remove' then 'Cannot Supply'
        when p.action_type='Recall' then 'Pre-Order'
        else coalesce(public.fc_normalize_warehouse_status_v1(p.new_status),
          public.fc_normalize_warehouse_status_v1(p.previous_status),'Pre-Order')
      end,
      case
        when p.action_type in ('Buy','PartialBuy') then 'Bought'
        when p.action_type='NextSup' then 'Next Supplier'
        when p.action_type='Remove' then 'Cannot Supply'
        when p.action_type='Recall' and original.action_type in ('Buy','PartialBuy') then 'Recall Bought'
        when p.action_type='Recall' and original.action_type='Remove' then 'Recall Cannot Supply'
        when p.action_type='Recall' and original.action_type='NextSup' then 'Recall Next Supplier'
        else p.action_type
      end,
      p.metadata->>'reason',p.supplier_id,p.supplier_name,p.changed_by_staff_id,
      p.changed_by_name,p.changed_by_role,'Pre-Order Supply',original.id,
      p.metadata->>'recalledClientActionId',p.created_at
    from public.preorder_supply_events p
    left join lateral (
      select prior.id,prior.action_type
      from public.preorder_supply_events prior
      where prior.id = nullif(p.metadata->>'recalledEventId','')::uuid
         or prior.client_action_id = p.metadata->>'recalledClientActionId'
      order by prior.created_at desc limit 1
    ) original on p.action_type='Recall'
  )
  select c.* from combined c
  where (p_date_from is null or c.created_at >= p_date_from)
    and (p_date_to is null or c.created_at <= p_date_to)
  order by c.created_at desc,c.id desc
  limit greatest(1,least(coalesce(p_page_size,5000),10000));
end
$$;

revoke all on function public.fc_normalize_warehouse_status_v1(text) from public,anon,authenticated;
revoke all on function public.fc_record_warehouse_operational_event_v1(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.fc_list_warehouse_operational_events_v1(text,text,integer) from public,anon,authenticated;
revoke all on function public.fc_list_warehouse_activity_v1(text,text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.fc_record_warehouse_operational_event_v1(text,text,jsonb) to anon,authenticated;
grant execute on function public.fc_list_warehouse_operational_events_v1(text,text,integer) to anon,authenticated;
grant execute on function public.fc_list_warehouse_activity_v1(text,text,timestamptz,timestamptz,integer) to anon,authenticated;

notify pgrst,'reload schema';
commit;
