-- Owner-only financial correction controls.
-- TEST FIRST. This migration is additive and performs no business-data correction
-- when installed. Corrections happen only through explicit RPC calls.

begin;

create extension if not exists pgcrypto;

alter table public.orders
  add column if not exists financial_status text not null default 'ACTIVE',
  add column if not exists financial_correction_id uuid null,
  add column if not exists financial_void_reason text null,
  add column if not exists financial_voided_at timestamptz null,
  add column if not exists financial_voided_by text null;

alter table public.customer_ledger
  add column if not exists financial_status text not null default 'ACTIVE',
  add column if not exists financial_correction_id uuid null;

alter table public.customer_invoices
  add column if not exists financial_status text not null default 'ACTIVE',
  add column if not exists financial_correction_id uuid null,
  add column if not exists void_reason text null,
  add column if not exists voided_at timestamptz null,
  add column if not exists voided_by text null;

create table if not exists public.owner_financial_corrections (
  id uuid primary key default gen_random_uuid(),
  correction_type text not null check (
    correction_type in (
      'VOID_DUPLICATE_INVOICE',
      'LINK_LEGACY_PAYMENT'
    )
  ),
  customer_account_id uuid null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  order_id uuid null references public.orders(id) on delete restrict,
  invoice_reference text null,
  legacy_ledger_id bigint null,
  canonical_payment_id uuid null references public.customer_payments(id) on delete restrict,
  reason text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  applied_by text not null,
  applied_by_staff_id uuid null references public.staff_users(id) on delete set null,
  applied_at timestamptz not null default now(),
  reversed_at timestamptz null,
  reversed_by text null,
  reversal_reason text null
);

create index if not exists owner_financial_corrections_order_idx
  on public.owner_financial_corrections(order_id, applied_at desc);
create index if not exists owner_financial_corrections_customer_idx
  on public.owner_financial_corrections(customer_account_id, applied_at desc);
create index if not exists owner_financial_corrections_legacy_idx
  on public.owner_financial_corrections(legacy_ledger_id, applied_at desc);
create index if not exists orders_financial_status_idx
  on public.orders(financial_status, delivered_at);
create index if not exists customer_ledger_financial_status_idx
  on public.customer_ledger(financial_status, customer_account_id, created_at);

alter table public.owner_financial_corrections enable row level security;
revoke all on table public.owner_financial_corrections from public, anon, authenticated;

create or replace function public.fc_require_nisstaj_admin_session_v1(
  p_username text,
  p_session_token text
)
returns table(
  login_id uuid,
  staff_id uuid,
  username text,
  staff_name text,
  staff_role text
)
language plpgsql
security definer
set search_path = public
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
    raise exception 'Only nisstaj_admin may apply financial corrections.'
      using errcode = '42501';
  end if;

  return query select
    v_actor.login_id,
    v_actor.staff_id,
    v_actor.username,
    v_actor.staff_name,
    v_actor.staff_role;
end;
$$;

create or replace function public.preview_owner_invoice_correction_v1(
  p_username text,
  p_session_token text,
  p_order_number text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_invoice jsonb := '[]'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_allocations jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
begin
  select * into v_actor
  from public.fc_require_nisstaj_admin_session_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Order number is required.';
  end if;

  select * into v_order
  from public.orders
  where upper(trim(order_number)) = upper(trim(p_order_number))
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Order % was not found.', p_order_number;
  end if;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]'::jsonb)
    into v_invoice
  from public.customer_invoices i
  where i.order_id = v_order.id
     or upper(trim(i.invoice_number)) = upper(trim(v_order.order_number));

  select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at), '[]'::jsonb)
    into v_ledger
  from public.customer_ledger l
  where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'INVOICE'
    and (
      l.order_id::text = v_order.id::text
      or upper(trim(coalesce(l.order_number, ''))) = upper(trim(v_order.order_number))
      or upper(trim(coalesce(l.reference_no, ''))) = upper(trim(v_order.order_number))
    );

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.customer_account_id = v_order.customer_account_id
    and (
      upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
      or a.invoice_source_id = v_order.id::text
    );

  select coalesce(jsonb_agg(to_jsonb(p) order by p.payment_date), '[]'::jsonb)
    into v_payments
  from public.customer_payments p
  where p.customer_account_id = v_order.customer_account_id
    and exists (
      select 1
      from public.customer_payment_allocations a
      where a.payment_id = p.id
        and (
          upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
          or a.invoice_source_id = v_order.id::text
        )
    );

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'customer_invoices', v_invoice,
    'ledger_invoices', v_ledger,
    'allocations', v_allocations,
    'payments', v_payments,
    'already_voided', upper(coalesce(v_order.financial_status, 'ACTIVE')) = 'VOID',
    'warning', 'Preview only. No order quantities, warehouse state, delivery state, or inventory are changed by financial correction.'
  );
end;
$$;

create or replace function public.void_owner_duplicate_invoice_v1(
  p_username text,
  p_session_token text,
  p_order_number text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_correction_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_actor_name text;
begin
  select * into v_actor
  from public.fc_require_nisstaj_admin_session_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Correction reason is required.';
  end if;
  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Order number is required.';
  end if;

  select * into v_order
  from public.orders
  where upper(trim(order_number)) = upper(trim(p_order_number))
  order by created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'Order % was not found.', p_order_number;
  end if;

  if upper(coalesce(v_order.financial_status, 'ACTIVE')) = 'VOID' then
    raise exception 'This invoice is already financially voided.';
  end if;

  if lower(trim(coalesce(v_order.status, ''))) not in
    ('delivered', 'confirmed', 'delivery confirmed', 'completed') then
    raise exception 'Only a delivered/confirmed invoice can be financially voided.';
  end if;

  v_actor_name := concat_ws(' | ', v_actor.staff_name, v_actor.username);

  v_before := jsonb_build_object(
    'order', to_jsonb(v_order),
    'customer_invoices', (
      select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
      from public.customer_invoices i
      where i.order_id = v_order.id
         or upper(trim(i.invoice_number)) = upper(trim(v_order.order_number))
    ),
    'ledger_invoices', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.customer_ledger l
      where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'INVOICE'
        and (
          l.order_id::text = v_order.id::text
          or upper(trim(coalesce(l.order_number, ''))) = upper(trim(v_order.order_number))
          or upper(trim(coalesce(l.reference_no, ''))) = upper(trim(v_order.order_number))
        )
    )
  );

  insert into public.owner_financial_corrections (
    correction_type,
    customer_account_id,
    customer_branch_id,
    order_id,
    invoice_reference,
    reason,
    before_snapshot,
    after_snapshot,
    applied_by,
    applied_by_staff_id
  )
  values (
    'VOID_DUPLICATE_INVOICE',
    v_order.customer_account_id,
    coalesce(v_order.customer_branch_id, v_order.branch_id),
    v_order.id,
    v_order.order_number,
    trim(p_reason),
    v_before,
    '{}'::jsonb,
    v_actor_name,
    v_actor.staff_id
  )
  returning id into v_correction_id;

  update public.orders
  set
    financial_status = 'VOID',
    financial_correction_id = v_correction_id,
    financial_void_reason = trim(p_reason),
    financial_voided_at = now(),
    financial_voided_by = v_actor_name,
    updated_at = now()
  where id = v_order.id;

  update public.customer_invoices
  set
    status = 'CANCELLED',
    financial_status = 'VOID',
    financial_correction_id = v_correction_id,
    void_reason = trim(p_reason),
    voided_at = now(),
    voided_by = v_actor_name,
    updated_at = now()
  where order_id = v_order.id
     or upper(trim(invoice_number)) = upper(trim(v_order.order_number));

  update public.customer_ledger
  set
    financial_status = 'VOID',
    financial_correction_id = v_correction_id,
    invoice_status = 'VOID',
    remaining_amount = 0,
    updated_at = now()
  where upper(coalesce(entry_type, transaction_type, '')) = 'INVOICE'
    and (
      order_id::text = v_order.id::text
      or upper(trim(coalesce(order_number, ''))) = upper(trim(v_order.order_number))
      or upper(trim(coalesce(reference_no, ''))) = upper(trim(v_order.order_number))
    );

  update public.customer_payment_allocations
  set
    status = 'reversed',
    reversed_at = now(),
    reversal_reason = 'Financial invoice void: ' || trim(p_reason),
    updated_at = now()
  where customer_account_id = v_order.customer_account_id
    and lower(coalesce(status, 'active')) = 'active'
    and (
      upper(trim(coalesce(invoice_reference, ''))) = upper(trim(v_order.order_number))
      or invoice_source_id = v_order.id::text
    );

  if v_order.customer_account_id is not null then
    perform public.recalculate_central_payment_fifo(v_order.customer_account_id);
  end if;

  v_after := jsonb_build_object(
    'order', (
      select to_jsonb(o) from public.orders o where o.id = v_order.id
    ),
    'customer_invoices', (
      select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
      from public.customer_invoices i
      where i.order_id = v_order.id
         or upper(trim(i.invoice_number)) = upper(trim(v_order.order_number))
    ),
    'ledger_invoices', (
      select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
      from public.customer_ledger l
      where l.financial_correction_id = v_correction_id
    )
  );

  update public.owner_financial_corrections
  set after_snapshot = v_after
  where id = v_correction_id;

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
    'VOID_DUPLICATE_INVOICE',
    'ORDER_INVOICE',
    v_order.id::text,
    v_order.customer_account_id,
    coalesce(v_order.customer_branch_id, v_order.branch_id),
    trim(p_reason),
    v_before,
    v_after,
    v_actor_name
  );

  return jsonb_build_object(
    'correction_id', v_correction_id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer_account_id', v_order.customer_account_id,
    'financial_status', 'VOID'
  );
end;
$$;

create or replace function public.preview_matched_legacy_payment_v1(
  p_username text,
  p_session_token text,
  p_ledger_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_match record;
begin
  select * into v_actor
  from public.fc_require_nisstaj_admin_session_v1(p_username, p_session_token);

  select * into v_match
  from public.reconcile_customer_ledger_payments_v2() r
  where r.ledger_id = p_ledger_id;

  if not found then
    raise exception 'Ledger payment % was not found.', p_ledger_id;
  end if;

  return to_jsonb(v_match);
end;
$$;

create or replace function public.link_matched_legacy_payment_v1(
  p_username text,
  p_session_token text,
  p_ledger_id bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_match record;
  v_ledger public.customer_ledger%rowtype;
  v_payment public.customer_payments%rowtype;
  v_correction_id uuid;
  v_actor_name text;
begin
  select * into v_actor
  from public.fc_require_nisstaj_admin_session_v1(p_username, p_session_token);

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Link reason is required.';
  end if;

  select * into v_match
  from public.reconcile_customer_ledger_payments_v2() r
  where r.ledger_id = p_ledger_id;

  if not found then
    raise exception 'Ledger payment % was not found.', p_ledger_id;
  end if;

  if v_match.classification <> 'MATCHED'
     or v_match.canonical_payment_id is null
     or coalesce(v_match.candidate_count, 0) <> 1
     or v_match.confidence not in ('CERTAIN', 'HIGH') then
    raise exception
      'Legacy payment % cannot be linked safely. Classification %, candidates %, confidence %.',
      p_ledger_id,
      v_match.classification,
      v_match.candidate_count,
      v_match.confidence;
  end if;

  select * into v_ledger
  from public.customer_ledger
  where id = p_ledger_id
  for update;

  select * into v_payment
  from public.customer_payments
  where id = v_match.canonical_payment_id
  for update;

  if v_ledger.central_payment_id is not null
     and v_ledger.central_payment_id <> v_payment.id then
    raise exception 'Ledger payment is already linked to a different canonical payment.';
  end if;

  v_actor_name := concat_ws(' | ', v_actor.staff_name, v_actor.username);

  insert into public.owner_financial_corrections (
    correction_type,
    customer_account_id,
    customer_branch_id,
    legacy_ledger_id,
    canonical_payment_id,
    reason,
    before_snapshot,
    after_snapshot,
    applied_by,
    applied_by_staff_id
  )
  values (
    'LINK_LEGACY_PAYMENT',
    v_payment.customer_account_id,
    v_payment.customer_branch_id,
    p_ledger_id,
    v_payment.id,
    trim(p_reason),
    jsonb_build_object('ledger', to_jsonb(v_ledger), 'payment', to_jsonb(v_payment)),
    '{}'::jsonb,
    v_actor_name,
    v_actor.staff_id
  )
  returning id into v_correction_id;

  update public.customer_ledger
  set
    central_payment_id = v_payment.id,
    financial_correction_id = v_correction_id,
    updated_at = now()
  where id = p_ledger_id;

  update public.owner_financial_corrections
  set after_snapshot = jsonb_build_object(
    'ledger', (select to_jsonb(l) from public.customer_ledger l where l.id = p_ledger_id),
    'payment', to_jsonb(v_payment)
  )
  where id = v_correction_id;

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
    'LINK_LEGACY_PAYMENT',
    'CUSTOMER_LEDGER_PAYMENT',
    p_ledger_id::text,
    v_payment.customer_account_id,
    v_payment.customer_branch_id,
    trim(p_reason),
    to_jsonb(v_ledger),
    (select to_jsonb(l) from public.customer_ledger l where l.id = p_ledger_id),
    v_actor_name
  );

  return jsonb_build_object(
    'correction_id', v_correction_id,
    'ledger_id', p_ledger_id,
    'canonical_payment_id', v_payment.id,
    'linked', true
  );
end;
$$;

revoke all on function public.fc_require_nisstaj_admin_session_v1(text, text) from public;
revoke all on function public.preview_owner_invoice_correction_v1(text, text, text) from public;
revoke all on function public.void_owner_duplicate_invoice_v1(text, text, text, text) from public;
revoke all on function public.preview_matched_legacy_payment_v1(text, text, bigint) from public;
revoke all on function public.link_matched_legacy_payment_v1(text, text, bigint, text) from public;

grant execute on function public.preview_owner_invoice_correction_v1(text, text, text) to anon, authenticated;
grant execute on function public.void_owner_duplicate_invoice_v1(text, text, text, text) to anon, authenticated;
grant execute on function public.preview_matched_legacy_payment_v1(text, text, bigint) to anon, authenticated;
grant execute on function public.link_matched_legacy_payment_v1(text, text, bigint, text) to anon, authenticated;

comment on table public.owner_financial_corrections is
  'Permanent owner-only audit trail for controlled financial corrections. Never delete correction history.';
comment on function public.void_owner_duplicate_invoice_v1(text, text, text, text) is
  'Financially voids a duplicate delivered invoice without changing order quantities, operational delivery status, warehouse status, or inventory history. Rebuilds canonical FIFO.';
comment on function public.link_matched_legacy_payment_v1(text, text, bigint, text) is
  'Links only a unique high-confidence legacy ledger payment to its canonical payment. Refuses ambiguous or missing matches.';

notify pgrst, 'reload schema';

commit;
