-- Home Page Content editor schema.
-- Run in the Supabase SQL editor for the target environment.

create extension if not exists pgcrypto;

create table if not exists public.homepage_items (
  id uuid primary key default gen_random_uuid(),
  description text not null default '',
  sub_description text not null default '',
  image_url text not null default '',
  price numeric(12, 2) not null default 0,
  category_type text not null default 'main_category',
  target_value text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.homepage_items
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists description text not null default '',
  add column if not exists sub_description text not null default '',
  add column if not exists image_url text not null default '',
  add column if not exists category_type text not null default 'main_category',
  add column if not exists target_value text not null default '',
  add column if not exists sort_order integer not null default 0,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.homepage_items'::regclass
      and contype = 'p'
  ) then
    alter table public.homepage_items
      add constraint homepage_items_pkey primary key (id);
  end if;
end;
$$;

alter table public.homepage_items
  drop constraint if exists homepage_items_category_type_check;

alter table public.homepage_items
  add constraint homepage_items_category_type_check
  check (
    category_type in (
      'main_category',
      'sub_category',
      'brand',
      'custom_link',
      'promotion'
    )
  );

create index if not exists homepage_items_active_sort_idx
  on public.homepage_items (active, sort_order, created_at);

create table if not exists public.homepage_messages (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_value text not null,
  message text not null,
  message_style text not null default 'warning',
  active boolean not null default true,
  start_date date,
  end_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homepage_messages_target_type_check
    check (target_type in ('main_category', 'sub_category', 'brand', 'product')),
  constraint homepage_messages_style_check
    check (message_style in ('info', 'warning', 'success', 'danger')),
  constraint homepage_messages_date_range_check
    check (end_date is null or start_date is null or end_date >= start_date)
);

alter table public.homepage_messages
  drop constraint if exists homepage_messages_target_type_check;

alter table public.homepage_messages
  add constraint homepage_messages_target_type_check
  check (target_type in ('main_category', 'sub_category', 'brand', 'product'));

create index if not exists homepage_messages_active_target_idx
  on public.homepage_messages (
    active,
    target_type,
    target_value,
    sort_order,
    created_at
  );

create or replace function public.set_homepage_content_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists homepage_items_set_updated_at
  on public.homepage_items;
create trigger homepage_items_set_updated_at
before update on public.homepage_items
for each row execute function public.set_homepage_content_updated_at();

drop trigger if exists homepage_messages_set_updated_at
  on public.homepage_messages;
create trigger homepage_messages_set_updated_at
before update on public.homepage_messages
for each row execute function public.set_homepage_content_updated_at();

alter table public.homepage_items enable row level security;
alter table public.homepage_messages enable row level security;

-- This project authenticates staff through its Fair Choice session layer while
-- the browser uses the Supabase anon role. Match that established table policy.
drop policy if exists homepage_items_read on public.homepage_items;
create policy homepage_items_read
on public.homepage_items
for select
to anon, authenticated
using (true);

drop policy if exists homepage_items_manage on public.homepage_items;
create policy homepage_items_manage
on public.homepage_items
for all
to anon, authenticated
using (true)
with check (true);

drop policy if exists homepage_messages_read on public.homepage_messages;
create policy homepage_messages_read
on public.homepage_messages
for select
to anon, authenticated
using (true);

drop policy if exists homepage_messages_manage on public.homepage_messages;
create policy homepage_messages_manage
on public.homepage_messages
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete
  on table public.homepage_items, public.homepage_messages
  to anon, authenticated;

notify pgrst, 'reload schema';
