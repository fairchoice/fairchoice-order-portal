-- FAIRCHOICE CENTRAL CART FOUNDATION
-- PREPARED FOR TEST ENVIRONMENT ONLY.
-- DO NOT APPLY TO fairchoice-order-system (PRODUCTION) WITHOUT EXPLICIT APPROVAL.
-- This migration does not alter orders or order_items.

create table if not exists public.customer_carts (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'SUBMITTING', 'SUBMITTED', 'ABANDONED')),
  submission_order_number text null,
  submitted_at timestamptz null,
  created_by_login_id uuid null references public.login_users(id) on delete set null,
  created_by_name text not null default '',
  updated_by_login_id uuid null references public.login_users(id) on delete set null,
  updated_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.customer_carts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);

create unique index if not exists uq_customer_carts_one_open_scope
  on public.customer_carts (
    customer_account_id,
    coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status in ('ACTIVE', 'SUBMITTING');

create index if not exists idx_customer_carts_account_branch
  on public.customer_carts(customer_account_id, customer_branch_id, status, updated_at desc);

create index if not exists idx_customer_cart_items_cart
  on public.customer_cart_items(cart_id, updated_at desc);

alter table public.customer_carts enable row level security;
alter table public.customer_cart_items enable row level security;

-- FairChoice uses its own FC session system. Browser roles must not access these tables directly.
revoke all on public.customer_carts from anon, authenticated;
revoke all on public.customer_cart_items from anon, authenticated;

create or replace function public.fc_cart_actor_v1(
  p_fc_username text,
  p_fc_session_token text
)
returns table(
  login_id uuid,
  username text,
  staff_name text,
  staff_role text,
  customer_account_id uuid,
  effective_permissions jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_session public.fc_login_sessions%rowtype;
  v_role text;
  v_effective jsonb := '{}'::jsonb;
begin
  if nullif(trim(coalesce(p_fc_username, '')), '') is null
     or nullif(coalesce(p_fc_session_token, ''), '') is null then
    raise exception 'FC session is invalid or expired. Please sign in again.'
      using errcode = '28000';
  end if;

  select s.* into v_session
  from public.fc_login_sessions s
  join public.login_users l
    on l.id = s.login_id
  where lower(trim(l.username)) = lower(trim(p_fc_username))
    and s.token_hash = encode(
      extensions.digest(p_fc_session_token, 'sha256'),
      'hex'
    )
    and s.revoked_at is null
    and s.expires_at > now()
    and l.active is true
  order by s.created_at desc
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.'
      using errcode = '28000';
  end if;

  select *
  into v_login
  from public.login_users
  where id = v_session.login_id;

  v_role := coalesce(nullif(trim(v_login.role), ''), 'Staff');

  update public.fc_login_sessions
  set last_used_at = now()
  where id = v_session.id;

  if lower(v_role) = 'customer' then
    return query
    select
      v_login.id,
      v_login.username,
      v_login.username,
      v_role,
      v_login.customer_account_id,
      '{}'::jsonb;
    return;
  end if;

  select *
  into v_staff
  from public.staff_users
  where id = v_login.staff_id
    and active is true
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.'
      using errcode = '28000';
  end if;

  v_effective :=
    public.fc_effective_permissions_v2(
      v_login.id,
      v_staff.id,
      v_role
    );

  if not (
    coalesce((v_effective->>'all_access')::boolean, false)
    or coalesce((v_effective->>'orders.take')::boolean, false)
    or coalesce((v_effective->>'orders.edit')::boolean, false)
  ) then
    raise exception 'FC permission denied.'
      using errcode = '42501';
  end if;

  return query
  select
    v_login.id,
    v_login.username,
    coalesce(v_staff.staff_name, v_login.username),
    v_role,
    v_login.customer_account_id,
    v_effective;
end;
$$;

create or replace function public.fc_assert_cart_access_v1(
  p_cart_id uuid,
  p_fc_username text,
  p_fc_session_token text
)
returns public.customer_carts
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
begin
  select * into v_actor
  from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);

  select * into v_cart
  from public.customer_carts
  where id = p_cart_id;

  if not found then
    raise exception 'Cart not found.' using errcode = 'P0002';
  end if;

  if lower(coalesce(v_actor.staff_role, '')) = 'customer'
     and v_actor.customer_account_id is distinct from v_cart.customer_account_id then
    raise exception 'FC permission denied.' using errcode = '42501';
  end if;

  return v_cart;
end;
$$;

create or replace function public.fc_cart_get_or_create_v1(
  p_customer_account_id uuid,
  p_customer_branch_id uuid default null,
  p_fc_username text default null,
  p_fc_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
  v_items jsonb := '[]'::jsonb;
begin
  if p_customer_account_id is null then
    raise exception 'Customer account is required.';
  end if;

  select * into v_actor
  from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);

  if lower(coalesce(v_actor.staff_role, '')) = 'customer'
     and v_actor.customer_account_id is distinct from p_customer_account_id then
    raise exception 'FC permission denied.' using errcode = '42501';
  end if;

  if p_customer_branch_id is not null and not exists (
    select 1
    from public.customer_branches b
    where b.id = p_customer_branch_id
      and b.customer_account_id = p_customer_account_id
      and coalesce(b.active, true) is true
  ) then
    raise exception 'Selected branch does not belong to this customer account.' using errcode = '23514';
  end if;

  -- Recover a completed submission if the order already exists but finalization was interrupted.
  update public.customer_carts c
  set status = 'SUBMITTED',
      submitted_at = coalesce(c.submitted_at, now()),
      updated_at = now()
  where c.customer_account_id = p_customer_account_id
    and c.customer_branch_id is not distinct from p_customer_branch_id
    and c.status = 'SUBMITTING'
    and c.submission_order_number is not null
    and exists (
      select 1 from public.orders o
      where o.order_number = c.submission_order_number
        and o.customer_account_id = c.customer_account_id
    );

  select * into v_cart
  from public.customer_carts c
  where c.customer_account_id = p_customer_account_id
    and c.customer_branch_id is not distinct from p_customer_branch_id
    and c.status in ('ACTIVE', 'SUBMITTING')
  order by c.updated_at desc
  limit 1;

  if not found then
    insert into public.customer_carts(
      customer_account_id,
      customer_branch_id,
      status,
      created_by_login_id,
      created_by_name,
      updated_by_login_id,
      updated_by_name
    ) values (
      p_customer_account_id,
      p_customer_branch_id,
      'ACTIVE',
      v_actor.login_id,
      coalesce(v_actor.staff_name, v_actor.username, ''),
      v_actor.login_id,
      coalesce(v_actor.staff_name, v_actor.username, '')
    )
    returning * into v_cart;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', i.product_id,
        'quantity', i.quantity,
        'updated_at', i.updated_at
      ) order by i.created_at
    ),
    '[]'::jsonb
  ) into v_items
  from public.customer_cart_items i
  where i.cart_id = v_cart.id;

  return jsonb_build_object(
    'cart_id', v_cart.id,
    'status', v_cart.status,
    'submission_order_number', v_cart.submission_order_number,
    'updated_at', v_cart.updated_at,
    'updated_by_name', v_cart.updated_by_name,
    'items', v_items
  );
end;
$$;

create or replace function public.fc_cart_increment_item_v1(
  p_cart_id uuid,
  p_product_id uuid,
  p_delta numeric,
  p_fc_username text,
  p_fc_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
  v_row public.customer_cart_items%rowtype;
begin
  if p_product_id is null or coalesce(p_delta, 0) = 0 then
    raise exception 'Product and non-zero quantity change are required.';
  end if;

  select * into v_actor from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);
  v_cart := public.fc_assert_cart_access_v1(p_cart_id, p_fc_username, p_fc_session_token);

  if v_cart.status <> 'ACTIVE' then
    raise exception 'Cart is currently being submitted. Please refresh before editing.' using errcode = '55000';
  end if;

  if not exists (select 1 from public.products p where p.id = p_product_id) then
    raise exception 'Product not found.' using errcode = 'P0002';
  end if;

  if p_delta > 0 then
    insert into public.customer_cart_items(cart_id, product_id, quantity)
    values (p_cart_id, p_product_id, p_delta)
    on conflict (cart_id, product_id) do update
      set quantity = customer_cart_items.quantity + excluded.quantity,
          updated_at = now()
    returning * into v_row;
else
  select *
  into v_row
  from public.customer_cart_items
  where cart_id = p_cart_id
    and product_id = p_product_id
  for update;

  if found then
    if v_row.quantity + p_delta <= 0 then
      delete from public.customer_cart_items
      where id = v_row.id;

      v_row := null;
    else
      update public.customer_cart_items
      set quantity = quantity + p_delta,
          updated_at = now()
      where id = v_row.id
      returning * into v_row;
    end if;
  end if;
end if;

  update public.customer_carts
  set updated_at = now(),
      updated_by_login_id = v_actor.login_id,
      updated_by_name = coalesce(v_actor.staff_name, v_actor.username, '')
  where id = p_cart_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'quantity', case when v_row.id is null then 0 else v_row.quantity end
  );
end;
$$;

create or replace function public.fc_cart_set_quantity_v1(
  p_cart_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_fc_username text,
  p_fc_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
  v_quantity numeric := greatest(0, coalesce(p_quantity, 0));
begin
  select * into v_actor from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);
  v_cart := public.fc_assert_cart_access_v1(p_cart_id, p_fc_username, p_fc_session_token);

  if v_cart.status <> 'ACTIVE' then
    raise exception 'Cart is currently being submitted. Please refresh before editing.' using errcode = '55000';
  end if;

  if v_quantity = 0 then
    delete from public.customer_cart_items
    where cart_id = p_cart_id and product_id = p_product_id;
  else
    if not exists (select 1 from public.products p where p.id = p_product_id) then
      raise exception 'Product not found.' using errcode = 'P0002';
    end if;

    insert into public.customer_cart_items(cart_id, product_id, quantity)
    values (p_cart_id, p_product_id, v_quantity)
    on conflict (cart_id, product_id) do update
      set quantity = excluded.quantity,
          updated_at = now();
  end if;

  update public.customer_carts
  set updated_at = now(),
      updated_by_login_id = v_actor.login_id,
      updated_by_name = coalesce(v_actor.staff_name, v_actor.username, '')
  where id = p_cart_id;

  return jsonb_build_object('product_id', p_product_id, 'quantity', v_quantity);
end;
$$;

create or replace function public.fc_cart_begin_submission_v1(
  p_cart_id uuid,
  p_order_number text,
  p_fc_username text,
  p_fc_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
begin
  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Order number is required.';
  end if;

  select * into v_actor from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);
  v_cart := public.fc_assert_cart_access_v1(p_cart_id, p_fc_username, p_fc_session_token);

  if v_cart.status = 'SUBMITTING' and v_cart.submission_order_number = p_order_number then
    return jsonb_build_object('cart_id', v_cart.id, 'status', v_cart.status);
  end if;

  if v_cart.status <> 'ACTIVE' then
    raise exception 'Cart is not available for submission.' using errcode = '55000';
  end if;

  if not exists (select 1 from public.customer_cart_items where cart_id = p_cart_id) then
    raise exception 'Cannot submit an empty cart.' using errcode = '23514';
  end if;

  update public.customer_carts
  set status = 'SUBMITTING',
      submission_order_number = p_order_number,
      updated_at = now(),
      updated_by_login_id = v_actor.login_id,
      updated_by_name = coalesce(v_actor.staff_name, v_actor.username, '')
  where id = p_cart_id
  returning * into v_cart;

  return jsonb_build_object('cart_id', v_cart.id, 'status', v_cart.status);
end;
$$;

create or replace function public.fc_cart_finalize_submission_v1(
  p_cart_id uuid,
  p_order_number text,
  p_fc_username text,
  p_fc_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
begin
  select * into v_actor from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);
  v_cart := public.fc_assert_cart_access_v1(p_cart_id, p_fc_username, p_fc_session_token);

  if v_cart.submission_order_number is distinct from p_order_number then
    raise exception 'Cart submission reference does not match the created order.' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.orders o
    where o.order_number = p_order_number
      and o.customer_account_id = v_cart.customer_account_id
      and coalesce(o.customer_branch_id, o.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_cart.customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'Created order could not be verified for this cart.' using errcode = '23514';
  end if;

  update public.customer_carts
  set status = 'SUBMITTED',
      submitted_at = now(),
      updated_at = now(),
      updated_by_login_id = v_actor.login_id,
      updated_by_name = coalesce(v_actor.staff_name, v_actor.username, '')
  where id = p_cart_id;

  return jsonb_build_object('cart_id', p_cart_id, 'status', 'SUBMITTED');
end;
$$;

create or replace function public.fc_cart_cancel_submission_v1(
  p_cart_id uuid,
  p_order_number text,
  p_fc_username text,
  p_fc_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_cart public.customer_carts%rowtype;
begin
  select * into v_actor from public.fc_cart_actor_v1(p_fc_username, p_fc_session_token);
  v_cart := public.fc_assert_cart_access_v1(p_cart_id, p_fc_username, p_fc_session_token);

  if v_cart.status = 'SUBMITTING'
     and v_cart.submission_order_number = p_order_number
     and not exists (
       select 1 from public.orders o
       where o.order_number = p_order_number
         and o.customer_account_id = v_cart.customer_account_id
     ) then
    update public.customer_carts
    set status = 'ACTIVE',
        submission_order_number = null,
        updated_at = now(),
        updated_by_login_id = v_actor.login_id,
        updated_by_name = coalesce(v_actor.staff_name, v_actor.username, '')
    where id = p_cart_id;
  end if;

  return jsonb_build_object('cart_id', p_cart_id, 'status', 'ACTIVE');
end;
$$;

revoke all on function public.fc_cart_actor_v1(text, text) from public;
revoke all on function public.fc_assert_cart_access_v1(uuid, text, text) from public;
revoke all on function public.fc_cart_get_or_create_v1(uuid, uuid, text, text) from public;
revoke all on function public.fc_cart_increment_item_v1(uuid, uuid, numeric, text, text) from public;
revoke all on function public.fc_cart_set_quantity_v1(uuid, uuid, numeric, text, text) from public;
revoke all on function public.fc_cart_begin_submission_v1(uuid, text, text, text) from public;
revoke all on function public.fc_cart_finalize_submission_v1(uuid, text, text, text) from public;
revoke all on function public.fc_cart_cancel_submission_v1(uuid, text, text, text) from public;

grant execute on function public.fc_cart_get_or_create_v1(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.fc_cart_increment_item_v1(uuid, uuid, numeric, text, text) to anon, authenticated;
grant execute on function public.fc_cart_set_quantity_v1(uuid, uuid, numeric, text, text) to anon, authenticated;
grant execute on function public.fc_cart_begin_submission_v1(uuid, text, text, text) to anon, authenticated;
grant execute on function public.fc_cart_finalize_submission_v1(uuid, text, text, text) to anon, authenticated;
grant execute on function public.fc_cart_cancel_submission_v1(uuid, text, text, text) to anon, authenticated;
