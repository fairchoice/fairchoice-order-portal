begin;

alter table public.order_items add column if not exists preorder_supply_client_action_id text;
create unique index if not exists order_items_preorder_supply_action_uidx on public.order_items(preorder_supply_client_action_id) where preorder_supply_client_action_id is not null;

create table if not exists public.preorder_supply_events (
  id uuid primary key default gen_random_uuid(), item_key text not null, order_number text not null,
  order_item_id uuid, added_order_item_id uuid, action_type text not null, product_id uuid,
  product_name text, supplier_id uuid, supplier_name text, customer_id uuid, customer_name text,
  quantity numeric not null default 0, previous_qty numeric not null default 0, remaining_qty numeric,
  previous_status text, new_status text, changed_by_login_id uuid, changed_by_staff_id uuid,
  changed_by_staff_code text, changed_by_username text, changed_by_name text, changed_by_role text,
  client_action_id text, batch_id uuid, bought_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.preorder_supply_events add column if not exists client_action_id text;
alter table public.preorder_supply_events add column if not exists batch_id uuid;
alter table public.preorder_supply_events add column if not exists bought_at timestamptz;
alter table public.preorder_supply_events add column if not exists supplier_id uuid;
alter table public.preorder_supply_events add column if not exists supplier_name text;
alter table public.preorder_supply_events add column if not exists changed_by_login_id uuid;
alter table public.preorder_supply_events add column if not exists changed_by_staff_id uuid;
alter table public.preorder_supply_events add column if not exists changed_by_staff_code text;
alter table public.preorder_supply_events add column if not exists changed_by_username text;
alter table public.preorder_supply_events add column if not exists changed_by_role text;
update public.preorder_supply_events set client_action_id='legacy:'||id::text where client_action_id is null;
alter table public.preorder_supply_events alter column client_action_id set not null;
alter table public.preorder_supply_events drop constraint if exists preorder_supply_events_action_check;
alter table public.preorder_supply_events add constraint preorder_supply_events_action_check check (action_type in ('Buy','PartialBuy','NextSup','Remove','Recall','StatusChange'));
alter table public.preorder_supply_events drop constraint if exists preorder_supply_events_quantity_check;
alter table public.preorder_supply_events add constraint preorder_supply_events_quantity_check check (quantity>=0 and previous_qty>=0 and (remaining_qty is null or remaining_qty>=0));
create unique index if not exists preorder_supply_events_client_action_uidx on public.preorder_supply_events(client_action_id);
create index if not exists preorder_supply_events_item_created_idx on public.preorder_supply_events(item_key,created_at desc,id desc);
create index if not exists preorder_supply_events_order_created_idx on public.preorder_supply_events(order_number,created_at desc);
create index if not exists preorder_supply_events_bought_idx on public.preorder_supply_events(bought_at desc) where bought_at is not null;
create index if not exists preorder_supply_events_batch_idx on public.preorder_supply_events(batch_id) where batch_id is not null;
alter table public.preorder_supply_events enable row level security;
revoke all on public.preorder_supply_events from public, anon, authenticated;

create or replace function public.fc_list_preorder_supply_events_v1(p_username text,p_session_token text,p_before_created_at timestamptz default null,p_before_id uuid default null,p_page_size integer default 500)
returns setof public.preorder_supply_events language plpgsql security definer set search_path=public as $$
begin
  perform public.fc_require_session_permission(p_username,p_session_token,'page.warehouse');
  return query select e.* from public.preorder_supply_events e
   where p_before_created_at is null or (e.created_at,e.id)<(p_before_created_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
   order by e.created_at desc,e.id desc limit greatest(1,least(coalesce(p_page_size,500),1000));
end $$;

create or replace function public.fc_record_preorder_supply_event_v1(p_username text,p_session_token text,p_event jsonb)
returns public.preorder_supply_events language plpgsql security definer set search_path=public as $$
declare v_actor record; v_existing public.preorder_supply_events%rowtype; v_result public.preorder_supply_events%rowtype; v_client text:=nullif(trim(p_event->>'client_action_id'),''); v_action text:=p_event->>'action_type'; v_qty numeric:=coalesce((p_event->>'quantity')::numeric,0); v_batch uuid:=nullif(p_event->>'batch_id','')::uuid;
begin
  select * into v_actor from public.fc_require_session_permission(p_username,p_session_token,'page.warehouse');
  if v_client is null then raise exception 'client_action_id is required' using errcode='22023'; end if;
  insert into public.preorder_supply_events(item_key,order_number,order_item_id,added_order_item_id,action_type,product_id,product_name,supplier_id,supplier_name,customer_id,customer_name,quantity,previous_qty,remaining_qty,previous_status,new_status,changed_by_login_id,changed_by_staff_id,changed_by_staff_code,changed_by_username,changed_by_name,changed_by_role,client_action_id,batch_id,bought_at,metadata)
  values(p_event->>'item_key',p_event->>'order_number',nullif(p_event->>'order_item_id','')::uuid,nullif(p_event->>'added_order_item_id','')::uuid,v_action,nullif(p_event->>'product_id','')::uuid,p_event->>'product_name',nullif(p_event->>'supplier_id','')::uuid,p_event->>'supplier_name',nullif(p_event->>'customer_id','')::uuid,p_event->>'customer_name',v_qty,coalesce((p_event->>'previous_qty')::numeric,0),nullif(p_event->>'remaining_qty','')::numeric,p_event->>'previous_status',p_event->>'new_status',v_actor.login_id,v_actor.staff_id,v_actor.staff_code,v_actor.username,v_actor.staff_name,v_actor.staff_role,v_client,v_batch,case when v_action in ('Buy','PartialBuy') then now() else null end,coalesce(p_event->'metadata','{}'::jsonb))
  on conflict (client_action_id) do nothing
  returning * into v_result;
  if found then return v_result; end if;
  select * into v_existing from public.preorder_supply_events where client_action_id=v_client;
  if not found then raise exception 'Could not resolve the existing client_action_id event.'; end if;
  if v_existing.order_item_id is distinct from nullif(p_event->>'order_item_id','')::uuid or v_existing.action_type is distinct from v_action or v_existing.quantity is distinct from v_qty or v_existing.batch_id is distinct from v_batch then
    raise exception 'client_action_id was already used for a different event' using errcode='23505';
  end if;
  return v_existing;
end $$;

revoke all on function public.fc_list_preorder_supply_events_v1(text,text,timestamptz,uuid,integer) from public,anon,authenticated;
revoke all on function public.fc_record_preorder_supply_event_v1(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.fc_list_preorder_supply_events_v1(text,text,timestamptz,uuid,integer) to anon,authenticated;
grant execute on function public.fc_record_preorder_supply_event_v1(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
