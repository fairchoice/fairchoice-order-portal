-- Keep canonical invoice/ledger totals aligned with the printable saved lines.
-- This does not post, allocate, reverse or move any payments or Wallet credits.
begin;
create or replace function public.fc_invoice_document_total_v1(p_order_id uuid)
returns numeric language sql volatile security invoker set search_path=pg_catalog,public as $$
 with doc as (
  select o.*,lower(regexp_replace(regexp_replace(trim(coalesce(o.price_mode,'')),'[._-]+',' ','g'),'\s+',' ','g')) mode
  from public.orders o where o.id=p_order_id
   and lower(trim(o.status)) in ('delivered','confirmed','delivery confirmed','completed')
   and upper(coalesce(o.financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED')
 ), settings as (
  select *,mode in ('vat','admin','admin offer','long customer','long customers','super') add_vat from doc
 ), raw as (
  select to_jsonb(i) j,d.add_vat from public.order_items i join settings d on d.id=i.order_id
 ), items as (
  select j,add_vat,coalesce((j->>'qty')::numeric,(j->>'quantity')::numeric,(j->>'picked_qty')::numeric,0) qty,
   coalesce((j->>'price')::numeric,(j->>'unit_price')::numeric) price,
   lower(trim(coalesce(j->>'source_status',j->>'status',''))) source,
   nullif(replace(coalesce(j->>'vat_percent',j->>'vatRate',j->>'vat_rate',j->>'vat_type'),'%',''),'')::numeric raw_rate
  from raw
 ), lines as (
  select case when not add_vat then 0 when raw_rate=0.2 then 20 when raw_rate=0.05 then 5 else coalesce(raw_rate,0) end rate,
   round(case when source in ('free','promotion free') then 0
    when not add_vat and price is not null then price*qty
    when j->>'net_total' is not null then (j->>'net_total')::numeric
    when price is not null and raw_rate is not null then price*qty
    when j->>'line_total' is not null and raw_rate is not null then (j->>'line_total')::numeric else 0 end,2) net
  from items where qty>0 and source not in ('removed','cancelled','deleted','cannot supply','need supplier','pre-order','pre order','pre-order supply','pre order supply','supply needed','next supplier')
   and (source in ('in stock','available','supplied') or coalesce((j->>'include_in_picking')::boolean,true))
 ), grouped as (select rate,sum(net) net from lines group by rate),
 totals as (select coalesce(sum(net),0)+coalesce(sum(round(net*rate/100,2)),0) gross from grouped)
 select round(case when coalesce(d.order_total,0)>0 and (t.gross=0 or abs(d.order_total-t.gross)<=0.05)
  then d.order_total else coalesce(nullif(t.gross,0),d.order_total,0) end,2)
 from settings d cross join totals t;
$$;
revoke all on function public.fc_invoice_document_total_v1(uuid) from public,anon,authenticated;

create or replace function public.fc_invoice_total_before_write_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_total numeric; v_previous numeric;
begin
 if new.order_id is null or upper(new.status)<>'ISSUED' or upper(coalesce(new.financial_status,'ACTIVE')) in ('VOID','VOIDED','CANCELLED','ARCHIVED') then return new;end if;
 v_total:=public.fc_invoice_document_total_v1(new.order_id);
 if v_total is null or v_total<0 then return new;end if;
 if not exists(select 1 from public.orders o where o.id=new.order_id and o.customer_account_id=new.customer_account_id) then return new;end if;
 v_previous:=case when tg_op='UPDATE' then old.invoice_total else new.invoice_total end;
 if new.invoice_total is distinct from v_total or v_previous is distinct from v_total then
  insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
  values('INVOICE_DOCUMENT_TOTAL_SYNC','customer_invoices',new.id::text,new.customer_account_id,new.customer_branch_id,
   'Align invoice amount with printable saved invoice lines; preserve existing payments and Wallet applications.',
   jsonb_build_object('invoice_total',v_previous,'requested_total',new.invoice_total),jsonb_build_object('invoice_total',v_total,'order_id',new.order_id),'invoice-total-sync');
 end if;
 new.invoice_total:=v_total;
 return new;
end;$$;
revoke all on function public.fc_invoice_total_before_write_v1() from public,anon,authenticated;
create trigger fc_invoice_total_before_write before insert or update of invoice_total,order_id on public.customer_invoices
 for each row execute function public.fc_invoice_total_before_write_v1();

create or replace function public.fc_invoice_total_after_write_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_paid numeric;
begin
 if upper(new.status)<>'ISSUED' or upper(coalesce(new.financial_status,'ACTIVE')) in ('VOID','VOIDED','CANCELLED','ARCHIVED') then return new;end if;
 v_paid:=coalesce(public.fc_collection_paid_amount_v1(new.id),0);
 update public.customer_invoices set amount_to_collect=greatest(0,new.invoice_total-v_paid)
  where id=new.id and amount_to_collect is distinct from greatest(0,new.invoice_total-v_paid);
 update public.customer_ledger set invoice_total=new.invoice_total,invoice_amount=new.invoice_total,
  debit=new.invoice_total,amount=new.invoice_total
 where customer_account_id=new.customer_account_id and customer_branch_id is not distinct from new.customer_branch_id
  and upper(coalesce(entry_type,''))='INVOICE' and reference_no=new.invoice_number;
 perform public.fc_sync_collection_invoice_status_v1(new.id);
 -- Refresh existing summary rows only; never rerun FIFO or move allocations.
 update public.central_payment_balances b set
  invoice_total=t.total,
  outstanding_balance=coalesce(b.opening_balance,0)+t.total-coalesce(b.payment_total,0),
  recalculated_at=now()
 from (
  select b0.scope_key,coalesce(sum(c.invoice_total),0) total
  from public.central_payment_balances b0
  left join public.customer_invoices c on c.customer_account_id=b0.customer_account_id
   and (b0.customer_branch_id is null or c.customer_branch_id=b0.customer_branch_id)
   and c.status<>'CANCELLED'
  where b0.customer_account_id=new.customer_account_id group by b0.scope_key
 ) t where b.scope_key=t.scope_key;
 return new;
end;$$;
revoke all on function public.fc_invoice_total_after_write_v1() from public,anon,authenticated;
create trigger fc_invoice_total_after_write after insert or update of invoice_total,order_id on public.customer_invoices
 for each row execute function public.fc_invoice_total_after_write_v1();

create or replace function public.fc_order_invoice_total_changed_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_ids uuid[];v_id uuid;v_total numeric;
begin
 if tg_table_name='orders' then v_ids:=array[new.id];
 elsif tg_op='DELETE' then v_ids:=array[old.order_id];
 elsif tg_op='UPDATE' then v_ids:=array[old.order_id,new.order_id];
 else v_ids:=array[new.order_id];end if;
 for v_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
  v_total:=public.fc_invoice_document_total_v1(v_id);
  if v_total is not null and v_total>=0 then
   update public.customer_invoices set invoice_total=v_total,updated_at=now()
   where order_id=v_id and customer_account_id=(select o.customer_account_id from public.orders o where o.id=v_id) and status='ISSUED' and upper(coalesce(financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED')
    and invoice_total is distinct from v_total;
  end if;
 end loop;
 if tg_op='DELETE' then return old;else return new;end if;
end;$$;
revoke all on function public.fc_order_invoice_total_changed_v1() from public,anon,authenticated;
create trigger fc_order_invoice_total_changed after update of status,price_mode,order_total,net_total,vat_total on public.orders
 for each row execute function public.fc_order_invoice_total_changed_v1();
create trigger fc_item_invoice_total_changed after insert or delete or update of qty,picked_qty,price,unit_price,net_total,line_total,vat_rate,vat_type,source_status,include_in_picking,order_id on public.order_items
 for each row execute function public.fc_order_invoice_total_changed_v1();

-- Ledger postings can be inserted after the canonical invoice. Normalize those
-- postings too so a stale caller cannot write the old order-header amount back.
create or replace function public.fc_invoice_ledger_total_before_write_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.customer_invoices%rowtype;v_paid numeric;
begin
 if upper(coalesce(new.entry_type,''))<>'INVOICE' or upper(coalesce(new.financial_status,'ACTIVE')) in ('VOID','VOIDED','CANCELLED','ARCHIVED') then return new;end if;
 if (select count(*) from public.customer_invoices c where c.customer_account_id=new.customer_account_id
  and c.customer_branch_id is not distinct from new.customer_branch_id and c.invoice_number=new.reference_no
  and c.status='ISSUED' and upper(coalesce(c.financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED'))<>1 then return new;end if;
 select * into i from public.customer_invoices c where c.customer_account_id=new.customer_account_id
  and c.customer_branch_id is not distinct from new.customer_branch_id and c.invoice_number=new.reference_no and c.status='ISSUED'
  and upper(coalesce(c.financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED');
 v_paid:=coalesce(public.fc_collection_paid_amount_v1(i.id),0);
 new.invoice_total:=i.invoice_total;new.invoice_amount:=i.invoice_total;new.debit:=i.invoice_total;new.amount:=i.invoice_total;
 new.paid_amount:=v_paid;new.remaining_amount:=greatest(0,i.invoice_total-v_paid);
 new.invoice_status:=case when v_paid>=i.invoice_total then 'PAID' when v_paid>0 then 'PART PAID' else 'UNPAID' end;
 new.collection_previous_paid_amount:=i.collection_previous_paid_amount;
 new.collection_previous_allocated_amount:=i.collection_previous_allocated_amount;
 new.collection_previous_wallet_amount:=i.collection_previous_wallet_amount;
 new.wallet_applied_amount:=i.wallet_applied_amount;
 return new;
end;$$;
revoke all on function public.fc_invoice_ledger_total_before_write_v1() from public,anon,authenticated;
create trigger fc_invoice_ledger_total_before_write before insert or update of reference_no,customer_account_id,customer_branch_id,debit,amount,invoice_amount,invoice_total on public.customer_ledger
 for each row execute function public.fc_invoice_ledger_total_before_write_v1();

-- Reconcile existing active, order-backed invoices on this environment. Each
-- changed invoice is audited by the trigger above. Cash/allocations stay intact.
update public.customer_invoices i set invoice_total=t.total,updated_at=now()
from (select id,public.fc_invoice_document_total_v1(order_id) total from public.customer_invoices
 where order_id is not null and exists(select 1 from public.orders o where o.id=customer_invoices.order_id and o.customer_account_id=customer_invoices.customer_account_id) and status='ISSUED' and upper(coalesce(financial_status,'ACTIVE')) not in ('VOID','VOIDED','CANCELLED','ARCHIVED')) t
where i.id=t.id and t.total is not null and t.total>=0 and i.invoice_total is distinct from t.total;
notify pgrst,'reload schema';
commit;
