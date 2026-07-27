-- Central Payment / Customer Credit RPC and compatibility layer.
-- Additive only: no existing production financial rows are deleted, renamed, copied, or rewritten.

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

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  payment_reference text not null,
  payment_date timestamptz not null default now(),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (payment_method in ('Cash','Card','Bank Transfer','Cheque','Other')),
  paid_by text null,
  notes text null,
  source text not null default 'CENTRAL_PAYMENT',
  idempotency_key text not null,
  status text not null default 'POSTED' check (status in ('POSTED','VOIDED')),
  void_reason text null,
  voided_by text null,
  voided_at timestamptz null,
  created_by text null,
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

create index if not exists customer_payments_customer_date_idx
  on public.customer_payments (customer_account_id, customer_branch_id, payment_date desc);

create index if not exists customer_payment_allocations_payment_id_idx
  on public.customer_payment_allocations (payment_id);

create index if not exists customer_payment_allocations_invoice_reference_idx
  on public.customer_payment_allocations (customer_account_id, customer_branch_id, invoice_reference);

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
  v_payment public.customer_payments%rowtype;
  v_allocation jsonb;
  v_inserted_allocations jsonb := '[]'::jsonb;
begin
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
    p_created_by
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
      coalesce((v_allocation->>'customerBranchId')::uuid, p_customer_branch_id),
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
    p_created_by
  );

  return jsonb_build_object(
    'duplicate', false,
    'payment', to_jsonb(v_payment),
    'allocations', v_inserted_allocations
  );
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
  v_counts jsonb;
begin
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
    )
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
  v_preview jsonb;
  v_request_id uuid;
begin
  if p_source_customer_account_id = p_destination_customer_account_id then
    raise exception 'Destination customer must be different from source customer.';
  end if;

  if nullif(trim(p_reason), '') is null then
    raise exception 'Reason is required.';
  end if;

  v_preview := public.preview_branch_separation(
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
    v_preview,
    'APPLIED',
    'SEPARATE BRANCH',
    p_changed_by,
    p_changed_by,
    now(),
    p_changed_by,
    now()
  )
  returning id into v_request_id;

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

  update public.customer_branch_opening_balances
     set customer_account_id = p_destination_customer_account_id,
         updated_at = now(),
         updated_by = p_changed_by
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

  update public.orders
     set customer_account_id = p_destination_customer_account_id
   where customer_account_id = p_source_customer_account_id
     and customer_branch_id = p_source_branch_id;

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
    v_preview,
    jsonb_build_object(
      'destination_customer_account_id', p_destination_customer_account_id,
      'request_id', v_request_id
    ),
    p_changed_by
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'preview', v_preview,
    'status', 'APPLIED'
  );
exception
  when others then
    insert into public.financial_audit_log (
      action,
      entity_type,
      customer_account_id,
      customer_branch_id,
      reason,
      after_data,
      changed_by
    )
    values (
      'BRANCH_SEPARATION_FAILED',
      'branch_separation_requests',
      p_source_customer_account_id,
      p_source_branch_id,
      p_reason,
      jsonb_build_object('error', sqlerrm),
      p_changed_by
    );
    raise;
end;
$$;

alter table public.customer_payments enable row level security;
