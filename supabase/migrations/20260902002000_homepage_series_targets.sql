begin;

alter table public.homepage_items
  drop constraint if exists homepage_items_category_type_check;

alter table public.homepage_items
  add constraint homepage_items_category_type_check
  check (
    category_type = any (
      array[
        'main_category'::text,
        'sub_category'::text,
        'brand'::text,
        'series'::text,
        'custom_link'::text,
        'promotion'::text
      ]
    )
  );

alter table public.homepage_messages
  drop constraint if exists homepage_messages_target_type_check;

alter table public.homepage_messages
  add constraint homepage_messages_target_type_check
  check (
    target_type = any (
      array[
        'main_category'::text,
        'sub_category'::text,
        'brand'::text,
        'series'::text,
        'product'::text
      ]
    )
  );

commit;
