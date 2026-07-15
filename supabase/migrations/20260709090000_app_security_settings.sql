create table if not exists public.app_security_settings (
  id uuid primary key default gen_random_uuid(),
  "key" text not null unique,
  value text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create or replace function public.set_app_security_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_security_settings_updated_at on public.app_security_settings;

create trigger trg_app_security_settings_updated_at
before update on public.app_security_settings
for each row
execute function public.set_app_security_settings_updated_at();

insert into public.app_security_settings ("key", value, active)
values ('pricing_super_admin_password', 'CHANGE_ME_SECURE_PASSWORD', true)
on conflict ("key") do nothing;
