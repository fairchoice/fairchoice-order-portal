-- FC Staff Identity, FC Security, short FC IDs and username/password sessions.
-- Apply this migration after the existing central payment migrations.

begin;

create extension if not exists pgcrypto;

create sequence if not exists public.fc_staff_code_seq start 1;
create sequence if not exists public.fc_login_code_seq start 1;

alter table public.staff_users
  add column if not exists staff_code text null,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.login_users
  add column if not exists login_code text null,
  add column if not exists password_hash text null,
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update public.staff_users
set staff_code = 'FC-S-' || lpad(nextval('public.fc_staff_code_seq')::text, 6, '0')
where nullif(trim(staff_code), '') is null;

update public.login_users
set login_code = 'FC-L-' || lpad(nextval('public.fc_login_code_seq')::text, 6, '0')
where nullif(trim(login_code), '') is null;

create unique index if not exists staff_users_staff_code_uidx on public.staff_users(staff_code);
create unique index if not exists login_users_login_code_uidx on public.login_users(login_code);

create or replace function public.fc_assign_staff_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if nullif(trim(new.staff_code), '') is null then
    new.staff_code := 'FC-S-' || lpad(nextval('public.fc_staff_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists fc_assign_staff_code_trigger on public.staff_users;
create trigger fc_assign_staff_code_trigger before insert on public.staff_users
for each row execute function public.fc_assign_staff_code();

create or replace function public.fc_assign_login_code()
returns trigger language plpgsql set search_path = public as $$
begin
  if nullif(trim(new.login_code), '') is null then
    new.login_code := 'FC-L-' || lpad(nextval('public.fc_login_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists fc_assign_login_code_trigger on public.login_users;
create trigger fc_assign_login_code_trigger before insert on public.login_users
for each row execute function public.fc_assign_login_code();

update public.login_users
set
  password_hash = extensions.crypt(
    password,
    extensions.gen_salt('bf', 10)
  ),
  updated_at = now()
where nullif(password_hash, '') is null
  and nullif(password, '') is not null
  and lower(trim(username)) <> 'nisstaj_admin';

create table if not exists public.fc_permissions (
  permission_key text primary key,
  permission_name text not null,
  category text not null,
  description text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fc_staff_permissions (
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  permission_key text not null references public.fc_permissions(permission_key) on delete cascade,
  allowed boolean not null default true,
  granted_by_staff_id uuid null references public.staff_users(id) on delete set null,
  granted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (staff_id, permission_key)
);

create table if not exists public.fc_login_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  login_id uuid not null references public.login_users(id) on delete cascade,
  staff_id uuid null references public.staff_users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists fc_login_sessions_login_idx on public.fc_login_sessions(login_id);
create index if not exists fc_login_sessions_staff_idx on public.fc_login_sessions(staff_id);
create index if not exists fc_login_sessions_active_idx on public.fc_login_sessions(expires_at) where revoked_at is null;

insert into public.fc_permissions(permission_key, permission_name, category, description)
values
 ('all_access','All FC Access','System','Access all current and future FC functions.'),
 ('page.sales_rep','Sales Rep Page','Pages','Open the Sales Rep workspace.'),
 ('page.warehouse','Warehouse Page','Pages','Open warehouse operations.'),
 ('page.product_setup','Product Setup Page','Pages','Open product setup and maintenance.'),
 ('page.customer_credit','Customer Credit Page','Pages','Open customer credit and account information.'),
 ('page.supplier_accounts','Supplier Accounts Page','Pages','Open supplier accounts and payments.'),
 ('orders.take','Take Orders','Orders','Create and submit customer orders.'),
 ('orders.view_all','View All Orders','Orders','View all operational orders.'),
 ('orders.edit','Edit Orders','Orders','Edit customer orders.'),
 ('orders.cancel','Cancel Orders','Orders','Cancel customer orders.'),
 ('warehouse.pick','Pick Orders','Warehouse','Start, pause and complete picking.'),
 ('warehouse.pack','Pack Orders','Warehouse','Pack picked orders.'),
 ('warehouse.complete','Complete Warehouse Order','Warehouse','Complete warehouse processing.'),
 ('delivery.complete','Complete Deliveries','Delivery','Complete customer deliveries.'),
 ('customers.credit_check','Customer Credit Check','Customers','View credit and outstanding balances.'),
 ('customers.create_login','Create Customer Login','Customers','Create or update customer portal logins.'),
 ('customers.edit','Edit Customers','Customers','Edit customer accounts.'),
 ('products.setup','Product Setup','Products','Create and edit products.'),
 ('payments.collect_cash','Collect Customer Cash','Payments','Post customer cash collections.'),
 ('payments.collect_card','Collect Customer Card Payment','Payments','Post customer card collections.'),
 ('payments.view','View Customer Payments','Payments','View customer payment history.'),
 ('payments.void','Void Customer Payment','Payments','Void or reverse payments.'),
 ('suppliers.view','View Suppliers','Suppliers','View supplier accounts.'),
 ('suppliers.pay','Pay Suppliers','Suppliers','Create supplier payments.'),
 ('staff.manage','Manage Staff','Security','Create and edit staff identities.'),
 ('permissions.manage','Manage Permissions','Security','Grant and revoke FC permissions.')
on conflict(permission_key) do update set
 permission_name=excluded.permission_name, category=excluded.category,
 description=excluded.description, active=true, updated_at=now();

create or replace function public.fc_login_v1(
  p_username text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_token text;
  v_permissions jsonb := '{}'::jsonb;
  v_direct_permissions jsonb := '{}'::jsonb;
  v_role text;
  v_is_customer boolean;
begin
  if nullif(trim(coalesce(p_username, '')), '') is null
     or nullif(coalesce(p_password, ''), '') is null then
    raise exception 'Username and password are required.'
      using errcode = '28000';
  end if;

  select *
  into v_login
  from public.login_users l
  where lower(trim(l.username)) = lower(trim(p_username))
    and l.active is true
  order by l.created_at desc nulls last
  limit 1;

  if not found then
    raise exception 'Invalid username or password.'
      using errcode = '28000';
  end if;

  if nullif(v_login.password_hash, '') is not null then
    if extensions.crypt(
         p_password,
         v_login.password_hash
       ) <> v_login.password_hash then
      raise exception 'Invalid username or password.'
        using errcode = '28000';
    end if;
  elsif coalesce(v_login.password, '') <> p_password then
    raise exception 'Invalid username or password.'
      using errcode = '28000';
  end if;

  v_role := coalesce(nullif(trim(v_login.role), ''), 'Staff');
  v_is_customer := lower(v_role) = 'customer';

  if not v_is_customer then
    if v_login.staff_id is null then
      raise exception 'This login is not linked to an FC Staff Identity.'
        using errcode = '28000';
    end if;

    select *
    into v_staff
    from public.staff_users s
    where s.id = v_login.staff_id
      and s.active is true
    limit 1;

    if not found then
      raise exception 'The linked FC Staff Identity is inactive or missing.'
        using errcode = '28000';
    end if;

    select coalesce(
      jsonb_object_agg(permission_key, to_jsonb(allowed)),
      '{}'::jsonb
    )
    into v_direct_permissions
    from public.fc_staff_permissions
    where staff_id = v_staff.id;

    v_permissions := '{}'::jsonb;

    if lower(v_role) = 'super admin' then
      v_permissions := '{"all_access":true}'::jsonb;

    elsif lower(v_role) = 'admin' then
      v_permissions :=
        '{"payments.collect_cash":true,"payments.collect_card":true,"payments.view":true}'::jsonb;

    elsif lower(v_role) = 'driver' then
      v_permissions :=
        '{"payments.collect_cash":true,"delivery.complete":true}'::jsonb;

    elsif replace(lower(v_role), ' ', '') in (
      'salesrep',
      'salesrepresentative'
    ) then
      v_permissions :=
        '{"payments.collect_cash":true,"orders.take":true}'::jsonb;
    end if;

    v_permissions :=
      v_permissions
      || coalesce(v_staff.permissions, '{}'::jsonb)
      || coalesce(v_login.permissions, '{}'::jsonb)
      || coalesce(v_direct_permissions, '{}'::jsonb);
  end if;

  v_token := encode(
    extensions.gen_random_bytes(32),
    'hex'
  );

  insert into public.fc_login_sessions (
    login_id,
    staff_id,
    token_hash,
    expires_at
  )
  values (
    v_login.id,
    v_login.staff_id,
    encode(
      extensions.digest(v_token, 'sha256'),
      'hex'
    ),
    now() + interval '12 hours'
  );

  return jsonb_build_object(
    'session_token', v_token,
    'expires_at', now() + interval '12 hours',
    'profile', jsonb_build_object(
      'id', v_login.id,
      'login_user_id', v_login.id,
      'login_code', v_login.login_code,
      'staff_id', v_login.staff_id,
      'staff_code',
        case
          when v_is_customer then null
          else v_staff.staff_code
        end,
      'username', v_login.username,
      'staff_name',
        coalesce(
          case
            when v_is_customer then v_login.staff_name
            else v_staff.staff_name
          end,
          v_login.username
        ),
      'role', v_role,
      'access_level', v_role,
      'permissions', v_permissions,
      'effective_permissions', v_permissions,
      'customer_account_id', v_login.customer_account_id,
      'active', true
    )
  );
end;
$$;

create or replace function public.fc_require_owner_approval(
  p_owner_username text,
  p_owner_password text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.login_users%rowtype;
  v_password_valid boolean := false;
begin
  if lower(trim(coalesce(p_owner_username, ''))) <> 'nisstaj_admin' then
    raise exception 'Nisstaj owner approval is required.'
      using errcode = '42501';
  end if;

  if nullif(coalesce(p_owner_password, ''), '') is null then
    raise exception 'Owner password is required.'
      using errcode = '28000';
  end if;

  select *
  into v_owner
  from public.login_users
  where lower(trim(username)) = 'nisstaj_admin'
    and active is true
  limit 1;

  if not found then
    raise exception 'The Nisstaj owner login is inactive or missing.'
      using errcode = '42501';
  end if;

  if nullif(v_owner.password_hash, '') is not null then
    v_password_valid :=
      extensions.crypt(
        p_owner_password,
        v_owner.password_hash
      ) = v_owner.password_hash;
  else
    v_password_valid :=
      coalesce(v_owner.password, '') = p_owner_password;
  end if;

  if not v_password_valid then
    raise exception 'Invalid Nisstaj owner password.'
      using errcode = '28000';
  end if;

  return true;
end;
$$;

revoke all
on function public.fc_require_owner_approval(text, text)
from public;

grant execute
on function public.fc_require_owner_approval(text, text)
to anon, authenticated;

create or replace function public.fc_require_session_permission(
  p_username text,
  p_session_token text,
  p_permission_key text
)
returns table(
  login_id uuid, login_code text, staff_id uuid, staff_code text,
  username text, staff_name text, staff_role text,
  customer_account_id uuid, effective_permissions jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  v_login public.login_users%rowtype;
  v_staff public.staff_users%rowtype;
  v_session public.fc_login_sessions%rowtype;
  v_direct jsonb := '{}'::jsonb;
  v_effective jsonb := '{}'::jsonb;
  v_role text;
begin
  select s.* into v_session
  from public.fc_login_sessions s
  join public.login_users l on l.id=s.login_id
  where lower(trim(l.username))=lower(trim(p_username))
    and s.token_hash = encode(
  extensions.digest(coalesce(p_session_token, ''), 'sha256'),
  'hex'
)
    and s.revoked_at is null and s.expires_at>now() and l.active is true
  order by s.created_at desc limit 1;
  if not found then raise exception 'FC session is invalid or expired. Please sign in again.' using errcode='28000'; end if;

  update public.fc_login_sessions set last_used_at=now() where id=v_session.id;
  select * into v_login from public.login_users where id=v_session.login_id;
  v_role := coalesce(nullif(trim(v_login.role),''),'Staff');

  if lower(v_role)='customer' then
    if p_permission_key <> 'customer.portal.payment' then
      raise exception 'FC permission denied: %',p_permission_key using errcode='42501';
    end if;
    return query select v_login.id,v_login.login_code,null::uuid,null::text,v_login.username,
      coalesce(v_login.staff_name,v_login.username),v_role,v_login.customer_account_id,'{}'::jsonb;
    return;
  end if;

  select * into v_staff from public.staff_users where id=v_login.staff_id and active is true limit 1;
  if not found then raise exception 'The linked FC Staff Identity is inactive or missing.' using errcode='28000'; end if;
  select coalesce(jsonb_object_agg(permission_key,to_jsonb(allowed)),'{}'::jsonb)
    into v_direct from public.fc_staff_permissions where staff_id=v_staff.id;
    
 v_effective := '{}'::jsonb;

if lower(v_role) = 'super admin' then
  v_effective := '{"all_access":true}'::jsonb;

elsif lower(v_role) = 'admin' then
  v_effective :=
    '{"payments.collect_cash":true,"payments.collect_card":true,"payments.view":true}'::jsonb;

elsif lower(v_role) = 'driver' then
  v_effective :=
    '{"payments.collect_cash":true,"delivery.complete":true}'::jsonb;

elsif replace(lower(v_role), ' ', '') in (
  'salesrep',
  'salesrepresentative'
) then
  v_effective :=
    '{"payments.collect_cash":true,"orders.take":true}'::jsonb;
end if;

-- Specific staff and login settings override role defaults.
v_effective :=
  v_effective
  || coalesce(v_staff.permissions, '{}'::jsonb)
  || coalesce(v_login.permissions, '{}'::jsonb)
  || coalesce(v_direct, '{}'::jsonb);

  if not (coalesce((v_effective->>'all_access')::boolean,false) or coalesce((v_effective->>p_permission_key)::boolean,false)) then
    raise exception 'FC permission denied: %',p_permission_key using errcode='42501';
  end if;

  return query select v_login.id,v_login.login_code,v_staff.id,v_staff.staff_code,v_login.username,
    coalesce(v_staff.staff_name,v_login.username),v_role,v_login.customer_account_id,v_effective;
end;
$$;

revoke all on function public.fc_login_v1(text,text) from public;
revoke all on function public.fc_require_session_permission(text,text,text) from public;
grant execute on function public.fc_login_v1(text,text) to anon, authenticated;
grant execute on function public.fc_require_session_permission(text,text,text) to anon, authenticated;


create or replace function public.post_canonical_customer_payment_v1(
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_payment_date timestamptz,
  p_payment_method text,
  p_payment_source text,
  p_payment_reference text,
  p_paid_by text,
  p_collector_name text,
  p_collector_staff_id uuid,
  p_collector_role text,
  p_order_id uuid,
  p_invoice_id uuid,
  p_idempotency_key text,
  p_notes text default '',
  p_metadata jsonb default '{}'::jsonb,
  p_allocations jsonb default '[]'::jsonb,

  -- IMPORTANT: These two legacy parameter names are retained because
  -- PostgreSQL CREATE OR REPLACE FUNCTION cannot rename existing input
  -- parameters, and PostgREST clients may already use these JSON keys.
  --
  -- In THIS payment function only:
  --   p_owner_username = FC login username
  --   p_owner_password = FC session token
  --
  -- Do not pass the real nisstaj_admin password to this payment function.
  p_owner_username text default null,
  p_owner_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_actor_name text;
  v_actor_role text;
  v_actor_customer_account_id uuid;
  v_source text;
  v_method text;
  v_reference text;
  v_verification_status text;
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_allocations jsonb := '[]'::jsonb;
begin
  v_source := upper(trim(coalesce(p_payment_source, '')));
  if v_source not in (
    'CENTRAL_PAYMENT',
    'OFFICE_PAYMENT',
    'MANUAL_PAYMENT',
    'BANK_TRANSFER',
    'CASH_COLLECTION',
    'ORDER_PAYMENT',
    'DRIVER_DELIVERY_COLLECTION',
    'PREVIOUS_BALANCE_COLLECTION',
    'SALES_REP_COLLECTION',
    'CUSTOMER_PORTAL_PAYMENT'
  ) then
    raise exception 'Unsupported payment source.';
  end if;

  -- Legacy names, current meaning:
  -- p_owner_username = FC username
  -- p_owner_password = FC session token
  if nullif(trim(coalesce(p_owner_username, '')), '') is null
     or nullif(trim(coalesce(p_owner_password, '')), '') is null then
    raise exception 'FC login session is required. Please sign in again.'
      using errcode = '28000';
  end if;

  select *
  into v_actor
  from public.fc_require_session_permission(
    p_owner_username,
    p_owner_password,
    case
      when v_source = 'CUSTOMER_PORTAL_PAYMENT'
        then 'customer.portal.payment'
      when v_source in (
        'DRIVER_DELIVERY_COLLECTION',
        'PREVIOUS_BALANCE_COLLECTION',
        'SALES_REP_COLLECTION'
      )
        then 'payments.collect_cash'
      when lower(trim(coalesce(p_payment_method, ''))) = 'card'
        then 'payments.collect_card'
      else 'payments.collect_cash'
    end
  );

  v_actor_name := concat_ws(' | ', v_actor.staff_name, v_actor.username, v_actor.staff_code);
  v_actor_role := v_actor.staff_role;
  v_actor_customer_account_id := v_actor.customer_account_id;

  if v_source = 'CUSTOMER_PORTAL_PAYMENT'
     and lower(coalesce(v_actor.staff_role,'')) = 'customer'
     and v_actor_customer_account_id is distinct from p_customer_account_id then
    raise exception 'A customer may post payments only to their own account.'
      using errcode = '42501';
  end if;

  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'A stable idempotency key is required.';
  end if;
  if not exists (
    select 1 from public.customer_accounts
    where id = p_customer_account_id
  ) then
    raise exception 'Customer account does not exist.';
  end if;
  if p_customer_branch_id is not null and not exists (
    select 1
    from public.customer_branches
    where id = p_customer_branch_id
      and customer_account_id = p_customer_account_id
  ) then
    raise exception 'Selected branch does not belong to the customer account.';
  end if;

  v_method := case lower(trim(coalesce(p_payment_method, '')))
    when 'cash' then 'Cash'
    when 'card' then 'Card'
    when 'bank transfer' then 'Bank Transfer'
    when 'cheque' then 'Cheque'
    when 'other' then 'Other'
    else null
  end;
  if v_method is null then
    raise exception 'Unsupported payment method.';
  end if;

  select *
    into v_payment
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and idempotency_key = trim(p_idempotency_key)
  limit 1;

  if found then
    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_payment),
      'allocations', coalesce((
        select jsonb_agg(to_jsonb(a))
        from public.customer_payment_allocations a
        where a.payment_id = v_payment.id
      ), '[]'::jsonb)
    );
  end if;

  v_verification_status := case
    when v_method = 'Bank Transfer' then 'PENDING_VERIFICATION'
    else 'CONFIRMED'
  end;
  v_reference := coalesce(
    nullif(trim(p_payment_reference), ''),
    'PAY-' || to_char(coalesce(p_payment_date, now()), 'YYYYMMDD')
      || '-' || lpad(nextval('public.central_payment_reference_seq')::text, 6, '0')
  );

  insert into public.customer_payments (
    customer_account_id,
    customer_branch_id,
    branch_id,
    payment_reference,
    payment_date,
    amount,
    payment_method,
    paid_by,
    notes,
    source,
    idempotency_key,
    status,
    created_by,
    transaction_type,
    verification_status,
    verified_by,
    verified_at,
    collector_staff_id,
    collector_name,
    collector_role,
    order_id,
    invoice_id,
    metadata
  )
  values (
    p_customer_account_id,
    p_customer_branch_id,
    p_customer_branch_id,
    v_reference,
    coalesce(p_payment_date, now()),
    round(p_amount, 2),
    v_method,
    nullif(trim(p_paid_by), ''),
    nullif(trim(p_notes), ''),
    v_source,
    trim(p_idempotency_key),
    'POSTED',
    v_actor_name,
    'PAYMENT',
    v_verification_status,
    case when v_verification_status = 'CONFIRMED' then v_actor_name end,
    case when v_verification_status = 'CONFIRMED' then now() end,
    p_collector_staff_id,
    coalesce(nullif(trim(p_collector_name), ''), v_actor_name),
    coalesce(nullif(trim(p_collector_role), ''), v_actor_role),
    p_order_id,
    p_invoice_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_payment;

  if v_verification_status = 'CONFIRMED' then
    for v_allocation in
      select value
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
    loop
      if coalesce((v_allocation->>'allocatedAmount')::numeric, 0) <= 0 then
        raise exception 'Allocation amount must be greater than zero.';
      end if;
      if nullif(trim(v_allocation->>'invoiceReference'), '') is null then
        raise exception 'Allocation invoice reference is required.';
      end if;

      insert into public.customer_payment_allocations (
        payment_id,
        customer_account_id,
        customer_branch_id,
        invoice_reference,
        invoice_source_id,
        allocated_amount,
        allocation_type,
        status,
        created_by
      )
      values (
        v_payment.id,
        p_customer_account_id,
        coalesce(
          nullif(v_allocation->>'customerBranchId', '')::uuid,
          p_customer_branch_id
        ),
        v_allocation->>'invoiceReference',
        nullif(v_allocation->>'invoiceSourceId', ''),
        (v_allocation->>'allocatedAmount')::numeric,
        'automatic',
        'active',
        v_actor_name
      );
    end loop;

    if coalesce((
      select sum(a.allocated_amount)
      from public.customer_payment_allocations a
      where a.payment_id = v_payment.id
    ), 0) > v_payment.amount then
      raise exception 'Payment allocations cannot exceed the payment amount.';
    end if;
  elsif jsonb_array_length(coalesce(p_allocations, '[]'::jsonb)) > 0 then
    raise exception 'Pending bank transfers cannot be allocated before confirmation.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id;

  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    after_data,
    changed_by
  )
  values (
    case
      when v_verification_status = 'PENDING_VERIFICATION'
        then 'BANK_TRANSFER_RECORDED_PENDING'
      else 'PAYMENT_POSTED'
    end,
    'customer_payments',
    v_payment.id::text,
    p_customer_account_id,
    p_customer_branch_id,
    coalesce(nullif(trim(p_notes), ''), v_source),
    jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'allocations', v_allocations,
      'ledger_sync', true
    ),
    v_actor_name
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'allocations', v_allocations
  );
exception
  when unique_violation then
    select *
      into v_payment
    from public.customer_payments
    where customer_account_id = p_customer_account_id
      and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and idempotency_key = trim(p_idempotency_key)
    limit 1;
    if found then
      return jsonb_build_object(
        'duplicate', true,
        'payment', to_jsonb(v_payment),
        'allocations', coalesce((
          select jsonb_agg(to_jsonb(a))
          from public.customer_payment_allocations a
          where a.payment_id = v_payment.id
        ), '[]'::jsonb)
      );
    end if;
    raise;
end;
$$;


revoke all on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) from public;
grant execute on function public.post_canonical_customer_payment_v1(
  uuid,uuid,numeric,timestamptz,text,text,text,text,text,uuid,text,uuid,uuid,text,text,jsonb,jsonb,text,text
) to anon, authenticated;

notify pgrst, 'reload schema';
commit;