-- Owner amendments use current FC session validation (idle expiry, revocation,
-- auth version, active identity and effective permissions), not the legacy helper.
-- No invoice/order/line/ledger/payment data is changed by this migration.
begin;
create or replace function public.fc_require_issued_invoice_owner_v1(p_username text,p_session_token text)
returns table(username text) language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;
begin
 select * into strict actor from public.fc_require_session_permission_v2(p_username,p_session_token,'page.accounts.invoices');
 if lower(trim(coalesce(actor.username,'')))<>'nisstaj_admin' then
  raise exception 'Only the verified nisstaj_admin FC session may amend an issued invoice.' using errcode='42501';
 end if;
 return query select actor.username::text;
end;$$;
revoke all on function public.fc_require_issued_invoice_owner_v1(text,text) from public,anon,authenticated,service_role;
do $$ declare proc regprocedure;definition text;begin
 foreach proc in array array[
  'public.fc_prepare_issued_invoice_edit_v1(text,text,uuid)'::regprocedure,
  'public.fc_amend_issued_invoice_v1(text,text,uuid,text,text,jsonb,jsonb)'::regprocedure
 ] loop
  select pg_get_functiondef(proc) into definition;
  if position('fc_require_nisstaj_admin_session_v1' in definition)=0 and position('fc_require_issued_invoice_owner_v1' in definition)=0 then
   raise exception 'Invoice amendment function differs from the reviewed owner session path.';
  end if;
  execute replace(definition,'public.fc_require_nisstaj_admin_session_v1','public.fc_require_issued_invoice_owner_v1');
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
