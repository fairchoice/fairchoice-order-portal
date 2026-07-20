-- Payment History is readable without the owner password.
-- Edit/archive/restore are updates, never physical deletes.
-- Permanent deletion remains available only through the existing
-- permanently_delete_central_payment RPC, which verifies the bcrypt-backed
-- nisstaj_admin financial password stored in owner_financial_security.

grant select, update on table public.customer_payments to anon, authenticated;
revoke delete on table public.customer_payments from anon, authenticated;
revoke delete on table public.customer_accounts from anon, authenticated;
revoke delete on table public.customer_invoices from anon, authenticated;
revoke delete on table public.orders from anon, authenticated;

-- Ensure archived payments cannot affect Customer Credit queries that use status.
update public.customer_payments
set status = 'VOIDED'
where removed_at is not null
  and coalesce(status, '') <> 'VOIDED';

notify pgrst, 'reload schema';
