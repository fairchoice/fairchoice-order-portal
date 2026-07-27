-- Product-level special pricing is used by product loading, pricing and editing.
alter table public.products
  add column if not exists product_special_price numeric(14,2) null;

comment on column public.products.product_special_price is
  'Optional product-specific special price; regional special prices take precedence where configured.';
