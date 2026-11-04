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
        and i.invoice_date <= coalesce(v_payment.payment_date, v_payment.created_at, now())
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
