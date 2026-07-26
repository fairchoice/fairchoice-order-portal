-- Canonical customer financial statement.
-- Invoices are mirrored from delivered-order invoice totals into customer_invoices.
-- Payments are mirrored from legacy customer_ledger rows into customer_payments once,
-- then both admin credit history and the customer portal read these canonical tables.

create extension if not exists pgcrypto;

create table if not exists public.customer_financial_mirror_audit (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  entity_type text not null check (entity_type in ('INVOICE','PAYMENT')),
  entity_reference text not null,
  action text not null check (action in ('BACKFILLED','RECONCILED','MIRRORED')),
  before_data jsonb null,
  after_data jsonb not null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists customer_financial_mirror_audit_customer_idx
  on public.customer_financial_mirror_audit(customer_account_id, changed_at desc);

alter table public.customer_financial_mirror_audit enable row level security;
revoke insert, update, delete on table public.customer_financial_mirror_audit from anon, authenticated;

create or replace function public.financial_jsonb_numeric(p_data jsonb, variadic p_keys text[])
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array p_keys loop
    v_value := nullif(trim(p_data ->> v_key), '');
    if v_value is not null and v_value ~ '^-?[0-9]+([.][0-9]+)?$' then
      return v_value::numeric;
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.canonical_order_invoice_total(p_order_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_price_mode text;
  v_saved_total numeric;
  v_calculated_total numeric;
begin
  select lower(trim(coalesce(to_jsonb(o)->>'price_mode', ''))),
         public.financial_jsonb_numeric(to_jsonb(o), 'order_total', 'final_total', 'total_amount', 'total')
    into v_price_mode, v_saved_total
  from public.orders o
  where o.id = p_order_id;

  with active_lines as (
    select
      case
        when coalesce(public.financial_jsonb_numeric(to_jsonb(oi), 'net_total', 'netTotal'), 0) > 0
          then round(public.financial_jsonb_numeric(to_jsonb(oi), 'net_total', 'netTotal'), 2)
        when public.financial_jsonb_numeric(to_jsonb(oi), 'price', 'unit_price', 'unitPrice') is not null
             and public.financial_jsonb_numeric(to_jsonb(oi), 'vat_percent', 'vatPercent', 'vatRate', 'vat_type', 'vatType') is not null
          then round(
            public.financial_jsonb_numeric(to_jsonb(oi), 'price', 'unit_price', 'unitPrice')
            * coalesce(public.financial_jsonb_numeric(to_jsonb(oi), 'qty', 'quantity', 'pickedQty', 'picked_qty'), 0),
            2
          )
        when public.financial_jsonb_numeric(to_jsonb(oi), 'line_total', 'lineTotal') is not null
             and public.financial_jsonb_numeric(to_jsonb(oi), 'vat_percent', 'vatPercent', 'vatRate', 'vat_type', 'vatType') is not null
          then round(public.financial_jsonb_numeric(to_jsonb(oi), 'line_total', 'lineTotal'), 2)
        else 0
      end as net_total,
      case
        when v_price_mode <> 'vat' then 0
        when public.financial_jsonb_numeric(to_jsonb(oi), 'vat_percent', 'vatPercent', 'vatRate', 'vat_type', 'vatType') = 0.2 then 20
        when public.financial_jsonb_numeric(to_jsonb(oi), 'vat_percent', 'vatPercent', 'vatRate', 'vat_type', 'vatType') = 0.05 then 5
        else coalesce(public.financial_jsonb_numeric(to_jsonb(oi), 'vat_percent', 'vatPercent', 'vatRate', 'vat_type', 'vatType'), 0)
      end as vat_rate
    from public.order_items oi
    where oi.order_id = p_order_id
      and coalesce(public.financial_jsonb_numeric(to_jsonb(oi), 'qty', 'quantity', 'pickedQty', 'picked_qty'), 0) > 0
      and lower(coalesce(to_jsonb(oi)->>'include_in_picking', to_jsonb(oi)->>'includeInPicking', 'true')) <> 'false'
      and lower(coalesce(to_jsonb(oi)->>'source_status', to_jsonb(oi)->>'sourceStatus', to_jsonb(oi)->>'status', '')) not in ('removed','cancelled','deleted')
  ), vat_groups as (
    select vat_rate, round(sum(net_total), 2) as net_total
    from active_lines
    group by vat_rate
  )
  select round(coalesce(sum(net_total + round(net_total * vat_rate / 100, 2)), 0), 2)
    into v_calculated_total
  from vat_groups;

  if coalesce(v_calculated_total, 0) = 0 and coalesce(v_saved_total, 0) > 0 then
    return round(v_saved_total, 2);
  end if;
  if coalesce(v_saved_total, 0) > 0 and abs(v_saved_total - v_calculated_total) <= 0.05 then
    return round(v_saved_total, 2);
  end if;
  return round(coalesce(v_calculated_total, v_saved_total, 0), 2);
end;
$$;

-- The deployed allocation table uses a UUID created_by column. Replace the earlier
-- rebuild function that attempted to insert the text username "nisstaj_admin".
create or replace function public.recalculate_central_payment_fifo(p_customer_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_invoice record;
  v_remaining numeric(14,2);
  v_invoice_remaining numeric(14,2);
  v_allocate numeric(14,2);
  v_branch record;
begin
  perform 1 from public.customer_accounts where id = p_customer_account_id for update;
  if not found then raise exception 'Customer account does not exist.'; end if;

  perform id from public.customer_payments where customer_account_id = p_customer_account_id for update;
  perform id from public.customer_invoices where customer_account_id = p_customer_account_id for update;
  delete from public.customer_payment_allocations where customer_account_id = p_customer_account_id;

  for v_payment in
    select p.*
    from public.customer_payments p
    where p.customer_account_id = p_customer_account_id
      and p.status = 'POSTED'
      and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
      and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)
    order by p.payment_date, p.created_at, p.payment_reference, p.id
  loop
    v_remaining := round(v_payment.amount, 2);
    for v_invoice in
      select i.*
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id
        and i.status <> 'CANCELLED'
        and (v_payment.customer_branch_id is null or i.customer_branch_id = v_payment.customer_branch_id)
      order by i.invoice_date, i.invoice_number, i.id
    loop
      exit when v_remaining <= 0;
      select greatest(0, round(v_invoice.invoice_total - coalesce(sum(a.allocated_amount), 0), 2))
        into v_invoice_remaining
      from public.customer_payment_allocations a
      where a.customer_account_id = p_customer_account_id
        and a.invoice_reference = v_invoice.invoice_number
        and a.status = 'active';
      v_allocate := least(v_remaining, v_invoice_remaining);
      if v_allocate > 0 then
        insert into public.customer_payment_allocations(
          payment_id, customer_account_id, customer_branch_id, invoice_reference,
          invoice_source_id, allocated_amount, allocation_type, status, created_by
        ) values (
          v_payment.id, p_customer_account_id, v_invoice.customer_branch_id,
          v_invoice.invoice_number, v_invoice.id::text, v_allocate, 'rebuild', 'active', null
        );
        v_remaining := round(v_remaining - v_allocate, 2);
      end if;
    end loop;
  end loop;

  delete from public.central_payment_balances where customer_account_id = p_customer_account_id;
  insert into public.central_payment_balances(
    scope_key, customer_account_id, customer_branch_id, opening_balance,
    invoice_total, payment_total, outstanding_balance, recalculated_at
  )
  select
    p_customer_account_id::text || ':ALL', p_customer_account_id, null,
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0),
    coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0),
    coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0)
      + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0)
      - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    now();

  for v_branch in select id from public.customer_branches where customer_account_id = p_customer_account_id
  loop
    insert into public.central_payment_balances(
      scope_key, customer_account_id, customer_branch_id, opening_balance,
      invoice_total, payment_total, outstanding_balance, recalculated_at
    )
    select
      p_customer_account_id::text || ':' || v_branch.id::text, p_customer_account_id, v_branch.id,
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0),
      coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0),
      coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0)
        + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0)
        - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      now();
  end loop;
end;
$$;

with delivered_invoices as (
  select
    o.id as order_id,
    o.customer_account_id,
    coalesce(o.customer_branch_id, o.branch_id) as customer_branch_id,
    coalesce(nullif(trim(o.order_number), ''), o.id::text) as invoice_number,
    coalesce(o.delivered_at, o.updated_at, o.created_at, now()) as invoice_date,
    public.canonical_order_invoice_total(o.id) as invoice_total,
    to_jsonb(o)->>'price_mode' as price_mode
  from public.orders o
  where o.customer_account_id is not null
    and lower(trim(coalesce(o.status, ''))) in ('delivered','confirmed','delivery confirmed','completed')
), changed as (
  insert into public.customer_financial_mirror_audit(
    customer_account_id, entity_type, entity_reference, action, before_data, after_data, changed_by
  )
  select
    d.customer_account_id,
    'INVOICE',
    d.invoice_number,
    case when i.id is null then 'BACKFILLED' else 'RECONCILED' end,
    case when i.id is null then null else to_jsonb(i) end,
    jsonb_build_object('order_id', d.order_id, 'invoice_total', d.invoice_total, 'invoice_date', d.invoice_date),
    'canonical-financial-migration'
  from delivered_invoices d
  left join public.customer_invoices i on i.invoice_number = d.invoice_number
  where i.id is null or abs(i.invoice_total - d.invoice_total) > 0.005
  returning id
)
insert into public.customer_invoices(
  customer_account_id, customer_branch_id, order_id, invoice_number,
  invoice_date, invoice_total, price_mode, status, created_by, updated_at
)
select
  customer_account_id, customer_branch_id, order_id, invoice_number,
  invoice_date, invoice_total, price_mode, 'ISSUED', 'canonical-financial-migration', now()
from delivered_invoices
on conflict (invoice_number) do update set
  customer_account_id = excluded.customer_account_id,
  customer_branch_id = excluded.customer_branch_id,
  order_id = excluded.order_id,
  invoice_date = excluded.invoice_date,
  invoice_total = excluded.invoice_total,
  price_mode = excluded.price_mode,
  status = case when customer_invoices.status = 'CANCELLED' then customer_invoices.status else 'ISSUED' end,
  updated_at = now();

with payment_candidates as (
  select
    l.id as ledger_id,
    coalesce(l.customer_account_id, matched.customer_account_id) as customer_account_id,
    coalesce(l.customer_branch_id, l.branch_id) as customer_branch_id,
    coalesce(nullif(trim(coalesce(to_jsonb(l)->>'payment_reference', l.reference_no, '')), ''), 'LEGACY-PAYMENT-' || l.id::text) as payment_reference,
    coalesce(nullif(to_jsonb(l)->>'payment_date', '')::timestamptz, l.created_at, now()) as payment_date,
    coalesce(nullif(l.credit, 0), nullif(public.financial_jsonb_numeric(to_jsonb(l), 'payment_amount'), 0), nullif(l.amount, 0), 0) as amount,
    case
      when coalesce(to_jsonb(l)->>'payment_method', to_jsonb(l)->>'payment_type', '') in ('Cash','Card','Bank Transfer','Cheque','Other')
        then coalesce(to_jsonb(l)->>'payment_method', to_jsonb(l)->>'payment_type')
      else 'Other'
    end as payment_method,
    coalesce(to_jsonb(l)->>'paid_by', to_jsonb(l)->>'who_paid', to_jsonb(l)->>'collected_by') as paid_by,
    coalesce(to_jsonb(l)->>'notes', 'Migrated from customer ledger') as notes
  from public.customer_ledger l
  left join lateral (
    select (array_agg(a.id order by a.id))[1] as customer_account_id
    from public.customer_accounts a
    where lower(trim(a.account_name)) = lower(trim(l.customer_name))
    having count(*) = 1
  ) matched on true
  where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'PAYMENT'
), inserted_payments as (
  insert into public.customer_payments(
    customer_account_id, customer_branch_id, payment_reference, payment_date, amount,
    payment_method, paid_by, notes, source, idempotency_key, status, created_by,
    transaction_type, verification_status, collector_role
  )
  select
    p.customer_account_id, p.customer_branch_id, p.payment_reference, p.payment_date, round(p.amount, 2),
    p.payment_method, p.paid_by, p.notes, 'LEGACY_CUSTOMER_LEDGER',
    'legacy-customer-ledger:' || p.ledger_id::text, 'POSTED', 'canonical-financial-migration',
    'PAYMENT', 'CONFIRMED', 'LEGACY'
  from payment_candidates p
  where p.customer_account_id is not null
    and p.amount > 0
    and not exists (
      select 1 from public.customer_payments existing
      where existing.customer_account_id = p.customer_account_id
        and existing.payment_reference = p.payment_reference
        and abs(existing.amount - p.amount) <= 0.005
        and existing.payment_date::date = p.payment_date::date
    )
  returning *
)
insert into public.customer_financial_mirror_audit(
  customer_account_id, entity_type, entity_reference, action, after_data, changed_by
)
select customer_account_id, 'PAYMENT', payment_reference, 'BACKFILLED', to_jsonb(inserted_payments), 'canonical-financial-migration'
from inserted_payments;

create or replace function public.upsert_customer_invoice_mirror(
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_order_id uuid,
  p_invoice_number text,
  p_invoice_date timestamptz,
  p_invoice_total numeric,
  p_price_mode text,
  p_changed_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.customer_invoices%rowtype;
  v_after public.customer_invoices%rowtype;
  v_actor text := coalesce(nullif(trim(p_changed_by), ''), 'invoice-engine');
begin
  if p_customer_account_id is null or nullif(trim(p_invoice_number), '') is null then
    raise exception 'Customer account and invoice number are required.';
  end if;
  if coalesce(p_invoice_total, -1) < 0 then
    raise exception 'Invoice total cannot be negative.';
  end if;

  perform id from public.customer_accounts where id = p_customer_account_id for update;
  select * into v_before from public.customer_invoices where invoice_number = trim(p_invoice_number) for update;

  insert into public.customer_invoices(
    customer_account_id, customer_branch_id, order_id, invoice_number,
    invoice_date, invoice_total, price_mode, status, created_by, updated_at
  ) values (
    p_customer_account_id, p_customer_branch_id, p_order_id, trim(p_invoice_number),
    coalesce(p_invoice_date, now()), round(p_invoice_total, 2), p_price_mode, 'ISSUED', v_actor, now()
  )
  on conflict (invoice_number) do update set
    customer_account_id = excluded.customer_account_id,
    customer_branch_id = excluded.customer_branch_id,
    order_id = excluded.order_id,
    invoice_date = excluded.invoice_date,
    invoice_total = excluded.invoice_total,
    price_mode = excluded.price_mode,
    status = 'ISSUED',
    updated_at = now()
  returning * into v_after;

  update public.customer_ledger
  set customer_account_id = p_customer_account_id,
      customer_branch_id = p_customer_branch_id,
      branch_id = coalesce(p_customer_branch_id, branch_id),
      debit = round(p_invoice_total, 2),
      amount = round(p_invoice_total, 2),
      invoice_amount = round(p_invoice_total, 2),
      invoice_total = round(p_invoice_total, 2),
      remaining_amount = greatest(0, round(p_invoice_total, 2) - coalesce(paid_amount, 0)),
      invoice_date = coalesce(p_invoice_date, invoice_date),
      price_mode = coalesce(p_price_mode, price_mode),
      order_price_mode = coalesce(p_price_mode, order_price_mode)
  where upper(coalesce(entry_type, transaction_type, '')) = 'INVOICE'
    and (reference_no = trim(p_invoice_number) or order_number = trim(p_invoice_number));

  if v_before.id is null or abs(v_before.invoice_total - v_after.invoice_total) > 0.005 then
    insert into public.customer_financial_mirror_audit(
      customer_account_id, entity_type, entity_reference, action, before_data, after_data, changed_by
    ) values (
      p_customer_account_id, 'INVOICE', trim(p_invoice_number),
      case when v_before.id is null then 'MIRRORED' else 'RECONCILED' end,
      case when v_before.id is null then null else to_jsonb(v_before) end,
      to_jsonb(v_after), v_actor
    );
  end if;

  perform public.recalculate_central_payment_fifo(p_customer_account_id);
  return to_jsonb(v_after);
end;
$$;

create or replace function public.get_customer_financial_statement(p_customer_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'opening_balances', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.effective_at, b.created_at)
      from public.customer_branch_opening_balances b
      where b.customer_account_id = p_customer_account_id
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.invoice_date, i.created_at)
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id and i.status <> 'CANCELLED'
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.payment_date, p.created_at)
      from public.customer_payments p
      where p.customer_account_id = p_customer_account_id
        and p.status = 'POSTED'
        and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.allocated_at, a.created_at)
      from public.customer_payment_allocations a
      where a.customer_account_id = p_customer_account_id and a.status = 'active'
    ), '[]'::jsonb)
  );
$$;

do $$
declare
  v_customer record;
begin
  for v_customer in
    select distinct customer_account_id
    from (
      select customer_account_id from public.customer_invoices
      union
      select customer_account_id from public.customer_payments
    ) affected
    where customer_account_id is not null
  loop
    perform public.recalculate_central_payment_fifo(v_customer.customer_account_id);
  end loop;
end;
$$;

revoke all on function public.financial_jsonb_numeric(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.canonical_order_invoice_total(uuid) from public, anon, authenticated;
revoke all on function public.upsert_customer_invoice_mirror(uuid,uuid,uuid,text,timestamptz,numeric,text,text) from public;
revoke all on function public.get_customer_financial_statement(uuid) from public;
grant execute on function public.upsert_customer_invoice_mirror(uuid,uuid,uuid,text,timestamptz,numeric,text,text) to anon, authenticated;
grant execute on function public.get_customer_financial_statement(uuid) to anon, authenticated;
