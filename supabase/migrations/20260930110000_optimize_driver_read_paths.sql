-- Reduce Driver/warehouse read-path timeouts without changing financial data.
-- 1) Read-only session permission check avoids updating the shared session row.
-- 2) Promotion Run lookup gets a targeted partial expression index.
-- 3) Pre-order history limits the event page before joining orders.

create index if not exists customer_payments_promotion_run_order_lookup_idx
  on public.customer_payments (
    (coalesce(metadata->>'order_number', payment_reference))
  )
  where voided_at is null
    and upper(coalesce(metadata->>'payment_applies_to', '')) = 'PROMOTION_RUN';

create or replace function public.fc_assert_session_permission_readonly_v1(
  p_username text,
  p_session_token text,
  p_permission_key text
)
returns void
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_session public.fc_login_sessions%rowtype;
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_effective jsonb := '{}'::jsonb;
  v_role text;
begin
  if nullif(trim(coalesce(p_username,'')),'') is null
     or nullif(coalesce(p_session_token,''),'') is null
     or nullif(trim(coalesce(p_permission_key,'')),'') is null then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  select s.* into v_session
  from public.fc_login_sessions s
  where s.token_hash = encode(extensions.digest(p_session_token,'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(s.idle_expires_at, s.expires_at) > now()
  order by s.created_at desc
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  select * into v_login
  from public.login_users
  where id = v_session.login_id
    and lower(trim(username)) = lower(trim(p_username))
    and active is true
    and auth_version = v_session.auth_version
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  v_role := coalesce(nullif(trim(v_login.role),''),'Staff');

  if lower(v_role) = 'customer' then
    if p_permission_key <> 'customer.portal.payment' then
      raise exception 'FC permission denied.' using errcode='42501';
    end if;
    return;
  end if;

  select * into v_staff
  from public.staff_users
  where id = v_login.staff_id and active is true
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  v_effective := public.fc_effective_permissions_v2(v_login.id, v_staff.id, v_role);

  if not (
    coalesce((v_effective->>'all_access')::boolean,false)
    or coalesce((v_effective->>p_permission_key)::boolean,false)
  ) then
    raise exception 'FC permission denied.' using errcode='42501';
  end if;
end;
$function$;

revoke all on function public.fc_assert_session_permission_readonly_v1(text,text,text) from public;
grant execute on function public.fc_assert_session_permission_readonly_v1(text,text,text) to anon, authenticated;

create or replace function public.fc_list_promotion_run_order_numbers_v1(
  p_username text,
  p_session_token text
)
returns table(order_number text)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
begin
  perform public.fc_assert_session_permission_readonly_v1(
    p_username,
    p_session_token,
    'page.operations.driver'
  );

  return query
  select distinct promotion_order_number
  from (
    select nullif(trim(pr.order_number), '') as promotion_order_number
    from public.promotion_runs pr
    where nullif(trim(pr.order_number), '') is not null

    union all

    select nullif(trim(coalesce(cp.metadata->>'order_number', cp.payment_reference)), '')
    from public.customer_payments cp
    where upper(coalesce(cp.metadata->>'payment_applies_to', '')) = 'PROMOTION_RUN'
      and cp.voided_at is null
  ) promotion_orders
  where promotion_order_number is not null;
end;
$function$;

revoke all on function public.fc_list_promotion_run_order_numbers_v1(text,text) from public;
grant execute on function public.fc_list_promotion_run_order_numbers_v1(text,text) to anon, authenticated;

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
set search_path = 'public', 'extensions'
as $function$
begin
  perform public.fc_assert_session_permission_readonly_v1(
    p_username,
    p_session_token,
    'page.warehouse'
  );

  return query
  with selected_events as (
    select e.*
    from public.preorder_supply_events e
    where p_before_created_at is null
       or (e.created_at, e.id) < (
         p_before_created_at,
         coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
       )
    order by e.created_at desc, e.id desc
    limit greatest(1, least(coalesce(p_page_size, 500), 1000))
  )
  select to_jsonb(e)
    || jsonb_build_object(
      'order_status', matched_order.order_status,
      'delivery_confirmed_at', matched_order.delivery_confirmed_at,
      'delivery_confirmed', (
        lower(coalesce(matched_order.order_status, '')) in (
          'delivered', 'delivery confirmed', 'confirmed delivered'
        )
        or matched_order.delivery_confirmed_at is not null
      )
    )
  from selected_events e
  left join lateral (
    select o.status as order_status,
           coalesce(o.delivered_at, nullif(to_jsonb(o)->>'delivery_confirmed_at','')::timestamptz) as delivery_confirmed_at
    from public.orders o
    where o.order_number = e.order_number

    union all

    select o.status as order_status,
           coalesce(o.delivered_at, nullif(to_jsonb(o)->>'delivery_confirmed_at','')::timestamptz) as delivery_confirmed_at
    from public.orders o
    where e.order_number ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and o.id = e.order_number::uuid
      and o.order_number is distinct from e.order_number
    limit 1
  ) matched_order on true
  order by e.created_at desc, e.id desc;
end;
$function$;

revoke all on function public.fc_list_preorder_supply_events_v2(text,text,timestamptz,uuid,integer) from public;
grant execute on function public.fc_list_preorder_supply_events_v2(text,text,timestamptz,uuid,integer) to anon, authenticated;

notify pgrst, 'reload schema';