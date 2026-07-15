create table if not exists public.product_display_messages (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('main_category', 'sub_category', 'brand', 'series', 'product')),
  target_value text not null,
  message text not null,
  color text not null default 'red' check (color in ('red', 'navy')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_product_display_messages_target
on public.product_display_messages (target_type, target_value)
where active = true;

create or replace function public.set_product_display_messages_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_product_display_messages_updated_at on public.product_display_messages;

create trigger trg_product_display_messages_updated_at
before update on public.product_display_messages
for each row
execute function public.set_product_display_messages_updated_at();
