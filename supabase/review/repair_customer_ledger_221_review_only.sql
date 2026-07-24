-- REVIEW ONLY. This file is intentionally not a migration and must not be run automatically.
-- It contains read-only preflight checks and a commented audited RPC call.

begin transaction read only;

select
  l.id,
  l.customer_account_id,
  coalesce(l.customer_branch_id, l.branch_id) as customer_branch_id,
  coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0), 0) as amount,
  coalesce(l.payment_date, l.collection_date, l.created_at) as payment_date,
  l.created_at,
  coalesce(l.payment_reference, l.reference_no) as reference,
  coalesce(l.collection_source, l.source) as collection_source,
  coalesce(l.payment_method, l.payment_type) as payment_method,
  coalesce(l.paid_by, l.who_paid) as payer,
  coalesce(l.received_by, l.collected_by_name) as receiver,
  l.notes
from public.customer_ledger l
where l.id = 221;

select *
from public.reconcile_customer_ledger_payments_v1()
where ledger_id = 221;

select *
from public.customer_payment_legacy_migrations
where legacy_source = 'customer_ledger' and legacy_id = '221';

select id, customer_account_id, customer_branch_id, amount, payment_date,
       payment_reference, source, idempotency_key, status, verification_status
from public.customer_payments
where idempotency_key = 'legacy-customer-ledger:221'
   or metadata @> '{"legacy_source":"customer_ledger","legacy_source_id":"221"}'::jsonb;

rollback;

-- CONTROLLED REPAIR — DO NOT UNCOMMENT OR RUN WITHOUT EXPLICIT PRODUCTION APPROVAL.
-- The owner password must be supplied interactively and must never be saved in this file.
--
-- select public.post_previous_balance_collection_v1(
--   p_owner_username        => 'nisstaj_admin',
--   p_owner_password        => :'owner_financial_password',
--   p_customer_account_id   => '7a673fb8-e01d-4165-8c12-3d243f5eb7b3'::uuid,
--   p_customer_branch_id    => '8f598571-db45-424b-9d23-1fe2fba98d78'::uuid,
--   p_amount                => 43.00,
--   p_payment_method        => 'Cash',
--   p_payment_date          => '2026-07-22T01:23:39.892083Z'::timestamptz,
--   p_payer_name            => 'Vijay',
--   p_collector_name        => 'nisstaj_admin',
--   p_collector_staff_id    => 'c935885a-9512-47da-866a-99c8428a826f'::uuid,
--   p_collector_role        => 'Super Admin',
--   p_notes                 => 'Driver previous balance collection - Cash',
--   p_payment_intent_id     => '80ca425d-0665-5aaf-93fd-d63a73476d08'::uuid,
--   p_legacy_ledger_id      => 221,
--   p_migration_reason      => 'Approved one-record repair of legacy previous-balance collection'
-- );
