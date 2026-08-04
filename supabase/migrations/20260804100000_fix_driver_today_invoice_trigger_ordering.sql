begin;

-- Validate the final persisted state of a confirmed Driver TODAY_INVOICE
-- payment. p_require_allocation=false is used only by the payment INSERT
-- trigger, before the canonical writer has inserted its allocation rows.
create or replace function public.fc_validate_driver_today_invoice_allocation_v1(
  p_payment_id uuid,
  p_require_allocation boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.customer_payments%rowtype;
  v_active_count integer := 0;
  v_exact_count integer := 0;
begin
  select * into v_payment
  from public.customer_payments
  where id = p_payment_id;

  if not found then
    return;
  end if;

  if v_payment.source <> 'DRIVER_DELIVERY_COLLECTION'
     or v_payment.status <> 'POSTED'
     or v_payment.verification_status <> 'CONFIRMED'
     or coalesce(v_payment.metadata->>'payment_applies_to', '') <> 'TODAY_INVOICE'
     or v_payment.voided_at is not null then
    return;
  end if;

  if v_payment.order_id is null then
    raise exception 'TODAY_INVOICE delivery payments require the exact order UUID.';
  end if;

  if not exists (
    select 1
    from public.orders o
    where o.id = v_payment.order_id
      and o.order_number = v_payment.payment_reference
      and o.customer_account_id = v_payment.customer_account_id
      and coalesce(
            o.customer_branch_id,
            o.branch_id,
            '00000000-0000-0000-0000-000000000000'::uuid
          ) = coalesce(
            v_payment.customer_branch_id,
            v_payment.branch_id,
            '00000000-0000-0000-0000-000000000000'::uuid
          )
  ) then
    raise exception 'TODAY_INVOICE payment reference, customer and branch must match the exact order.';
  end if;

  if not p_require_allocation then
    return;
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where a.invoice_reference = v_payment.payment_reference
        and a.invoice_source_id = v_payment.order_id::text
        and a.customer_account_id = v_payment.customer_account_id
        and coalesce(
              a.customer_branch_id,
              a.branch_id,
              '00000000-0000-0000-0000-000000000000'::uuid
            ) = coalesce(
              v_payment.customer_branch_id,
              v_payment.branch_id,
              '00000000-0000-0000-0000-000000000000'::uuid
            )
        and a.allocated_amount > 0
    )::integer
  into v_active_count, v_exact_count
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id
    and a.status = 'active'
    and a.reversed_at is null
    and a.voided_at is null;

  if v_active_count > v_exact_count then
    raise exception 'TODAY_INVOICE delivery payments cannot retain an active allocation to another invoice.';
  end if;

  if v_exact_count <> 1 or v_active_count <> 1 then
    raise exception 'TODAY_INVOICE delivery payments require exactly one positive active allocation to the exact order.';
  end if;
end;
$$;

-- The payment row is inserted before allocations. Validate only its immutable
-- order/customer/branch identity on INSERT. Later payment updates must validate
-- the complete final allocation state.
create or replace function public.fc_enforce_driver_today_invoice_allocation_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fc_validate_driver_today_invoice_allocation_v1(
    new.id,
    tg_op <> 'INSERT'
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_driver_today_invoice_allocation
  on public.customer_payments;

create constraint trigger trg_enforce_driver_today_invoice_allocation
after insert or update
on public.customer_payments
deferrable initially deferred
for each row
execute function public.fc_enforce_driver_today_invoice_allocation_v1();

-- Allocation changes are also checked at transaction end. This prevents a
-- later privileged workflow from deleting or redirecting the exact allocation
-- without updating the payment row itself.
create or replace function public.fc_enforce_driver_today_invoice_allocation_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fc_validate_driver_today_invoice_allocation_v1(
      old.payment_id,
      true
    );
    return old;
  end if;

  if tg_op = 'UPDATE' and old.payment_id is distinct from new.payment_id then
    perform public.fc_validate_driver_today_invoice_allocation_v1(
      old.payment_id,
      true
    );
  end if;

  perform public.fc_validate_driver_today_invoice_allocation_v1(
    new.payment_id,
    true
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_driver_today_invoice_allocation_change
  on public.customer_payment_allocations;

create constraint trigger trg_enforce_driver_today_invoice_allocation_change
after insert or update or delete
on public.customer_payment_allocations
deferrable initially deferred
for each row
execute function public.fc_enforce_driver_today_invoice_allocation_change_v1();

-- Preserve explicit TODAY_INVOICE allocations through the canonical FIFO
-- rebuild. Generic FIFO continues unchanged for every other payment type.
-- Final TODAY_INVOICE validation runs only after allocations and balances have
-- been rebuilt, within the same canonical payment transaction.
create or replace function public.recalculate_central_payment_fifo(
  p_customer_account_id uuid
)
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
  v_today_allocations jsonb := '[]'::jsonb;
begin
  perform 1
  from public.customer_accounts
  where id = p_customer_account_id
  for update;
  if not found then
    raise exception 'Customer account does not exist.';
  end if;

  perform id
  from public.customer_payments
  where customer_account_id = p_customer_account_id
  for update;

  perform id
  from public.customer_invoices
  where customer_account_id = p_customer_account_id
  for update;

  select coalesce(
    jsonb_agg(to_jsonb(a) order by a.allocated_at, a.id),
    '[]'::jsonb
  )
  into v_today_allocations
  from public.customer_payment_allocations a
  join public.customer_payments p on p.id = a.payment_id
  where p.customer_account_id = p_customer_account_id
    and p.source = 'DRIVER_DELIVERY_COLLECTION'
    and p.status = 'POSTED'
    and p.verification_status = 'CONFIRMED'
    and coalesce(p.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
    and p.voided_at is null
    and a.status = 'active'
    and a.reversed_at is null
    and a.voided_at is null;

  delete from public.customer_payment_allocations
  where customer_account_id = p_customer_account_id;

  insert into public.customer_payment_allocations
  select preserved.*
  from jsonb_populate_recordset(
    null::public.customer_payment_allocations,
    v_today_allocations
  ) as preserved;

  for v_payment in
    select p.*
    from public.customer_payments p
    where p.customer_account_id = p_customer_account_id
      and p.status = 'POSTED'
      and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
      and not exists (
        select 1
        from public.central_payment_archive archive
        where archive.payment_id = p.id
      )
      and not (
        p.source = 'DRIVER_DELIVERY_COLLECTION'
        and p.verification_status = 'CONFIRMED'
        and coalesce(p.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
        and p.voided_at is null
      )
    order by p.payment_date, p.created_at, p.payment_reference, p.id
  loop
    v_remaining := round(v_payment.amount, 2);

    for v_invoice in
      select i.*
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id
        and i.status <> 'CANCELLED'
        and (
          v_payment.customer_branch_id is null
          or i.customer_branch_id = v_payment.customer_branch_id
        )
      order by i.invoice_date, i.invoice_number, i.id
    loop
      exit when v_remaining <= 0;

      select greatest(
        0,
        round(
          v_invoice.invoice_total - coalesce(sum(a.allocated_amount), 0),
          2
        )
      )
      into v_invoice_remaining
      from public.customer_payment_allocations a
      where a.customer_account_id = p_customer_account_id
        and a.invoice_reference = v_invoice.invoice_number
        and a.status = 'active';

      v_allocate := least(v_remaining, v_invoice_remaining);
      if v_allocate > 0 then
        insert into public.customer_payment_allocations (
          payment_id,
          customer_account_id,
          customer_branch_id,
          invoice_reference,
          invoice_source_id,
          allocated_amount,
          allocation_type,
          status,
          created_by
        ) values (
          v_payment.id,
          p_customer_account_id,
          v_invoice.customer_branch_id,
          v_invoice.invoice_number,
          v_invoice.id::text,
          v_allocate,
          'rebuild',
          'active',
          null
        );
        v_remaining := round(v_remaining - v_allocate, 2);
      end if;
    end loop;
  end loop;

  delete from public.central_payment_balances
  where customer_account_id = p_customer_account_id;

  insert into public.central_payment_balances (
    scope_key,
    customer_account_id,
    customer_branch_id,
    opening_balance,
    invoice_total,
    payment_total,
    outstanding_balance,
    recalculated_at
  )
  select
    p_customer_account_id::text || ':ALL',
    p_customer_account_id,
    null,
    coalesce((
      select sum(opening_balance)
      from public.customer_branch_opening_balances
      where customer_account_id = p_customer_account_id
    ), 0),
    coalesce((
      select sum(invoice_total)
      from public.customer_invoices
      where customer_account_id = p_customer_account_id
        and status <> 'CANCELLED'
    ), 0),
    coalesce((
      select sum(p.amount)
      from public.customer_payments p
      where p.customer_account_id = p_customer_account_id
        and p.status = 'POSTED'
        and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
        and not exists (
          select 1 from public.central_payment_archive archive
          where archive.payment_id = p.id
        )
    ), 0),
    coalesce((
      select sum(opening_balance)
      from public.customer_branch_opening_balances
      where customer_account_id = p_customer_account_id
    ), 0)
      + coalesce((
          select sum(invoice_total)
          from public.customer_invoices
          where customer_account_id = p_customer_account_id
            and status <> 'CANCELLED'
        ), 0)
      - coalesce((
          select sum(p.amount)
          from public.customer_payments p
          where p.customer_account_id = p_customer_account_id
            and p.status = 'POSTED'
            and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
            and not exists (
              select 1 from public.central_payment_archive archive
              where archive.payment_id = p.id
            )
        ), 0),
    now();

  for v_branch in
    select id
    from public.customer_branches
    where customer_account_id = p_customer_account_id
  loop
    insert into public.central_payment_balances (
      scope_key,
      customer_account_id,
      customer_branch_id,
      opening_balance,
      invoice_total,
      payment_total,
      outstanding_balance,
      recalculated_at
    )
    select
      p_customer_account_id::text || ':' || v_branch.id::text,
      p_customer_account_id,
      v_branch.id,
      coalesce((
        select sum(opening_balance)
        from public.customer_branch_opening_balances
        where customer_account_id = p_customer_account_id
          and customer_branch_id = v_branch.id
      ), 0),
      coalesce((
        select sum(invoice_total)
        from public.customer_invoices
        where customer_account_id = p_customer_account_id
          and customer_branch_id = v_branch.id
          and status <> 'CANCELLED'
      ), 0),
      coalesce((
        select sum(p.amount)
        from public.customer_payments p
        where p.customer_account_id = p_customer_account_id
          and p.customer_branch_id = v_branch.id
          and p.status = 'POSTED'
          and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
          and not exists (
            select 1 from public.central_payment_archive archive
            where archive.payment_id = p.id
          )
      ), 0),
      coalesce((
        select sum(opening_balance)
        from public.customer_branch_opening_balances
        where customer_account_id = p_customer_account_id
          and customer_branch_id = v_branch.id
      ), 0)
        + coalesce((
            select sum(invoice_total)
            from public.customer_invoices
            where customer_account_id = p_customer_account_id
              and customer_branch_id = v_branch.id
              and status <> 'CANCELLED'
          ), 0)
        - coalesce((
            select sum(p.amount)
            from public.customer_payments p
            where p.customer_account_id = p_customer_account_id
              and p.customer_branch_id = v_branch.id
              and p.status = 'POSTED'
              and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
              and not exists (
                select 1 from public.central_payment_archive archive
                where archive.payment_id = p.id
              )
          ), 0),
      now();
  end loop;

  -- This is the canonical post-allocation checkpoint. Any failure raises inside
  -- the caller's transaction and rolls back the payment, allocations, FIFO
  -- rebuild, balance changes and audit rows together.
  for v_payment in
    select p.id
    from public.customer_payments p
    where p.customer_account_id = p_customer_account_id
      and p.source = 'DRIVER_DELIVERY_COLLECTION'
      and p.status = 'POSTED'
      and p.verification_status = 'CONFIRMED'
      and coalesce(p.metadata->>'payment_applies_to', '') = 'TODAY_INVOICE'
      and p.voided_at is null
  loop
    perform public.fc_validate_driver_today_invoice_allocation_v1(
      v_payment.id,
      true
    );
  end loop;
end;
$$;

revoke all on function public.fc_validate_driver_today_invoice_allocation_v1(uuid, boolean)
  from public;
revoke all on function public.fc_enforce_driver_today_invoice_allocation_v1()
  from public;
revoke all on function public.fc_enforce_driver_today_invoice_allocation_change_v1()
  from public;
revoke all on function public.recalculate_central_payment_fifo(uuid)
  from public;

-- Canonical SECURITY DEFINER RPCs remain the only application write path.
revoke insert, update, delete on table public.customer_payments
  from public, anon, authenticated;
revoke insert, update, delete on table public.customer_payment_allocations
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
