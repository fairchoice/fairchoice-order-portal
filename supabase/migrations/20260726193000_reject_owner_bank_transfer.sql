-- Rejected bank transfers remain in internal payment/global history but never affect customer balances.
create or replace function public.reject_owner_bank_transfer(
  p_owner_username text,
  p_owner_password text,
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_before public.customer_payments%rowtype;
  v_after public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_owner_username,p_owner_password);
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'Bank rejection reason is compulsory.';
  end if;

  select * into v_before
  from public.customer_payments
  where id=p_payment_id and payment_method='Bank Transfer'
  for update;

  if not found or v_before.verification_status <> 'PENDING_VERIFICATION' then
    raise exception 'Pending bank transfer was not found.';
  end if;

  if exists(select 1 from public.central_payment_archive where payment_id=p_payment_id) then
    raise exception 'Archived bank transfers cannot be rejected.';
  end if;

  delete from public.customer_payment_allocations where payment_id=p_payment_id;

  update public.customer_payments
  set verification_status='REJECTED',
      verified_by='nisstaj_admin',
      verified_at=now(),
      notes=concat_ws(E'\n',notes,'Bank rejection: '||trim(p_reason)),
      updated_at=now()
  where id=p_payment_id
  returning * into v_after;

  perform public.recalculate_central_payment_fifo(v_after.customer_account_id);

  insert into public.central_payment_lifecycle_audit(
    payment_id,payment_reference,customer_account_id,customer_branch_id,
    action,reason,before_data,after_data,changed_by
  ) values (
    v_after.id,v_after.payment_reference,v_after.customer_account_id,v_after.customer_branch_id,
    'REJECTED',trim(p_reason),to_jsonb(v_before),to_jsonb(v_after),'nisstaj_admin'
  );

  return to_jsonb(v_after);
end;
$$;

revoke all on function public.reject_owner_bank_transfer(text,text,uuid,text) from public;
grant execute on function public.reject_owner_bank_transfer(text,text,uuid,text) to anon, authenticated;
