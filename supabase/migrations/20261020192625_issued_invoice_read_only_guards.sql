-- No UPDATE/DELETE/backfill of existing order, invoice, line or payment records.
-- Only new archive rows are inserted. Original invoice snapshots remain immutable.
begin;
create table if not exists public.fc_invoice_edit_context (
 transaction_id bigint not null, backend_pid integer not null, invoice_id uuid not null,
 actor text not null, primary key(transaction_id,backend_pid,invoice_id)
);
alter table public.fc_invoice_edit_context enable row level security;
revoke all on public.fc_invoice_edit_context from public,anon,authenticated,service_role;

create table if not exists public.fc_issued_invoice_archive (
 invoice_id uuid primary key, invoice_number text not null, original_document jsonb not null,
 archived_at timestamptz not null default now()
);
alter table public.fc_issued_invoice_archive enable row level security;
revoke all on public.fc_issued_invoice_archive from public,anon,authenticated,service_role;

create or replace function public.fc_deny_invoice_archive_changes_v1() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'Original invoice archive is immutable.' using errcode='42501';end;$$;
revoke all on function public.fc_deny_invoice_archive_changes_v1() from public,anon,authenticated,service_role;
create trigger fc_original_invoice_archive_read_only before update or delete on public.fc_issued_invoice_archive for each row execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_invoice_archive_no_truncate before truncate on public.fc_issued_invoice_archive for each statement execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_invoices_no_truncate before truncate on public.customer_invoices for each statement execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_invoiced_orders_no_truncate before truncate on public.orders for each statement execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_invoice_lines_no_truncate before truncate on public.order_items for each statement execute function public.fc_deny_invoice_archive_changes_v1();
create trigger fc_invoice_ledger_no_truncate before truncate on public.customer_ledger for each statement execute function public.fc_deny_invoice_archive_changes_v1();

create or replace function public.fc_invoice_document_snapshot_v1(p_invoice_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
 'invoice',to_jsonb(i)-array['updated_at','wallet_applied_amount','amount_to_collect','wallet_application_mode','wallet_preserve_paid_watermark','collection_previous_paid_amount','collection_previous_allocated_amount','collection_previous_wallet_amount'],
 'order',(select to_jsonb(o)-array['updated_at','payment_type','payment_amount','payment_collected','paid_by','wallet_use_requested','wallet_requested_amount','wallet_requested_at','wallet_applied_amount'] from public.orders o where o.id=i.order_id),
 'items',coalesce((select jsonb_agg(to_jsonb(l)-'updated_at' order by l.id) from public.order_items l where l.order_id=i.order_id),'[]'::jsonb))
 from public.customer_invoices i where i.id=p_invoice_id;
$$;
revoke all on function public.fc_invoice_document_snapshot_v1(uuid) from public,anon,authenticated,service_role;

create or replace function public.fc_invoice_edit_authorized_v1(p_invoice_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.fc_invoice_edit_context c where c.transaction_id=txid_current()
 and c.backend_pid=pg_backend_pid() and c.invoice_id=p_invoice_id and c.actor='nisstaj_admin');
$$;
revoke all on function public.fc_invoice_edit_authorized_v1(uuid) from public,anon,authenticated,service_role;

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
 for inv in select i.* from public.customer_invoices i where i.order_id=any(ids) loop
  if tg_op='DELETE' and tg_table_name='orders' then raise exception 'An invoiced order cannot be deleted.' using errcode='42501';end if;
  if not public.fc_invoice_edit_authorized_v1(inv.id) then raise exception 'Invoiced order and saved invoice lines are read-only. Only the authenticated nisstaj_admin amendment action can change them.' using errcode='42501';end if;
 end loop;
 return case when tg_op='DELETE' then old else new end;
end;$$;
revoke all on function public.fc_guard_invoice_history_v1() from public,anon,authenticated,service_role;
create trigger zz_fc_invoice_history_guard before insert or update or delete on public.customer_invoices for each row execute function public.fc_guard_invoice_history_v1();
create trigger zz_fc_order_history_guard before update or delete on public.orders for each row execute function public.fc_guard_invoice_history_v1();
create trigger zz_fc_item_history_guard before insert or update or delete on public.order_items for each row execute function public.fc_guard_invoice_history_v1();
create trigger zz_fc_ledger_history_guard before insert or update or delete on public.customer_ledger for each row execute function public.fc_guard_invoice_history_v1();

-- Existing issued totals are no longer derived from mutable order data on a write.
create or replace function public.fc_invoice_total_before_write_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare total numeric;
begin
 if tg_op='UPDATE' then return new;end if;
 if new.order_id is not null and upper(new.status)='ISSUED' then
  total:=public.fc_invoice_document_total_v1(new.order_id);
  if total is not null then new.invoice_total:=total;end if;
 end if;
 return new;
end;$$;
revoke all on function public.fc_invoice_total_before_write_v1() from public,anon,authenticated,service_role;
create or replace function public.fc_order_invoice_total_changed_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin return case when tg_op='DELETE' then old else new end;end;$$;
revoke all on function public.fc_order_invoice_total_changed_v1() from public,anon,authenticated,service_role;

-- Keep first issuance but make repeats read-only and remove automatic historical FIFO reallocations.
do $$ declare definition text; begin
 if to_regprocedure('public.fc_issue_customer_invoice_original_v1(uuid)') is null then
  alter function public.sync_customer_invoice_from_order_v1(uuid) rename to fc_issue_customer_invoice_original_v1;
 end if;
 select pg_get_functiondef('public.fc_issue_customer_invoice_original_v1(uuid)'::regprocedure) into definition;
 if position('perform public.recalculate_central_payment_fifo(v_order.customer_account_id);' in definition)=0 and position('No automatic historical payment reallocation.' in definition)=0 then
  raise exception 'Invoice issuance function differs from the reviewed version; stop and review before installing guards.';
 end if;
 definition:=replace(definition,'perform public.recalculate_central_payment_fifo(v_order.customer_account_id);','null; /* No automatic historical payment reallocation. */');
 execute definition;
end;$$;
revoke all on function public.fc_issue_customer_invoice_original_v1(uuid) from public,anon,authenticated,service_role;
create or replace function public.sync_customer_invoice_from_order_v1(p_order_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform 1 from public.orders where id=p_order_id for update;
 if exists(select 1 from public.customer_invoices where order_id=p_order_id) then return;end if;
 perform public.fc_issue_customer_invoice_original_v1(p_order_id);
end;$$;
revoke all on function public.sync_customer_invoice_from_order_v1(uuid) from public;
grant execute on function public.sync_customer_invoice_from_order_v1(uuid) to anon,authenticated;

create or replace function public.fc_archive_issued_invoice_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare order_data jsonb;
begin
 insert into public.fc_issued_invoice_archive(invoice_id,invoice_number,original_document)
 values(new.id,new.invoice_number,public.fc_invoice_document_snapshot_v1(new.id)) on conflict do nothing;
 -- First issuance must publish its ledger row in the same transaction. The
 -- delivery trigger can create the canonical invoice before the browser sees it.
 -- This never backfills or updates an existing invoice's ledger.
 if upper(new.status)='ISSUED' and not exists(select 1 from public.customer_ledger l
  where upper(coalesce(l.entry_type,''))='INVOICE' and l.reference_no=new.invoice_number
  and l.customer_account_id=new.customer_account_id and l.customer_branch_id is not distinct from new.customer_branch_id) then
  select to_jsonb(o) into order_data from public.orders o where o.id=new.order_id;
  insert into public.customer_ledger(customer_name,entry_type,reference_no,order_number,customer_account_id,customer_branch_id,
   debit,invoice_total,invoice_amount,amount,paid_amount,remaining_amount,invoice_status,price_mode,invoice_date)
  values(coalesce(nullif(order_data->>'company_name',''),'Unknown Customer'),'INVOICE',new.invoice_number,new.invoice_number,
   new.customer_account_id,new.customer_branch_id,new.invoice_total,new.invoice_total,new.invoice_total,new.invoice_total,
   0,new.invoice_total,'UNPAID',new.price_mode,coalesce((to_jsonb(new)->>'invoice_date')::timestamptz,now()));
 end if;
 return new;
end;$$;
revoke all on function public.fc_archive_issued_invoice_v1() from public,anon,authenticated,service_role;
create trigger fc_archive_issued_invoice after insert on public.customer_invoices for each row execute function public.fc_archive_issued_invoice_v1();
insert into public.fc_issued_invoice_archive(invoice_id,invoice_number,original_document)
select i.id,i.invoice_number,public.fc_invoice_document_snapshot_v1(i.id) from public.customer_invoices i on conflict do nothing;

create or replace function public.fc_prepare_issued_invoice_edit_v1(p_username text,p_session_token text,p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;i public.customer_invoices%rowtype;
begin
 select * into strict actor from public.fc_require_nisstaj_admin_session_v1(p_username,p_session_token);
 select * into strict i from public.customer_invoices where order_id=p_order_id;
 return jsonb_build_object('invoice_id',i.id,'revision',md5(public.fc_invoice_document_snapshot_v1(i.id)::text));
end;$$;
revoke all on function public.fc_prepare_issued_invoice_edit_v1(text,text,uuid) from public;
grant execute on function public.fc_prepare_issued_invoice_edit_v1(text,text,uuid) to anon,authenticated;

create or replace function public.fc_amend_issued_invoice_v1(
 p_username text,p_session_token text,p_order_id uuid,p_expected_revision text,p_reason text,p_header jsonb,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor record;i public.customer_invoices%rowtype;before_doc jsonb;after_doc jsonb;line jsonb;line_id uuid;
 kept uuid[]:='{}';v_qty integer;v_price numeric;v_rate numeric;v_net numeric;v_vat numeric;v_total numeric;v_net_total numeric;v_vat_total numeric;mode text;add_vat boolean;
begin
 select * into strict actor from public.fc_require_nisstaj_admin_session_v1(p_username,p_session_token);
 if lower(trim(actor.username))<>'nisstaj_admin' then raise exception 'Owner authorization required.' using errcode='42501';end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A specific amendment reason is required.';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'An invoice must retain at least one line.';end if;
 perform 1 from public.orders where id=p_order_id for update;
 select * into strict i from public.customer_invoices where order_id=p_order_id for update;
 if upper(i.status)<>'ISSUED' or upper(coalesce(i.financial_status,'ACTIVE'))<>'ACTIVE' then raise exception 'Voided or cancelled invoices cannot be amended.';end if;
 before_doc:=public.fc_invoice_document_snapshot_v1(i.id);
 if p_expected_revision is null or md5(before_doc::text)<>p_expected_revision then raise exception 'Invoice changed since it was opened. Reopen the read-only document before requesting an amendment.' using errcode='40001';end if;
 insert into public.fc_invoice_edit_context values(txid_current(),pg_backend_pid(),i.id,actor.username);
 mode:=lower(regexp_replace(trim(coalesce(p_header->>'price_mode',i.price_mode,'VAT')),'[._-]+',' ','g'));
 add_vat:=mode in ('vat','admin','admin offer','long customer','long customers','super') or (mode like 'code:%' and split_part(mode,'|',2)='ex vat');
 for line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=(line->>'qty')::integer;v_price:=(line->>'price')::numeric;v_rate:=coalesce((line->>'vat_rate')::numeric,0);
  if v_qty is null or v_qty<=0 or v_price is null or v_price<0 or v_price='NaN'::numeric or v_price='Infinity'::numeric or v_rate not in (0,5,20) then raise exception 'Invalid saved invoice quantity, unit price or VAT rate.';end if;
  if lower(coalesce(line->>'source_status','')) in ('free','promotion free') then v_price:=0;end if;
  v_net:=round(v_qty*v_price,2);v_vat:=case when add_vat then round(v_net*v_rate/100,2) else 0 end;
  if nullif(line->>'db_id','') is not null then
   line_id:=(line->>'db_id')::uuid;
   if line_id=any(kept) then raise exception 'Duplicate invoice line.';end if;
   update public.order_items set qty=v_qty,picked_qty=v_qty,price=v_price,unit_price=v_price,
    net_total=v_net,line_total=v_net,gross_total=v_net+v_vat,vat_total=v_vat,vat_amount=v_vat,vat_rate=v_rate,vat_type=v_rate::text,
    source_status=coalesce(nullif(line->>'source_status',''),'In Stock'),include_in_picking=true
   where id=line_id and order_id=p_order_id;
   if not found then raise exception 'Invoice line does not belong to this invoice.' using errcode='42501';end if;
  else
   insert into public.order_items(order_id,product_id,product_code,product_name,qty,picked_qty,price,unit_price,net_total,line_total,gross_total,vat_total,vat_amount,vat_rate,vat_type,source_status,include_in_picking)
   values(p_order_id,(line->>'product_id')::uuid,line->>'product_code',line->>'product_name',v_qty,v_qty,v_price,v_price,v_net,v_net,v_net+v_vat,v_vat,v_vat,v_rate,v_rate::text,coalesce(nullif(line->>'source_status',''),'In Stock'),true) returning id into line_id;
  end if;
  kept:=array_append(kept,line_id);
 end loop;
 update public.order_items set qty=0,picked_qty=0,net_total=0,line_total=0,gross_total=0,vat_total=0,vat_amount=0,source_status='Removed',include_in_picking=false
 where order_id=p_order_id and not(id=any(kept)) and qty>0
 and lower(coalesce(source_status,'')) not in ('removed','cancelled','deleted','cannot supply','need supplier','pre-order','pre order','pre-order supply','pre order supply','supply needed','next supplier')
 and (lower(coalesce(source_status,'')) in ('in stock','available','supplied','free','promotion free') or coalesce(include_in_picking,true));
 -- Group VAT exactly once per rate, using only these saved invoice lines.
 select coalesce(sum(n),0),coalesce(sum(case when add_vat then round(n*r/100,2) else 0 end),0)
 into v_net_total,v_vat_total from (select l.vat_rate r,sum(l.net_total) n from public.order_items l where l.id=any(kept) group by l.vat_rate) grouped;
 v_total:=v_net_total+v_vat_total;
 if v_total is null or v_total<=0 then raise exception 'An amendment cannot zero an issued invoice.' using errcode='23514';end if;
 update public.orders set company_name=coalesce(p_header->>'company_name',company_name),delivery_address=coalesce(p_header->>'delivery_address',delivery_address),
 delivery_postcode=coalesce(p_header->>'delivery_postcode',delivery_postcode),postcode=coalesce(p_header->>'delivery_postcode',postcode),
 price_mode=coalesce(p_header->>'price_mode',price_mode),notes=coalesce(p_header->>'notes',notes),
 order_total=v_total,grand_total=v_total,subtotal=v_net_total,net_total=v_net_total,vat_total=v_vat_total where id=p_order_id;
 update public.customer_invoices set invoice_total=v_total,price_mode=coalesce(p_header->>'price_mode',price_mode),updated_at=now() where id=i.id;
 after_doc:=public.fc_invoice_document_snapshot_v1(i.id);
 insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
 values('OWNER_INVOICE_AMENDMENT','customer_invoices',i.id::text,i.customer_account_id,i.customer_branch_id,trim(p_reason),before_doc,after_doc,actor.username);
 delete from public.fc_invoice_edit_context where transaction_id=txid_current() and backend_pid=pg_backend_pid() and invoice_id=i.id;
 return jsonb_build_object('invoice_id',i.id,'invoice_total',v_total,'revision',md5(after_doc::text));
end;$$;
revoke all on function public.fc_amend_issued_invoice_v1(text,text,uuid,text,text,jsonb,jsonb) from public;
grant execute on function public.fc_amend_issued_invoice_v1(text,text,uuid,text,text,jsonb,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
