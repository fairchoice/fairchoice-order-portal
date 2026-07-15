-- Central Payment final lifecycle, archive, audit, FIFO and access controls.

create extension if not exists pgcrypto;

alter table public.customer_payments
  add column if not exists edited_at timestamptz null,
  add column if not exists edited_by text null,
  add column if not exists edit_reason text null;

create table if not exists public.central_payment_archive (
  payment_id uuid primary key references public.customer_payments(id) on delete cascade,
  customer_account_id uuid not null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  payment_snapshot jsonb not null,
  removed_reason text not null,
  removed_by text not null,
  removed_at timestamptz not null default now(),
  restored_reason text null,
  restored_by text null,
  restored_at timestamptz null
);

create index if not exists central_payment_archive_customer_idx
  on public.central_payment_archive(customer_account_id, customer_branch_id, removed_at desc);

create table if not exists public.central_payment_lifecycle_audit (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid null,
  payment_reference text null,
  customer_account_id uuid null references public.customer_accounts(id) on delete restrict,
  customer_branch_id uuid null references public.customer_branches(id) on delete restrict,
  action text not null check (action in ('CREATED','CONFIRMED','EDITED','REMOVED','RESTORED','PERMANENTLY_DELETED')),
  reason text not null,
  before_data jsonb null,
  after_data jsonb null,
  changed_by text not null,
  changed_at timestamptz not null default now()
);

create index if not exists central_payment_lifecycle_audit_customer_idx
  on public.central_payment_lifecycle_audit(customer_account_id, customer_branch_id, changed_at desc);

create table if not exists public.central_payment_balances (
  scope_key text primary key,
  customer_account_id uuid not null references public.customer_accounts(id) on delete cascade,
  customer_branch_id uuid null references public.customer_branches(id) on delete cascade,
  opening_balance numeric(14,2) not null default 0,
  invoice_total numeric(14,2) not null default 0,
  payment_total numeric(14,2) not null default 0,
  outstanding_balance numeric(14,2) not null default 0,
  recalculated_at timestamptz not null default now()
);

alter table public.central_payment_archive enable row level security;
alter table public.central_payment_lifecycle_audit enable row level security;
alter table public.central_payment_balances enable row level security;

create or replace function public.central_payment_is_nisstaj_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.login_users u
    where lower(trim(u.username)) = 'nisstaj_admin'
      and coalesce(u.active, true)
      and (
        lower(trim(coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'username', ''))) = 'nisstaj_admin'
        or lower(trim(coalesce((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'email', ''))) = lower(trim(coalesce(to_jsonb(u)->>'email', '')))
      )
  );
$$;

create or replace function public.central_payment_require_admin_credentials(
  p_admin_username text,
  p_admin_password text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(trim(coalesce(p_admin_username, ''))) <> 'nisstaj_admin'
     or nullif(coalesce(p_admin_password, ''), '') is null
     or not exists (
       select 1 from public.login_users
       where lower(trim(username)) = 'nisstaj_admin'
         and password = p_admin_password
         and coalesce(active, true)
     ) then
    raise exception 'nisstaj_admin authorisation failed.' using errcode = '42501';
  end if;
  return 'nisstaj_admin';
end;
$$;

drop policy if exists central_payment_archive_admin_select on public.central_payment_archive;
create policy central_payment_archive_admin_select on public.central_payment_archive
  for select to authenticated using (public.central_payment_is_nisstaj_admin());
drop policy if exists central_payment_lifecycle_audit_admin_select on public.central_payment_lifecycle_audit;
create policy central_payment_lifecycle_audit_admin_select on public.central_payment_lifecycle_audit
  for select to authenticated using (public.central_payment_is_nisstaj_admin());
drop policy if exists central_payment_balances_admin_select on public.central_payment_balances;
create policy central_payment_balances_admin_select on public.central_payment_balances
  for select to authenticated using (public.central_payment_is_nisstaj_admin());

create or replace function public.recalculate_central_payment_fifo(p_customer_account_id uuid)
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
begin
  perform 1 from public.customer_accounts where id = p_customer_account_id for update;
  if not found then raise exception 'Customer account does not exist.'; end if;

  perform id from public.customer_payments
    where customer_account_id = p_customer_account_id for update;
  perform id from public.customer_invoices
    where customer_account_id = p_customer_account_id for update;

  delete from public.customer_payment_allocations
    where customer_account_id = p_customer_account_id;

  for v_payment in
    select p.*
    from public.customer_payments p
    where p.customer_account_id = p_customer_account_id
      and p.status = 'POSTED'
      and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED'
      and not exists (select 1 from public.central_payment_archive a where a.payment_id = p.id)
    order by p.payment_date, p.created_at, p.payment_reference, p.id
  loop
    v_remaining := round(v_payment.amount, 2);
    for v_invoice in
      select i.*
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id
        and i.status <> 'CANCELLED'
        and (v_payment.customer_branch_id is null or i.customer_branch_id = v_payment.customer_branch_id)
      order by i.invoice_date, i.invoice_number, i.id
    loop
      exit when v_remaining <= 0;
      select greatest(0, round(v_invoice.invoice_total - coalesce(sum(a.allocated_amount), 0), 2))
        into v_invoice_remaining
      from public.customer_payment_allocations a
      where a.customer_account_id = p_customer_account_id
        and a.invoice_reference = v_invoice.invoice_number
        and a.status = 'active';
      v_allocate := least(v_remaining, v_invoice_remaining);
      if v_allocate > 0 then
        insert into public.customer_payment_allocations(
          payment_id, customer_account_id, customer_branch_id, invoice_reference,
          invoice_source_id, allocated_amount, allocation_type, status, created_by
        ) values (
          v_payment.id, p_customer_account_id, v_invoice.customer_branch_id,
          v_invoice.invoice_number, v_invoice.id::text, v_allocate, 'rebuild', 'active', 'nisstaj_admin'
        );
        v_remaining := round(v_remaining - v_allocate, 2);
      end if;
    end loop;
  end loop;

  delete from public.central_payment_balances where customer_account_id = p_customer_account_id;
  insert into public.central_payment_balances(
    scope_key, customer_account_id, customer_branch_id, opening_balance,
    invoice_total, payment_total, outstanding_balance, recalculated_at
  )
  select
    p_customer_account_id::text || ':ALL', p_customer_account_id, null,
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0),
    coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0),
    coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0)
      + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and status <> 'CANCELLED'), 0)
      - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
    now();

  for v_branch in select id from public.customer_branches where customer_account_id = p_customer_account_id
  loop
    insert into public.central_payment_balances(
      scope_key, customer_account_id, customer_branch_id, opening_balance,
      invoice_total, payment_total, outstanding_balance, recalculated_at
    )
    select
      p_customer_account_id::text || ':' || v_branch.id::text, p_customer_account_id, v_branch.id,
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0),
      coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0),
      coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id), 0)
        + coalesce((select sum(invoice_total) from public.customer_invoices where customer_account_id = p_customer_account_id and customer_branch_id = v_branch.id and status <> 'CANCELLED'), 0)
        - coalesce((select sum(p.amount) from public.customer_payments p where p.customer_account_id = p_customer_account_id and p.customer_branch_id = v_branch.id and p.status = 'POSTED' and coalesce(p.verification_status, 'CONFIRMED') = 'CONFIRMED' and not exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)), 0),
      now();
  end loop;
end;
$$;

-- Retire the separate Owner Financial Security setup and its password store.
drop function if exists public.setup_owner_financial_password(text,text,text);
drop function if exists public.change_owner_financial_password(text,text,text);
drop function if exists public.owner_financial_security_status(text);
drop function if exists public.delete_owner_central_payment(text,text,uuid,text);
drop function if exists public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb);
drop function if exists public.confirm_owner_bank_transfer(text,text,uuid,text,jsonb);
drop function if exists public.verify_owner_financial_password(text,text);
drop table if exists public.owner_financial_security;

create or replace function public.list_central_payment_records(
  p_admin_username text, p_admin_password text, p_customer_account_id uuid,
  p_customer_branch_id uuid default null, p_archived boolean default false,
  p_search text default '', p_method text default '', p_date_from date default null,
  p_date_to date default null, p_page integer default 1
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_offset integer; v_total integer; v_rows jsonb;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username, p_admin_password);
  v_offset := greatest(coalesce(p_page, 1) - 1, 0) * 2;
  select count(*) into v_total
  from public.customer_payments p
  where p.customer_account_id = p_customer_account_id
    and (p_customer_branch_id is null or p.customer_branch_id = p_customer_branch_id)
    and (exists(select 1 from public.central_payment_archive a where a.payment_id=p.id)) = p_archived
    and (coalesce(trim(p_search),'')='' or p.payment_reference ilike '%'||trim(p_search)||'%' or coalesce(p.paid_by,'') ilike '%'||trim(p_search)||'%' or coalesce(p.notes,'') ilike '%'||trim(p_search)||'%')
    and (coalesce(trim(p_method),'')='' or p.payment_method=p_method)
    and (p_date_from is null or p.payment_date::date >= p_date_from)
    and (p_date_to is null or p.payment_date::date <= p_date_to);

  select coalesce(jsonb_agg(row_data order by payment_date desc, created_at desc), '[]'::jsonb) into v_rows
  from (
    select to_jsonb(p) || jsonb_build_object(
      'archived', p_archived,
      'removed_reason', a.removed_reason,
      'removed_by', a.removed_by,
      'removed_at', a.removed_at
    ) as row_data, p.payment_date, p.created_at
    from public.customer_payments p
    left join public.central_payment_archive a on a.payment_id=p.id
    where p.customer_account_id = p_customer_account_id
      and (p_customer_branch_id is null or p.customer_branch_id = p_customer_branch_id)
      and (a.payment_id is not null) = p_archived
      and (coalesce(trim(p_search),'')='' or p.payment_reference ilike '%'||trim(p_search)||'%' or coalesce(p.paid_by,'') ilike '%'||trim(p_search)||'%' or coalesce(p.notes,'') ilike '%'||trim(p_search)||'%')
      and (coalesce(trim(p_method),'')='' or p.payment_method=p_method)
      and (p_date_from is null or p.payment_date::date >= p_date_from)
      and (p_date_to is null or p.payment_date::date <= p_date_to)
    order by p.payment_date desc, p.created_at desc
    limit 2 offset v_offset
  ) q;
  return jsonb_build_object('records',v_rows,'total',v_total,'page',greatest(coalesce(p_page,1),1),'page_size',2,'total_pages',greatest(1,ceil(v_total/2.0)::integer));
end;
$$;

create or replace function public.post_owner_central_transaction(
  p_owner_username text, p_owner_password text, p_customer_account_id uuid, p_customer_branch_id uuid,
  p_transaction_type text, p_payment_date timestamptz, p_amount numeric, p_payment_method text,
  p_paid_by text, p_external_reference text, p_notes text, p_idempotency_key text,
  p_allocations jsonb default '[]'::jsonb
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payment public.customer_payments%rowtype; v_status text; v_reference text; v_existing public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  if p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  if upper(p_transaction_type) not in ('PAYMENT','DISCOUNT') then raise exception 'Invalid transaction type.'; end if;
  if upper(p_transaction_type)='DISCOUNT' and nullif(trim(coalesce(p_notes,'')),'') is null then raise exception 'A detailed discount reason is compulsory.'; end if;
  select * into v_existing from public.customer_payments where customer_account_id=p_customer_account_id and coalesce(customer_branch_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_customer_branch_id,'00000000-0000-0000-0000-000000000000'::uuid) and idempotency_key=p_idempotency_key and not exists(select 1 from public.central_payment_archive a where a.payment_id=customer_payments.id) limit 1;
  if found then return jsonb_build_object('duplicate',true,'payment',to_jsonb(v_existing),'allocations','[]'::jsonb); end if;
  v_status := case when upper(p_transaction_type)='PAYMENT' and p_payment_method='Bank Transfer' then 'PENDING_VERIFICATION' else 'CONFIRMED' end;
  v_reference := coalesce(nullif(trim(p_external_reference),''),'PAY-'||to_char(coalesce(p_payment_date,now()),'YYYYMMDD')||'-'||lpad(nextval('public.central_payment_reference_seq')::text,6,'0'));
  insert into public.customer_payments(customer_account_id,customer_branch_id,payment_reference,payment_date,amount,payment_method,paid_by,notes,source,idempotency_key,status,created_by,transaction_type,verification_status,verified_by,verified_at,mandatory_reason,collector_role)
  values(p_customer_account_id,p_customer_branch_id,v_reference,coalesce(p_payment_date,now()),round(p_amount,2),case when upper(p_transaction_type)='DISCOUNT' then 'Other' else p_payment_method end,p_paid_by,p_notes,'CENTRAL_PAYMENT',p_idempotency_key,'POSTED','nisstaj_admin',upper(p_transaction_type),v_status,case when v_status='CONFIRMED' then 'nisstaj_admin' end,case when v_status='CONFIRMED' then now() end,case when upper(p_transaction_type)='DISCOUNT' then p_notes end,'OWNER') returning * into v_payment;
  perform public.recalculate_central_payment_fifo(p_customer_account_id);
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,after_data,changed_by) values(v_payment.id,v_payment.payment_reference,v_payment.customer_account_id,v_payment.customer_branch_id,'CREATED',coalesce(nullif(trim(p_notes),''),'Manual payment created'),to_jsonb(v_payment),'nisstaj_admin');
  return jsonb_build_object('duplicate',false,'payment',to_jsonb(v_payment),'verification_status',v_status);
end;
$$;

create or replace function public.edit_central_payment(
  p_admin_username text,p_admin_password text,p_payment_id uuid,p_payment_date timestamptz,
  p_amount numeric,p_payment_method text,p_paid_by text,p_external_reference text,p_notes text,p_reason text
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_before public.customer_payments%rowtype; v_after public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username,p_admin_password);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Edit reason is required.'; end if;
  if p_amount <= 0 then raise exception 'Amount must be greater than zero.'; end if;
  select * into v_before from public.customer_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment does not exist.'; end if;
  if exists(select 1 from public.central_payment_archive where payment_id=p_payment_id) then raise exception 'Archived payments must be restored before editing.'; end if;
  update public.customer_payments set payment_date=coalesce(p_payment_date,payment_date),amount=round(p_amount,2),payment_method=p_payment_method,paid_by=p_paid_by,payment_reference=coalesce(nullif(trim(p_external_reference),''),payment_reference),notes=p_notes,edited_at=now(),edited_by='nisstaj_admin',edit_reason=trim(p_reason),updated_at=now() where id=p_payment_id returning * into v_after;
  perform public.recalculate_central_payment_fifo(v_before.customer_account_id);
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,before_data,after_data,changed_by) values(v_after.id,v_after.payment_reference,v_after.customer_account_id,v_after.customer_branch_id,'EDITED',trim(p_reason),to_jsonb(v_before),to_jsonb(v_after),'nisstaj_admin');
  return to_jsonb(v_after);
end;
$$;

create or replace function public.remove_central_payment(p_admin_username text,p_admin_password text,p_payment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_before public.customer_payments%rowtype; v_after public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username,p_admin_password);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Removal reason is required.'; end if;
  select * into v_before from public.customer_payments where id=p_payment_id for update;
  if not found then raise exception 'Payment does not exist.'; end if;
  if exists(select 1 from public.central_payment_archive where payment_id=p_payment_id) then raise exception 'Payment is already archived.'; end if;
  insert into public.central_payment_archive(payment_id,customer_account_id,customer_branch_id,payment_snapshot,removed_reason,removed_by) values(v_before.id,v_before.customer_account_id,v_before.customer_branch_id,to_jsonb(v_before),trim(p_reason),'nisstaj_admin');
  update public.customer_payments set status='VOIDED',verification_status='VOIDED',void_reason=trim(p_reason),voided_by='nisstaj_admin',voided_at=now(),updated_at=now() where id=p_payment_id returning * into v_after;
  perform public.recalculate_central_payment_fifo(v_before.customer_account_id);
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,before_data,after_data,changed_by) values(v_before.id,v_before.payment_reference,v_before.customer_account_id,v_before.customer_branch_id,'REMOVED',trim(p_reason),to_jsonb(v_before),to_jsonb(v_after),'nisstaj_admin');
  return to_jsonb(v_after);
end;
$$;

create or replace function public.restore_central_payment(p_admin_username text,p_admin_password text,p_payment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_archive public.central_payment_archive%rowtype; v_before public.customer_payments%rowtype; v_after public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username,p_admin_password);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Restore reason is required.'; end if;
  select * into v_archive from public.central_payment_archive where payment_id=p_payment_id for update;
  if not found then raise exception 'Archived payment does not exist.'; end if;
  select * into v_before from public.customer_payments where id=p_payment_id for update;
  update public.central_payment_archive set restored_reason=trim(p_reason),restored_by='nisstaj_admin',restored_at=now() where payment_id=p_payment_id;
  update public.customer_payments set status='POSTED',verification_status=case when payment_method='Bank Transfer' and verified_at is null then 'PENDING_VERIFICATION' else 'CONFIRMED' end,void_reason=null,voided_by=null,voided_at=null,updated_at=now() where id=p_payment_id returning * into v_after;
  delete from public.central_payment_archive where payment_id=p_payment_id;
  perform public.recalculate_central_payment_fifo(v_after.customer_account_id);
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,before_data,after_data,changed_by) values(v_after.id,v_after.payment_reference,v_after.customer_account_id,v_after.customer_branch_id,'RESTORED',trim(p_reason),to_jsonb(v_before),to_jsonb(v_after),'nisstaj_admin');
  return to_jsonb(v_after);
end;
$$;

create or replace function public.permanently_delete_central_payment(p_admin_username text,p_admin_password text,p_payment_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_payment public.customer_payments%rowtype; v_archive public.central_payment_archive%rowtype; v_snapshot jsonb;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username,p_admin_password);
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Permanent deletion reason is required.'; end if;
  select * into v_archive from public.central_payment_archive where payment_id=p_payment_id for update;
  if not found then raise exception 'Active payments can never be permanently deleted. Remove the payment to the archive first.'; end if;
  select * into v_payment from public.customer_payments where id=p_payment_id for update;
  v_snapshot := jsonb_build_object('payment',to_jsonb(v_payment),'archive',to_jsonb(v_archive),'allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.customer_payment_allocations a where a.payment_id=p_payment_id),'[]'::jsonb));
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,before_data,changed_by) values(v_payment.id,v_payment.payment_reference,v_payment.customer_account_id,v_payment.customer_branch_id,'PERMANENTLY_DELETED',trim(p_reason),v_snapshot,'nisstaj_admin');
  delete from public.customer_payment_allocations where payment_id=p_payment_id;
  delete from public.central_payment_archive where payment_id=p_payment_id;
  delete from public.customer_payments where id=p_payment_id;
  perform public.recalculate_central_payment_fifo(v_payment.customer_account_id);
  return jsonb_build_object('deleted',true,'payment_id',p_payment_id);
end;
$$;

create or replace function public.confirm_owner_bank_transfer(p_owner_username text,p_owner_password text,p_payment_id uuid,p_note text,p_allocations jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare v_before public.customer_payments%rowtype; v_after public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  if nullif(trim(coalesce(p_note,'')),'') is null then raise exception 'Bank confirmation note is compulsory.'; end if;
  select * into v_before from public.customer_payments where id=p_payment_id and payment_method='Bank Transfer' for update;
  if not found or v_before.verification_status <> 'PENDING_VERIFICATION' then raise exception 'Pending bank transfer was not found.'; end if;
  if exists(select 1 from public.central_payment_archive where payment_id=p_payment_id) then raise exception 'Archived bank transfers cannot be confirmed.'; end if;
  update public.customer_payments set verification_status='CONFIRMED',verified_by='nisstaj_admin',verified_at=now(),notes=concat_ws(E'\n',notes,'Bank confirmation: '||trim(p_note)),updated_at=now() where id=p_payment_id returning * into v_after;
  perform public.recalculate_central_payment_fifo(v_after.customer_account_id);
  insert into public.central_payment_lifecycle_audit(payment_id,payment_reference,customer_account_id,customer_branch_id,action,reason,before_data,after_data,changed_by) values(v_after.id,v_after.payment_reference,v_after.customer_account_id,v_after.customer_branch_id,'CONFIRMED',trim(p_note),to_jsonb(v_before),to_jsonb(v_after),'nisstaj_admin');
  return to_jsonb(v_after);
end;
$$;

revoke all on table public.central_payment_archive, public.central_payment_lifecycle_audit, public.central_payment_balances from anon, authenticated;
grant select on table public.central_payment_archive, public.central_payment_lifecycle_audit, public.central_payment_balances to authenticated;
revoke insert, update, delete on table public.customer_payments, public.customer_payment_allocations from anon, authenticated;
revoke all on function public.central_payment_require_admin_credentials(text,text), public.recalculate_central_payment_fifo(uuid) from public;

grant execute on function public.list_central_payment_records(text,text,uuid,uuid,boolean,text,text,date,date,integer) to anon, authenticated;
grant execute on function public.post_owner_central_transaction(text,text,uuid,uuid,text,timestamptz,numeric,text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.confirm_owner_bank_transfer(text,text,uuid,text,jsonb) to anon, authenticated;
grant execute on function public.edit_central_payment(text,text,uuid,timestamptz,numeric,text,text,text,text,text) to anon, authenticated;
grant execute on function public.remove_central_payment(text,text,uuid,text) to anon, authenticated;
grant execute on function public.restore_central_payment(text,text,uuid,text) to anon, authenticated;
grant execute on function public.permanently_delete_central_payment(text,text,uuid,text) to anon, authenticated;
