-- Additional exact-price offer codes. The original single code remains compatible.
-- Existing customer_accounts access rules and grants are retained.
alter table public.customer_accounts
  add column if not exists customer_price_overlay_code_ids uuid[] not null default '{}';

update public.customer_accounts
set customer_price_overlay_code_ids = array[customer_price_overlay_code_id]
where customer_price_overlay_code_id is not null
  and cardinality(customer_price_overlay_code_ids) = 0;

comment on column public.customer_accounts.customer_price_overlay_code_ids is
  'Additional exact-price Sub Codes. Lowest matching offer price wins; Base Code is the fallback.';
