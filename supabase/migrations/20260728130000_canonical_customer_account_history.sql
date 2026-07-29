-- Canonical customer-account history, secured opening-balance amendment and
-- all-account reconciliation. This migration deliberately reuses
-- customer_payments + customer_payment_allocations as the only active payment
-- and allocation sources.

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values
  ('customer_credit.view', 'View Customer Credit', 'Customer Credit',
   'View customer account summaries and transaction history.'),
  ('customer_credit.payment_view', 'View Customer Credit Payments', 'Customer Credit',
   'View payment detail, allocation and lifecycle audit data.'),
  ('customer_credit.payment_edit', 'Edit Customer Credit Payment', 'Customer Credit',
   'Correct an active payment and rebuild FIFO allocations.'),
  ('customer_credit.payment_void', 'Void Customer Credit Payment', 'Customer Credit',
   'Void an active payment and rebuild FIFO allocations.'),
  ('customer_credit.opening_balance_edit', 'Edit Opening Balance', 'Customer Credit',
   'Amend a customer or branch opening balance with an audit reason.'),
  ('customer_credit.audit_view', 'View Customer Credit Audit', 'Customer Credit',
   'Run all-account reconciliation and view payment amendment history.')
on conflict (permission_key) do update
set permission_name = excluded.permission_name,
    category = excluded.category,
    description = excluded.description,
    active = true,
    updated_at = now();

create table if not exists public.customer_opening_balance_audit (
  id uuid primary key default gen_random_uuid(),
  opening_balance_id uuid null
    references public.customer_branch_opening_balances(id) on delete set null,
  customer_account_id uuid not null
    references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null
    references public.customer_branches(id) on delete restrict,
  previous_amount numeric(14,2) not null,
  new_amount numeric(14,2) not null,
  reason text not null,
  changed_by_staff_id uuid null
    references public.staff_users(id) on delete set null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

alter table public.customer_opening_balance_audit enable row level security;
revoke all on table public.customer_opening_balance_audit from anon, authenticated;

create or replace function public.set_customer_opening_balance_v1(
  p_username text,
  p_session_token text,
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.customer_branch_opening_balances%rowtype;
  v_after public.customer_branch_opening_balances%rowtype;
  v_actor_name text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.opening_balance_edit'
  );

  if p_customer_account_id is null then
    raise exception 'Customer account ID is required.';
  end if;
  if p_amount is null then
    raise exception 'Opening balance is required.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Amendment reason is required.';
  end if;
  if p_customer_branch_id is not null and not exists (
    select 1
    from public.customer_branches b
    where b.id = p_customer_branch_id
      and b.customer_account_id = p_customer_account_id
  ) then
    raise exception 'Branch does not belong to the selected customer account.'
      using errcode = '42501';
  end if;

  select * into v_before
  from public.customer_branch_opening_balances b
  where b.customer_account_id = p_customer_account_id
    and b.customer_branch_id is not distinct from p_customer_branch_id
  for update;

  v_actor_name := concat_ws(
    ' | ',
    v_actor.staff_name,
    v_actor.username,
    v_actor.staff_code
  );

  if found then
    update public.customer_branch_opening_balances
    set opening_balance = round(p_amount, 2),
        notes = trim(p_reason),
        updated_by = v_actor_name,
        updated_at = now()
    where id = v_before.id
    returning * into v_after;
  else
    insert into public.customer_branch_opening_balances (
      customer_account_id,
      customer_branch_id,
      opening_balance,
      notes,
      created_by,
      updated_by
    )
    values (
      p_customer_account_id,
      p_customer_branch_id,
      round(p_amount, 2),
      trim(p_reason),
      v_actor_name,
      v_actor_name
    )
    returning * into v_after;
  end if;

  insert into public.customer_opening_balance_audit (
    opening_balance_id,
    customer_account_id,
    customer_branch_id,
    previous_amount,
    new_amount,
    reason,
    changed_by_staff_id,
    changed_by
  )
  values (
    v_after.id,
    p_customer_account_id,
    p_customer_branch_id,
    round(coalesce(v_before.opening_balance, 0), 2),
    v_after.opening_balance,
    trim(p_reason),
    v_actor.staff_id,
    v_actor_name
  );

  perform public.recalculate_central_payment_fifo(p_customer_account_id);

  return jsonb_build_object(
    'opening_balance', to_jsonb(v_after),
    'customer_account_id', p_customer_account_id,
    'customer_branch_id', p_customer_branch_id
  );
end;
$$;

revoke all on function public.set_customer_opening_balance_v1(
  text, text, uuid, uuid, numeric, text
) from public;
grant execute on function public.set_customer_opening_balance_v1(
  text, text, uuid, uuid, numeric, text
) to anon, authenticated;

-- Recreate any missing order-backed invoice mirrors. The original order and
-- order_items remain the authority for gross/VAT totals.
insert into public.customer_invoices (
  customer_account_id,
  customer_branch_id,
  order_id,
  invoice_number,
  invoice_date,
  invoice_total,
  price_mode,
  status,
  created_by,
  updated_at
)
select
  o.customer_account_id,
  coalesce(o.customer_branch_id, o.branch_id),
  o.id,
  coalesce(nullif(trim(o.order_number), ''), o.id::text),
  coalesce(o.delivered_at, o.updated_at, o.created_at, now()),
  public.canonical_order_invoice_total(o.id),
  to_jsonb(o)->>'price_mode',
  'ISSUED',
  'canonical-customer-account-history',
  now()
from public.orders o
where o.customer_account_id is not null
  and lower(trim(coalesce(o.status, ''))) in (
    'delivered', 'confirmed', 'delivery confirmed', 'completed'
  )
on conflict (invoice_number) do update
set customer_account_id = excluded.customer_account_id,
    customer_branch_id = excluded.customer_branch_id,
    order_id = excluded.order_id,
    invoice_date = excluded.invoice_date,
    invoice_total = excluded.invoice_total,
    price_mode = excluded.price_mode,
    status = case
      when customer_invoices.status = 'CANCELLED' then 'CANCELLED'
      else 'ISSUED'
    end,
    updated_at = now();

create or replace function public.sync_customer_invoice_from_order_v1(
  p_order_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_invoice_number text;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.customer_account_id is null then return; end if;

  v_invoice_number := coalesce(
    nullif(trim(v_order.order_number), ''),
    v_order.id::text
  );

  if lower(trim(coalesce(v_order.status, ''))) in (
    'delivered', 'confirmed', 'delivery confirmed', 'completed'
  ) then
    insert into public.customer_invoices (
      customer_account_id,
      customer_branch_id,
      order_id,
      invoice_number,
      invoice_date,
      invoice_total,
      price_mode,
      status,
      created_by,
      updated_at
    )
    values (
      v_order.customer_account_id,
      coalesce(v_order.customer_branch_id, v_order.branch_id),
      v_order.id,
      v_invoice_number,
      coalesce(v_order.delivered_at, v_order.updated_at, v_order.created_at, now()),
      public.canonical_order_invoice_total(v_order.id),
      to_jsonb(v_order)->>'price_mode',
      'ISSUED',
      'order-invoice-sync',
      now()
    )
    on conflict (invoice_number) do update
    set customer_account_id = excluded.customer_account_id,
        customer_branch_id = excluded.customer_branch_id,
        order_id = excluded.order_id,
        invoice_date = excluded.invoice_date,
        invoice_total = excluded.invoice_total,
        price_mode = excluded.price_mode,
        status = 'ISSUED',
        updated_at = now();
  elsif lower(trim(coalesce(v_order.status, ''))) in ('cancelled', 'canceled') then
    update public.customer_invoices
    set status = 'CANCELLED', updated_at = now()
    where order_id = v_order.id;
  else
    return;
  end if;

  perform public.recalculate_central_payment_fifo(v_order.customer_account_id);
end;
$$;

revoke all on function public.sync_customer_invoice_from_order_v1(uuid)
from public, anon, authenticated;

create or replace function public.trigger_sync_customer_invoice_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_customer_invoice_from_order_v1(
    coalesce(new.id, old.id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists orders_customer_invoice_sync_v1 on public.orders;
create trigger orders_customer_invoice_sync_v1
after insert or update of
  status, delivered_at, updated_at, order_total, customer_account_id,
  customer_branch_id, branch_id, order_number
on public.orders
for each row execute function public.trigger_sync_customer_invoice_v1();

create or replace function public.trigger_sync_customer_invoice_item_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_customer_invoice_from_order_v1(
    coalesce(new.order_id, old.order_id)
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists order_items_customer_invoice_sync_v1 on public.order_items;
create trigger order_items_customer_invoice_sync_v1
after insert or update or delete on public.order_items
for each row execute function public.trigger_sync_customer_invoice_item_v1();

do $$
declare
  v_customer record;
begin
  for v_customer in
    select distinct customer_account_id
    from public.customer_invoices
    where customer_account_id is not null
  loop
    perform public.recalculate_central_payment_fifo(
      v_customer.customer_account_id
    );
  end loop;
end;
$$;

create or replace view public.customer_account_reconciliation_v1
with (security_invoker = true)
as
with opening_totals as (
  select customer_account_id, round(sum(opening_balance), 2) as opening_balance
  from public.customer_branch_opening_balances
  group by customer_account_id
), invoice_totals as (
  select
    customer_account_id,
    round(sum(invoice_total) filter (where status <> 'CANCELLED'), 2) as invoice_total,
    count(*) filter (where status <> 'CANCELLED') as invoice_count
  from public.customer_invoices
  group by customer_account_id
), payment_totals as (
  select
    p.customer_account_id,
    round(sum(p.amount) filter (
      where p.status = 'POSTED'
        and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
        and p.voided_at is null
        and not exists (
          select 1
          from public.central_payment_archive a
          where a.payment_id = p.id
        )
    ), 2) as active_payment_total,
    count(*) filter (
      where p.status = 'POSTED'
        and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
        and p.voided_at is null
        and not exists (
          select 1
          from public.central_payment_archive a
          where a.payment_id = p.id
        )
    ) as active_payment_count,
    round(sum(p.amount) filter (
      where p.status <> 'POSTED' or p.voided_at is not null
    ), 2) as excluded_payment_total
  from public.customer_payments p
  group by p.customer_account_id
), allocation_totals as (
  select
    customer_account_id,
    round(sum(allocated_amount) filter (
      where lower(coalesce(status, 'active')) = 'active'
    ), 2) as allocation_total
  from public.customer_payment_allocations
  group by customer_account_id
), stored_totals as (
  select customer_account_id, outstanding_balance
  from public.central_payment_balances
  where customer_branch_id is null
)
select
  a.id as customer_account_id,
  a.account_name,
  coalesce(o.opening_balance, 0)::numeric(14,2) as opening_balance,
  coalesce(i.invoice_total, 0)::numeric(14,2) as invoice_total,
  coalesce(i.invoice_count, 0) as invoice_count,
  coalesce(p.active_payment_total, 0)::numeric(14,2) as active_payment_total,
  coalesce(p.active_payment_count, 0) as active_payment_count,
  coalesce(p.excluded_payment_total, 0)::numeric(14,2) as excluded_payment_total,
  coalesce(x.allocation_total, 0)::numeric(14,2) as allocation_total,
  round(
    coalesce(o.opening_balance, 0)
      + coalesce(i.invoice_total, 0)
      - coalesce(p.active_payment_total, 0),
    2
  )::numeric(14,2) as calculated_closing_balance,
  coalesce(s.outstanding_balance, 0)::numeric(14,2) as stored_closing_balance,
  round(
    coalesce(o.opening_balance, 0)
      + coalesce(i.invoice_total, 0)
      - coalesce(p.active_payment_total, 0)
      - coalesce(s.outstanding_balance, 0),
    2
  )::numeric(14,2) as difference,
  abs(
    coalesce(o.opening_balance, 0)
      + coalesce(i.invoice_total, 0)
      - coalesce(p.active_payment_total, 0)
      - coalesce(s.outstanding_balance, 0)
  ) <= 0.01 as reconciled
from public.customer_accounts a
left join opening_totals o on o.customer_account_id = a.id
left join invoice_totals i on i.customer_account_id = a.id
left join payment_totals p on p.customer_account_id = a.id
left join allocation_totals x on x.customer_account_id = a.id
left join stored_totals s on s.customer_account_id = a.id;

revoke all on public.customer_account_reconciliation_v1
from public, anon, authenticated;

create or replace function public.get_customer_account_reconciliation_v1(
  p_username text,
  p_session_token text
)
returns setof public.customer_account_reconciliation_v1
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.audit_view'
  );
  return query
  select *
  from public.customer_account_reconciliation_v1
  order by reconciled, account_name;
end;
$$;

revoke all on function public.get_customer_account_reconciliation_v1(
  text, text
) from public;
grant execute on function public.get_customer_account_reconciliation_v1(
  text, text
) to anon, authenticated;

notify pgrst, 'reload schema';
