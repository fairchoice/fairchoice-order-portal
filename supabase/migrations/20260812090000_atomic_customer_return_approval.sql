-- FairChoice Returns Approval Phase 2.
-- Forward-only foundation: secured atomic approval, canonical credit, reversal,
-- legacy Customer Credit compatibility, and read-only reconciliation.
-- No historical return is backfilled by this migration.

begin;

do $$
begin
  if to_regclass('public.customer_returns') is null
     or to_regclass('public.customer_ledger') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_ledger_events') is null
     or to_regclass('public.financial_audit_log') is null
     or to_regprocedure('public.fc_require_session_permission(text,text,text)') is null then
    raise exception 'Returns Phase 2 prerequisites are not installed.';
  end if;
end;
$$;

insert into public.fc_permissions(permission_key, permission_name, category, description)
values
  ('returns.view', 'View Returns', 'Returns', 'View customer return requests and their status.'),
  ('returns.approve', 'Approve Returns', 'Returns', 'Approve a pending customer return and create its financial effect.'),
  ('returns.reverse', 'Reverse Return Approval', 'Returns', 'Reverse an approved return while preserving financial history.'),
  ('returns.reconcile', 'Reconcile Returns', 'Returns', 'View return-to-ledger reconciliation without changing data.')
on conflict (permission_key) do update
set permission_name = excluded.permission_name,
    category = excluded.category,
    description = excluded.description,
    active = true,
    updated_at = now();

-- Seed coarse staff permission eligibility. The secured RPCs below additionally
-- require the role of the current validated login alias, so another alias on the
-- same staff identity cannot use these privileged permissions.
insert into public.fc_staff_permissions(staff_id, permission_key, allowed)
select distinct l.staff_id, p.permission_key, true
from public.login_users l
cross join lateral (
  select unnest(
    case
      when regexp_replace(lower(trim(coalesce(l.role, ''))), '[^a-z0-9]+', '', 'g')
             in ('admin', 'superadmin')
        then array['returns.view','returns.approve','returns.reverse','returns.reconcile']::text[]
      when regexp_replace(lower(trim(coalesce(l.role, ''))), '[^a-z0-9]+', '', 'g') = 'warehouse'
        then array['returns.view','returns.approve']::text[]
      else array[]::text[]
    end
  ) as permission_key
) p
where l.active is true and l.staff_id is not null
on conflict (staff_id, permission_key) do update
set allowed = excluded.allowed,
    updated_at = now();

alter table public.customer_returns
  add column if not exists financial_disposition text,
  add column if not exists approval_note text,
  add column if not exists ledger_transaction_id uuid,
  add column if not exists reversal_ledger_transaction_id uuid,
  add column if not exists reversed_by uuid,
  add column if not exists reversed_by_name text,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversal_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_returns_financial_disposition_check'
      and conrelid = 'public.customer_returns'::regclass
  ) then
    alter table public.customer_returns
      add constraint customer_returns_financial_disposition_check
      check (financial_disposition is null or financial_disposition in ('CUSTOMER_CREDIT','NO_CREDIT'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_returns_ledger_transaction_fk'
      and conrelid = 'public.customer_returns'::regclass
  ) then
    alter table public.customer_returns
      add constraint customer_returns_ledger_transaction_fk
      foreign key (ledger_transaction_id) references public.financial_transactions(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_returns_reversal_ledger_transaction_fk'
      and conrelid = 'public.customer_returns'::regclass
  ) then
    alter table public.customer_returns
      add constraint customer_returns_reversal_ledger_transaction_fk
      foreign key (reversal_ledger_transaction_id) references public.financial_transactions(id) on delete restrict;
  end if;
end;
$$;

alter table public.customer_returns drop constraint if exists customer_returns_status_check;
alter table public.customer_returns
  add constraint customer_returns_status_check
  check (status in (
    'Pending Warehouse Confirmation', 'Confirmed', 'Rejected', 'Cancelled', 'Reversed'
  ));

alter table public.customer_ledger
  add column if not exists customer_return_id uuid,
  add column if not exists canonical_financial_transaction_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_ledger_customer_return_fk'
      and conrelid = 'public.customer_ledger'::regclass
  ) then
    alter table public.customer_ledger
      add constraint customer_ledger_customer_return_fk
      foreign key (customer_return_id) references public.customer_returns(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_ledger_return_financial_transaction_fk'
      and conrelid = 'public.customer_ledger'::regclass
  ) then
    alter table public.customer_ledger
      add constraint customer_ledger_return_financial_transaction_fk
      foreign key (canonical_financial_transaction_id) references public.financial_transactions(id) on delete restrict;
  end if;
end;
$$;

create unique index if not exists customer_ledger_one_return_credit_idx
  on public.customer_ledger(customer_return_id)
  where customer_return_id is not null and transaction_type = 'RETURN_CREDIT';

create or replace function public.fc_guard_customer_return_financial_transition_v1()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user in ('anon','authenticated') and (
    new.status is distinct from old.status
    or new.financial_disposition is distinct from old.financial_disposition
    or new.ledger_transaction_id is distinct from old.ledger_transaction_id
    or new.reversal_ledger_transaction_id is distinct from old.reversal_ledger_transaction_id
    or new.reversed_at is distinct from old.reversed_at
  ) then
    raise exception 'Return approval and reversal must use the secured Returns service.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_returns_guard_financial_transition_v1 on public.customer_returns;
create trigger customer_returns_guard_financial_transition_v1
before update on public.customer_returns
for each row execute function public.fc_guard_customer_return_financial_transition_v1();
revoke all on function public.fc_guard_customer_return_financial_transition_v1() from public,anon,authenticated;

create or replace function public.fc_approve_customer_return_v1(
  p_username text,
  p_session_token text,
  p_return_id uuid,
  p_approval_note text,
  p_financial_disposition text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_return public.customer_returns%rowtype;
  v_ledger public.financial_transactions%rowtype;
  v_amount numeric(14,2);
  v_disposition text := upper(trim(coalesce(p_financial_disposition, '')));
  v_legacy_id bigint;
  v_now timestamptz := now();
begin
  select * into v_actor
  from public.fc_require_session_permission(p_username, p_session_token, 'returns.approve');

  if regexp_replace(lower(trim(coalesce(v_actor.staff_role, ''))), '[^a-z0-9]+', '', 'g')
       not in ('admin', 'superadmin', 'warehouse') then
    raise exception 'FC role denied: returns.approve' using errcode = '42501';
  end if;

  if p_return_id is null then raise exception 'Return ID is required.' using errcode = '22023'; end if;
  if v_disposition not in ('CUSTOMER_CREDIT','NO_CREDIT') then
    raise exception 'Select whether this return creates a customer credit.' using errcode = '22023';
  end if;

  select * into v_return
  from public.customer_returns
  where id = p_return_id
  for update;
  if not found then raise exception 'Return not found.' using errcode = 'P0002'; end if;

  if v_return.status = 'Confirmed' then
    if v_return.financial_disposition = 'NO_CREDIT'
       or (v_return.financial_disposition = 'CUSTOMER_CREDIT'
           and v_return.ledger_transaction_id is not null
           and exists (
             select 1 from public.financial_transactions ft
             where ft.id = v_return.ledger_transaction_id
               and ft.source_type = 'CUSTOMER_RETURN'
               and ft.source_id = v_return.id::text
           )) then
      return jsonb_build_object('return', to_jsonb(v_return), 'duplicate', true);
    end if;
    raise exception 'Confirmed return is missing its expected financial effect; reconciliation is required.';
  end if;

  if v_return.status <> 'Pending Warehouse Confirmation' then
    raise exception 'Return status % is not eligible for approval.', v_return.status using errcode = '23514';
  end if;

  v_amount := round(coalesce(v_return.return_total, 0)::numeric, 2);
  if v_disposition = 'CUSTOMER_CREDIT' then
    if v_amount <= 0 then raise exception 'Customer credit amount must be greater than zero.' using errcode = '23514'; end if;
    if v_return.customer_account_id is null then raise exception 'Customer account is required for return credit.' using errcode = '23502'; end if;

    insert into public.financial_transactions(
      source_type, source_id, transaction_type, customer_account_id,
      customer_branch_id, transaction_date, amount, debit_amount, credit_amount,
      payment_method, reference, description, staff_id, staff_name, status,
      metadata, created_by, created_at, updated_at
    ) values (
      'CUSTOMER_RETURN', v_return.id::text, 'CREDIT', v_return.customer_account_id,
      coalesce(v_return.customer_branch_id, v_return.branch_id), v_now,
      v_amount, 0, v_amount, 'Return Credit', v_return.return_number,
      'Customer Return - ' || coalesce(v_return.return_type, 'Return'),
      v_actor.staff_id, v_actor.staff_name, 'ACTIVE',
      jsonb_build_object(
        'transaction_subtype','CREDIT_NOTE', 'raw_type','RETURN_CREDIT',
        'return_id',v_return.id, 'return_number',v_return.return_number,
        'order_id',v_return.order_id, 'order_number',v_return.order_number,
        'customer_account_id',v_return.customer_account_id,
        'customer_branch_id',coalesce(v_return.customer_branch_id,v_return.branch_id),
        'return_type',v_return.return_type, 'approved_amount',v_amount,
        'approved_quantity',v_return.total_qty, 'approved_by_staff_id',v_actor.staff_id,
        'approved_by',v_actor.username, 'approved_at',v_now,
        'approval_note',nullif(trim(coalesce(p_approval_note,'')),'')
      ), v_actor.username, v_now, v_now
    )
    on conflict (source_type, source_id) do nothing
    returning * into v_ledger;

    if v_ledger.id is null then
      select * into v_ledger from public.financial_transactions
      where source_type = 'CUSTOMER_RETURN' and source_id = v_return.id::text
      for update;
      if v_ledger.transaction_type <> 'CREDIT'
         or v_ledger.customer_account_id is distinct from v_return.customer_account_id
         or v_ledger.customer_branch_id is distinct from coalesce(v_return.customer_branch_id,v_return.branch_id)
         or v_ledger.amount <> v_amount or v_ledger.credit_amount <> v_amount then
        raise exception 'Existing return ledger effect conflicts with this approval.';
      end if;
    else
      insert into public.financial_ledger_events(transaction_id,event_type,actor,reason,event_data)
      values (v_ledger.id,'CREATE',v_actor.username,'Approved customer return',
        jsonb_build_object('source_type','CUSTOMER_RETURN','source_id',v_return.id,'amount',v_amount,'direction','CREDIT'))
      on conflict do nothing;
    end if;

    insert into public.customer_ledger(
      customer_account_id, customer_branch_id, branch_id, branch_name, customer_name,
      entry_type, transaction_type, reference_no, order_number, debit, credit, amount,
      payment_amount, payment_type, payment_method, payment_applies_to,
      collection_source, received_by, received_by_role, confirmed_by, notes,
      payment_status, source, payment_date, customer_return_id,
      canonical_financial_transaction_id, updated_at
    ) values (
      v_return.customer_account_id, coalesce(v_return.customer_branch_id,v_return.branch_id),
      coalesce(v_return.branch_id,v_return.customer_branch_id), v_return.branch_name,
      v_return.customer_name, 'PAYMENT', 'RETURN_CREDIT', v_return.return_number,
      v_return.order_number, 0, v_amount, v_amount, v_amount, 'Return Credit',
      'Return Credit', 'RETURN', 'SECURE_RETURN_APPROVAL', v_actor.staff_name,
      v_actor.staff_role, v_actor.username,
      'Temporary Customer Credit compatibility row for canonical return ' || v_return.id::text,
      'POSTED', 'CUSTOMER_RETURN_COMPATIBILITY', v_now, v_return.id, v_ledger.id, v_now
    )
    on conflict (customer_return_id) where customer_return_id is not null and transaction_type = 'RETURN_CREDIT'
    do nothing
    returning id into v_legacy_id;

    if v_legacy_id is null and not exists (
      select 1 from public.customer_ledger cl
      where cl.customer_return_id = v_return.id and cl.transaction_type = 'RETURN_CREDIT'
        and cl.customer_account_id = v_return.customer_account_id
        and cl.credit = v_amount and cl.canonical_financial_transaction_id = v_ledger.id
    ) then
      raise exception 'Existing legacy return credit conflicts with canonical approval.';
    end if;
  end if;

  update public.customer_returns
  set status = 'Confirmed', financial_disposition = v_disposition,
      approval_note = nullif(trim(coalesce(p_approval_note,'')),''),
      confirmed_by = v_actor.staff_id, confirmed_by_name = v_actor.staff_name,
      confirmed_by_role = v_actor.staff_role, confirmed_at = v_now,
      ledger_transaction_id = case when v_disposition='CUSTOMER_CREDIT' then v_ledger.id else null end
  where id = v_return.id
  returning * into v_return;

  insert into public.financial_audit_log(
    action, entity_type, entity_id, customer_account_id, customer_branch_id,
    reason, before_data, after_data, changed_by, changed_at
  ) values (
    'APPROVE','CUSTOMER_RETURN',v_return.id::text,v_return.customer_account_id,
    coalesce(v_return.customer_branch_id,v_return.branch_id),p_approval_note,
    jsonb_build_object('status','Pending Warehouse Confirmation'),
    jsonb_build_object('return_id',v_return.id,'return_number',v_return.return_number,
      'status',v_return.status,'financial_disposition',v_disposition,'amount',v_amount,
      'qty',v_return.total_qty,'return_type',v_return.return_type,'actor_staff_id',v_actor.staff_id),
    v_actor.username,v_now
  );

  return jsonb_build_object('return',to_jsonb(v_return),'financial_transaction',to_jsonb(v_ledger),'duplicate',false);
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
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_return public.customer_returns%rowtype;
  v_original public.financial_transactions%rowtype;
  v_reversal public.financial_transactions%rowtype;
  v_reason text := nullif(trim(coalesce(p_reason,'')),'');
  v_now timestamptz := now();
begin
  select * into v_actor
  from public.fc_require_session_permission(p_username,p_session_token,'returns.reverse');
  if regexp_replace(lower(trim(coalesce(v_actor.staff_role, ''))), '[^a-z0-9]+', '', 'g')
       not in ('admin', 'superadmin') then
    raise exception 'FC role denied: returns.reverse' using errcode='42501';
  end if;
  if v_reason is null then raise exception 'Reversal reason is required.' using errcode='22023'; end if;

  select * into v_return from public.customer_returns where id=p_return_id for update;
  if not found then raise exception 'Return not found.' using errcode='P0002'; end if;
  if v_return.status = 'Reversed' then raise exception 'Return approval has already been reversed.' using errcode='23514'; end if;
  if v_return.status <> 'Confirmed' then raise exception 'Only a confirmed return can be reversed.' using errcode='23514'; end if;

  if v_return.financial_disposition = 'CUSTOMER_CREDIT' then
    select * into v_original from public.financial_transactions
    where source_type='CUSTOMER_RETURN' and source_id=v_return.id::text for update;
    if not found or v_original.id is distinct from v_return.ledger_transaction_id then
      raise exception 'Original canonical return credit is missing; reconciliation is required.';
    end if;

    insert into public.financial_transactions(
      source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
      transaction_date,amount,debit_amount,credit_amount,payment_method,reference,
      description,staff_id,staff_name,status,metadata,created_by,created_at,updated_at
    ) values (
      'CUSTOMER_RETURN_REVERSAL',v_return.id::text,'ADJUSTMENT',v_original.customer_account_id,
      v_original.customer_branch_id,v_now,v_original.amount,v_original.amount,0,
      'Return Reversal',v_return.return_number,
      'Reversal - Customer Return - '||coalesce(v_return.return_type,'Return'),
      v_actor.staff_id,v_actor.staff_name,'ACTIVE',
      jsonb_build_object('direction','DEBIT','return_id',v_return.id,
        'original_transaction_id',v_original.id,'reversal_reason',v_reason,
        'reversed_by_staff_id',v_actor.staff_id,'reversed_by',v_actor.username),
      v_actor.username,v_now,v_now
    )
    on conflict (source_type,source_id) do nothing
    returning * into v_reversal;

    if v_reversal.id is null then
      raise exception 'A reversal transaction already exists for this return.' using errcode='23505';
    end if;
    insert into public.financial_ledger_events(transaction_id,event_type,actor,reason,event_data)
    values (v_reversal.id,'CREATE',v_actor.username,v_reason,
      jsonb_build_object('source_type','CUSTOMER_RETURN_REVERSAL','source_id',v_return.id,
        'original_transaction_id',v_original.id,'amount',v_original.amount,'direction','DEBIT'))
    on conflict do nothing;

    update public.customer_ledger
    set payment_status='REVERSED',reversed_at=v_now,reversed_by=v_actor.staff_id,
        reversal_reason=v_reason,updated_at=v_now
    where customer_return_id=v_return.id and transaction_type='RETURN_CREDIT';
  end if;

  update public.customer_returns
  set status='Reversed',reversed_by=v_actor.staff_id,reversed_by_name=v_actor.staff_name,
      reversed_at=v_now,reversal_reason=v_reason,
      reversal_ledger_transaction_id=v_reversal.id
  where id=v_return.id returning * into v_return;

  insert into public.financial_audit_log(
    action,entity_type,entity_id,customer_account_id,customer_branch_id,
    reason,before_data,after_data,changed_by,changed_at
  ) values (
    'REVERSE','CUSTOMER_RETURN',v_return.id::text,v_return.customer_account_id,
    coalesce(v_return.customer_branch_id,v_return.branch_id),v_reason,
    jsonb_build_object('status','Confirmed','ledger_transaction_id',v_return.ledger_transaction_id),
    jsonb_build_object('status','Reversed','reversal_transaction_id',v_reversal.id,
      'actor_staff_id',v_actor.staff_id),v_actor.username,v_now
  );
  return jsonb_build_object('return',to_jsonb(v_return),'original_transaction',to_jsonb(v_original),
    'reversal_transaction',to_jsonb(v_reversal));
end;
$$;

create or replace function public.fc_list_customer_return_reconciliation_v1(
  p_username text,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_rows jsonb;
begin
  select * into v_actor
  from public.fc_require_session_permission(p_username,p_session_token,'returns.reconcile');
  if regexp_replace(lower(trim(coalesce(v_actor.staff_role, ''))), '[^a-z0-9]+', '', 'g')
       not in ('admin', 'superadmin') then
    raise exception 'FC role denied: returns.reconcile' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb) into v_rows
  from (
    select r.id,r.return_number,r.customer_name,r.branch_name,r.return_type,r.total_qty,
      r.return_total,r.status,r.financial_disposition,r.created_at,
      count(distinct cl.id) filter (where cl.transaction_type='RETURN_CREDIT') as legacy_credit_count,
      count(distinct ft.id) filter (where ft.source_type='CUSTOMER_RETURN') as global_ledger_count,
      count(distinct rv.id) filter (where rv.source_type='CUSTOMER_RETURN_REVERSAL') as reversal_count,
      case
        when r.financial_disposition='NO_CREDIT' then 'NO_FINANCIAL_EFFECT'
        when r.status='Reversed' and count(distinct rv.id)=1 then 'REVERSED'
        when count(distinct cl.id)>1 or count(distinct ft.id)>1 then 'DUPLICATE_LEDGER'
        when count(*) over(partition by r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),
          r.order_id,r.order_number,r.return_type,r.total_qty,r.return_total)>1 then 'DUPLICATE_RETURN'
        when r.status='Confirmed' and count(distinct cl.id)=1 and count(distinct ft.id)=1 then 'MATCHED'
        when r.status='Confirmed' and count(distinct cl.id)=1 and count(distinct ft.id)=0 then 'LEGACY_CREDIT_ONLY'
        when r.status='Confirmed' and count(distinct ft.id)=0 then 'MISSING_LEDGER'
        else 'NEEDS_REVIEW'
      end as reconciliation_status
    from public.customer_returns r
    left join public.customer_ledger cl on cl.customer_return_id=r.id or
      (cl.customer_return_id is null and cl.reference_no=r.return_number and cl.transaction_type='RETURN_CREDIT')
    left join public.financial_transactions ft on ft.source_type='CUSTOMER_RETURN' and ft.source_id=r.id::text
    left join public.financial_transactions rv on rv.source_type='CUSTOMER_RETURN_REVERSAL' and rv.source_id=r.id::text
    group by r.id
  ) q;
  return v_rows;
end;
$$;

revoke all on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) from public;
revoke all on function public.fc_reverse_customer_return_v1(text,text,uuid,text) from public;
revoke all on function public.fc_list_customer_return_reconciliation_v1(text,text) from public;
grant execute on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) to anon,authenticated;
grant execute on function public.fc_reverse_customer_return_v1(text,text,uuid,text) to anon,authenticated;
grant execute on function public.fc_list_customer_return_reconciliation_v1(text,text) to anon,authenticated;

comment on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) is
  'Atomically approves one pending customer return and posts exactly one canonical credit when selected.';
comment on function public.fc_reverse_customer_return_v1(text,text,uuid,text) is
  'Atomically reverses one approved return without deleting its original financial history.';
comment on function public.fc_list_customer_return_reconciliation_v1(text,text) is
  'Read-only owner/admin reconciliation of customer returns against legacy and canonical financial effects.';

notify pgrst, 'reload schema';
commit;
