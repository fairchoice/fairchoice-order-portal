-- Secure return approval/reversal RPCs for the Returns Portal.
-- Financial safety: approval is idempotent, requires FC session permission,
-- does not touch stock, and records customer-credit effects in both the
-- customer ledger compatibility table and the global financial ledger.

create or replace function public.fc_approve_customer_return_v1(
  p_username text,
  p_session_token text,
  p_return_id uuid,
  p_approval_note text default null,
  p_financial_disposition text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_return public.customer_returns%rowtype;
  v_global_id uuid;
  v_amount numeric := 0;
  v_disposition text := upper(trim(coalesce(p_financial_disposition, '')));
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'returns.approve'
  );

  if p_return_id is null then
    raise exception 'Return database ID is required.' using errcode = '22023';
  end if;

  if v_disposition not in ('CUSTOMER_CREDIT', 'NO_CREDIT') then
    raise exception 'Select a valid return financial effect.' using errcode = '22023';
  end if;

  select * into v_return
  from public.customer_returns
  where id = p_return_id
  for update;

  if not found then
    raise exception 'Return was not found.' using errcode = 'P0002';
  end if;

  if v_return.status <> 'Pending Warehouse Confirmation' then
    raise exception 'This return is no longer pending approval.' using errcode = 'P0001';
  end if;

  if v_return.reversed_at is not null then
    raise exception 'This return has already been reversed.' using errcode = 'P0001';
  end if;

  v_amount := greatest(coalesce(v_return.return_total, 0), 0);

  if v_disposition = 'CUSTOMER_CREDIT' and v_amount > 0 then
    insert into public.financial_transactions (
      source_type,
      source_id,
      transaction_type,
      customer_account_id,
      customer_branch_id,
      transaction_date,
      amount,
      debit_amount,
      credit_amount,
      reference,
      description,
      staff_id,
      staff_name,
      status,
      metadata,
      created_by
    ) values (
      'CUSTOMER_RETURN',
      v_return.id::text,
      'RETURN_CREDIT',
      v_return.customer_account_id,
      coalesce(v_return.customer_branch_id, v_return.branch_id),
      now(),
      v_amount,
      0,
      v_amount,
      v_return.return_number,
      'Approved customer return credit',
      v_actor.staff_id,
      v_actor.staff_name,
      'ACTIVE',
      jsonb_build_object(
        'return_id', v_return.id,
        'return_number', v_return.return_number,
        'order_number', v_return.order_number,
        'financial_disposition', v_disposition,
        'approval_note', nullif(trim(coalesce(p_approval_note, '')), '')
      ),
      v_actor.username
    )
    on conflict (source_type, source_id) do update
      set updated_at = now()
    returning id into v_global_id;

    if not exists (
      select 1
      from public.customer_ledger cl
      where cl.source = 'CUSTOMER_RETURN'
        and cl.reference_no = v_return.return_number
        and coalesce(cl.financial_status, 'ACTIVE') <> 'VOID'
    ) then
      insert into public.customer_ledger (
        customer_name,
        entry_type,
        reference_no,
        debit,
        credit,
        notes,
        confirmed_by,
        customer_account_id,
        customer_branch_id,
        branch_id,
        branch_name,
        description,
        amount,
        order_number,
        price_mode,
        source,
        transaction_type,
        financial_status,
        created_at,
        updated_at
      ) values (
        v_return.customer_name,
        'RETURN_CREDIT',
        v_return.return_number,
        0,
        v_amount,
        coalesce(nullif(trim(coalesce(p_approval_note, '')), ''), 'Approved customer return credit'),
        v_actor.staff_name,
        v_return.customer_account_id,
        coalesce(v_return.customer_branch_id, v_return.branch_id),
        coalesce(v_return.branch_id, v_return.customer_branch_id),
        v_return.branch_name,
        'Customer return credit',
        v_amount,
        v_return.order_number,
        v_return.price_mode,
        'CUSTOMER_RETURN',
        'RETURN_CREDIT',
        'ACTIVE',
        now(),
        now()
      );
    end if;
  end if;

  update public.customer_returns
  set status = 'Confirmed',
      financial_disposition = v_disposition,
      approval_note = nullif(trim(coalesce(p_approval_note, '')), ''),
      ledger_transaction_id = case when v_disposition = 'CUSTOMER_CREDIT' then v_global_id else null end,
      confirmed_by = v_actor.staff_id,
      confirmed_by_name = v_actor.staff_name,
      confirmed_by_role = v_actor.staff_role,
      confirmed_at = now(),
      updated_at = now()
  where id = v_return.id;

  return jsonb_build_object(
    'ok', true,
    'return_id', v_return.id,
    'return_number', v_return.return_number,
    'status', 'Confirmed',
    'financial_disposition', v_disposition,
    'ledger_transaction_id', v_global_id
  );
end;
$$;

create or replace function public.fc_reverse_customer_return_v1(
  p_username text,
  p_session_token text,
  p_return_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor record;
  v_return public.customer_returns%rowtype;
  v_global_id uuid;
  v_amount numeric := 0;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'returns.reverse'
  );

  if v_reason is null then
    raise exception 'Reversal reason is required.' using errcode = '22023';
  end if;

  select * into v_return
  from public.customer_returns
  where id = p_return_id
  for update;

  if not found then
    raise exception 'Return was not found.' using errcode = 'P0002';
  end if;

  if v_return.status <> 'Confirmed' then
    raise exception 'Only a confirmed return can be reversed.' using errcode = 'P0001';
  end if;

  if v_return.reversed_at is not null then
    raise exception 'This return approval has already been reversed.' using errcode = 'P0001';
  end if;

  v_amount := greatest(coalesce(v_return.return_total, 0), 0);

  if v_return.financial_disposition = 'CUSTOMER_CREDIT' and v_amount > 0 then
    insert into public.financial_transactions (
      source_type,
      source_id,
      transaction_type,
      customer_account_id,
      customer_branch_id,
      transaction_date,
      amount,
      debit_amount,
      credit_amount,
      reference,
      description,
      staff_id,
      staff_name,
      status,
      metadata,
      created_by
    ) values (
      'CUSTOMER_RETURN_REVERSAL',
      v_return.id::text,
      'RETURN_CREDIT_REVERSAL',
      v_return.customer_account_id,
      coalesce(v_return.customer_branch_id, v_return.branch_id),
      now(),
      v_amount,
      v_amount,
      0,
      v_return.return_number || '-REV',
      'Customer return credit reversal',
      v_actor.staff_id,
      v_actor.staff_name,
      'ACTIVE',
      jsonb_build_object(
        'return_id', v_return.id,
        'return_number', v_return.return_number,
        'reversal_reason', v_reason,
        'reversal_of_transaction_id', v_return.ledger_transaction_id
      ),
      v_actor.username
    )
    on conflict (source_type, source_id) do update
      set updated_at = now()
    returning id into v_global_id;

    if not exists (
      select 1
      from public.customer_ledger cl
      where cl.source = 'CUSTOMER_RETURN_REVERSAL'
        and cl.reference_no = v_return.return_number || '-REV'
        and coalesce(cl.financial_status, 'ACTIVE') <> 'VOID'
    ) then
      insert into public.customer_ledger (
        customer_name,
        entry_type,
        reference_no,
        debit,
        credit,
        notes,
        confirmed_by,
        customer_account_id,
        customer_branch_id,
        branch_id,
        branch_name,
        description,
        amount,
        order_number,
        price_mode,
        source,
        transaction_type,
        financial_status,
        created_at,
        updated_at
      ) values (
        v_return.customer_name,
        'RETURN_CREDIT_REVERSAL',
        v_return.return_number || '-REV',
        v_amount,
        0,
        v_reason,
        v_actor.staff_name,
        v_return.customer_account_id,
        coalesce(v_return.customer_branch_id, v_return.branch_id),
        coalesce(v_return.branch_id, v_return.customer_branch_id),
        v_return.branch_name,
        'Customer return credit reversal',
        v_amount,
        v_return.order_number,
        v_return.price_mode,
        'CUSTOMER_RETURN_REVERSAL',
        'RETURN_CREDIT_REVERSAL',
        'ACTIVE',
        now(),
        now()
      );
    end if;
  end if;

  update public.customer_returns
  set reversal_ledger_transaction_id = v_global_id,
      reversed_by = v_actor.staff_id,
      reversed_by_name = v_actor.staff_name,
      reversed_at = now(),
      reversal_reason = v_reason,
      updated_at = now()
  where id = v_return.id;

  return jsonb_build_object(
    'ok', true,
    'return_id', v_return.id,
    'return_number', v_return.return_number,
    'reversed', true,
    'reversal_ledger_transaction_id', v_global_id
  );
end;
$$;

create or replace function public.fc_list_customer_return_reconciliation_v1(
  p_username text,
  p_session_token text
)
returns table(
  id uuid,
  return_number text,
  customer_name text,
  branch_name text,
  return_type text,
  total_qty numeric,
  return_total numeric,
  status text,
  legacy_credit_count bigint,
  global_ledger_count bigint,
  reversal_count bigint,
  reconciliation_status text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform 1
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'returns.reconcile'
  );

  return query
  select
    r.id,
    r.return_number,
    r.customer_name,
    r.branch_name,
    r.return_type,
    r.total_qty,
    r.return_total,
    r.status,
    (select count(*) from public.customer_ledger cl
      where cl.source = 'CUSTOMER_RETURN'
        and cl.reference_no = r.return_number
        and coalesce(cl.financial_status, 'ACTIVE') <> 'VOID')::bigint as legacy_credit_count,
    (select count(*) from public.financial_transactions ft
      where ft.source_type = 'CUSTOMER_RETURN'
        and ft.source_id = r.id::text
        and ft.status = 'ACTIVE')::bigint as global_ledger_count,
    ((select count(*) from public.financial_transactions ft
      where ft.source_type = 'CUSTOMER_RETURN_REVERSAL'
        and ft.source_id = r.id::text
        and ft.status = 'ACTIVE')
      +
     (select count(*) from public.customer_ledger cl
      where cl.source = 'CUSTOMER_RETURN_REVERSAL'
        and cl.reference_no = r.return_number || '-REV'
        and coalesce(cl.financial_status, 'ACTIVE') <> 'VOID'))::bigint as reversal_count,
    case
      when r.status = 'Pending Warehouse Confirmation' then 'PENDING'
      when r.financial_disposition = 'NO_CREDIT' then 'NO_CREDIT_CONFIRMED'
      when r.reversed_at is not null then 'REVERSED'
      when r.financial_disposition = 'CUSTOMER_CREDIT'
        and exists (select 1 from public.customer_ledger cl where cl.source = 'CUSTOMER_RETURN' and cl.reference_no = r.return_number and coalesce(cl.financial_status, 'ACTIVE') <> 'VOID')
        and exists (select 1 from public.financial_transactions ft where ft.source_type = 'CUSTOMER_RETURN' and ft.source_id = r.id::text and ft.status = 'ACTIVE')
        then 'RECONCILED'
      else 'CHECK_REQUIRED'
    end as reconciliation_status
  from public.customer_returns r
  order by r.created_at desc;
end;
$$;

revoke all on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) from public;
revoke all on function public.fc_reverse_customer_return_v1(text,text,uuid,text) from public;
revoke all on function public.fc_list_customer_return_reconciliation_v1(text,text) from public;
grant execute on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) to anon, authenticated;
grant execute on function public.fc_reverse_customer_return_v1(text,text,uuid,text) to anon, authenticated;
grant execute on function public.fc_list_customer_return_reconciliation_v1(text,text) to anon, authenticated;
