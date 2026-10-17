-- Checkpoint 3: Promotion Run / Promotion Inventory audit foundation.
-- This is an audit/reconciliation layer only. It does not mutate normal stock.

create table if not exists public.promotion_runs (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  promotion_line_key text not null,
  promotion_rule_id uuid null references public.promotion_rules(id) on delete set null,
  promotion_name text not null default '',
  promotion_rule_kind text not null,
  audience_type text not null default 'all',
  customer_account_id uuid null,
  customer_name text not null default '',
  customer_branch_id uuid null,
  branch_name text not null default '',
  country text not null default '',
  actor_login_id uuid null,
  actor_name text not null default '',
  actor_role text not null default '',
  trigger_brand text not null default '',
  trigger_series text not null default '',
  free_brand text not null default '',
  free_series text not null default '',
  buy_qty_rule numeric not null default 0,
  free_qty_rule numeric not null default 0,
  paid_units_qualified numeric not null default 0,
  free_units_entitled numeric not null default 0,
  free_units_given numeric not null default 0,
  promotion_discount_amount numeric not null default 0,
  promotion_discount_vat_amount numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_runs_order_line_unique unique (order_number, promotion_line_key),
  constraint promotion_runs_audience_check check (audience_type in ('all', 'sales_rep', 'agent', 'guest')),
  constraint promotion_runs_nonnegative_units_check check (
    buy_qty_rule >= 0 and
    free_qty_rule >= 0 and
    paid_units_qualified >= 0 and
    free_units_entitled >= 0 and
    free_units_given >= 0
  )
);

create index if not exists promotion_runs_rule_created_idx
  on public.promotion_runs (promotion_rule_id, created_at desc);
create index if not exists promotion_runs_order_idx
  on public.promotion_runs (order_number);
create index if not exists promotion_runs_customer_idx
  on public.promotion_runs (customer_account_id, created_at desc);
create index if not exists promotion_runs_actor_idx
  on public.promotion_runs (actor_login_id, created_at desc);

alter table public.promotion_runs enable row level security;
revoke all on table public.promotion_runs from public, anon, authenticated;

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

    begin
      v_rule_id := nullif(v_record->>'promotion_rule_id', '')::uuid;
    exception when invalid_text_representation then
      v_rule_id := null;
    end;

    begin
      v_customer_account_id := nullif(v_record->>'customer_account_id', '')::uuid;
    exception when invalid_text_representation then
      v_customer_account_id := null;
    end;

    begin
      v_customer_branch_id := nullif(v_record->>'customer_branch_id', '')::uuid;
    exception when invalid_text_representation then
      v_customer_branch_id := null;
    end;

    -- Never allow client metadata to attribute a run to a different order/customer.
    v_customer_account_id := coalesce(v_order.customer_account_id, v_customer_account_id);
    v_customer_branch_id := coalesce(v_order.customer_branch_id, v_customer_branch_id);

    insert into public.promotion_runs (
      order_number,
      promotion_line_key,
      promotion_rule_id,
      promotion_name,
      promotion_rule_kind,
      audience_type,
      customer_account_id,
      customer_name,
      customer_branch_id,
      branch_name,
      country,
      actor_login_id,
      actor_name,
      actor_role,
      trigger_brand,
      trigger_series,
      free_brand,
      free_series,
      buy_qty_rule,
      free_qty_rule,
      paid_units_qualified,
      free_units_entitled,
      free_units_given,
      promotion_discount_amount,
      promotion_discount_vat_amount,
      created_at,
      updated_at
    ) values (
      v_order.order_number,
      trim(v_record->>'promotion_line_key'),
      v_rule_id,
      coalesce(v_record->>'promotion_name', ''),
      coalesce(nullif(v_record->>'promotion_rule_kind', ''), 'UNKNOWN'),
      case lower(coalesce(v_record->>'audience_type', 'all'))
        when 'sales_rep' then 'sales_rep'
        when 'agent' then 'agent'
        when 'guest' then 'guest'
        else 'all'
      end,
      v_customer_account_id,
      coalesce(v_order.company_name, v_record->>'customer_name', ''),
      v_customer_branch_id,
      coalesce(v_order.delivery_branch_name, v_record->>'branch_name', ''),
      coalesce(v_order.customer_country, v_record->>'country', ''),
      v_actor.login_id,
      coalesce(v_actor.staff_name, v_actor.username, ''),
      coalesce(v_actor.staff_role, ''),
      coalesce(v_record->>'trigger_brand', ''),
      coalesce(v_record->>'trigger_series', ''),
      coalesce(v_record->>'free_brand', ''),
      coalesce(v_record->>'free_series', ''),
      greatest(0, coalesce((v_record->>'buy_qty_rule')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_qty_rule')::numeric, 0)),
      greatest(0, coalesce((v_record->>'paid_units_qualified')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_units_entitled')::numeric, 0)),
      greatest(0, coalesce((v_record->>'free_units_given')::numeric, 0)),
      greatest(0, coalesce((v_record->>'promotion_discount_amount')::numeric, 0)),
      greatest(0, coalesce((v_record->>'promotion_discount_vat_amount')::numeric, 0)),
      coalesce(nullif(v_record->>'created_at', '')::timestamptz, now()),
      now()
    )
    on conflict (order_number, promotion_line_key)
    do update set
      promotion_rule_id = excluded.promotion_rule_id,
      promotion_name = excluded.promotion_name,
      promotion_rule_kind = excluded.promotion_rule_kind,
      audience_type = excluded.audience_type,
      customer_account_id = excluded.customer_account_id,
      customer_name = excluded.customer_name,
      customer_branch_id = excluded.customer_branch_id,
      branch_name = excluded.branch_name,
      country = excluded.country,
      actor_login_id = excluded.actor_login_id,
      actor_name = excluded.actor_name,
      actor_role = excluded.actor_role,
      trigger_brand = excluded.trigger_brand,
      trigger_series = excluded.trigger_series,
      free_brand = excluded.free_brand,
      free_series = excluded.free_series,
      buy_qty_rule = excluded.buy_qty_rule,
      free_qty_rule = excluded.free_qty_rule,
      paid_units_qualified = excluded.paid_units_qualified,
      free_units_entitled = excluded.free_units_entitled,
      free_units_given = excluded.free_units_given,
      promotion_discount_amount = excluded.promotion_discount_amount,
      promotion_discount_vat_amount = excluded.promotion_discount_vat_amount,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$function$;

revoke all on function public.fc_record_promotion_runs_v1(text, text, text, jsonb) from public;
grant execute on function public.fc_record_promotion_runs_v1(text, text, text, jsonb) to anon, authenticated;

comment on table public.promotion_runs is
  'Checkpoint 3 promotion audit/reconciliation records. This table does not replace or mutate normal inventory.';
comment on function public.fc_record_promotion_runs_v1(text, text, text, jsonb) is
  'Records idempotent promotion-run audit rows after an order exists, using the existing FC session authorization path.';
