-- FairChoice TEST migration: add Brand Partner as a supported staff-login role.
-- Preserves the current login_users role constraint and extends it safely.

begin;

-- Extend the existing login_users role CHECK without guessing/replacing
-- the roles already allowed by this database.
do $$
declare
  v_existing_check text;
begin
  select pg_get_expr(c.conbin, c.conrelid)
    into v_existing_check
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'login_users'
    and c.conname = 'login_users_role_check'
    and c.contype = 'c';

  if v_existing_check is not null then
    execute 'alter table public.login_users drop constraint login_users_role_check';
    execute format(
      'alter table public.login_users add constraint login_users_role_check check ((%s) or lower(trim(coalesce(role, ''''))) = ''brand partner'')',
      v_existing_check
    );
  else
    -- Fallback for databases where the historic constraint has a different state.
    alter table public.login_users
      add constraint login_users_role_check
      check (
        lower(trim(coalesce(role, ''))) in (
          'admin',
          'administrator',
          'accounts',
          'accountant',
          'sales rep',
          'sales representative',
          'driver',
          'warehouse',
          'brand partner',
          'partner',
          'super admin',
          'customer'
        )
      ) not valid;
  end if;
end;
$$;

-- Staff Login / Onboarding writer: add Brand Partner to the supported-role list.
create or replace function public.fc_save_staff_login_v1(
  p_username text,
  p_session_token text,
  p_target_staff_id uuid,
  p_target_login_id uuid,
  p_target_username text,
  p_new_password text,
  p_role text,
  p_staff_active boolean,
  p_login_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_actor record;
  v_target public.login_users%rowtype;
  v_role text := trim(coalesce(p_role,''));
  v_old_staff_active boolean;
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(p_username, p_session_token, 'staff.manage');

  if v_role not in (
    'Admin', 'Accounts', 'Accountant', 'Sales Rep', 'Driver',
    'Warehouse', 'Brand Partner', 'Super Admin'
  ) then
    raise exception 'Unsupported staff role.' using errcode='22023';
  end if;

  if v_role = 'Super Admin' and lower(trim(v_actor.username)) <> 'nisstaj_admin' then
    raise exception 'Only Nisstaj_admin can grant Super Admin access.' using errcode='42501';
  end if;

  select active into v_old_staff_active
  from public.staff_users
  where id = p_target_staff_id;
  if not found then
    raise exception 'The selected staff record no longer exists.' using errcode='P0002';
  end if;

  if p_target_login_id is not null then
    select * into v_target
    from public.login_users
    where id = p_target_login_id
      and staff_id = p_target_staff_id
      and lower(trim(coalesce(role,''))) <> 'customer';
  else
    select * into v_target
    from public.login_users
    where staff_id = p_target_staff_id
      and lower(trim(coalesce(role,''))) <> 'customer'
    order by created_at desc nulls last
    limit 1;
  end if;

  if v_target.id is not null and lower(trim(v_target.username)) = 'nisstaj_admin' then
    raise exception 'Nisstaj_admin login is protected and cannot be changed.' using errcode='42501';
  end if;

  if nullif(lower(trim(coalesce(p_target_username,''))),'') is null then
    raise exception 'A staff username is required.' using errcode='22023';
  end if;

  if v_target.id is null and length(coalesce(p_new_password,'')) < 8 then
    raise exception 'A password of at least 8 characters is required for a new staff login.' using errcode='22023';
  end if;

  if p_new_password is not null and length(p_new_password) < 8 then
    raise exception 'The new password must be at least 8 characters.' using errcode='22023';
  end if;

  update public.staff_users
  set role = v_role,
      job_role = v_role,
      active = coalesce(p_staff_active,true)
  where id = p_target_staff_id;

  if v_target.id is null then
    insert into public.login_users(
      staff_id, username, password, password_hash, role,
      customer_account_id, active, password_changed_at
    )
    values(
      p_target_staff_id,
      lower(trim(p_target_username)),
      null,
      extensions.crypt(p_new_password,extensions.gen_salt('bf',12)),
      v_role,
      null,
      coalesce(p_login_enabled,true),
      now()
    )
    returning * into v_target;
  else
    update public.login_users
    set username = lower(trim(p_target_username)),
        role = v_role,
        active = coalesce(p_login_enabled,true),
        password = case when p_new_password is not null then null else password end,
        password_hash = case
          when p_new_password is not null
            then extensions.crypt(p_new_password,extensions.gen_salt('bf',12))
          else password_hash
        end,
        password_changed_at = case
          when p_new_password is not null then now()
          else password_changed_at
        end,
        auth_version = case
          when active is distinct from coalesce(p_login_enabled,true)
            or username is distinct from lower(trim(p_target_username))
            or p_new_password is not null
          then auth_version + 1
          else auth_version
        end,
        updated_at = now()
    where id = v_target.id
    returning * into v_target;
  end if;

  if p_login_enabled is false or p_staff_active is false then
    update public.fc_login_sessions
    set revoked_at = now(), revoked_reason = 'STAFF_OFFBOARDED'
    where login_id = v_target.id and revoked_at is null;
  end if;

  insert into public.fc_security_events(
    event_type, severity, login_id, staff_id, username_normalized,
    session_id, entity_type, entity_id, details
  )
  values (
    'STAFF_LOGIN_CHANGED', 'HIGH', v_actor.login_id, v_actor.staff_id,
    lower(trim(v_actor.username)), v_actor.session_id, 'login_users', v_target.id::text,
    jsonb_build_object(
      'affected_staff_id', p_target_staff_id,
      'affected_username', v_target.username,
      'role', v_role,
      'staff_active', coalesce(p_staff_active,true),
      'login_enabled', coalesce(p_login_enabled,true),
      'password_changed', p_new_password is not null,
      'old_staff_active', v_old_staff_active
    )
  );

  return jsonb_build_object(
    'ok', true,
    'login_id', v_target.id,
    'staff_id', p_target_staff_id
  );
end;
$function$;

commit;
