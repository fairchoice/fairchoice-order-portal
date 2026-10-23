alter table public.homepage_messages
  drop constraint if exists homepage_messages_style_check;

alter table public.homepage_messages
  add constraint homepage_messages_style_check
  check (
    message_style = any (
      array[
        'info'::text,
        'warning'::text,
        'success'::text,
        'danger'::text,
        'info_blue'::text,
        'navy'::text,
        'success_green'::text,
        'teal'::text,
        'warning_amber'::text,
        'orange'::text,
        'danger_red'::text,
        'purple'::text,
        'pink'::text,
        'plain'::text
      ]
    )
  );
