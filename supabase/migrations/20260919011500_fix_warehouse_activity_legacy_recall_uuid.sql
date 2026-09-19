begin;

create or replace function public.fc_list_warehouse_activity_v1(
  p_username text,
  p_session_token text,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_page_size integer default 5000
)
returns table(
  id uuid,
  client_action_id text,
  order_number text,
  order_id uuid,
  order_item_id uuid,
  product_id uuid,
  product_code text,
  product_name text,
  quantity numeric,
  customer_id uuid,
  customer_name text,
  branch_name text,
  country text,
  warehouse_location text,
  old_status text,
  new_status text,
  action_type text,
  reason text,
  supplier_id uuid,
  supplier_name text,
  changed_by_staff_id uuid,
  changed_by_name text,
  changed_by_role text,
  source_module text,
  referenced_event_id uuid,
  referenced_client_action_id text,
  created_at timestamptz
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
      coalesce(p.metadata->>'recalledClientActionId', p.metadata->>'recalledEventId'),
      p.created_at
    from public.preorder_supply_events p
    left join lateral (
      select prior.id,prior.action_type
      from public.preorder_supply_events prior
      where prior.id = case
              when coalesce(p.metadata->>'recalledEventId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (p.metadata->>'recalledEventId')::uuid
              else null::uuid
            end
         or prior.client_action_id = nullif(p.metadata->>'recalledClientActionId','')
         or prior.client_action_id = nullif(p.metadata->>'recalledEventId','')
      order by prior.created_at desc
      limit 1
    ) original on p.action_type='Recall'
  )
  select c.*
  from combined c
  where (p_date_from is null or c.created_at >= p_date_from)
    and (p_date_to is null or c.created_at <= p_date_to)
  order by c.created_at desc,c.id desc
  limit greatest(1,least(coalesce(p_page_size,5000),10000));
end
$$;

revoke all on function public.fc_list_warehouse_activity_v1(text,text,timestamptz,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.fc_list_warehouse_activity_v1(text,text,timestamptz,timestamptz,integer) to anon,authenticated;

notify pgrst,'reload schema';
commit;
