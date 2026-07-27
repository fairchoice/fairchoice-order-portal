-- Optional Supabase Auth identity metadata for staff records.
-- Legacy staff authentication continues to use login_users.username/password
-- and login_users.staff_id; auth_user_id is not required by that flow.

alter table public.staff_users
  add column if not exists auth_user_id uuid,
  add column if not exists branch_access jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'staff_users_auth_user_id_fkey'
      and conrelid = 'public.staff_users'::regclass
  ) then
    alter table public.staff_users
      add constraint staff_users_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users(id)
      on update restrict
      on delete restrict;
  end if;
end
$$;

create unique index if not exists staff_users_auth_user_id_unique
  on public.staff_users (auth_user_id)
  where auth_user_id is not null;

comment on column public.staff_users.auth_user_id is
  'Optional Supabase Auth identity metadata. Legacy staff username login does not require or use this value.';

comment on column public.staff_users.branch_access is
  'Per-staff branch access list. An empty array means no explicitly assigned branches.';
