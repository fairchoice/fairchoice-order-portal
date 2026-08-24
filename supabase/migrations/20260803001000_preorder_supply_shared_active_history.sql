begin;

-- Shared Pre-order Supply history with current order delivery state.
-- Additive only: existing event rows remain unchanged.
create or replace function public.fc_list_preorder_supply_events_v2(
  p_username text,
  p_session_token text,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_page_size integer default 500
)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fc_require_session_permission(
    p_username,
    p_session_token,
    'page.warehouse'
  );

  return query
  select to_jsonb(e)
    || jsonb_build_object(
      'order_status', matched_order.order_status,
      'delivery_confirmed_at', matched_order.delivery_confirmed_at,
      'delivery_confirmed', (
        lower(coalesce(matched_order.order_status, '')) in (
          'delivered',
          'delivery confirmed',
          'confirmed delivered'
        )
        or matched_order.delivery_confirmed_at is not null
      )
    )
  from public.preorder_supply_events e
  left join lateral (
    select
      to_jsonb(o)->>'status' as order_status,
      coalesce(
        nullif(to_jsonb(o)->>'delivered_at', '')::timestamptz,
        nullif(to_jsonb(o)->>'delivery_confirmed_at', '')::timestamptz
      ) as delivery_confirmed_at
    from public.orders o
    where to_jsonb(o)->>'order_number' = e.order_number
       or o.id::text = e.order_number
    limit 1
  ) matched_order on true
  where p_before_created_at is null
     or (e.created_at, e.id) < (
       p_before_created_at,
       coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
     )
  order by e.created_at desc, e.id desc
  limit greatest(1, least(coalesce(p_page_size, 500), 1000));
end;
$$;

revoke all on function public.fc_list_preorder_supply_events_v2(
  text,
  text,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated;

grant execute on function public.fc_list_preorder_supply_events_v2(
  text,
  text,
  timestamptz,
  uuid,
  integer
) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
