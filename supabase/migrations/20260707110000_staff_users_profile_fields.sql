-- Staff Setup profile/contact fields used by src/pages/AdminSetup/Staff.jsx.
-- Idempotent and non-destructive: adds nullable columns only.

alter table public.staff_users
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text,
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists mobile text,
  add column if not exists telephone text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists postcode text,
  add column if not exists onboard_date date,
  add column if not exists emergency_contact text,
  add column if not exists next_of_kin text,
  add column if not exists job_position text,
  add column if not exists job_role text,
  add column if not exists job_access text,
  add column if not exists portal_access text,
  add column if not exists notes text;
