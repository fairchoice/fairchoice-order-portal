begin;

alter table public.warehouse_operational_events
  drop constraint if exists warehouse_operational_events_old_status_check;
alter table public.warehouse_operational_events
  add constraint warehouse_operational_events_old_status_check
  check (old_status in ('In Stock','Pre-Order','Cannot Supply','Free'));

alter table public.warehouse_operational_events
  drop constraint if exists warehouse_operational_events_new_status_check;
alter table public.warehouse_operational_events
  add constraint warehouse_operational_events_new_status_check
  check (new_status in ('In Stock','Pre-Order','Cannot Supply','Free'));

alter table public.warehouse_operational_events
  drop constraint if exists warehouse_operational_events_action_type_check;
alter table public.warehouse_operational_events
  add constraint warehouse_operational_events_action_type_check
  check (action_type in (
    'Cannot Supply','Available','Recall Available',
    'Picking Mismatch','Free'
  ));

create or replace function public.fc_record_received_order_free_event_v1(
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
  v_client text := nullif(trim(p_event->>'client_action_id'),'');
  v_item_id uuid := nullif(p_event->>'order_item_id','')::uuid;
  v_old_status text;
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username, p_session_token, 'page.operations.received_orders'
  );

  if v_client is null or v_item_id is null then
    raise exception 'client_action_id and order_item_id are required' using errcode='22023';
  end if;

  select * into v_existing
  from public.warehouse_operational_events
  where client_action_id = v_client;
  if found then return v_existing; end if;

  select * into v_item
  from public.order_items
  where id = v_item_id;
  if not found then
    raise exception 'Received order item was not found' using errcode='P0002';
  end if;

  v_old_status := case
    when lower(trim(coalesce(p_event->>'old_status',''))) in ('free','promotion free') then 'Free'
    when lower(trim(coalesce(p_event->>'old_status',''))) in ('need supplier','pre-order','pre order','preorder','supply needed','next supplier') then 'Pre-Order'
    when lower(trim(coalesce(p_event->>'old_status','')))='cannot supply' then 'Cannot Supply'
    else 'In Stock'
  end;

  insert into public.warehouse_operational_events(
    client_action_id,order_number,order_id,order_item_id,product_id,product_code,
    product_name,quantity,customer_id,customer_name,branch_name,country,
    warehouse_location,old_status,new_status,action_type,reason,source_module,
    changed_by_login_id,changed_by_staff_id,changed_by_staff_code,changed_by_username,
    changed_by_name,changed_by_role,metadata
  ) values (
    v_client,p_event->>'order_number',nullif(p_event->>'order_id','')::uuid,v_item_id,
    nullif(p_event->>'product_id','')::uuid,p_event->>'product_code',
    coalesce(nullif(p_event->>'product_name',''),'Unnamed Product'),
    coalesce(nullif(p_event->>'quantity','')::numeric,v_item.qty,0),
    nullif(p_event->>'customer_id','')::uuid,p_event->>'customer_name',
    p_event->>'branch_name',p_event->>'country',p_event->>'warehouse_location',
    v_old_status,'Free','Free',nullif(p_event->>'reason',''),
    coalesce(nullif(p_event->>'source_module',''),'Received Orders'),
    v_actor.login_id,v_actor.staff_id,v_actor.staff_code,v_actor.username,
    v_actor.staff_name,v_actor.staff_role,coalesce(p_event->'metadata','{}'::jsonb)
  ) returning * into v_result;

  return v_result;
end
$$;

revoke all on function public.fc_record_received_order_free_event_v1(text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.fc_record_received_order_free_event_v1(text,text,jsonb)
  to anon,authenticated;

notify pgrst,'reload schema';
commit;
