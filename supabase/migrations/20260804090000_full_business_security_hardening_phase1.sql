-- Fair Choice full-business security hardening, phase 1.
-- Forward-only migration. Review in test before applying to production.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Authentication abuse controls and security audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.fc_login_security_state (
  username_normalized text primary key,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  first_failed_at timestamptz null,
  last_failed_at timestamptz null,
  locked_until timestamptz null,
  last_success_at timestamptz null,
  updated_at timestamptz not null default now()
);

create table if not exists public.fc_security_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','HIGH','CRITICAL')),
  login_id uuid null,
  staff_id uuid null,
  username_normalized text null,
  session_id uuid null,
  permission_key text null,
  entity_type text null,
  entity_id text null,
  request_id uuid not null default extensions.gen_random_uuid(),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists fc_security_events_time_idx
  on public.fc_security_events (occurred_at desc);
create index if not exists fc_security_events_username_idx
  on public.fc_security_events (username_normalized, occurred_at desc);
create index if not exists fc_security_events_session_idx
  on public.fc_security_events (session_id, occurred_at desc);

alter table public.login_users
  add column if not exists auth_version integer not null default 1,
  add column if not exists password_changed_at timestamptz null;

alter table public.fc_login_sessions
  add column if not exists auth_version integer not null default 1,
  add column if not exists idle_expires_at timestamptz null,
  add column if not exists revoked_reason text null;

update public.fc_login_sessions
set idle_expires_at = least(expires_at, coalesce(last_used_at, created_at) + interval '60 minutes')
where idle_expires_at is null;

-- Complete password migration, including the owner account, then remove plaintext.
update public.login_users
set password_hash = extensions.crypt(password, extensions.gen_salt('bf', 12)),
    password_changed_at = coalesce(password_changed_at, now()),
    auth_version = auth_version + 1,
    updated_at = now()
where nullif(password_hash, '') is null
  and nullif(password, '') is not null;

-- Legacy schemas created password as NOT NULL. Remove that constraint only
-- after every usable plaintext credential has been converted to a hash.
alter table public.login_users
  alter column password drop not null;

update public.login_users
set password = null,
    updated_at = now()
where password is not null;

-- Sensitive tables are never directly accessible through PostgREST roles.
alter table public.fc_login_sessions enable row level security;
alter table public.fc_login_sessions force row level security;
alter table public.fc_login_security_state enable row level security;
alter table public.fc_login_security_state force row level security;
alter table public.fc_security_events enable row level security;
alter table public.fc_security_events force row level security;
alter table public.fc_staff_permissions enable row level security;
alter table public.fc_staff_permissions force row level security;

revoke all on table public.fc_login_sessions from anon, authenticated;
revoke all on table public.fc_login_security_state from anon, authenticated;
revoke all on table public.fc_security_events from anon, authenticated;
revoke all on table public.fc_staff_permissions from anon, authenticated;
revoke all on sequence public.fc_security_events_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Canonical permission calculation
-- ---------------------------------------------------------------------------

create or replace function public.fc_effective_permissions_v2(
  p_login_id uuid,
  p_staff_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_role text := lower(trim(coalesce(p_role, 'staff')));
  v_permissions jsonb := '{}'::jsonb;
begin
  if v_role = 'super admin' then
    return '{"all_access":true}'::jsonb;
  end if;

  if v_role = 'admin' then
    v_permissions := '{"payments.collect_cash":true,"payments.collect_card":true,"payments.view":true}'::jsonb;
  elsif v_role = 'driver' then
    v_permissions := '{"payments.collect_cash":true,"delivery.complete":true}'::jsonb;
  elsif replace(v_role, ' ', '') in ('salesrep','salesrepresentative') then
    v_permissions := '{"payments.collect_cash":true,"orders.take":true}'::jsonb;
  end if;

  -- Only registered permission keys are accepted. Arbitrary JSON permission
  -- keys and all_access injection are intentionally ignored.
  select v_permissions || coalesce(jsonb_object_agg(p.permission_key, to_jsonb(sp.allowed)), '{}'::jsonb)
  into v_permissions
  from public.fc_staff_permissions sp
  join public.fc_permissions p
    on p.permission_key = sp.permission_key
   and p.active is true
  where sp.staff_id = p_staff_id
    and p.permission_key <> 'all_access';

  return coalesce(v_permissions, '{}'::jsonb);
end;
$$;

revoke all on function public.fc_effective_permissions_v2(uuid,uuid,text) from public;

-- ---------------------------------------------------------------------------
-- Login v2: hash-only, persistent throttling, generic failure responses
-- ---------------------------------------------------------------------------

create or replace function public.fc_login_v2(p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text := lower(trim(coalesce(p_username, '')));
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_state public.fc_login_security_state%rowtype;
  v_password_valid boolean := false;
  v_token text;
  v_session_id uuid;
  v_role text;
  v_is_customer boolean;
  v_permissions jsonb := '{}'::jsonb;
  v_failures integer;
  v_lock_minutes integer;
begin
  if v_username = '' or nullif(coalesce(p_password, ''), '') is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid username or password.');
  end if;

  -- Serialize attempts for one username to prevent parallel lockout bypass.
  perform pg_advisory_xact_lock(hashtext('fc-login:' || v_username));

  insert into public.fc_login_security_state(username_normalized)
  values (v_username)
  on conflict (username_normalized) do nothing;

  select * into v_state
  from public.fc_login_security_state
  where username_normalized = v_username
  for update;

  if v_state.locked_until is not null and v_state.locked_until > now() then
    insert into public.fc_security_events(event_type,severity,username_normalized,details)
    values ('LOGIN_BLOCKED','HIGH',v_username,jsonb_build_object('locked_until',v_state.locked_until));
    return jsonb_build_object(
      'ok', false,
      'error', 'Too many login attempts. Try again later.',
      'retry_at', v_state.locked_until
    );
  end if;

  select * into v_login
  from public.login_users l
  where lower(trim(l.username)) = v_username
    and l.active is true
  order by l.created_at desc nulls last
  limit 1;

  if found and nullif(v_login.password_hash, '') is not null then
    v_password_valid := extensions.crypt(p_password, v_login.password_hash) = v_login.password_hash;
  end if;

  if not found or not v_password_valid then
    v_failures := case
      when v_state.last_failed_at is null or v_state.last_failed_at < now() - interval '30 minutes' then 1
      else v_state.failed_attempts + 1
    end;
    v_lock_minutes := case
      when v_failures >= 10 then 60
      when v_failures >= 7 then 15
      when v_failures >= 5 then 5
      else 0
    end;

    update public.fc_login_security_state
    set failed_attempts = v_failures,
        first_failed_at = case when v_failures = 1 then now() else coalesce(first_failed_at, now()) end,
        last_failed_at = now(),
        locked_until = case when v_lock_minutes > 0 then now() + make_interval(mins => v_lock_minutes) else null end,
        updated_at = now()
    where username_normalized = v_username;

    insert into public.fc_security_events(event_type,severity,username_normalized,login_id,details)
    values (
      'LOGIN_FAILED',
      case when v_lock_minutes > 0 then 'HIGH' else 'WARNING' end,
      v_username,
      case when found then v_login.id else null end,
      jsonb_build_object('failed_attempts',v_failures,'lock_minutes',v_lock_minutes)
    );

    return jsonb_build_object(
      'ok', false,
      'error', case when v_lock_minutes > 0 then 'Too many login attempts. Try again later.' else 'Invalid username or password.' end,
      'retry_at', case when v_lock_minutes > 0 then now() + make_interval(mins => v_lock_minutes) else null end
    );
  end if;

  v_role := coalesce(nullif(trim(v_login.role), ''), 'Staff');
  v_is_customer := lower(v_role) = 'customer';

  if not v_is_customer then
    select * into v_staff
    from public.staff_users s
    where s.id = v_login.staff_id and s.active is true
    limit 1;
    if not found then
      insert into public.fc_security_events(event_type,severity,username_normalized,login_id,details)
      values ('LOGIN_REJECTED_INACTIVE_STAFF','HIGH',v_username,v_login.id,'{}'::jsonb);
      return jsonb_build_object('ok', false, 'error', 'Invalid username or password.');
    end if;
    v_permissions := public.fc_effective_permissions_v2(v_login.id, v_staff.id, v_role);
  end if;

  -- Limit concurrent exposure: revoke older sessions and keep at most three.
  update public.fc_login_sessions
  set revoked_at = now(), revoked_reason = 'NEW_LOGIN_SESSION_LIMIT'
  where id in (
    select id from public.fc_login_sessions
    where login_id = v_login.id and revoked_at is null
    order by created_at desc
    offset 2
  );

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.fc_login_sessions(
    login_id, staff_id, token_hash, auth_version,
    expires_at, idle_expires_at, last_used_at
  ) values (
    v_login.id, v_login.staff_id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_login.auth_version,
    now() + interval '8 hours',
    now() + interval '60 minutes',
    now()
  ) returning id into v_session_id;

  update public.fc_login_security_state
  set failed_attempts = 0, first_failed_at = null, last_failed_at = null,
      locked_until = null, last_success_at = now(), updated_at = now()
  where username_normalized = v_username;

  insert into public.fc_security_events(
    event_type,severity,login_id,staff_id,username_normalized,session_id,details
  ) values (
    'LOGIN_SUCCEEDED','INFO',v_login.id,v_login.staff_id,v_username,v_session_id,
    jsonb_build_object('role',v_role)
  );

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'expires_at', now() + interval '8 hours',
    'idle_expires_at', now() + interval '60 minutes',
    'profile', jsonb_build_object(
      'id',v_login.id,'login_user_id',v_login.id,'login_code',v_login.login_code,
      'staff_id',v_login.staff_id,
      'staff_code',case when v_is_customer then null else v_staff.staff_code end,
      'username',v_login.username,
      'staff_name',case when v_is_customer then v_login.username else coalesce(v_staff.staff_name,v_login.username) end,
      'role',v_role,'access_level',v_role,
      'permissions',v_permissions,'effective_permissions',v_permissions,
      'customer_account_id',v_login.customer_account_id,'active',true
    )
  );
end;
$$;

revoke all on function public.fc_login_v1(text,text) from anon, authenticated;
revoke all on function public.fc_login_v2(text,text) from public;
grant execute on function public.fc_login_v2(text,text) to anon, authenticated;

-- Owner passwords must never be submitted to a public RPC.
revoke all on function public.fc_require_owner_approval(text,text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Session validation v2: auth-version revocation and idle expiration
-- ---------------------------------------------------------------------------

create or replace function public.fc_require_session_permission_v2(
  p_username text,
  p_session_token text,
  p_permission_key text
)
returns table(
  session_id uuid, login_id uuid, login_code text, staff_id uuid, staff_code text,
  username text, staff_name text, staff_role text,
  customer_account_id uuid, effective_permissions jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_session public.fc_login_sessions%rowtype;
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
  join public.login_users l on l.id = s.login_id
  where lower(trim(l.username)) = lower(trim(p_username))
    and s.token_hash = encode(extensions.digest(p_session_token,'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(s.idle_expires_at, s.expires_at) > now()
    and s.auth_version = l.auth_version
    and l.active is true
  order by s.created_at desc
  limit 1;

  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  select * into v_login from public.login_users where id = v_session.login_id;

  update public.fc_login_sessions
  set last_used_at = now(),
      idle_expires_at = least(expires_at, now() + interval '60 minutes')
  where id = v_session.id;

  v_role := coalesce(nullif(trim(v_login.role),''),'Staff');
  if lower(v_role) = 'customer' then
    if p_permission_key <> 'customer.portal.payment' then
      insert into public.fc_security_events(event_type,severity,login_id,username_normalized,session_id,permission_key)
      values ('PERMISSION_DENIED','HIGH',v_login.id,lower(trim(v_login.username)),v_session.id,p_permission_key);
      raise exception 'FC permission denied.' using errcode='42501';
    end if;
    return query select v_session.id,v_login.id,v_login.login_code,null::uuid,null::text,
      v_login.username,v_login.username,v_role,v_login.customer_account_id,'{}'::jsonb;
    return;
  end if;

  select * into v_staff from public.staff_users
  where id = v_login.staff_id and active is true limit 1;
  if not found then
    raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000';
  end if;

  v_effective := public.fc_effective_permissions_v2(v_login.id,v_staff.id,v_role);
  if not (
    coalesce((v_effective->>'all_access')::boolean,false)
    or coalesce((v_effective->>p_permission_key)::boolean,false)
  ) then
    insert into public.fc_security_events(
      event_type,severity,login_id,staff_id,username_normalized,session_id,permission_key
    ) values (
      'PERMISSION_DENIED','HIGH',v_login.id,v_staff.id,lower(trim(v_login.username)),v_session.id,p_permission_key
    );
    raise exception 'FC permission denied.' using errcode='42501';
  end if;

  return query select v_session.id,v_login.id,v_login.login_code,v_staff.id,v_staff.staff_code,
    v_login.username,coalesce(v_staff.staff_name,v_login.username),v_role,
    v_login.customer_account_id,v_effective;
end;
$$;

revoke all on function public.fc_require_session_permission_v2(text,text,text) from public;
grant execute on function public.fc_require_session_permission_v2(text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Validated financial writer v2
-- ---------------------------------------------------------------------------

create or replace function public.post_canonical_customer_payment_v2(
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_payment_date timestamptz,
  p_payment_method text,
  p_payment_source text,
  p_payment_reference text,
  p_paid_by text,
  p_order_id uuid,
  p_invoice_id uuid,
  p_idempotency_key text,
  p_notes text default '',
  p_metadata jsonb default '{}'::jsonb,
  p_allocations jsonb default '[]'::jsonb,
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
  v_source text := upper(trim(coalesce(p_payment_source,'')));
  v_permission text;
  v_allocation jsonb;
  v_invoice public.customer_invoices%rowtype;
  v_allocated numeric;
  v_requested numeric;
  v_seen text[] := array[]::text[];
  v_metadata jsonb;
begin
  v_permission := case
    when v_source = 'CUSTOMER_PORTAL_PAYMENT' then 'customer.portal.payment'
    when v_source in ('DRIVER_DELIVERY_COLLECTION','PREVIOUS_BALANCE_COLLECTION','SALES_REP_COLLECTION') then 'payments.collect_cash'
    when lower(trim(coalesce(p_payment_method,''))) = 'card' then 'payments.collect_card'
    else 'payments.collect_cash'
  end;

  select * into v_actor
  from public.fc_require_session_permission_v2(p_fc_username,p_fc_session_token,v_permission);

  if p_amount is null or round(p_amount,2) <= 0 or round(p_amount,2) > 1000000 then
    raise exception 'Payment amount is outside the permitted range.';
  end if;

  if lower(v_actor.staff_role) = 'customer' then
    if v_source <> 'CUSTOMER_PORTAL_PAYMENT'
       or v_actor.customer_account_id is distinct from p_customer_account_id then
      raise exception 'Customer payment scope is invalid.' using errcode='42501';
    end if;
    if coalesce(p_payment_date,now()) < now() - interval '1 hour'
       or coalesce(p_payment_date,now()) > now() + interval '5 minutes' then
      raise exception 'Customer payment date is invalid.';
    end if;
  elsif not coalesce((v_actor.effective_permissions->>'all_access')::boolean,false) then
    if coalesce(p_payment_date,now()) < now() - interval '7 days'
       or coalesce(p_payment_date,now()) > now() + interval '5 minutes' then
      raise exception 'Backdated payments beyond seven days require elevated approval.' using errcode='42501';
    end if;
  end if;

  if p_order_id is not null and not exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and o.customer_account_id = p_customer_account_id
      and (p_customer_branch_id is null or o.customer_branch_id = p_customer_branch_id)
  ) then
    raise exception 'Order does not belong to the selected customer scope.';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from public.customer_invoices i
    where i.id = p_invoice_id
      and i.customer_account_id = p_customer_account_id
      and i.status <> 'CANCELLED'
      and (p_customer_branch_id is null or i.customer_branch_id = p_customer_branch_id)
      and (p_order_id is null or i.order_id = p_order_id)
  ) then
    raise exception 'Invoice does not belong to the selected customer scope.';
  end if;

  for v_allocation in select value from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb))
  loop
    if nullif(trim(v_allocation->>'invoiceReference'),'') is null then
      raise exception 'Allocation invoice reference is required.';
    end if;
    if (v_allocation->>'invoiceReference') = any(v_seen) then
      raise exception 'Duplicate invoice allocation is not permitted.';
    end if;
    v_seen := array_append(v_seen,v_allocation->>'invoiceReference');
    v_requested := round(coalesce((v_allocation->>'allocatedAmount')::numeric,0),2);
    if v_requested <= 0 then raise exception 'Allocation amount must be greater than zero.'; end if;

    select * into v_invoice from public.customer_invoices i
    where i.invoice_number = v_allocation->>'invoiceReference'
      and i.customer_account_id = p_customer_account_id
      and i.status <> 'CANCELLED'
      and (p_customer_branch_id is null or i.customer_branch_id = p_customer_branch_id)
    limit 1;
    if not found then raise exception 'Allocation invoice is invalid for this customer.'; end if;

    select coalesce(sum(a.allocated_amount),0) into v_allocated
    from public.customer_payment_allocations a
    where a.customer_account_id = p_customer_account_id
      and a.invoice_reference = v_invoice.invoice_number
      and a.status = 'active';
    if v_requested > round(v_invoice.invoice_total - v_allocated,2) then
      raise exception 'Allocation exceeds the invoice remaining balance.';
    end if;
  end loop;

  -- Remove all caller-supplied identity claims and replace with trusted values.
  v_metadata := coalesce(p_metadata,'{}'::jsonb)
    - 'fc_staff_code' - 'fc_login_code' - 'fc_username'
    - 'collector_staff_id' - 'collector_name' - 'collector_role'
    || jsonb_build_object(
      'fc_staff_code',v_actor.staff_code,
      'fc_login_code',v_actor.login_code,
      'fc_username',v_actor.username,
      'fc_session_id',v_actor.session_id
    );

  return public.post_canonical_customer_payment_v1(
    p_customer_account_id,p_customer_branch_id,p_amount,p_payment_date,
    p_payment_method,p_payment_source,p_payment_reference,p_paid_by,
    v_actor.staff_name,v_actor.staff_id,v_actor.staff_role,
    p_order_id,p_invoice_id,p_idempotency_key,p_notes,v_metadata,p_allocations,
    p_fc_username,p_fc_session_token
  );
end;
$$;

revoke all on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) from anon, authenticated;
revoke all on function public.post_canonical_customer_payment_v2(
  uuid,uuid,numeric,timestamptz,text,text,text,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) from public;
grant execute on function public.post_canonical_customer_payment_v2(
  uuid,uuid,numeric,timestamptz,text,text,text,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
