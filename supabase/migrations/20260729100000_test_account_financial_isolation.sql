-- Test-account isolation and audit-safe cleanup.
-- This migration installs the schema and secure RPC only. It does not mark,
-- void, archive, delete, or otherwise change any existing customer transaction.

create extension if not exists pgcrypto;

alter table public.customer_accounts
  add column if not exists is_test_account boolean not null default false;

comment on column public.customer_accounts.is_test_account is
  'Excludes confirmed test accounts from financial and collection reporting by default.';

create table if not exists public.test_transaction_cleanup_archive (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_record_id text not null,
  customer_account_id uuid not null,
  record_snapshot jsonb not null,
  cleanup_reason text not null,
  archived_at timestamptz not null default now(),
  archived_by text not null,
  cleanup_batch_id uuid not null,
  unique (source_table, source_record_id, cleanup_reason)
);

comment on table public.test_transaction_cleanup_archive is
  'Permanent audit archive of removed test transactions. DO NOT DELETE.';

revoke all on public.test_transaction_cleanup_archive from anon, authenticated;

insert into public.fc_permissions(
  permission_key, permission_name, category, description
)
values (
  'customer_accounts.cleanup_test_data',
  'Cleanup confirmed test-account data',
  'Customer Accounts',
  'Archive and void transactions for an explicitly confirmed test account.'
)
on conflict (permission_key) do update set
  permission_name = excluded.permission_name,
  category = excluded.category,
  description = excluded.description,
  active = true,
  updated_at = now();

create or replace view public.v_reportable_total_collection_payments
with (security_invoker = true)
as
select payment.*
from public.v_total_collection_payments payment
join public.customer_accounts account
  on account.id = payment.customer_account_id
where coalesce(account.is_test_account, false) = false;

comment on view public.v_reportable_total_collection_payments is
  'Default Total Collection read model. Excludes customer accounts explicitly flagged as test accounts.';

revoke all on public.v_reportable_total_collection_payments from anon, authenticated;
grant select on public.v_reportable_total_collection_payments to anon, authenticated;

create or replace function public.prevent_duplicate_legacy_order_payment_import_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if upper(coalesce(new.source, '')) = 'LEGACY_CUSTOMER_LEDGER'
     and upper(trim(coalesce(new.payment_reference, ''))) like 'ORD-%'
     and exists (
       select 1
       from public.customer_payments existing
       where existing.customer_account_id = new.customer_account_id
         and coalesce(existing.customer_branch_id, existing.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(new.customer_branch_id, new.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and upper(trim(existing.payment_reference)) =
             upper(trim(new.payment_reference))
         and existing.amount = new.amount
         and existing.payment_date::date = new.payment_date::date
         and upper(coalesce(existing.status, '')) in ('POSTED', 'ACTIVE')
     ) then
    raise exception
      'Duplicate legacy order payment import blocked for customer %, reference %, amount %.',
      new.customer_account_id, new.payment_reference, new.amount
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_duplicate_legacy_order_payment_import
  on public.customer_payments;
create trigger prevent_duplicate_legacy_order_payment_import
before insert on public.customer_payments
for each row
execute function public.prevent_duplicate_legacy_order_payment_import_v1();

create or replace function public.cleanup_test_customer_transactions_v1(
  p_username text,
  p_session_token text,
  p_customer_account_id uuid,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_account public.customer_accounts%rowtype;
  v_reason constant text := 'Removal of confirmed Test Shop data';
  v_batch_id uuid := gen_random_uuid();
  v_payment_count integer := 0;
  v_payment_total numeric := 0;
  v_invoice_count integer := 0;
  v_invoice_total numeric := 0;
  v_ledger_count integer := 0;
  v_order_count integer := 0;
  v_order_item_count integer := 0;
  v_allocation_count integer := 0;
  v_opening_count integer := 0;
  v_processing_count integer := 0;
  v_rows_changed integer := 0;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_accounts.cleanup_test_data'
  )
  limit 1;

  select * into v_account
  from public.customer_accounts
  where id = p_customer_account_id
  for update;

  if not found then
    raise exception 'Customer account was not found.' using errcode = 'P0002';
  end if;

  if coalesce(v_account.is_test_account, false) = false
     and lower(trim(v_account.account_name)) <> 'test shop' then
    raise exception
      'Cleanup is restricted to an already flagged test account or the explicitly confirmed Test Shop account.'
      using errcode = '42501';
  end if;

  select count(*), coalesce(sum(amount), 0)
    into v_payment_count, v_payment_total
  from public.customer_payments
  where customer_account_id = p_customer_account_id
    and upper(coalesce(status, '')) in ('POSTED', 'ACTIVE')
    and upper(coalesce(verification_status, 'CONFIRMED')) in ('CONFIRMED', 'NOT_REQUIRED');

  select count(*)
    into v_ledger_count
  from public.customer_ledger
  where customer_account_id = p_customer_account_id;

  select
    count(*),
    coalesce(sum(coalesce(nullif(debit, 0), nullif(invoice_total, 0), nullif(amount, 0), 0)), 0)
    into v_invoice_count, v_invoice_total
  from public.customer_ledger
  where customer_account_id = p_customer_account_id
    and upper(coalesce(entry_type, transaction_type, '')) = 'INVOICE';

  select count(*) into v_order_count
  from public.orders where customer_account_id = p_customer_account_id;

  select count(*) into v_order_item_count
  from public.order_items item
  join public.orders customer_order on customer_order.id = item.order_id
  where customer_order.customer_account_id = p_customer_account_id;

  select count(*) into v_allocation_count
  from public.customer_payment_allocations
  where customer_account_id = p_customer_account_id
    and upper(coalesce(status, 'ACTIVE')) not in ('VOID', 'VOIDED', 'REVERSED', 'INACTIVE');

  select count(*) into v_opening_count
  from public.customer_branch_opening_balances
  where customer_account_id = p_customer_account_id;

  select count(*) into v_processing_count
  from public.processing_queue
  where customer_account_id = p_customer_account_id;

  if not p_apply then
    return jsonb_build_object(
      'dry_run', true,
      'customer_account_id', p_customer_account_id,
      'customer_name', v_account.account_name,
      'records_to_archive',
        v_payment_count + v_ledger_count + v_order_count + v_order_item_count + v_allocation_count
        + v_opening_count + v_processing_count,
      'records_to_void', v_payment_count,
      'records_to_delete', 0,
      'payment_count_reduction', v_payment_count,
      'collection_total_reduction', v_payment_total,
      'invoice_count', v_invoice_count,
      'invoice_total', v_invoice_total,
      'active_balance_effect',
        coalesce((select sum(opening_balance) from public.customer_branch_opening_balances where customer_account_id = p_customer_account_id), 0)
        + v_invoice_total - v_payment_total,
      'order_count', v_order_count,
      'order_item_count', v_order_item_count,
      'ledger_count', v_ledger_count,
      'allocation_count', v_allocation_count,
      'opening_balance_count', v_opening_count,
      'processing_queue_count', v_processing_count
    );
  end if;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'customer_payments', p.id::text, p_customer_account_id, to_jsonb(p),
    v_reason, v_actor.username, v_batch_id
  from public.customer_payments p
  where p.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'customer_ledger', l.id::text, p_customer_account_id, to_jsonb(l),
    v_reason, v_actor.username, v_batch_id
  from public.customer_ledger l
  where l.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'orders', o.id::text, p_customer_account_id, to_jsonb(o),
    v_reason, v_actor.username, v_batch_id
  from public.orders o
  where o.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'order_items', item.id::text, p_customer_account_id, to_jsonb(item),
    v_reason, v_actor.username, v_batch_id
  from public.order_items item
  join public.orders o on o.id = item.order_id
  where o.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'customer_payment_allocations', allocation.id::text,
    p_customer_account_id, to_jsonb(allocation), v_reason, v_actor.username, v_batch_id
  from public.customer_payment_allocations allocation
  where allocation.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'customer_branch_opening_balances', opening.id::text,
    p_customer_account_id, to_jsonb(opening), v_reason, v_actor.username, v_batch_id
  from public.customer_branch_opening_balances opening
  where opening.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  insert into public.test_transaction_cleanup_archive(
    source_table, source_record_id, customer_account_id, record_snapshot,
    cleanup_reason, archived_by, cleanup_batch_id
  )
  select 'processing_queue', queue.id::text, p_customer_account_id,
    to_jsonb(queue), v_reason, v_actor.username, v_batch_id
  from public.processing_queue queue
  where queue.customer_account_id = p_customer_account_id
  on conflict (source_table, source_record_id, cleanup_reason) do nothing;

  update public.customer_accounts
  set is_test_account = true
  where id = p_customer_account_id
    and is_test_account is distinct from true;

  update public.customer_payments
  set status = 'VOIDED',
      verification_status = 'VOIDED',
      void_reason = v_reason,
      voided_at = now(),
      voided_by = v_actor.username,
      updated_at = now()
  where customer_account_id = p_customer_account_id
    and upper(coalesce(status, '')) in ('POSTED', 'ACTIVE');
  get diagnostics v_rows_changed = row_count;

  update public.customer_ledger
  set payment_status = 'VOIDED',
      void_reason = v_reason,
      voided_at = now(),
      voided_by = v_actor.username,
      updated_at = now()
  where customer_account_id = p_customer_account_id
    and upper(coalesce(entry_type, transaction_type, '')) in ('PAYMENT', 'COLLECTION')
    and upper(coalesce(payment_status, 'POSTED')) not in ('VOIDED', 'REVERSED');

  update public.customer_payment_allocations
  set status = 'reversed',
      reversed_at = now(),
      reversal_reason = v_reason,
      updated_at = now()
  where customer_account_id = p_customer_account_id
    and upper(coalesce(status, 'ACTIVE')) not in ('VOID', 'VOIDED', 'REVERSED', 'INACTIVE');

  return jsonb_build_object(
    'dry_run', false,
    'cleanup_batch_id', v_batch_id,
    'customer_account_id', p_customer_account_id,
    'customer_name', v_account.account_name,
    'payments_voided', v_rows_changed,
    'collection_total_removed', v_payment_total,
    'records_deleted', 0,
    'audit_archive_preserved', true
  );
end;
$$;

revoke all on function public.cleanup_test_customer_transactions_v1(
  text, text, uuid, boolean
) from public;
grant execute on function public.cleanup_test_customer_transactions_v1(
  text, text, uuid, boolean
) to anon, authenticated;

notify pgrst, 'reload schema';
