-- Protect legacy invoice-number links without changing any saved rows.
-- Preserve all payment/collection exemptions in the installed guards.
create or replace function public.fc_guard_invoice_history_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[]; inv public.customer_invoices%rowtype; old_doc jsonb; new_doc jsonb;
begin
 if tg_table_name='customer_invoices' then
  if tg_op='INSERT' then
   if new.order_id is not null then perform 1 from public.orders where id=new.order_id for update;end if;
   if new.invoice_total is null or new.invoice_total<=0 or new.invoice_total>='Infinity'::numeric then
    raise exception 'An issued invoice must have a positive saved total. No zero invoice was created.' using errcode='23514';
   end if;
   return new;
  end if;
  if tg_op='DELETE' then raise exception 'Issued invoice history cannot be deleted.' using errcode='42501';end if;
  if new.id is distinct from old.id then raise exception 'Invoice identity is immutable.' using errcode='42501';end if;
  old_doc:=to_jsonb(old)-array['updated_at','wallet_applied_amount','amount_to_collect','wallet_application_mode','wallet_preserve_paid_watermark','collection_previous_paid_amount','collection_previous_allocated_amount','collection_previous_wallet_amount'];
  new_doc:=to_jsonb(new)-array['updated_at','wallet_applied_amount','amount_to_collect','wallet_application_mode','wallet_preserve_paid_watermark','collection_previous_paid_amount','collection_previous_allocated_amount','collection_previous_wallet_amount'];
  if old_doc is distinct from new_doc then
   if not public.fc_invoice_edit_authorized_v1(old.id) then raise exception 'Issued invoice is read-only. Use the authenticated nisstaj_admin amendment action.' using errcode='42501';end if;
   if new.invoice_total is null or new.invoice_total<=0 or new.invoice_total>='Infinity'::numeric then raise exception 'An amendment cannot zero an issued invoice.' using errcode='23514';end if;
  end if;
  return new;
 elsif tg_table_name='orders' then
  ids:=array[old.id];
  if tg_op='UPDATE' then
   old_doc:=to_jsonb(old)-array['updated_at','payment_type','payment_amount','payment_collected','paid_by','wallet_use_requested','wallet_requested_amount','wallet_requested_at','wallet_applied_amount'];
   new_doc:=to_jsonb(new)-array['updated_at','payment_type','payment_amount','payment_collected','paid_by','wallet_use_requested','wallet_requested_amount','wallet_requested_at','wallet_applied_amount'];
   if old_doc is not distinct from new_doc then return new;end if;
  end if;
 elsif tg_table_name='order_items' then
  ids:=case when tg_op='INSERT' then array[new.order_id] when tg_op='DELETE' then array[old.order_id] else array[old.order_id,new.order_id] end;
  -- Serialize order-line edits against invoice issuance and owner amendments.
  perform 1 from public.orders where id=any(ids) order by id for update;
  if tg_op='UPDATE' and (to_jsonb(old)-'updated_at') is not distinct from (to_jsonb(new)-'updated_at') then return new;end if;
 elsif tg_table_name='customer_ledger' then
  if tg_op='INSERT' then
   if upper(coalesce(new.entry_type,''))='INVOICE' and (coalesce(new.invoice_total,new.invoice_amount,new.debit,new.amount,0)<=0 or coalesce(new.invoice_total,new.invoice_amount,new.debit,new.amount,0)>='Infinity'::numeric) then
    raise exception 'A new invoice ledger entry must have a positive saved total.' using errcode='23514';
   end if;
   return new;
  end if;
  if upper(coalesce(old.entry_type,''))<>'INVOICE' then return case when tg_op='DELETE' then old else new end;end if;
  if tg_op='UPDATE' then
   old_doc:=to_jsonb(old)-array['updated_at','paid_amount','remaining_amount','invoice_status','wallet_applied_amount','collection_previous_paid_amount','collection_previous_allocated_amount','collection_previous_wallet_amount'];
   new_doc:=to_jsonb(new)-array['updated_at','paid_amount','remaining_amount','invoice_status','wallet_applied_amount','collection_previous_paid_amount','collection_previous_allocated_amount','collection_previous_wallet_amount'];
   if old_doc is not distinct from new_doc then return new;end if;
  end if;
  for inv in select i.* from public.customer_invoices i where i.invoice_number=old.reference_no and i.customer_account_id=old.customer_account_id and i.customer_branch_id is not distinct from old.customer_branch_id loop
   if tg_op='DELETE' or not public.fc_invoice_edit_authorized_v1(inv.id) then raise exception 'Issued invoice ledger content is read-only; payment allocations remain separate.' using errcode='42501';end if;
  end loop;
  return case when tg_op='DELETE' then old else new end;
 end if;
 for inv in select i.* from public.customer_invoices i where i.order_id=any(ids)
 or (i.order_id is null and exists(select 1 from public.orders o where o.id=any(ids) and o.order_number=i.invoice_number)) loop
  if tg_op='DELETE' and tg_table_name='orders' then raise exception 'An invoiced order cannot be deleted.' using errcode='42501';end if;
  if not public.fc_invoice_edit_authorized_v1(inv.id) then raise exception 'Invoiced order and saved invoice lines are read-only. Only the authenticated nisstaj_admin amendment action can change them.' using errcode='42501';end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.fc_guard_invoice_history_v1() from public,anon,authenticated,service_role;

create or replace function public.sync_customer_invoice_from_order_v1(p_order_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform 1 from public.orders where id=p_order_id for update;
 if exists(select 1 from public.customer_invoices where order_id=p_order_id
 or (order_id is null and invoice_number=(select order_number from public.orders where id=p_order_id))) then return;end if;
 perform public.fc_issue_customer_invoice_original_v1(p_order_id);
end;$$;
revoke all on function public.sync_customer_invoice_from_order_v1(uuid) from public;
grant execute on function public.sync_customer_invoice_from_order_v1(uuid) to anon,authenticated;
