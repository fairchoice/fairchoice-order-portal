create table if not exists public.homepage_items (
  id uuid primary key default gen_random_uuid(),
  description text not null default '',
  image_url text not null default '',
  price numeric(12, 2) not null default 0,
  category_type text not null default 'main_category'
    check (category_type in ('main_category', 'sub_category', 'promotion')),
  target_value text not null default '',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists homepage_items_active_sort_idx
  on public.homepage_items (active, sort_order, created_at);
