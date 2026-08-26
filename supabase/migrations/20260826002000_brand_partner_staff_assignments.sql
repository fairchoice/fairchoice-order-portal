-- Brand Partner staff assignment model.
-- Assign FairChoice staff to a brand without granting the partner any extra permissions.

create table if not exists public.brand_partner_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  staff_id uuid not null references public.staff_users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text null,
  unique (brand, staff_id)
);

create index if not exists brand_partner_staff_assignments_brand_active_idx
  on public.brand_partner_staff_assignments (lower(brand), active);

alter table public.brand_partner_staff_assignments enable row level security;
revoke all on public.brand_partner_staff_assignments from public, anon, authenticated;

create or replace function public.fc_brand_partner_staff_snapshot_v1(
  p_username text,
  p_session_token text,
  p_brand text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_brand text := nullif(trim(p_brand), '');
  r jsonb;
begin
  select * into a
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'permissions.manage'
  );

  if v_brand is null then
    return jsonb_build_object('brand', null, 'assigned_staff_ids', '[]'::jsonb, 'staff', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'brand', v_brand,
    'assigned_staff_ids', coalesce((
      select jsonb_agg(x.staff_id order by x.staff_name)
      from (
        select b.staff_id, coalesce(s.staff_name, s.username, b.staff_id::text) staff_name
        from public.brand_partner_staff_assignments b
        join public.staff_users s on s.id = b.staff_id
        where lower(trim(b.brand)) = lower(v_brand)
          and b.active is true
          and s.active is true
      ) x
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.staff_name)
      from (
        select
          s.id staff_id,
          coalesce(s.staff_name, s.username, 'Unnamed staff') staff_name,
          coalesce(s.username, '') username,
          coalesce(s.role, 'Staff') role,
          exists(
            select 1
            from public.brand_partner_staff_assignments b
            where b.staff_id = s.id
              and lower(trim(b.brand)) = lower(v_brand)
              and b.active is true
          ) assigned
        from public.staff_users s
        where s.active is true
          and lower(coalesce(s.role,'')) not in ('brand partner','super admin')
      ) x
    ), '[]'::jsonb)
  ) into r;

  return r;
end;
$function$;

create or replace function public.fc_save_brand_partner_staff_assignments_v1(
  p_username text,
  p_session_token text,
  p_brand text,
  p_staff_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_brand text := nullif(trim(p_brand), '');
  v_staff_id uuid;
  v_count integer := 0;
begin
  select * into a
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'permissions.manage'
  );

  if v_brand is null then
    raise exception 'Brand is required.' using errcode = '22023';
  end if;

  update public.brand_partner_staff_assignments
     set active = false,
         updated_at = now(),
         created_by = p_username
   where lower(trim(brand)) = lower(v_brand)
     and active is true;

  foreach v_staff_id in array coalesce(p_staff_ids, '{}'::uuid[])
  loop
    if exists (
      select 1
      from public.staff_users s
      where s.id = v_staff_id
        and s.active is true
        and lower(coalesce(s.role,'')) not in ('brand partner','super admin')
    ) then
      insert into public.brand_partner_staff_assignments (brand, staff_id, active, created_by)
      values (v_brand, v_staff_id, true, p_username)
      on conflict (brand, staff_id)
      do update set
        active = true,
        updated_at = now(),
        created_by = excluded.created_by;
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'brand', v_brand, 'assigned_count', v_count);
end;
$function$;

create or replace function public.fc_brand_partner_assigned_staff_v1(
  p_username text,
  p_session_token text,
  p_brand text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a record;
  v_brand text := nullif(trim(p_brand), '');
  r jsonb;
begin
  select * into a
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'page.reports.brand_performance'
  );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.staff_name), '[]'::jsonb)
    into r
  from (
    select
      s.id staff_id,
      coalesce(s.staff_name, s.username, 'Unnamed staff') staff_name,
      coalesce(s.username, '') username,
      coalesce(s.role, 'Staff') role
    from public.brand_partner_staff_assignments b
    join public.staff_users s on s.id = b.staff_id
    where v_brand is not null
      and lower(trim(b.brand)) = lower(v_brand)
      and b.active is true
      and s.active is true
  ) x;

  return r;
end;
$function$;

revoke all on function public.fc_brand_partner_staff_snapshot_v1(text,text,text) from public;
revoke all on function public.fc_save_brand_partner_staff_assignments_v1(text,text,text,uuid[]) from public;
revoke all on function public.fc_brand_partner_assigned_staff_v1(text,text,text) from public;

grant execute on function public.fc_brand_partner_staff_snapshot_v1(text,text,text) to anon, authenticated, service_role;
grant execute on function public.fc_save_brand_partner_staff_assignments_v1(text,text,text,uuid[]) to anon, authenticated, service_role;
grant execute on function public.fc_brand_partner_assigned_staff_v1(text,text,text) to anon, authenticated, service_role;
