-- Session-authorized Customer Credit payment amendment and void workflow.
-- The canonical payment ID is retained for edits; voids retain the row and
-- archive/audit history. Existing FIFO is the only allocation engine used.

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values
  (
    'customer_credit.payment_edit',
    'Edit Customer Credit Payment',
    'Customer Credit',
    'Correct an active customer payment and rebuild FIFO allocations.'
  ),
  (
    'customer_credit.payment_delete',
    'Void Customer Credit Payment',
    'Customer Credit',
    'Void a mistaken customer payment and rebuild FIFO allocations.'
  )
on conflict (permission_key) do update
set
  permission_name = excluded.permission_name,
  category = excluded.category,
  description = excluded.description,
  active = true,
  updated_at = now();

alter table public.customer_payments
  add column if not exists edited_by_staff_id uuid null
    references public.staff_users(id) on delete set null;

alter table public.central_payment_lifecycle_audit
  add column if not exists changed_by_staff_id uuid null
    references public.staff_users(id) on delete set null;

create or replace function public.edit_customer_credit_payment_v1(
  p_username text,
  p_session_token text,
  p_customer_account_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_date timestamptz,
  p_paid_by text,
  p_collection_type text,
  p_reference text,
  p_notes text,
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
  v_allocations jsonb := '[]'::jsonb;
  v_actor_name text;
begin
  select *
    into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.payment_edit'
  );

  if p_payment_id is null then
    raise exception 'Payment ID is required.';
  end if;
  if p_customer_account_id is null then
    raise exception 'Customer account ID is required.';
  end if;
  if p_amount is null or round(p_amount, 2) <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if nullif(trim(coalesce(p_payment_method, '')), '') is null then
    raise exception 'Payment type is required.';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Amendment reason is required.';
  end if;

  select *
    into v_before
  from public.customer_payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment does not exist.';
  end if;
  if v_before.customer_account_id is distinct from p_customer_account_id then
    raise exception 'Payment does not belong to the selected customer account.'
      using errcode = '42501';
  end if;
  if upper(coalesce(v_before.status, 'POSTED')) <> 'POSTED'
     or upper(coalesce(v_before.verification_status, 'CONFIRMED'))
       in ('VOIDED', 'REVERSED', 'REJECTED', 'PENDING', 'PENDING_VERIFICATION')
     or v_before.voided_at is not null
     or exists (
       select 1
       from public.central_payment_archive a
       where a.payment_id = v_before.id
     ) then
    raise exception 'Only an active confirmed payment can be edited.';
  end if;

  v_actor_name := concat_ws(
    ' | ',
    v_actor.staff_name,
    v_actor.username,
    v_actor.staff_code
  );

  -- Remove the former effect first. The existing customer-wide FIFO rebuild
  -- below recreates one authoritative allocation set using the corrected row.
  delete from public.customer_payment_allocations
  where payment_id = v_before.id;

  update public.customer_payments
  set
    amount = round(p_amount, 2),
    payment_method = trim(p_payment_method),
    payment_date = coalesce(p_payment_date, payment_date),
    paid_by = nullif(trim(coalesce(p_paid_by, '')), ''),
    payment_reference = coalesce(
      nullif(trim(coalesce(p_reference, '')), ''),
      payment_reference
    ),
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'collection_type',
        nullif(trim(coalesce(p_collection_type, '')), '')
      ),
    edited_at = now(),
    edited_by = v_actor_name,
    edited_by_staff_id = v_actor.staff_id,
    edit_reason = trim(p_reason),
    updated_at = now()
  where id = v_before.id
  returning * into v_after;

  perform public.recalculate_central_payment_fifo(
    v_before.customer_account_id
  );

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.payment_id = v_after.id
    and lower(coalesce(a.status, 'active')) = 'active';

  insert into public.central_payment_lifecycle_audit (
    payment_id,
    payment_reference,
    customer_account_id,
    customer_branch_id,
    action,
    reason,
    before_data,
    after_data,
    changed_by,
    changed_by_staff_id
  )
  values (
    v_after.id,
    v_after.payment_reference,
    v_after.customer_account_id,
    v_after.customer_branch_id,
    'EDITED',
    trim(p_reason),
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_actor_name,
    v_actor.staff_id
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_after),
    'allocations', v_allocations,
    'customer_account_id', v_after.customer_account_id
  );
end;
$$;

create or replace function public.void_customer_credit_payment_v1(
  p_username text,
  p_session_token text,
  p_customer_account_id uuid,
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
  v_actor_name text;
begin
  select *
    into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.payment_delete'
  );

  if p_payment_id is null then
    raise exception 'Payment ID is required.';
  end if;
  if p_customer_account_id is null then
    raise exception 'Customer account ID is required.';
  end if;
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
  if v_before.customer_account_id is distinct from p_customer_account_id then
    raise exception 'Payment does not belong to the selected customer account.'
      using errcode = '42501';
  end if;
  if upper(coalesce(v_before.status, 'POSTED')) <> 'POSTED'
     or upper(coalesce(v_before.verification_status, 'CONFIRMED'))
       in ('VOIDED', 'REVERSED', 'REJECTED', 'PENDING', 'PENDING_VERIFICATION')
     or v_before.voided_at is not null
     or exists (
       select 1
       from public.central_payment_archive a
       where a.payment_id = v_before.id
     ) then
    raise exception 'Only an active confirmed payment can be voided.';
  end if;

  v_actor_name := concat_ws(
    ' | ',
    v_actor.staff_name,
    v_actor.username,
    v_actor.staff_code
  );

  insert into public.central_payment_archive (
    payment_id,
    customer_account_id,
    customer_branch_id,
    payment_snapshot,
    removed_reason,
    removed_by
  )
  values (
    v_before.id,
    v_before.customer_account_id,
    v_before.customer_branch_id,
    to_jsonb(v_before),
    trim(p_reason),
    v_actor_name
  );

  delete from public.customer_payment_allocations
  where payment_id = v_before.id;

  update public.customer_payments
  set
    status = 'VOIDED',
    verification_status = 'VOIDED',
    void_reason = trim(p_reason),
    voided_by = v_actor_name,
    voided_at = now(),
    updated_at = now()
  where id = v_before.id
  returning * into v_after;

  perform public.recalculate_central_payment_fifo(
    v_before.customer_account_id
  );

  insert into public.central_payment_lifecycle_audit (
    payment_id,
    payment_reference,
    customer_account_id,
    customer_branch_id,
    action,
    reason,
    before_data,
    after_data,
    changed_by,
    changed_by_staff_id
  )
  values (
    v_after.id,
    v_after.payment_reference,
    v_after.customer_account_id,
    v_after.customer_branch_id,
    'REMOVED',
    trim(p_reason),
    to_jsonb(v_before),
    to_jsonb(v_after),
    v_actor_name,
    v_actor.staff_id
  );

  return jsonb_build_object(
    'payment', to_jsonb(v_after),
    'allocations', '[]'::jsonb,
    'customer_account_id', v_after.customer_account_id
  );
end;
$$;

revoke all on function public.edit_customer_credit_payment_v1(
  text, text, uuid, uuid, numeric, text, timestamptz,
  text, text, text, text, text
) from public;
grant execute on function public.edit_customer_credit_payment_v1(
  text, text, uuid, uuid, numeric, text, timestamptz,
  text, text, text, text, text
) to anon, authenticated;

revoke all on function public.void_customer_credit_payment_v1(
  text, text, uuid, uuid, text
) from public;
grant execute on function public.void_customer_credit_payment_v1(
  text, text, uuid, uuid, text
) to anon, authenticated;

comment on function public.edit_customer_credit_payment_v1(
  text, text, uuid, uuid, numeric, text, timestamptz,
  text, text, text, text, text
) is
  'Session-authorized in-place payment correction with audit and canonical FIFO rebuild.';

comment on function public.void_customer_credit_payment_v1(
  text, text, uuid, uuid, text
) is
  'Session-authorized payment void with archive, audit, and canonical FIFO rebuild.';

notify pgrst, 'reload schema';
