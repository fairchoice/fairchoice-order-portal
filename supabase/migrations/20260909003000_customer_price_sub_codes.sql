-- Checkpoint 11.3 extension: layered customer price-code overlays.
-- Base Code remains the customer's main code. A Sub Code is an exact-price-only overlay.

alter table public.customer_price_codes
  add column if not exists code_type text not null default 'base',
  add column if not exists parent_price_code_id uuid null,
  add column if not exists exact_only boolean not null default false;

update public.customer_price_codes
set code_type = 'base'
where code_type is null or btrim(code_type) = '';

alter table public.customer_price_codes
  drop constraint if exists customer_price_codes_code_type_check;

alter table public.customer_price_codes
  add constraint customer_price_codes_code_type_check
  check (code_type in ('base', 'sub'));

alter table public.customer_price_codes
  drop constraint if exists customer_price_codes_parent_price_code_id_fkey;

alter table public.customer_price_codes
  add constraint customer_price_codes_parent_price_code_id_fkey
  foreign key (parent_price_code_id)
  references public.customer_price_codes(id)
  on delete restrict;

alter table public.customer_accounts
  add column if not exists customer_price_overlay_code_id uuid null;

alter table public.customer_accounts
  drop constraint if exists customer_accounts_customer_price_overlay_code_id_fkey;

alter table public.customer_accounts
  add constraint customer_accounts_customer_price_overlay_code_id_fkey
  foreign key (customer_price_overlay_code_id)
  references public.customer_price_codes(id)
  on delete set null;

create index if not exists idx_customer_price_codes_parent
  on public.customer_price_codes(parent_price_code_id)
  where parent_price_code_id is not null;

create index if not exists idx_customer_accounts_price_overlay
  on public.customer_accounts(customer_price_overlay_code_id)
  where customer_price_overlay_code_id is not null;
