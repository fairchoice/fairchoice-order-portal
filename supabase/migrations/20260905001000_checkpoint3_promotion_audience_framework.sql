-- FairChoice Checkpoint 3
-- Promotion Run audience framework: All / Sales Rep / Agent / Guest.
-- Backward compatible: existing promotion rules remain available to all audiences.

alter table public.promotion_rules
  add column if not exists audience_type text not null default 'all';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'promotion_rules_audience_type_check'
      and conrelid = 'public.promotion_rules'::regclass
  ) then
    alter table public.promotion_rules
      add constraint promotion_rules_audience_type_check
      check (audience_type in ('all', 'sales_rep', 'agent', 'guest'));
  end if;
end $$;

create index if not exists promotion_rules_active_audience_idx
  on public.promotion_rules (active, audience_type, start_date, end_date);
