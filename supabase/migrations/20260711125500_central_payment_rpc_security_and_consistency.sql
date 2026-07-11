-- Central Payment RPC security and branch-separation consistency hardening.
-- Additive/corrective only: no existing financial rows are rewritten by this migration.

create extension if not exists pgcrypto;

create table if not exists public.staff_users (
  id uuid primary key default gen_random_uuid(),
  staff_name text null,
  email text null,
  role text null,
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_payment_allocations
  add column if not exists payment_id uuid null,
  add column if not exists invoice_reference text null,
  add column if not exists invoice_source_id text null,
  add column if not exists allocation_type text not null default 'automatic',
  add column if not exists status text not null default 'active',
  add column if not exists allocated_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists customer_payments_idempotency_scope_idx
  on public.customer_payments (
    customer_account_id,
    coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    idempotency_key
  );

create unique index if not exists customer_payment_allocations_payment_invoice_ref_idx
  on public.customer_payment_allocations (payment_id, invoice_reference)
  where payment_id is not null and invoice_reference is not null;

create index if not exists customer_payment_allocations_payment_id_idx
  on public.customer_payment_allocations (payment_id);

create index if not exists customer_payment_allocations_customer_branch_idx
  on public.customer_payment_allocations (customer_account_id, customer_branch_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customer_payment_allocations_payment_id_fk'
      and conrelid = 'public.customer_payment_allocations'::regclass
  ) then
    alter table public.customer_payment_allocations
      add constraint customer_payment_allocations_payment_id_fk
      foreign key (payment_id)
      references public.customer_payments(id)
      on delete restrict
      not valid;
  end if;
end;
$$;

create or replace function public.fairchoice_current_staff_profile()
returns table (
  staff_id uuid,
  staff_email text,
  staff_name text,
  staff_role text,
  staff_permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims jsonb;
  v_email text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_email := coalesce(
    v_claims->>'email',
    current_setting('request.jwt.claim.email', true)
  );

  if nullif(trim(coalesce(v_email, '')), '') is null then
    raise exception 'Authenticated staff email claim is required.'
      using errcode = '28000';
  end if;

  return query
  select
    s.id,
    s.email,
    s.staff_name,
    s.role,
    coalesce(s.permissions, '{}'::jsonb)
  from public.staff_users s
  where lower(trim(s.email)) = lower(trim(v_email))
    and s.active is not false
  order by s.created_at asc nulls last
  limit 1;

  if not found then
    raise exception 'Active staff profile was not found for authenticated user.'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.fairchoice_require_financial_permission(
  p_required text
)
returns table (
  staff_id uuid,
  staff_email text,
  staff_name text,
  staff_role text,
  staff_permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with profile as (
    select * from public.fairchoice_current_staff_profile()
  )
  select *
  from profile
  where
    case p_required
      when 'super_admin' then staff_role = 'Super Admin'
      when 'post_payment' then
        staff_role in ('Super Admin', 'Admin')
        or coalesce((staff_permissions->>'access_accounts')::boolean, false)
      when 'void_payment' then staff_role in ('Super Admin', 'Admin')
      else false
    end;

  if not found then
    raise exception 'Authenticated staff user is not authorised for %.', p_required
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.post_central_payment(
  p_customer_account_id uuid,
  p_customer_branch_id uuid,
  p_payment_reference text,
  p_payment_date timestamptz,
  p_amount numeric,
  p_payment_method text,
  p_paid_by text,
  p_notes text,
  p_idempotency_key text,
  p_created_by text,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_inserted_allocations jsonb := '[]'::jsonb;
begin
  select * into v_actor
  from public.fairchoice_require_financial_permission('post_payment');

  if p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  perform 1
  from public.customer_accounts
  where id = p_customer_account_id
  for update;

  if not found then
    raise exception 'Customer account does not exist.';
  end if;

  if p_customer_branch_id is not null then
    perform 1
    from public.customer_branches
    where id = p_customer_branch_id
      and customer_account_id = p_customer_account_id
    for update;

    if not found then
      raise exception 'Selected branch does not belong to the customer account.';
    end if;
  end if;

  select *
    into v_payment
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and coalesce(customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_customer_branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'duplicate', true,
      'payment', to_jsonb(v_payment),
      'allocations', '[]'::jsonb
    );
  end if;

  insert into public.customer_payments (
    customer_account_id,
    customer_branch_id,
    payment_reference,
    payment_date,
    amount,
    payment_method,
    paid_by,
    notes,
    idempotency_key,
    created_by
  )
  values (
    p_customer_account_id,
    p_customer_branch_id,
    p_payment_reference,
    coalesce(p_payment_date, now()),
    p_amount,
    p_payment_method,
    p_paid_by,
    p_notes,
    p_idempotency_key,
    coalesce(v_actor.staff_name, v_actor.staff_email)
  )
  returning * into v_payment;

  for v_allocation in
    select value from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
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
    )
    values (
      v_payment.id,
      p_customer_account_id,
      coalesce(nullif(v_allocation->>'customerBranchId', '')::uuid, p_customer_branch_id),
      v_allocation->>'invoiceReference',
      v_allocation->>'invoiceSourceId',
      (v_allocation->>'allocatedAmount')::numeric,
      'automatic',
      'active',
      null
    );
  end loop;

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_inserted_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_payment.id;

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    after_data,
    changed_by
  )
  values (
    'PAYMENT_POSTED',
    'customer_payments',
    v_payment.id::text,
    p_customer_account_id,
    p_customer_branch_id,
    jsonb_build_object('payment', to_jsonb(v_payment), 'allocations', v_inserted_allocations),
    coalesce(v_actor.staff_name, v_actor.staff_email)
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'allocations', v_inserted_allocations
  );
end;
$$;

create or replace function public.void_central_payment(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
begin
  select * into v_actor
  from public.fairchoice_require_financial_permission('void_payment');

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Void reason is required.';
  end if;

  select *
    into v_before
  from public.customer_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment does not exist.';
  end if;

  update public.customer_payments
  set
    status = 'VOIDED',
    void_reason = p_reason,
    voided_by = coalesce(v_actor.staff_name, v_actor.staff_email),
    voided_at = now(),
    updated_at = now()
  where id = p_payment_id
  returning * into v_after;

  update public.customer_payment_allocations
  set status = 'void',
      updated_at = now()
  where payment_id = p_payment_id;

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    before_data,
    after_data,
    changed_by
  )
  values (
    'PAYMENT_VOIDED',
    'customer_payments',
    p_payment_id::text,
    v_before.customer_account_id,
    v_before.customer_branch_id,
    p_reason,
    to_jsonb(v_before),
    to_jsonb(v_after),
    coalesce(v_actor.staff_name, v_actor.staff_email)
  );

  return to_jsonb(v_after);
end;
$$;

create or replace function public.preview_branch_separation(
  p_source_customer_account_id uuid,
  p_source_branch_id uuid,
  p_destination_customer_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_counts jsonb;
begin
  select * into v_actor
  from public.fairchoice_require_financial_permission('super_admin');

  if p_source_customer_account_id = p_destination_customer_account_id then
    raise exception 'Destination customer must be different from source customer.';
  end if;

  perform 1 from public.customer_accounts where id = p_source_customer_account_id;
  if not found then
    raise exception 'Source customer account does not exist.';
  end if;

  perform 1 from public.customer_accounts where id = p_destination_customer_account_id;
  if not found then
    raise exception 'Destination customer account does not exist.';
  end if;

  perform 1
  from public.customer_branches
  where id = p_source_branch_id
    and customer_account_id = p_source_customer_account_id;

  if not found then
    raise exception 'Source branch does not belong to source customer.';
  end if;

  select jsonb_build_object(
    'invoices', (
      select count(*) from public.customer_invoices
      where customer_account_id = p_source_customer_account_id
        and customer_branch_id = p_source_branch_id
    ),
    'payments', (
      select count(*) from public.customer_payments
      where customer_account_id = p_source_customer_account_id
        and customer_branch_id = p_source_branch_id
    ),
    'payment_allocations', (
      select count(*) from public.customer_payment_allocations
      where customer_account_id = p_source_customer_account_id
        and customer_branch_id = p_source_branch_id
    ),
    'opening_balances', (
      select count(*) from public.customer_branch_opening_balances
      where customer_account_id = p_source_customer_account_id
        and customer_branch_id = p_source_branch_id
    ),
    'orders', (
      select count(*) from public.orders
      where customer_account_id = p_source_customer_account_id
        and customer_branch_id = p_source_branch_id
    ),
    'customer_branches', 1
  ) into v_counts;

  return jsonb_build_object(
    'source_customer_account_id', p_source_customer_account_id,
    'source_branch_id', p_source_branch_id,
    'destination_customer_account_id', p_destination_customer_account_id,
    'counts', v_counts
  );
end;
$$;

create or replace function public.apply_branch_separation(
  p_source_customer_account_id uuid,
  p_source_branch_id uuid,
  p_destination_customer_account_id uuid,
  p_reason text,
  p_changed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_preview_before jsonb;
  v_preview_after jsonb;
  v_request_id uuid;
begin
  select * into v_actor
  from public.fairchoice_require_financial_permission('super_admin');

  if p_source_customer_account_id = p_destination_customer_account_id then
    raise exception 'Destination customer must be different from source customer.';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Reason is required.';
  end if;

  perform 1 from public.customer_accounts
  where id in (p_source_customer_account_id, p_destination_customer_account_id)
  for update;

  perform 1
  from public.customer_branches
  where id = p_source_branch_id
    and customer_account_id = p_source_customer_account_id
  for update;

  if not found then
    raise exception 'Source branch does not belong to source customer.';
  end if;

  perform id from public.customer_invoices
  where customer_account_id = p_source_customer_account_id
    and customer_branch_id = p_source_branch_id
  for update;

  perform id from public.customer_payments
  where customer_account_id = p_source_customer_account_id
    and customer_branch_id = p_source_branch_id
  for update;

  perform id from public.customer_payment_allocations
  where customer_account_id = p_source_customer_account_id
    and customer_branch_id = p_source_branch_id
  for update;

  perform id from public.customer_branch_opening_balances
  where customer_account_id = p_source_customer_account_id
    and customer_branch_id = p_source_branch_id
  for update;

  perform id from public.orders
  where customer_account_id = p_source_customer_account_id
    and customer_branch_id = p_source_branch_id
  for update;

  v_preview_before := public.preview_branch_separation(
    p_source_customer_account_id,
    p_source_branch_id,
    p_destination_customer_account_id
  );

  insert into public.branch_separation_requests (
    source_customer_account_id,
    source_branch_id,
    destination_customer_account_id,
    reason,
    preview_snapshot,
    status,
    confirmation_token,
    requested_by,
    confirmed_by,
    confirmed_at,
    applied_by,
    applied_at
  )
  values (
    p_source_customer_account_id,
    p_source_branch_id,
    p_destination_customer_account_id,
    p_reason,
    v_preview_before,
    'APPLIED',
    'SEPARATE BRANCH',
    coalesce(v_actor.staff_name, v_actor.staff_email),
    coalesce(v_actor.staff_name, v_actor.staff_email),
    now(),
    coalesce(v_actor.staff_name, v_actor.staff_email),
    now()
  )
  returning id into v_request_id;

  update public.customer_branches
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now()
   where id = p_source_branch_id
     and customer_account_id = p_source_customer_account_id;

  update public.customer_invoices
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now()
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  update public.customer_payments
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now()
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  update public.customer_payment_allocations
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now()
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  update public.customer_payment_allocations a
     set customer_account_id = p_destination_customer_account_id,
         customer_branch_id = p_source_branch_id,
         updated_at = now()
    from public.customer_payments p
   where a.payment_id = p.id
     and p.customer_account_id = p_destination_customer_account_id
     and p.customer_branch_id = p_source_branch_id
     and a.customer_account_id <> p_destination_customer_account_id;

  update public.customer_branch_opening_balances
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now(),
         updated_by = coalesce(v_actor.staff_name, v_actor.staff_email)
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  update public.orders
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now()
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  v_preview_after := jsonb_build_object(
    'destination_customer_account_id', p_destination_customer_account_id,
    'source_branch_id', p_source_branch_id,
    'destination_branch_rows', (
      select count(*) from public.customer_branches
      where id = p_source_branch_id
        and customer_account_id = p_destination_customer_account_id
    ),
    'source_remaining', jsonb_build_object(
      'invoices', (
        select count(*) from public.customer_invoices
        where customer_account_id = p_source_customer_account_id
          and customer_branch_id = p_source_branch_id
      ),
      'payments', (
        select count(*) from public.customer_payments
        where customer_account_id = p_source_customer_account_id
          and customer_branch_id = p_source_branch_id
      ),
      'payment_allocations', (
        select count(*) from public.customer_payment_allocations
        where customer_account_id = p_source_customer_account_id
          and customer_branch_id = p_source_branch_id
      ),
      'orders', (
        select count(*) from public.orders
        where customer_account_id = p_source_customer_account_id
          and customer_branch_id = p_source_branch_id
      )
    )
  );

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    customer_account_id,
    customer_branch_id,
    reason,
    before_data,
    after_data,
    changed_by
  )
  values (
    'BRANCH_SEPARATED',
    'branch_separation_requests',
    v_request_id::text,
    p_source_customer_account_id,
    p_source_branch_id,
    p_reason,
    v_preview_before,
    v_preview_after,
    coalesce(v_actor.staff_name, v_actor.staff_email)
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'before', v_preview_before,
    'after', v_preview_after,
    'status', 'APPLIED'
  );
end;
$$;

revoke all on function public.fairchoice_current_staff_profile() from public;
revoke all on function public.fairchoice_require_financial_permission(text) from public;
revoke all on function public.post_central_payment(uuid, uuid, text, timestamptz, numeric, text, text, text, text, text, jsonb) from public;
revoke all on function public.preview_branch_separation(uuid, uuid, uuid) from public;
revoke all on function public.apply_branch_separation(uuid, uuid, uuid, text, text) from public;
revoke all on function public.void_central_payment(uuid, text) from public;

grant execute on function public.post_central_payment(uuid, uuid, text, timestamptz, numeric, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.preview_branch_separation(uuid, uuid, uuid) to authenticated;
grant execute on function public.apply_branch_separation(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.void_central_payment(uuid, text) to authenticated;

comment on function public.fairchoice_current_staff_profile() is
  'Security model assumption: Supabase Auth JWT contains an email claim that matches an active public.staff_users.email row. Legacy localStorage/login_users sessions cannot authorise SECURITY DEFINER RPCs and will fail closed until mapped to Supabase Auth.';
