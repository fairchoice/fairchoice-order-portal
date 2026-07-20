-- Restore legacy staff username authentication after the optional auth-user-link migration.
-- This migration never changes usernames, passwords, roles, or existing staff_id links.

alter table public.staff_users
  drop constraint if exists staff_users_active_requires_auth_user;

comment on column public.staff_users.auth_user_id is
  'Optional metadata only. Staff authentication uses login_users.username/password linked by login_users.staff_id.';

-- Safely provision only unlinked staff logins that have exactly one active
-- staff_users match by the same username or email. This links the existing
-- production `admin` login without selecting by display name or changing credentials.
with unique_staff_matches as (
  select
    l.id as login_user_id,
    min(s.id::text)::uuid as staff_id
  from public.login_users l
  join public.staff_users s
    on lower(trim(coalesce(s.username, ''))) = lower(trim(l.username))
    or lower(trim(coalesce(s.email, ''))) = lower(trim(l.username))
  where l.staff_id is null
    and l.active is true
    and lower(trim(coalesce(l.role, ''))) <> 'customer'
    and s.active is true
  group by l.id
  having count(distinct s.id) = 1
)
update public.login_users l
set staff_id = matches.staff_id
from unique_staff_matches matches
where l.id = matches.login_user_id
  and l.staff_id is null;
