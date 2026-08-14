-- TEST-only additive repair for owner financial authorization and bank-transfer approval.
-- Keeps all legacy password RPCs intact for compatibility while moving the active
-- Global Ledger and bank verification paths onto the authenticated FairChoice session.

begin;

create or replace function public.fc_require_nisstaj_financial_owner_v1(
  p_username text,
  p_session_token text
)
returns table(
  login_id uuid,
  staff_id uuid,
  username text,
  staff_name text,
  staff_code text,
  staff_role text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
begin
  select *
  into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'payments.view'
  );

  if lower(trim(coalesce(v_actor.username, ''))) <> 'nisstaj_admin' then
    raise exception 'Owner financial access is restricted to nisstaj_admin.'
      using errcode = '42501';
  end if;

  return query
  select
    v_actor.login_id,
    v_actor.staff_id,
    v_actor.username,
    v_actor.staff_name,
    v_actor.staff_code,
    v_actor.staff_role;
end;
$$;

revoke all on function public.fc_require_nisstaj_financial_owner_v1(text,text) from public;

create or replace function public.list_global_financial_history_session_v1(
  p_username text,
  p_session_token text,
  p_search text default null,
  p_payment_method text default null,
  p_status text default null,
  p_transaction_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_customer_account_id uuid default null,
  p_customer_branch_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint := 0;
  v_records jsonb := '[]'::jsonb;
  v_search_pattern text := null;
begin
  perform public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_search, '')), '') is not null then
    v_search_pattern :=
      '%' ||
      replace(
        replace(
          replace(trim(p_search), E'\\', E'\\\\'),
          '%',
          E'\\%'
        ),
        '_',
        E'\\_'
      ) ||
      '%';
  end if;

  select count(*)
  into v_total
  from public.global_financial_history h
  where (
      v_search_pattern is null
      or coalesce(h.reference, '') ilike v_search_pattern escape E'\\'
      or coalesce(h.description, '') ilike v_search_pattern escape E'\\'
      or coalesce(h.staff_name, '') ilike v_search_pattern escape E'\\'
      or coalesce(h.source_id, '') ilike v_search_pattern escape E'\\'
    )
    and (nullif(trim(coalesce(p_payment_method, '')), '') is null or h.payment_method = trim(p_payment_method))
    and (nullif(trim(coalesce(p_status, '')), '') is null or h.status = upper(trim(p_status)))
    and (nullif(trim(coalesce(p_transaction_type, '')), '') is null or h.transaction_type = upper(trim(p_transaction_type)))
    and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
    and (p_date_to is null or h.transaction_date < (p_date_to + 1)::timestamptz)
    and (p_customer_account_id is null or h.customer_account_id = p_customer_account_id)
    and (p_customer_branch_id is null or h.customer_branch_id = p_customer_branch_id);

  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.transaction_date desc, page_rows.created_at desc, page_rows.record_id desc), '[]'::jsonb)
  into v_records
  from (
    select h.*
    from public.global_financial_history h
    where (
        v_search_pattern is null
        or coalesce(h.reference, '') ilike v_search_pattern escape E'\\'
        or coalesce(h.description, '') ilike v_search_pattern escape E'\\'
        or coalesce(h.staff_name, '') ilike v_search_pattern escape E'\\'
        or coalesce(h.source_id, '') ilike v_search_pattern escape E'\\'
      )
      and (nullif(trim(coalesce(p_payment_method, '')), '') is null or h.payment_method = trim(p_payment_method))
      and (nullif(trim(coalesce(p_status, '')), '') is null or h.status = upper(trim(p_status)))
      and (nullif(trim(coalesce(p_transaction_type, '')), '') is null or h.transaction_type = upper(trim(p_transaction_type)))
      and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
      and (p_date_to is null or h.transaction_date < (p_date_to + 1)::timestamptz)
      and (p_customer_account_id is null or h.customer_account_id = p_customer_account_id)
      and (p_customer_branch_id is null or h.customer_branch_id = p_customer_branch_id)
    order by h.transaction_date desc, h.created_at desc, h.record_id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) page_rows;

  return jsonb_build_object(
    'records', v_records,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;

revoke all on function public.list_global_financial_history_session_v1(text,text,text,text,text,text,date,date,uuid,uuid,integer,integer) from public;
grant execute on function public.list_global_financial_history_session_v1(text,text,text,text,text,text,date,date,uuid,uuid,integer,integer) to anon, authenticated;

create or replace function public.owner_archive_financial_transactions_session_v1(
  p_username text,
  p_session_token text,
  p_transaction_ids uuid[],
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);
  return public.archive_financial_transactions(p_transaction_ids, 'nisstaj_admin', p_reason);
end;
$$;

create or replace function public.owner_restore_financial_transaction_session_v1(
  p_username text,
  p_session_token text,
  p_archive_id uuid,
  p_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);
  return public.restore_financial_transaction(p_archive_id, 'nisstaj_admin', p_reason);
end;
$$;

create or replace function public.owner_delete_financial_archive_session_v1(
  p_username text,
  p_session_token text,
  p_archive_id uuid,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);
  return public.permanently_delete_financial_archive(p_archive_id, 'nisstaj_admin', p_reason);
end;
$$;

revoke all on function public.owner_archive_financial_transactions_session_v1(text,text,uuid[],text) from public;
revoke all on function public.owner_restore_financial_transaction_session_v1(text,text,uuid,text) from public;
revoke all on function public.owner_delete_financial_archive_session_v1(text,text,uuid,text) from public;
grant execute on function public.owner_archive_financial_transactions_session_v1(text,text,uuid[],text) to anon, authenticated;
grant execute on function public.owner_restore_financial_transaction_session_v1(text,text,uuid,text) to anon, authenticated;
grant execute on function public.owner_delete_financial_archive_session_v1(text,text,uuid,text) to anon, authenticated;

create or replace function public.refresh_central_payment_balances_v1(
  p_customer_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_branch record;
begin
  delete from public.central_payment_balances
  where customer_account_id = p_customer_account_id;

  insert into public.central_payment_balances (
    scope_key, customer_account_id, customer_branch_id,
    opening_balance, invoice_total, payment_total, outstanding_balance, recalculated_at
  )
  select
    p_customer_account_id::text || ':ALL',
    p_customer_account_id,
    null,
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0),
    coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0),
    coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0)
      + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0)
      - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    now();

  for v_branch in
    select id from public.customer_branches where customer_account_id = p_customer_account_id
  loop
    insert into public.central_payment_balances (
      scope_key, customer_account_id, customer_branch_id,
      opening_balance, invoice_total, payment_total, outstanding_balance, recalculated_at
    )
    select
      p_customer_account_id::text || ':' || v_branch.id::text,
      p_customer_account_id,
      v_branch.id,
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0),
      coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0),
      coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0)
        + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0)
        - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      now();
  end loop;
end;
$$;

revoke all on function public.refresh_central_payment_balances_v1(uuid) from public;

create or replace function public.confirm_owner_bank_transfer_session_v1(
  p_username text,
  p_session_token text,
  p_payment_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_actor_name text;
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
  v_invoice record;
  v_remaining numeric(14,2);
  v_invoice_remaining numeric(14,2);
  v_allocate numeric(14,2);
  v_allocations jsonb := '[]'::jsonb;
begin
  select * into v_actor
  from public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_note, '')), '') is null then
    raise exception 'Bank confirmation note is compulsory.';
  end if;

  select * into v_before
  from public.customer_payments
  where id = p_payment_id and payment_method = 'Bank Transfer'
  for update;

  if not found then
    raise exception 'Bank transfer was not found.';
  end if;

  if exists(select 1 from public.central_payment_archive where payment_id = p_payment_id) then
    raise exception 'Archived bank transfers cannot be confirmed.';
  end if;

  if upper(coalesce(v_before.verification_status, '')) = 'CONFIRMED' then
    select coalesce(jsonb_agg(to_jsonb(a) order by a.allocated_at, a.id), '[]'::jsonb)
      into v_allocations
    from public.customer_payment_allocations a
    where a.payment_id = v_before.id
      and lower(coalesce(a.status, 'active')) = 'active';

    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_before),
      'allocations', v_allocations
    );
  end if;

  if upper(coalesce(v_before.verification_status, '')) <> 'PENDING_VERIFICATION' then
    raise exception 'This bank transfer is not pending verification.';
  end if;

  v_actor_name := concat_ws(' | ', v_actor.staff_name, v_actor.username, v_actor.staff_code);

  update public.customer_payments
  set verification_status = 'CONFIRMED',
      verified_by = v_actor_name,
      verified_at = now(),
      notes = concat_ws(E'\n', notes, 'Bank confirmation: ' || trim(p_note)),
      updated_at = now()
  where id = v_before.id
  returning * into v_after;

  -- Allocate only this newly approved transfer. Existing approved-payment
  -- allocation rows are intentionally left untouched.
  v_remaining := round(v_after.amount, 2);

  for v_invoice in
    select i.*
    from public.customer_invoices i
    where i.customer_account_id = v_after.customer_account_id
      and i.status <> 'CANCELLED'
      and (
        v_after.customer_branch_id is null
        or i.customer_branch_id = v_after.customer_branch_id
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
    where a.customer_account_id = v_after.customer_account_id
      and lower(coalesce(a.status, 'active')) = 'active'
      and a.reversed_at is null
      and a.voided_at is null
      and (
        a.invoice_source_id = v_invoice.id::text
        or a.invoice_reference = v_invoice.invoice_number
      );

    v_allocate := least(v_remaining, v_invoice_remaining);
    if v_allocate > 0 then
      insert into public.customer_payment_allocations (
        payment_id, customer_account_id, customer_branch_id,
        invoice_reference, invoice_source_id, allocated_amount,
        allocation_type, status, created_by
      ) values (
        v_after.id,
        v_after.customer_account_id,
        v_invoice.customer_branch_id,
        v_invoice.invoice_number,
        v_invoice.id::text,
        v_allocate,
        'automatic',
        'active',
        v_actor.staff_id
      );
      v_remaining := round(v_remaining - v_allocate, 2);
    end if;
  end loop;

  perform public.refresh_central_payment_balances_v1(v_after.customer_account_id);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.allocated_at, a.id), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_after.id
    and lower(coalesce(a.status, 'active')) = 'active';

  insert into public.central_payment_lifecycle_audit(
    payment_id, payment_reference, customer_account_id, customer_branch_id,
    action, reason, before_data, after_data, changed_by
  ) values (
    v_after.id, v_after.payment_reference, v_after.customer_account_id, v_after.customer_branch_id,
    'CONFIRMED', trim(p_note), to_jsonb(v_before), to_jsonb(v_after), v_actor_name
  );

  insert into public.financial_audit_log(
    action, entity_type, entity_id, customer_account_id, customer_branch_id,
    reason, after_data, changed_by
  ) values (
    'BANK_TRANSFER_CONFIRMED',
    'customer_payments',
    v_after.id::text,
    v_after.customer_account_id,
    v_after.customer_branch_id,
    trim(p_note),
    jsonb_build_object('payment', to_jsonb(v_after), 'allocations', v_allocations, 'ledger_sync', true),
    v_actor_name
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_after),
    'allocations', v_allocations,
    'unallocated_amount', greatest(0, v_remaining)
  );
end;
$$;

create or replace function public.reject_owner_bank_transfer_session_v1(
  p_username text,
  p_session_token text,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_actor_name text;
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
begin
  select * into v_actor
  from public.fc_require_nisstaj_financial_owner_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Bank rejection reason is compulsory.';
  end if;

  select * into v_before
  from public.customer_payments
  where id = p_payment_id and payment_method = 'Bank Transfer'
  for update;

  if not found then
    raise exception 'Bank transfer was not found.';
  end if;

  if upper(coalesce(v_before.verification_status, '')) = 'REJECTED' then
    return jsonb_build_object('duplicate', true, 'payment', to_jsonb(v_before));
  end if;

  if upper(coalesce(v_before.verification_status, '')) <> 'PENDING_VERIFICATION' then
    raise exception 'This bank transfer is not pending verification.';
  end if;

  if exists(select 1 from public.central_payment_archive where payment_id = p_payment_id) then
    raise exception 'Archived bank transfers cannot be rejected.';
  end if;

  if exists(select 1 from public.customer_payment_allocations where payment_id = p_payment_id) then
    raise exception 'Pending bank transfer unexpectedly has allocations; rejection aborted for review.';
  end if;

  v_actor_name := concat_ws(' | ', v_actor.staff_name, v_actor.username, v_actor.staff_code);

  update public.customer_payments
  set verification_status = 'REJECTED',
      verified_by = v_actor_name,
      verified_at = now(),
      notes = concat_ws(E'\n', notes, 'Bank rejection: ' || trim(p_reason)),
      updated_at = now()
  where id = v_before.id
  returning * into v_after;

  perform public.refresh_central_payment_balances_v1(v_after.customer_account_id);

  insert into public.central_payment_lifecycle_audit(
    payment_id, payment_reference, customer_account_id, customer_branch_id,
    action, reason, before_data, after_data, changed_by
  ) values (
    v_after.id, v_after.payment_reference, v_after.customer_account_id, v_after.customer_branch_id,
    'REJECTED', trim(p_reason), to_jsonb(v_before), to_jsonb(v_after), v_actor_name
  );

  return jsonb_build_object('duplicate', false, 'payment', to_jsonb(v_after));
end;
$$;

revoke all on function public.confirm_owner_bank_transfer_session_v1(text,text,uuid,text) from public;
revoke all on function public.reject_owner_bank_transfer_session_v1(text,text,uuid,text) from public;
grant execute on function public.confirm_owner_bank_transfer_session_v1(text,text,uuid,text) to anon, authenticated;
grant execute on function public.reject_owner_bank_transfer_session_v1(text,text,uuid,text) to anon, authenticated;

comment on function public.confirm_owner_bank_transfer_session_v1(text,text,uuid,text) is
  'FC-session-authorized owner bank approval. Idempotent for already-confirmed payments and incrementally allocates only the newly confirmed transfer.';

notify pgrst, 'reload schema';
commit;
