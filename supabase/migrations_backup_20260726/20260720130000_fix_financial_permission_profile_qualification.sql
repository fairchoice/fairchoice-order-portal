-- Resolve PL/pgSQL output-column ambiguity without changing financial permissions.
create or replace function public.fairchoice_require_financial_permission(
  p_required text
)
returns table (
  staff_id uuid,
  staff_email text,
  staff_name text,
  staff_role text,
  staff_permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with profile as (
    select * from public.fairchoice_current_staff_profile()
  )
  select *
  from profile
  where
    case p_required
      when 'super_admin' then profile.staff_role = 'Super Admin'
      when 'post_payment' then
        profile.staff_role in ('Super Admin', 'Admin')
        or coalesce((profile.staff_permissions->>'access_accounts')::boolean, false)
      when 'void_payment' then profile.staff_role in ('Super Admin', 'Admin')
      else false
    end;

  if not found then
    raise exception 'Authenticated staff user is not authorised for %.', p_required
      using errcode = '42501';
  end if;
end;
$$;
