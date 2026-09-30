-- Compatibility repair for TEST schemas where customer_ledger.order_id is bigint
-- while orders.id is uuid. Full textual order references remain the primary match.

begin;

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

notify pgrst, 'reload schema';

commit;
