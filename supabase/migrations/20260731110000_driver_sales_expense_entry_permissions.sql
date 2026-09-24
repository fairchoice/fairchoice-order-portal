-- Allow active Driver and Sales Rep staff to record and submit expenses.
-- Approval and voiding remain restricted to separately authorised staff.

begin;

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values
  ('expenses.view', 'View Expenses', 'Expenses', 'View Phase 1 business expenses.'),
  ('expenses.create', 'Create Expenses', 'Expenses', 'Create and edit own draft expenses.'),
  ('expenses.submit', 'Submit Expenses', 'Expenses', 'Submit expenses for approval.')
on conflict (permission_key) do nothing;

insert into public.fc_staff_permissions (
  staff_id,
  permission_key,
  allowed
)
select distinct
  login.staff_id,
  required.permission_key,
  true
from public.login_users as login
join public.staff_users as staff
  on staff.id = login.staff_id
 and staff.active is true
cross join (
  values
    ('expenses.view'::text),
    ('expenses.create'::text),
    ('expenses.submit'::text)
) as required(permission_key)
where login.active is true
  and login.staff_id is not null
  and (
    lower(trim(login.username)) = 'nisstaj_drive'
    or replace(lower(trim(coalesce(login.role, ''))), ' ', '') in (
      'driver',
      'salesrep',
      'salesrepresentative'
    )
  )
on conflict (staff_id, permission_key)
do update set allowed = excluded.allowed;

commit;

notify pgrst, 'reload schema';
