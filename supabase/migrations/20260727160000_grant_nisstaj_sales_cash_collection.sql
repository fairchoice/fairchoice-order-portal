-- Allow the dedicated Sales Rep login to post canonical cash collections.
-- The payment RPC still validates the live FC session and every other payment
-- permission; this grants only the permission required by Sales Rep collection.

begin;

insert into public.fc_staff_permissions (
  staff_id,
  permission_key,
  allowed,
  granted_at,
  updated_at
)
select
  login.staff_id,
  'payments.collect_cash',
  true,
  now(),
  now()
from public.login_users as login
where lower(trim(login.username)) = 'nisstaj_sales'
  and login.active is true
  and login.staff_id is not null
on conflict (staff_id, permission_key)
do update set
  allowed = true,
  updated_at = now();

commit;
