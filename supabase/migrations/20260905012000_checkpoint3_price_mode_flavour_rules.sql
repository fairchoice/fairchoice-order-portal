-- Checkpoint 3: promotion price-mode and flavour targeting.
-- Audience remains in the schema for backwards compatibility/audit, but rule eligibility
-- is now controlled by price_mode (Ex.VAT or Inc.VAT) and optional flavour filters.

alter table public.promotion_rules
  add column if not exists price_mode text not null default 'ex_vat',
  add column if not exists trigger_flavour_mode text not null default 'all',
  add column if not exists trigger_flavours text[] not null default '{}',
  add column if not exists free_flavour_mode text not null default 'all',
  add column if not exists free_flavours text[] not null default '{}';

update public.promotion_rules
set price_mode = case lower(trim(coalesce(price_mode, 'ex_vat')))
  when 'inc_vat' then 'inc_vat'
  else 'ex_vat'
end,
trigger_flavour_mode = case lower(trim(coalesce(trigger_flavour_mode, 'all')))
  when 'include' then 'include'
  when 'exclude' then 'exclude'
  else 'all'
end,
free_flavour_mode = case lower(trim(coalesce(free_flavour_mode, 'all')))
  when 'include' then 'include'
  when 'exclude' then 'exclude'
  else 'all'
end;

alter table public.promotion_rules drop constraint if exists promotion_rules_price_mode_check;
alter table public.promotion_rules add constraint promotion_rules_price_mode_check
  check (price_mode in ('ex_vat', 'inc_vat'));
alter table public.promotion_rules drop constraint if exists promotion_rules_trigger_flavour_mode_check;
alter table public.promotion_rules add constraint promotion_rules_trigger_flavour_mode_check
  check (trigger_flavour_mode in ('all', 'include', 'exclude'));
alter table public.promotion_rules drop constraint if exists promotion_rules_free_flavour_mode_check;
alter table public.promotion_rules add constraint promotion_rules_free_flavour_mode_check
  check (free_flavour_mode in ('all', 'include', 'exclude'));

comment on column public.promotion_rules.price_mode is 'Promotion eligibility price mode: ex_vat or inc_vat.';
comment on column public.promotion_rules.trigger_flavour_mode is 'Buy-side flavour rule: all, include, or exclude.';
comment on column public.promotion_rules.trigger_flavours is 'Buy-side selected/excluded flavours according to trigger_flavour_mode.';
comment on column public.promotion_rules.free_flavour_mode is 'Free-side flavour rule: all, include, or exclude.';
comment on column public.promotion_rules.free_flavours is 'Free-side selected/excluded flavours according to free_flavour_mode.';

alter table public.promotion_runs
  add column if not exists price_mode text not null default 'ex_vat',
  add column if not exists trigger_flavour_mode text not null default 'all',
  add column if not exists trigger_flavours text[] not null default '{}',
  add column if not exists free_flavour_mode text not null default 'all',
  add column if not exists free_flavours text[] not null default '{}';

alter table public.promotion_runs drop constraint if exists promotion_runs_price_mode_check;
alter table public.promotion_runs add constraint promotion_runs_price_mode_check
  check (price_mode in ('ex_vat', 'inc_vat'));

create or replace function public.fc_record_promotion_runs_v1(
  p_username text,
  p_session_token text,
  p_order_number text,
  p_records jsonb
)
returns table(recorded_count integer)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_record jsonb;
  v_count integer := 0;
  v_rule_id uuid;
  v_customer_account_id uuid;
  v_customer_branch_id uuid;
begin
  select * into v_actor
  from public.fc_cart_actor_v1(p_username, p_session_token)
  limit 1;

  select * into v_order
  from public.orders
  where order_number = nullif(trim(coalesce(p_order_number, '')), '')
  order by created_at desc nulls last
  limit 1;

  if not found then
    raise exception 'Promotion Run order was not found.' using errcode = 'P0002';
  end if;

  if v_actor.customer_account_id is not null
     and v_order.customer_account_id is distinct from v_actor.customer_account_id then
    raise exception 'Promotion Run order access denied.' using errcode = '42501';
  end if;

  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'Promotion Run records must be a JSON array.' using errcode = '22023';
  end if;

  for v_record in select value from jsonb_array_elements(p_records)
  loop
    if nullif(trim(coalesce(v_record->>'promotion_line_key', '')), '') is null then
      continue;
    end if;

    begin v_rule_id := nullif(v_record->>'promotion_rule_id', '')::uuid;
    exception when invalid_text_representation then v_rule_id := null; end;
    begin v_customer_account_id := nullif(v_record->>'customer_account_id', '')::uuid;
    exception when invalid_text_representation then v_customer_account_id := null; end;
    begin v_customer_branch_id := nullif(v_record->>'customer_branch_id', '')::uuid;
    exception when invalid_text_representation then v_customer_branch_id := null; end;

    v_customer_account_id := coalesce(v_order.customer_account_id, v_customer_account_id);
    v_customer_branch_id := coalesce(v_order.customer_branch_id, v_customer_branch_id);

    insert into public.promotion_runs (
      order_number, promotion_line_key, promotion_rule_id, promotion_name, promotion_rule_kind,
      audience_type, price_mode, customer_account_id, customer_name, customer_branch_id, branch_name, country,
      actor_login_id, actor_name, actor_role, trigger_brand, trigger_series,
      trigger_flavour_mode, trigger_flavours, free_brand, free_series, free_flavour_mode, free_flavours,
      buy_qty_rule, free_qty_rule, paid_units_qualified, free_units_entitled, free_units_given,
      promotion_discount_amount, promotion_discount_vat_amount, created_at, updated_at
    ) values (
      v_order.order_number, trim(v_record->>'promotion_line_key'), v_rule_id,
      coalesce(v_record->>'promotion_name', ''), coalesce(nullif(v_record->>'promotion_rule_kind', ''), 'UNKNOWN'),
      case lower(coalesce(v_record->>'audience_type', 'all')) when 'sales_rep' then 'sales_rep' when 'agent' then 'agent' when 'guest' then 'guest' else 'all' end,
      case lower(coalesce(v_record->>'price_mode', 'ex_vat')) when 'inc_vat' then 'inc_vat' else 'ex_vat' end,
      v_customer_account_id, coalesce(v_order.company_name, v_record->>'customer_name', ''),
      v_customer_branch_id, coalesce(v_order.delivery_branch_name, v_record->>'branch_name', ''),
      coalesce(v_order.customer_country, v_record->>'country', ''), v_actor.login_id,
      coalesce(v_actor.staff_name, v_actor.username, ''), coalesce(v_actor.staff_role, ''),
      coalesce(v_record->>'trigger_brand', ''), coalesce(v_record->>'trigger_series', ''),
      case lower(coalesce(v_record->>'trigger_flavour_mode', 'all')) when 'include' then 'include' when 'exclude' then 'exclude' else 'all' end,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'trigger_flavours', '[]'::jsonb))), '{}'::text[]),
      coalesce(v_record->>'free_brand', ''), coalesce(v_record->>'free_series', ''),
      case lower(coalesce(v_record->>'free_flavour_mode', 'all')) when 'include' then 'include' when 'exclude' then 'exclude' else 'all' end,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_record->'free_flavours', '[]'::jsonb))), '{}'::text[]),
      greatest(0, coalesce((v_record->>'buy_qty_rule')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_qty_rule')::numeric, 0)),
      greatest(0, coalesce((v_record->>'paid_units_qualified')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_units_entitled')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_units_given')::numeric, 0)),
      greatest(0, coalesce((v_record->>'promotion_discount_amount')::numeric, 0)),
      greatest(0, coalesce((v_record->>'promotion_discount_vat_amount')::numeric, 0)),
      coalesce(nullif(v_record->>'created_at', '')::timestamptz, now()), now()
    )
    on conflict (order_number, promotion_line_key) do update set
      promotion_rule_id=excluded.promotion_rule_id, promotion_name=excluded.promotion_name,
      promotion_rule_kind=excluded.promotion_rule_kind, audience_type=excluded.audience_type,
      price_mode=excluded.price_mode, customer_account_id=excluded.customer_account_id,
      customer_name=excluded.customer_name, customer_branch_id=excluded.customer_branch_id,
      branch_name=excluded.branch_name, country=excluded.country, actor_login_id=excluded.actor_login_id,
      actor_name=excluded.actor_name, actor_role=excluded.actor_role,
      trigger_brand=excluded.trigger_brand, trigger_series=excluded.trigger_series,
      trigger_flavour_mode=excluded.trigger_flavour_mode, trigger_flavours=excluded.trigger_flavours,
      free_brand=excluded.free_brand, free_series=excluded.free_series,
      free_flavour_mode=excluded.free_flavour_mode, free_flavours=excluded.free_flavours,
      buy_qty_rule=excluded.buy_qty_rule, free_qty_rule=excluded.free_qty_rule,
      paid_units_qualified=excluded.paid_units_qualified, free_units_entitled=excluded.free_units_entitled,
      free_units_given=excluded.free_units_given, promotion_discount_amount=excluded.promotion_discount_amount,
      promotion_discount_vat_amount=excluded.promotion_discount_vat_amount, updated_at=now();
    v_count := v_count + 1;
  end loop;
  return query select v_count;
end;
$function$;

revoke all on function public.fc_record_promotion_runs_v1(text,text,text,jsonb) from public;
grant execute on function public.fc_record_promotion_runs_v1(text,text,text,jsonb) to anon, authenticated;
