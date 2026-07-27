-- Owner-only access and password-protected global ledger lifecycle RPCs.

revoke all on public.financial_transactions from public, anon, authenticated;
revoke all on public.financial_transaction_archive from public, anon, authenticated;
revoke all on public.financial_ledger_events from public, anon, authenticated;
revoke all on public.global_financial_history from public, anon, authenticated;
revoke execute on function public.archive_financial_transactions(uuid[],text,text)
  from public, anon, authenticated;
revoke execute on function public.restore_financial_transaction(uuid,text,text)
  from public, anon, authenticated;
revoke execute on function public.permanently_delete_financial_archive(uuid,text,text)
  from public, anon, authenticated;

drop policy if exists global_ledger_owner_select on public.financial_transactions;
create policy global_ledger_owner_select on public.financial_transactions
for select to authenticated using (public.central_payment_is_nisstaj_admin());

drop policy if exists global_archive_owner_select on public.financial_transaction_archive;
create policy global_archive_owner_select on public.financial_transaction_archive
for select to authenticated using (public.central_payment_is_nisstaj_admin());

drop policy if exists global_events_owner_select on public.financial_ledger_events;
create policy global_events_owner_select on public.financial_ledger_events
for select to authenticated using (public.central_payment_is_nisstaj_admin());

grant select on public.financial_transactions to authenticated;
grant select on public.financial_transaction_archive to authenticated;
grant select on public.financial_ledger_events to authenticated;
grant select on public.global_financial_history to authenticated;

create or replace function public.owner_archive_financial_transactions(
  p_owner_username text,p_owner_password text,p_transaction_ids uuid[],p_reason text
) returns integer language plpgsql security definer set search_path=public as $$
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  return public.archive_financial_transactions(p_transaction_ids,'nisstaj_admin',p_reason);
end $$;

create or replace function public.owner_restore_financial_transaction(
  p_owner_username text,p_owner_password text,p_archive_id uuid,p_reason text default null
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  return public.restore_financial_transaction(p_archive_id,'nisstaj_admin',p_reason);
end $$;

create or replace function public.owner_delete_financial_archive(
  p_owner_username text,p_owner_password text,p_archive_id uuid,p_reason text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  return public.permanently_delete_financial_archive(p_archive_id,'nisstaj_admin',p_reason);
end $$;

revoke execute on function public.owner_archive_financial_transactions(text,text,uuid[],text)
  from public;
revoke execute on function public.owner_restore_financial_transaction(text,text,uuid,text)
  from public;
revoke execute on function public.owner_delete_financial_archive(text,text,uuid,text)
  from public;
grant execute on function public.owner_archive_financial_transactions(text,text,uuid[],text)
  to anon, authenticated;
grant execute on function public.owner_restore_financial_transaction(text,text,uuid,text)
  to anon, authenticated;
grant execute on function public.owner_delete_financial_archive(text,text,uuid,text)
  to anon, authenticated;
