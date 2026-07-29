-- Narrow, read-only reconciliation RPC repair. This migration deliberately
-- avoids invoice backfills, FIFO rebuilds, and customer-data mutations.

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values (
  'customer_credit.audit_view',
  'View Customer Credit Audit',
  'Customer Credit',
  'Run all-account reconciliation and view payment amendment history.'
)
on conflict (permission_key) do update
set permission_name = excluded.permission_name,
    category = excluded.category,
    description = excluded.description,
    active = true,
    updated_at = now();

create or replace view public.customer_account_reconciliation_v1
with (security_invoker = true)
as
with opening_totals as (
  select customer_account_id, round(sum(opening_balance), 2) as opening_balance
  from public.customer_branch_opening_balances
  group by customer_account_id
), invoice_totals as (
  select
    customer_account_id,
    round(sum(invoice_total) filter (where status <> 'CANCELLED'), 2) as invoice_total,
    count(*) filter (where status <> 'CANCELLED') as invoice_count
  from public.customer_invoices
  group by customer_account_id
), payment_totals as (
  select
    payment.customer_account_id,
    round(sum(payment.amount) filter (
      where payment.status = 'POSTED'
        and coalesce(payment.verification_status, 'CONFIRMED') = 'CONFIRMED'
        and payment.voided_at is null
        and not exists (
          select 1
          from public.central_payment_archive archive
          where archive.payment_id = payment.id
        )
    ), 2) as active_payment_total,
    count(*) filter (
      where payment.status = 'POSTED'
        and coalesce(payment.verification_status, 'CONFIRMED') = 'CONFIRMED'
        and payment.voided_at is null
        and not exists (
          select 1
          from public.central_payment_archive archive
          where archive.payment_id = payment.id
        )
    ) as active_payment_count,
    round(sum(payment.amount) filter (
      where payment.status <> 'POSTED'
         or payment.voided_at is not null
    ), 2) as excluded_payment_total
  from public.customer_payments payment
  group by payment.customer_account_id
), allocation_totals as (
  select
    customer_account_id,
    round(sum(allocated_amount) filter (
      where lower(coalesce(status, 'active')) = 'active'
    ), 2) as allocation_total
  from public.customer_payment_allocations
  group by customer_account_id
), stored_totals as (
  select customer_account_id, outstanding_balance
  from public.central_payment_balances
  where customer_branch_id is null
)
select
  account.id as customer_account_id,
  account.account_name,
  coalesce(opening.opening_balance, 0)::numeric(14,2) as opening_balance,
  coalesce(invoice.invoice_total, 0)::numeric(14,2) as invoice_total,
  coalesce(invoice.invoice_count, 0) as invoice_count,
  coalesce(payment.active_payment_total, 0)::numeric(14,2) as active_payment_total,
  coalesce(payment.active_payment_count, 0) as active_payment_count,
  coalesce(payment.excluded_payment_total, 0)::numeric(14,2) as excluded_payment_total,
  coalesce(allocation.allocation_total, 0)::numeric(14,2) as allocation_total,
  round(
    coalesce(opening.opening_balance, 0)
      + coalesce(invoice.invoice_total, 0)
      - coalesce(payment.active_payment_total, 0),
    2
  )::numeric(14,2) as calculated_closing_balance,
  coalesce(stored.outstanding_balance, 0)::numeric(14,2) as stored_closing_balance,
  round(
    coalesce(opening.opening_balance, 0)
      + coalesce(invoice.invoice_total, 0)
      - coalesce(payment.active_payment_total, 0)
      - coalesce(stored.outstanding_balance, 0),
    2
  )::numeric(14,2) as difference,
  abs(
    coalesce(opening.opening_balance, 0)
      + coalesce(invoice.invoice_total, 0)
      - coalesce(payment.active_payment_total, 0)
      - coalesce(stored.outstanding_balance, 0)
  ) <= 0.01 as reconciled
from public.customer_accounts account
left join opening_totals opening on opening.customer_account_id = account.id
left join invoice_totals invoice on invoice.customer_account_id = account.id
left join payment_totals payment on payment.customer_account_id = account.id
left join allocation_totals allocation on allocation.customer_account_id = account.id
left join stored_totals stored on stored.customer_account_id = account.id;

revoke all on public.customer_account_reconciliation_v1
from public, anon, authenticated;

create or replace function public.get_customer_account_reconciliation_v1(
  p_username text,
  p_session_token text
)
returns setof public.customer_account_reconciliation_v1
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'customer_credit.audit_view'
  );

  return query
  select *
  from public.customer_account_reconciliation_v1
  order by reconciled, account_name;
end;
$$;

revoke all on function public.get_customer_account_reconciliation_v1(
  text, text
) from public;
grant execute on function public.get_customer_account_reconciliation_v1(
  text, text
) to anon, authenticated;

comment on function public.get_customer_account_reconciliation_v1(
  text, text
) is
  'Session-authorized, read-only all-customer financial reconciliation.';

notify pgrst, 'reload schema';
