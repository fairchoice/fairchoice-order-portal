-- Prepared for review and local/test validation. Do not apply to production without approval.
-- Previous Paid is an invoice-status acknowledgement, not a payment, credit or allocation.
-- Account-level payment totals and balances continue to use actual financial records.
begin;

-- Refuse to replace an unreviewed FIFO implementation or a newer local update.
do $preflight$
declare v_hash text;
begin
  select md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) into v_hash
  from pg_proc p where p.oid='public.recalculate_central_payment_fifo(uuid)'::regprocedure;
  if v_hash is null or v_hash not in ('85c3963da64c1397ea273013485b5f69','233889126ea3361faf48016682c6fb60') then
    raise exception 'FIFO implementation differs from the reviewed version. Stop and review this database before applying the collection update.';
  end if;
end;
$preflight$;

alter table public.customer_invoices
  add column if not exists collection_previous_paid_amount numeric(14,2) not null default 0 check (collection_previous_paid_amount >= 0),
  add column if not exists collection_previous_allocated_amount numeric(14,2) not null default 0 check (collection_previous_allocated_amount >= 0);
alter table public.customer_ledger
  add column if not exists collection_previous_paid_amount numeric(14,2) not null default 0,
  add column if not exists collection_previous_allocated_amount numeric(14,2) not null default 0;

create table if not exists public.invoice_collection_requests (
  customer_account_id uuid not null references public.customer_accounts(id),
  request_key text not null,
  payload_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (customer_account_id, request_key)
);
alter table public.invoice_collection_requests enable row level security;
revoke all on public.invoice_collection_requests from public, anon, authenticated;

create or replace function public.fc_collection_allocated_amount_v1(p_invoice_id uuid)
returns numeric language sql stable security invoker set search_path = pg_catalog, public as $$
  select coalesce(sum(a.allocated_amount),0)
  from public.customer_invoices i
  join public.customer_payment_allocations a
    on a.customer_account_id=i.customer_account_id and a.invoice_reference=i.invoice_number
  join public.customer_payments p on p.id=a.payment_id
  where i.id=p_invoice_id and lower(a.status)='active'
    and a.reversed_at is null and a.voided_at is null
    and p.status='POSTED' and coalesce(p.verification_status,'CONFIRMED')='CONFIRMED'
    and p.voided_at is null
    and not exists (select 1 from public.central_payment_archive x where x.payment_id=p.id);
$$;
revoke all on function public.fc_collection_allocated_amount_v1(uuid) from public, anon, authenticated;

create or replace function public.fc_collection_paid_amount_v1(p_invoice_id uuid)
returns numeric language sql stable security invoker set search_path = pg_catalog, public as $$
  select least(i.invoice_total, greatest(a.amount,
    i.collection_previous_paid_amount + greatest(0,a.amount-i.collection_previous_allocated_amount)))
  from public.customer_invoices i
  cross join lateral (select public.fc_collection_allocated_amount_v1(i.id) as amount) a
  where i.id=p_invoice_id;
$$;
revoke all on function public.fc_collection_paid_amount_v1(uuid) from public, anon, authenticated;

create or replace function public.fc_sync_collection_invoice_status_v1(p_invoice_id uuid)
returns void language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_invoice public.customer_invoices%rowtype; v_paid numeric;
begin
  select * into strict v_invoice from public.customer_invoices where id=p_invoice_id;
  v_paid := public.fc_collection_paid_amount_v1(p_invoice_id);
  update public.customer_ledger l
  set collection_previous_paid_amount=v_invoice.collection_previous_paid_amount,
      collection_previous_allocated_amount=v_invoice.collection_previous_allocated_amount,
      paid_amount=v_paid, remaining_amount=greatest(0,v_invoice.invoice_total-v_paid),
      invoice_status=case when v_paid>=v_invoice.invoice_total then 'PAID' when v_paid>0 then 'PART PAID' else 'UNPAID' end
  where l.customer_account_id=v_invoice.customer_account_id
    and l.customer_branch_id is not distinct from v_invoice.customer_branch_id
    and upper(coalesce(l.entry_type,''))='INVOICE'
    and l.reference_no=v_invoice.invoice_number;
end;
$$;
revoke all on function public.fc_sync_collection_invoice_status_v1(uuid) from public, anon, authenticated;

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
    and p.status = 'POSTED'
    and coalesce(p.verification_status,'CONFIRMED') = 'CONFIRMED'
    and p.voided_at is null
    and not exists (select 1 from public.central_payment_archive x where x.payment_id=p.id)
    and (
      (p.source = 'DRIVER_DELIVERY_COLLECTION' and coalesce(p.metadata->>'payment_applies_to','')='TODAY_INVOICE')
      or (p.source in ('SALES_REP_COLLECTION','PREVIOUS_BALANCE_COLLECTION')
          and p.metadata->>'allocation_mode'='MANUAL_INVOICE_COLLECTION_V1')
      or exists (select 1 from public.customer_invoices i
        where i.customer_account_id=a.customer_account_id and i.invoice_number=a.invoice_reference
          and i.collection_previous_paid_amount>0)
    )
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
        ((p.source = 'DRIVER_DELIVERY_COLLECTION'
          and coalesce(p.metadata->>'payment_applies_to','')='TODAY_INVOICE')
         or (p.source in ('SALES_REP_COLLECTION','PREVIOUS_BALANCE_COLLECTION')
          and p.metadata->>'allocation_mode'='MANUAL_INVOICE_COLLECTION_V1'))
        and p.verification_status='CONFIRMED' and p.voided_at is null
      )
    order by p.payment_date, p.created_at, p.payment_reference, p.id
  loop
    -- Previously allocated money remains on its original acknowledged invoice.
    select greatest(0,round(v_payment.amount-coalesce(sum(a.allocated_amount),0),2))
    into v_remaining from public.customer_payment_allocations a where a.payment_id=v_payment.id and a.status='active';

    for v_invoice in
      select i.*
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id
        and i.status <> 'CANCELLED'
        and i.invoice_date <= coalesce(v_payment.payment_date,v_payment.created_at,now())
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
          v_invoice.invoice_total - greatest(coalesce(sum(a.allocated_amount),0),
            v_invoice.collection_previous_paid_amount + greatest(0,
              coalesce(sum(a.allocated_amount),0)-v_invoice.collection_previous_allocated_amount)),
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

revoke all on function public.recalculate_central_payment_fifo(uuid) from public, anon, authenticated;

create or replace function public.fc_save_invoice_collection_v1(
  p_customer_account_id uuid, p_customer_branch_id uuid,
  p_amount numeric, p_payment_date timestamptz, p_payment_method text,
  p_payment_source text, p_paid_by text, p_notes text, p_metadata jsonb,
  p_allocations jsonb, p_previous_statuses jsonb,
  p_request_key text, p_username text, p_session_token text
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_actor record; v_invoice public.customer_invoices%rowtype;
  v_item jsonb; v_seen uuid[] := array[]::uuid[]; v_id uuid;
  v_amount numeric; v_allocated numeric; v_paid numeric; v_remaining numeric;
  v_requested numeric; v_allocations_total numeric:=0;
  v_payment jsonb := null; v_result jsonb; v_before jsonb;
  v_existing public.invoice_collection_requests%rowtype;
  v_fingerprint text; v_mode text; v_effective_allocations jsonb := coalesce(p_allocations,'[]'::jsonb);
begin
  select * into strict v_actor from public.fc_require_session_permission_v2(p_username,p_session_token,'payments.collect_cash');
  if lower(coalesce(v_actor.staff_role,''))='customer' then
    raise exception 'Staff cash collection access is required.' using errcode='42501';
  end if;
  if p_payment_source not in ('SALES_REP_COLLECTION','PREVIOUS_BALANCE_COLLECTION') or p_payment_source is null then
    raise exception 'Unsupported collection source.';
  end if;
  if p_request_key is null or length(trim(p_request_key))<20 or length(p_request_key)>200 then
    raise exception 'A stable collection intent is required.';
  end if;
  if p_amount is null or p_amount<0 or p_amount>1000000 or round(p_amount,2)<>p_amount then
    raise exception 'Collected amount is invalid.';
  end if;
  v_amount:=p_amount;
  if jsonb_typeof(v_effective_allocations)<>'array'
    or jsonb_typeof(coalesce(p_previous_statuses,'[]'::jsonb))<>'array'
    or jsonb_array_length(v_effective_allocations)+jsonb_array_length(coalesce(p_previous_statuses,'[]'::jsonb))>200 then
    raise exception 'Invalid invoice selections.';
  end if;
  if v_amount=0 and jsonb_array_length(coalesce(p_previous_statuses,'[]'::jsonb))=0 then
    raise exception 'No collection or previous-payment correction was selected.';
  end if;
  if v_amount>0 and nullif(trim(p_paid_by),'') is null then raise exception 'Payer name is required for new money.'; end if;
  perform 1 from public.customer_accounts where id=p_customer_account_id for update;
  if not found then raise exception 'Customer account does not exist.'; end if;
  if p_customer_branch_id is not null and not exists(select 1 from public.customer_branches
    where id=p_customer_branch_id and customer_account_id=p_customer_account_id) then
    raise exception 'Branch does not belong to the selected customer.';
  end if;
  -- Dates are excluded so a response-loss retry made a minute later can return
  -- the original result. Money, scope and all invoice selections must match.
  v_fingerprint:=md5(jsonb_build_object('branch',p_customer_branch_id,'amount',p_amount,
    'method',p_payment_method,'source',p_payment_source,'payer',p_paid_by,'notes',p_notes,
    'allocations',v_effective_allocations,'previous',coalesce(p_previous_statuses,'[]'::jsonb))::text);
  select * into v_existing from public.invoice_collection_requests
    where customer_account_id=p_customer_account_id and request_key=p_request_key;
  if found then
    if v_existing.payload_fingerprint<>v_fingerprint then raise exception 'This collection was already saved with different values. Reload before starting another collection.'; end if;
    return v_existing.result || jsonb_build_object('duplicate',true);
  end if;
  -- Validate and apply every previous-status correction within this transaction.
  -- No payment writer, allocation mutation, balance refresh or FIFO rebuild is
  -- called for a status-only request.
  for v_item in select value from jsonb_array_elements(coalesce(p_previous_statuses,'[]'::jsonb)) loop
    v_id:=(v_item->>'invoiceSourceId')::uuid;
    if v_id=any(v_seen) then raise exception 'Duplicate invoice selection.'; end if;
    v_seen:=array_append(v_seen,v_id);
    select * into v_invoice from public.customer_invoices
      where id=v_id and customer_account_id=p_customer_account_id
        and customer_branch_id is not distinct from p_customer_branch_id
        and invoice_number=v_item->>'invoiceReference' and status='ISSUED'
        and upper(coalesce(financial_status,'ACTIVE'))<>'VOID' for update;
    if not found then raise exception 'Previous-payment invoice is invalid for this customer and branch.'; end if;
    if (v_item->>'customerBranchId')::uuid is distinct from v_invoice.customer_branch_id then raise exception 'Invoice branch does not match the selection.'; end if;
    v_allocated:=public.fc_collection_allocated_amount_v1(v_id);
    v_paid:=public.fc_collection_paid_amount_v1(v_id);
    v_remaining:=round(greatest(0,v_invoice.invoice_total-v_paid),2);
    if (v_item->>'expectedRemainingAmount')::numeric is distinct from v_remaining then raise exception 'Invoice balance changed. Reload invoices before saving.'; end if;
    v_requested:=(v_item->>'previouslyPaidAmount')::numeric;
    v_mode:=v_item->>'mode';
    if v_requested is null or v_requested<=0 or round(v_requested,2)<>v_requested
      or v_mode is null or v_mode not in ('previous_paid','previous_part')
      or (v_mode='previous_paid' and v_requested<>v_invoice.invoice_total)
      or (v_mode='previous_part' and v_requested>=v_invoice.invoice_total)
      or v_requested<v_paid then
      raise exception 'Previous Part Paid must be the total already paid, below the invoice total and no lower than the current paid amount.';
    end if;
    v_before:=to_jsonb(v_invoice);
    update public.customer_invoices set collection_previous_paid_amount=v_requested,
      collection_previous_allocated_amount=v_allocated, updated_at=now() where id=v_id;
    perform public.fc_sync_collection_invoice_status_v1(v_id);
    insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
    values('INVOICE_PREVIOUS_STATUS_ACKNOWLEDGED','customer_invoices',v_id::text,p_customer_account_id,p_customer_branch_id,
      coalesce(nullif(trim(p_notes),''),'Previous payment acknowledged; invoice status only'),v_before,
      jsonb_build_object('mode',v_mode,'acknowledged_paid_amount',v_requested,'new_payment_amount',0,'request_key',p_request_key),v_actor.username);
  end loop;
  -- New money is limited to the explicitly selected invoice balances.
  for v_item in select value from jsonb_array_elements(v_effective_allocations) loop
    v_id:=(v_item->>'invoiceSourceId')::uuid;
    if v_id=any(v_seen) then raise exception 'An invoice cannot have two payment choices in one collection.'; end if;
    v_seen:=array_append(v_seen,v_id);
    select * into v_invoice from public.customer_invoices
      where id=v_id and customer_account_id=p_customer_account_id
        and customer_branch_id is not distinct from p_customer_branch_id
        and invoice_number=v_item->>'invoiceReference' and status='ISSUED'
        and upper(coalesce(financial_status,'ACTIVE'))<>'VOID' for update;
    if not found then raise exception 'Collection invoice is invalid for this customer and branch.'; end if;
    if v_invoice.invoice_date>coalesce(p_payment_date,now()) then raise exception 'Cannot allocate a collection to a future-dated invoice.'; end if;
    if (v_item->>'customerBranchId')::uuid is distinct from v_invoice.customer_branch_id then raise exception 'Invoice branch does not match the selection.'; end if;
    v_remaining:=round(greatest(0,v_invoice.invoice_total-public.fc_collection_paid_amount_v1(v_id)),2);
    v_requested:=(v_item->>'allocatedAmount')::numeric;
    if (v_item->>'expectedRemainingAmount')::numeric is distinct from v_remaining then raise exception 'Invoice balance changed. Reload invoices before saving.'; end if;
    if v_requested is null or v_requested<=0 or round(v_requested,2)<>v_requested or v_requested>v_remaining then raise exception 'New payment exceeds the invoice balance.'; end if;
    v_allocations_total:=v_allocations_total+v_requested;
  end loop;
  if v_allocations_total>v_amount then raise exception 'Invoice allocations exceed new money collected.'; end if;
  if v_amount>0 then
    if p_payment_method='Bank Transfer' and jsonb_array_length(v_effective_allocations)>0 then raise exception 'Bank transfers must be verified before allocating to invoices.'; end if;
    v_result:=public.post_canonical_customer_payment_v2(
      p_customer_account_id,p_customer_branch_id,v_amount,p_payment_date,p_payment_method,p_payment_source,
      'INVOICE_COLLECTION',p_paid_by,null,null,p_request_key,p_notes,
      coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object(
        'payment_applies_to','MANUAL_INVOICE_COLLECTION',
        'allocation_mode',case when p_payment_method='Bank Transfer' then 'PENDING_BANK_TRANSFER' else 'MANUAL_INVOICE_COLLECTION_V1' end),
      v_effective_allocations,p_username,p_session_token);
    v_payment:=v_result->'payment';
    if coalesce((v_result->>'duplicate')::boolean,false) then
      raise exception 'Payment intent already exists outside this collection request. Reload and reconcile before retrying.';
    end if;
    foreach v_id in array v_seen loop perform public.fc_sync_collection_invoice_status_v1(v_id); end loop;
  end if;
  v_result:=jsonb_build_object('duplicate',false,'payment',v_payment,'status_only',v_amount=0,
    'previous_status_count',jsonb_array_length(coalesce(p_previous_statuses,'[]'::jsonb)),
    'collected_amount',v_amount,'unallocated_amount',v_amount-v_allocations_total);
  insert into public.invoice_collection_requests(customer_account_id,request_key,payload_fingerprint,result)
    values(p_customer_account_id,p_request_key,v_fingerprint,v_result);
  return v_result;
end;
$$;
revoke all on function public.fc_save_invoice_collection_v1(uuid,uuid,numeric,timestamptz,text,text,text,text,jsonb,jsonb,jsonb,text,text,text) from public;
grant execute on function public.fc_save_invoice_collection_v1(uuid,uuid,numeric,timestamptz,text,text,text,text,jsonb,jsonb,jsonb,text,text,text) to anon, authenticated;
notify pgrst,'reload schema';
commit;
