-- Point 8: optional per-product customer price-mode overrides.
-- NULL means fall back to the normal percentage calculation in pricing_settings.

alter table public.products
  add column if not exists royalty_price numeric(12,2),
  add column if not exists owner_offer_price numeric(12,2),
  add column if not exists admin_price numeric(12,2),
  add column if not exists long_customer_price numeric(12,2);

comment on column public.products.royalty_price is 'Optional exact Royalty Inc.VAT price. NULL uses normal pricing rule percentage.';
comment on column public.products.owner_offer_price is 'Optional exact Owner Offer Inc.VAT price. NULL uses normal pricing rule percentage.';
comment on column public.products.admin_price is 'Optional exact Admin Ex.VAT price. NULL uses normal pricing rule percentage.';
comment on column public.products.long_customer_price is 'Optional exact Long Customer Ex.VAT price. NULL uses normal pricing rule percentage.';
