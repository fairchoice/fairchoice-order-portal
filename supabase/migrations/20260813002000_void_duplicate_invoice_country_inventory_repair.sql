-- Emergency duplicate delivered-order correction: country/location-safe inventory repair.
-- Exact picking location is primary. For legacy orders that pre-date location picking,
-- exact SALE movements are returned to the one active stock location matching the
-- persisted order/customer country (England or Wales). The function refuses to guess.
-- No business rows are changed merely by applying this migration.

begin;

alter table public.orders
  add column if not exists duplicate_void_inventory_reversed_at timestamptz,
  add column if not exists duplicate_void_inventory_reversed_by text;

create table if not exists public.owner_inventory_reversals (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid references public.owner_financial_corrections(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  order_number text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid references public.stock_locations(id) on delete restrict,
  source_picking_event_id uuid references public.order_item_picking_events(id) on delete restrict,
  reversal_source text not null check (reversal_source in ('PICKING_LOCATION', 'LEGACY_PRODUCT_STOCK')),
  quantity numeric not null check (quantity > 0),
  stock_before numeric,
  stock_after numeric,
  reason text not null,
  reversed_by text not null,
  reversed_by_staff_id uuid,
  created_at timestamptz not null default now()
);

alter table public.owner_inventory_reversals
  drop constraint if exists owner_inventory_reversals_reversal_source_check;
alter table public.owner_inventory_reversals
  add constraint owner_inventory_reversals_reversal_source_check
  check (reversal_source in ('PICKING_LOCATION', 'LEGACY_COUNTRY_LOCATION', 'LEGACY_PRODUCT_STOCK'));

create unique index if not exists owner_inventory_reversals_legacy_country_uidx
  on public.owner_inventory_reversals(order_id, product_id, location_id, reversal_source)
  where reversal_source = 'LEGACY_COUNTRY_LOCATION';

create unique index if not exists owner_inventory_reversals_picking_event_uidx
  on public.owner_inventory_reversals(source_picking_event_id)
  where source_picking_event_id is not null;

create index if not exists owner_inventory_reversals_order_idx
  on public.owner_inventory_reversals(order_id, created_at desc);

alter table public.owner_inventory_reversals enable row level security;
revoke all on public.owner_inventory_reversals from public, anon, authenticated;

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
  v_invoice jsonb;
  v_ledger jsonb;
  v_allocations jsonb;
  v_payments jsonb;
  v_location_return_qty numeric := 0;
  v_legacy_return_qty numeric := 0;
  v_financial_voided boolean := false;
  v_inventory_reversed boolean := false;
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

  v_financial_voided := upper(coalesce(v_order.financial_status, 'ACTIVE')) = 'VOID';
  v_inventory_reversed := v_order.duplicate_void_inventory_reversed_at is not null;

  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
    into v_invoice
  from public.customer_invoices i
  where i.order_id = v_order.id
     or upper(trim(i.invoice_number)) = upper(trim(v_order.order_number));

  select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    into v_ledger
  from public.customer_ledger l
  where upper(coalesce(l.entry_type, l.transaction_type, '')) = 'INVOICE'
    and (
      l.order_id::text = v_order.id::text
      or upper(trim(coalesce(l.order_number, ''))) = upper(trim(v_order.order_number))
      or upper(trim(coalesce(l.reference_no, ''))) = upper(trim(v_order.order_number))
    );

  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_allocations
  from public.customer_payment_allocations a
  where a.customer_account_id = v_order.customer_account_id
    and lower(coalesce(a.status, 'active')) = 'active'
    and (
      upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
      or a.invoice_source_id = v_order.id::text
    );

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
    into v_payments
  from public.central_payments p
  where p.customer_account_id = v_order.customer_account_id
    and exists (
      select 1
      from public.customer_payment_allocations a
      where a.central_payment_id = p.id
        and lower(coalesce(a.status, 'active')) = 'active'
        and (
          upper(trim(coalesce(a.invoice_reference, ''))) = upper(trim(v_order.order_number))
          or a.invoice_source_id = v_order.id::text
        )
    );

  if not v_inventory_reversed then
    select coalesce(sum(e.quantity), 0)
      into v_location_return_qty
    from public.order_item_picking_events e
    join public.order_items oi on oi.id = e.order_item_id
    where oi.order_id = v_order.id
      and e.reversed_at is null
      and e.stock_location_id is not null
      and e.stock_product_id is not null;

    select coalesce(sum(abs(sm.qty)), 0)
      into v_legacy_return_qty
    from public.stock_movements sm
    where sm.movement_type = 'SALE'
      and sm.qty < 0
      and upper(trim(coalesce(sm.note, ''))) = upper(trim(v_order.order_number));
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'customer_invoices', v_invoice,
    'ledger_invoices', v_ledger,
    'allocations', v_allocations,
    'payments', v_payments,
    'financial_already_voided', v_financial_voided,
    'inventory_already_reversed', v_inventory_reversed,
    'already_voided', v_financial_voided and v_inventory_reversed,
    'location_stock_return_qty', v_location_return_qty,
    'legacy_stock_return_qty', v_legacy_return_qty,
    'warning', 'This will void the invoice and return its deducted stock to inventory.'
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
  v_financial_already_voided boolean := false;
  v_location_reversed_qty numeric := 0;
  v_legacy_reversed_qty numeric := 0;
  v_legacy_country_reversed_qty numeric := 0;
  v_order_country text;
  v_location_country text;
  v_country_location_count integer;
  v_country_location_id uuid;
  e record;
  s record;
  v_stock_before numeric;
  v_stock_after numeric;
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

  v_financial_already_voided := upper(coalesce(v_order.financial_status, 'ACTIVE')) = 'VOID';

  if not v_financial_already_voided
     and lower(trim(coalesce(v_order.status, ''))) not in
       ('delivered', 'confirmed', 'delivery confirmed', 'completed') then
    raise exception 'Only a delivered/confirmed invoice can be voided.';
  end if;

  -- Country is a safety boundary for all inventory restoration. The existing
  -- resolver uses the persisted delivery/branch/customer country on the order.
  v_order_country := public.fc_resolve_order_inventory_country_v1(v_order.id);

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
    ),
    'location_stock', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'picking_event_id', e2.id,
        'product_id', e2.stock_product_id,
        'location_id', e2.stock_location_id,
        'quantity', e2.quantity,
        'current_qty', pls.qty
      )), '[]'::jsonb)
      from public.order_item_picking_events e2
      join public.order_items oi2 on oi2.id = e2.order_item_id
      left join public.product_location_stock pls
        on pls.product_id = e2.stock_product_id
       and pls.location_id = e2.stock_location_id
      where oi2.order_id = v_order.id
        and e2.reversed_at is null
        and e2.stock_location_id is not null
        and e2.stock_product_id is not null
    )
  );

  v_correction_id := v_order.financial_correction_id;

  if v_correction_id is null then
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
    ) values (
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
    ) returning id into v_correction_id;
  else
    update public.owner_financial_corrections
    set reason = trim(p_reason),
        before_snapshot = case
          when before_snapshot is null or before_snapshot = '{}'::jsonb then v_before
          else before_snapshot
        end
    where id = v_correction_id;
  end if;

  -- Financial reversal. This is skipped only when repairing inventory for an
  -- invoice that was already voided by the earlier financial-only function.
  if not v_financial_already_voided then
    update public.orders
    set financial_status = 'VOID',
        financial_correction_id = v_correction_id,
        financial_void_reason = trim(p_reason),
        financial_voided_at = now(),
        financial_voided_by = v_actor_name,
        updated_at = now()
    where id = v_order.id;

    update public.customer_invoices
    set status = 'CANCELLED',
        financial_status = 'VOID',
        financial_correction_id = v_correction_id,
        void_reason = trim(p_reason),
        voided_at = now(),
        voided_by = v_actor_name,
        updated_at = now()
    where order_id = v_order.id
       or upper(trim(invoice_number)) = upper(trim(v_order.order_number));

    update public.customer_ledger
    set financial_status = 'VOID',
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
    set status = 'reversed',
        reversed_at = now(),
        reversal_reason = 'Duplicate invoice void: ' || trim(p_reason),
        updated_at = now()
    where customer_account_id = v_order.customer_account_id
      and lower(coalesce(status, 'active')) = 'active'
      and (
        upper(trim(coalesce(invoice_reference, ''))) = upper(trim(v_order.order_number))
        or invoice_source_id = v_order.id::text
      );
  end if;

  -- Return location inventory exactly from the active picking events that
  -- originally deducted it. Pre-order events have no stock_location_id and
  -- therefore are not returned here.
  for e in
    select pe.*
    from public.order_item_picking_events pe
    join public.order_items oi on oi.id = pe.order_item_id
    where oi.order_id = v_order.id
      and pe.reversed_at is null
      and pe.stock_location_id is not null
      and pe.stock_product_id is not null
    order by pe.created_at, pe.id
    for update of pe
  loop
    select public.fc_normalize_inventory_country_v1(sl.country)
      into v_location_country
    from public.stock_locations sl
    where sl.id = e.stock_location_id
      and sl.active is true;

    if not found or v_location_country is null then
      raise exception 'Cannot safely return inventory: picking stock location is missing, inactive, or has no valid country.';
    end if;

    if public.fc_normalize_inventory_country_v1(e.inventory_country) is distinct from v_order_country then
      raise exception 'Cannot safely return inventory: picking country does not match order country (%).', v_order_country;
    end if;

    if v_location_country is distinct from v_order_country then
      raise exception 'Cannot safely return inventory: original stock location country (%) does not match order country (%).', v_location_country, v_order_country;
    end if;

    select qty into v_stock_before
    from public.product_location_stock
    where product_id = e.stock_product_id
      and location_id = e.stock_location_id
    for update;

    if not found then
      raise exception 'Cannot safely return inventory: location stock row is missing for product %.', e.stock_product_id;
    end if;

    v_stock_after := coalesce(v_stock_before, 0) + e.quantity;

    update public.product_location_stock
    set qty = v_stock_after,
        updated_at = now()
    where product_id = e.stock_product_id
      and location_id = e.stock_location_id;

    insert into public.owner_inventory_reversals (
      correction_id, order_id, order_number, product_id, location_id,
      source_picking_event_id, reversal_source, quantity, stock_before,
      stock_after, reason, reversed_by, reversed_by_staff_id
    ) values (
      v_correction_id, v_order.id, v_order.order_number, e.stock_product_id,
      e.stock_location_id, e.id, 'PICKING_LOCATION', e.quantity,
      v_stock_before, v_stock_after, trim(p_reason), v_actor_name, v_actor.staff_id
    );

    update public.order_item_picking_events
    set reversed_at = now(),
        reversed_by_staff_id = v_actor.staff_id,
        reversal_old_status = coalesce(new_status, action),
        reversal_new_status = 'duplicate_void',
        reversal_reason = 'Duplicate delivered order void: ' || trim(p_reason)
    where id = e.id;

    v_location_reversed_qty := v_location_reversed_qty + e.quantity;
  end loop;

  -- Legacy orders may pre-date location-aware picking. In that case there is
  -- no picking event to identify a location, so use only the exact recorded SALE
  -- quantity for this order and the persisted order/customer country. There must
  -- be exactly one active location-stock row for that product in that country.
  -- If not, abort the whole transaction instead of guessing.
  for s in
    select sm.product_id, sum(abs(sm.qty))::numeric as quantity
    from public.stock_movements sm
    where sm.movement_type = 'SALE'
      and sm.qty < 0
      and upper(trim(coalesce(sm.note, ''))) = upper(trim(v_order.order_number))
    group by sm.product_id
  loop
    if not exists (
      select 1 from public.owner_inventory_reversals r
      where r.order_id = v_order.id
        and r.product_id = s.product_id
        and r.reversal_source = 'PICKING_LOCATION'
    ) and not exists (
      select 1 from public.owner_inventory_reversals r
      where r.order_id = v_order.id
        and r.product_id = s.product_id
        and r.reversal_source = 'LEGACY_COUNTRY_LOCATION'
    ) then
      select count(*), min(pls.location_id)
        into v_country_location_count, v_country_location_id
      from public.product_location_stock pls
      join public.stock_locations sl
        on sl.id = pls.location_id
       and sl.active is true
      where pls.product_id = s.product_id
        and public.fc_normalize_inventory_country_v1(sl.country) = v_order_country;

      if v_country_location_count <> 1 or v_country_location_id is null then
        raise exception 'Cannot safely return legacy inventory for product %: expected exactly one active % stock location, found %.', s.product_id, v_order_country, v_country_location_count;
      end if;

      select qty into v_stock_before
      from public.product_location_stock
      where product_id = s.product_id
        and location_id = v_country_location_id
      for update;

      if not found then
        raise exception 'Cannot safely return legacy inventory: location stock row disappeared for product %.', s.product_id;
      end if;

      v_stock_after := coalesce(v_stock_before, 0) + s.quantity;

      update public.product_location_stock
      set qty = v_stock_after,
          updated_at = now()
      where product_id = s.product_id
        and location_id = v_country_location_id;

      insert into public.owner_inventory_reversals (
        correction_id, order_id, order_number, product_id, location_id,
        source_picking_event_id, reversal_source, quantity, stock_before,
        stock_after, reason, reversed_by, reversed_by_staff_id
      ) values (
        v_correction_id, v_order.id, v_order.order_number, s.product_id,
        v_country_location_id, null, 'LEGACY_COUNTRY_LOCATION', s.quantity,
        v_stock_before, v_stock_after, trim(p_reason), v_actor_name, v_actor.staff_id
      );

      v_legacy_country_reversed_qty := v_legacy_country_reversed_qty + s.quantity;
    end if;
  end loop;

  -- Keep the legacy products.stock counter consistent when this order created
  -- the old SALE movements at order submission. This mirrors only recorded
  -- deductions for this exact order number; it never guesses a quantity.
  for s in
    select sm.product_id, sum(abs(sm.qty))::numeric as quantity
    from public.stock_movements sm
    where sm.movement_type = 'SALE'
      and sm.qty < 0
      and upper(trim(coalesce(sm.note, ''))) = upper(trim(v_order.order_number))
    group by sm.product_id
  loop
    if not exists (
      select 1
      from public.owner_inventory_reversals r
      where r.order_id = v_order.id
        and r.product_id = s.product_id
        and r.reversal_source = 'LEGACY_PRODUCT_STOCK'
    ) then
      select stock into v_stock_before
      from public.products
      where id = s.product_id
      for update;

      if not found then
        raise exception 'Cannot safely return legacy stock: product % is missing.', s.product_id;
      end if;

      v_stock_after := coalesce(v_stock_before, 0) + s.quantity;

      update public.products
      set stock = v_stock_after
      where id = s.product_id;

      insert into public.stock_movements (
        product_id, movement_type, qty, stock_before, stock_after, note
      ) values (
        s.product_id,
        'VOID_RETURN',
        s.quantity,
        v_stock_before,
        v_stock_after,
        'Duplicate invoice void return / ' || v_order.order_number
      );

      insert into public.owner_inventory_reversals (
        correction_id, order_id, order_number, product_id, location_id,
        source_picking_event_id, reversal_source, quantity, stock_before,
        stock_after, reason, reversed_by, reversed_by_staff_id
      ) values (
        v_correction_id, v_order.id, v_order.order_number, s.product_id, null,
        null, 'LEGACY_PRODUCT_STOCK', s.quantity, v_stock_before,
        v_stock_after, trim(p_reason), v_actor_name, v_actor.staff_id
      );

      v_legacy_reversed_qty := v_legacy_reversed_qty + s.quantity;
    end if;
  end loop;

  -- A delivered duplicate order must have provable inventory evidence. If this
  -- invocation changed neither location stock nor legacy stock and the financial
  -- side was already void, treat it as already complete rather than silently
  -- claiming an inventory reversal.
  if v_financial_already_voided
     and v_location_reversed_qty = 0
     and v_legacy_country_reversed_qty = 0
     and v_legacy_reversed_qty = 0 then
    raise exception 'This duplicate invoice and its inventory are already reversed, or no reversible stock evidence remains.';
  end if;

  if not v_financial_already_voided
     and v_location_reversed_qty = 0
     and v_legacy_country_reversed_qty = 0
     and v_legacy_reversed_qty = 0 then
    raise exception 'Cannot safely void this delivered invoice: no recorded stock deduction was found for the order.';
  end if;

  update public.orders
  set duplicate_void_inventory_reversed_at = now(),
      duplicate_void_inventory_reversed_by = v_actor_name,
      updated_at = now()
  where id = v_order.id;

  if v_order.customer_account_id is not null then
    perform public.recalculate_central_payment_fifo(v_order.customer_account_id);
  end if;

  v_after := jsonb_build_object(
    'order', (select to_jsonb(o) from public.orders o where o.id = v_order.id),
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
    ),
    'inventory_reversals', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from public.owner_inventory_reversals r
      where r.order_id = v_order.id
    )
  );

  update public.owner_financial_corrections
  set after_snapshot = v_after
  where id = v_correction_id;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, customer_account_id, customer_branch_id,
    reason, before_data, after_data, changed_by
  ) values (
    case when v_financial_already_voided
      then 'COMPLETE_DUPLICATE_INVENTORY_REVERSAL'
      else 'VOID_DUPLICATE_INVOICE_AND_RETURN_STOCK'
    end,
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
    'financial_status', 'VOID',
    'order_inventory_country', v_order_country,
    'location_stock_returned_qty', v_location_reversed_qty,
    'legacy_country_location_returned_qty', v_legacy_country_reversed_qty,
    'legacy_stock_returned_qty', v_legacy_reversed_qty,
    'inventory_reversed', true
  );
end;
$$;

revoke all on function public.preview_owner_invoice_correction_v1(text, text, text) from public;
revoke all on function public.void_owner_duplicate_invoice_v1(text, text, text, text) from public;
grant execute on function public.preview_owner_invoice_correction_v1(text, text, text) to anon, authenticated;
grant execute on function public.void_owner_duplicate_invoice_v1(text, text, text, text) to anon, authenticated;

comment on function public.void_owner_duplicate_invoice_v1(text, text, text, text) is
  'Owner-only emergency duplicate delivered-order correction. Atomically voids the invoice/ledger/allocation effect and returns only inventory proven to have been deducted by the order, with permanent audit records.';

commit;
