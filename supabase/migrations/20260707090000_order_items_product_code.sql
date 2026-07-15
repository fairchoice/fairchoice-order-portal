-- Store the product master code on order item lines so invoices can render
-- product codes without relying on product joins.

alter table public.order_items
  add column if not exists product_code text;

create index if not exists idx_order_items_product_code
  on public.order_items (product_code);
