-- Read Wallet applications as invoice settlement, without creating cash payments.
begin;
alter table public.customer_invoices add column if not exists collection_previous_wallet_amount numeric(14,2) not null default 0;
alter table public.customer_ledger add column if not exists collection_previous_wallet_amount numeric(14,2) not null default 0;
alter table public.customer_ledger add column if not exists wallet_applied_amount numeric(14,2) not null default 0;

create or replace function public.fc_capture_collection_wallet_baseline_v1() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin new.collection_previous_wallet_amount:=coalesce(new.wallet_applied_amount,0); return new; end; $$;
revoke all on function public.fc_capture_collection_wallet_baseline_v1() from public,anon,authenticated;
drop trigger if exists fc_capture_collection_wallet_baseline on public.customer_invoices;
create trigger fc_capture_collection_wallet_baseline before update of collection_previous_paid_amount,collection_previous_allocated_amount
on public.customer_invoices for each row execute function public.fc_capture_collection_wallet_baseline_v1();

create or replace function public.fc_collection_paid_amount_v1(p_invoice_id uuid)
returns numeric language sql stable security invoker set search_path=pg_catalog,public as $$
 select least(i.invoice_total,greatest(a.amount+coalesce(i.wallet_applied_amount,0),
   i.collection_previous_paid_amount+greatest(0,a.amount-i.collection_previous_allocated_amount)
   +greatest(0,coalesce(i.wallet_applied_amount,0)-i.collection_previous_wallet_amount)))
 from public.customer_invoices i cross join lateral(select public.fc_collection_allocated_amount_v1(i.id) amount) a where i.id=p_invoice_id;
$$;
revoke all on function public.fc_collection_paid_amount_v1(uuid) from public,anon,authenticated;

create or replace function public.fc_sync_collection_invoice_status_v1(p_invoice_id uuid)
returns void language plpgsql security invoker set search_path=pg_catalog,public as $$
declare i public.customer_invoices%rowtype; v_paid numeric;
begin
 select * into strict i from public.customer_invoices where id=p_invoice_id;
 v_paid:=public.fc_collection_paid_amount_v1(i.id);
 update public.customer_ledger l set collection_previous_paid_amount=i.collection_previous_paid_amount,
  collection_previous_allocated_amount=i.collection_previous_allocated_amount,collection_previous_wallet_amount=i.collection_previous_wallet_amount,
  wallet_applied_amount=coalesce(i.wallet_applied_amount,0),paid_amount=v_paid,remaining_amount=greatest(0,i.invoice_total-v_paid),
  invoice_status=case when v_paid>=i.invoice_total then 'PAID' when v_paid>0 then 'PART PAID' else 'UNPAID' end
 where l.customer_account_id=i.customer_account_id and l.customer_branch_id is not distinct from i.customer_branch_id
  and upper(coalesce(l.entry_type,''))='INVOICE' and l.reference_no=i.invoice_number;
end; $$;
revoke all on function public.fc_sync_collection_invoice_status_v1(uuid) from public,anon,authenticated;

create or replace function public.fc_invoice_collection_snapshot_v1(p_customer_account_id uuid,p_customer_branch_id uuid,p_username text,p_session_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; v_result jsonb;
begin
 select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'payments.collect_cash');
 if lower(coalesce(a.staff_role,''))='customer' then raise exception 'Staff cash collection access is required.' using errcode='42501'; end if;
 if not exists(select 1 from public.customer_accounts where id=p_customer_account_id) then raise exception 'Customer account does not exist.'; end if;
 if p_customer_branch_id is not null and not exists(select 1 from public.customer_branches where id=p_customer_branch_id and customer_account_id=p_customer_account_id) then raise exception 'Branch does not belong to the selected customer.'; end if;
 with scoped as(select i.*,public.fc_collection_allocated_amount_v1(i.id) cash_allocated_amount from public.customer_invoices i
  where customer_account_id=p_customer_account_id and customer_branch_id is not distinct from p_customer_branch_id
   and status='ISSUED' and upper(coalesce(financial_status,'ACTIVE'))<>'VOID')
 select jsonb_build_object('invoices',coalesce(jsonb_agg(to_jsonb(scoped) order by invoice_date,id),'[]'::jsonb),
  'allocations',coalesce(jsonb_agg(jsonb_build_object('invoice_reference',invoice_number,'allocated_amount',cash_allocated_amount,'status','active') order by invoice_date,id),'[]'::jsonb))
 into v_result from scoped;
 return v_result;
end; $$;
revoke all on function public.fc_invoice_collection_snapshot_v1(uuid,uuid,text,text) from public;
grant execute on function public.fc_invoice_collection_snapshot_v1(uuid,uuid,text,text) to anon,authenticated;

create or replace function public.fc_invoice_financial_snapshot_v1(p_username text,p_session_token text,
 p_customer_account_id uuid default null,p_invoice_numbers text[] default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; v_account uuid:=p_customer_account_id; v_result jsonb;
begin
 begin
  select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'order.checkout.payment');
 exception when insufficient_privilege then
  select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'customer.portal.payment');
 end;
 if lower(coalesce(a.staff_role,''))='customer' then
  if a.customer_account_id is null or (v_account is not null and v_account is distinct from a.customer_account_id) then raise exception 'Customer invoice scope denied.' using errcode='42501'; end if;
  v_account:=a.customer_account_id;
 elsif not (coalesce((a.effective_permissions->>'all_access')::boolean,false)
  or coalesce((a.effective_permissions->>'page.accounts.invoices')::boolean,false)
  or coalesce((a.effective_permissions->>'page.accounts.customer_credit')::boolean,false)
  or coalesce((a.effective_permissions->>'page.accounts.customer_wallet')::boolean,false)
  or coalesce((a.effective_permissions->>'page.accounts.central_payment')::boolean,false)
  or coalesce((a.effective_permissions->>'payments.collect_cash')::boolean,false)
  or coalesce((a.effective_permissions->>'page.operations.driver')::boolean,false)
  or coalesce((a.effective_permissions->>'page.order.sales_rep')::boolean,false)
  or coalesce((a.effective_permissions->>'page.order.sales_invoice')::boolean,false)) then
  raise exception 'Invoice financial access denied.' using errcode='42501';
 end if;
 if v_account is null and coalesce(cardinality(p_invoice_numbers),0)=0 then raise exception 'An account or invoice reference is required.'; end if;
 if coalesce(cardinality(p_invoice_numbers),0)>200 then raise exception 'Read at most 200 invoice references per request.'; end if;
 with scoped as(select i.*,public.fc_collection_allocated_amount_v1(i.id) cash_allocated_amount,
   public.fc_collection_paid_amount_v1(i.id) settled_amount from public.customer_invoices i
   where (v_account is null or i.customer_account_id=v_account)
    and (p_invoice_numbers is null or i.invoice_number=any(p_invoice_numbers))
    and i.status='ISSUED' and upper(coalesce(i.financial_status,'ACTIVE'))<>'VOID')
 select jsonb_build_object('invoices',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object(
   'paid_amount',settled_amount,'remaining_amount',greatest(0,invoice_total-settled_amount),
   'amount_to_collect',greatest(0,invoice_total-settled_amount),
   'invoice_status',case when settled_amount>=invoice_total then 'PAID' when settled_amount>0 then 'PART PAID' else 'UNPAID' end)
   order by invoice_date,id) from scoped s),'[]'::jsonb),
  'wallet_applications',coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at,w.id) from public.customer_wallet_transactions w
    join scoped s on s.id=w.invoice_id and s.customer_account_id=w.customer_account_id
    where w.direction='DEBIT' and w.status='ACTIVE'),'[]'::jsonb)) into v_result;
 return v_result;
end; $$;
revoke all on function public.fc_invoice_financial_snapshot_v1(text,text,uuid,text[]) from public;
grant execute on function public.fc_invoice_financial_snapshot_v1(text,text,uuid,text[]) to anon,authenticated;

create or replace function public.fc_apply_customer_wallet_to_invoice_v1(p_username text,p_session_token text,p_invoice_id uuid,p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; i public.customer_invoices%rowtype; v_paid numeric; v_existing numeric; v_capacity numeric; v_apply numeric; v_balance numeric; v_today_paid boolean; v_remaining numeric;
begin
 select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'page.accounts.customer_credit');
 if lower(coalesce(a.staff_role,''))='customer' then raise exception 'Staff wallet access is required.' using errcode='42501'; end if;
 if p_amount is not null and (p_amount<=0 or round(p_amount,2)<>p_amount) then raise exception 'Wallet amount must be positive with at most two decimals.'; end if;
 select * into i from public.customer_invoices where id=p_invoice_id for update;
 if not found then raise exception 'Invoice was not found.'; end if;
 if upper(coalesce(i.financial_status,'ACTIVE'))='VOID' or i.status<>'ISSUED' then raise exception 'Wallet cannot be applied to a void/cancelled invoice.'; end if;
 -- Serialize the balance check against all Wallet writes, including return reversals.
 lock table public.customer_wallet_transactions in share row exclusive mode;
 v_existing:=coalesce(i.wallet_applied_amount,0);
 v_paid:=public.fc_collection_paid_amount_v1(i.id);
 v_today_paid:=i.invoice_date::date=current_date and v_paid>=i.invoice_total-0.01;
 v_capacity:=case when v_today_paid then greatest(0,i.invoice_total-v_existing) else greatest(0,i.invoice_total-v_paid) end;
 v_balance:=greatest(0,public.fc_customer_wallet_balance_v1(i.customer_account_id));
 v_apply:=round(least(v_balance,v_capacity,coalesce(p_amount,v_capacity)),2);
 if v_apply<=0 then raise exception 'This invoice has no outstanding amount or Wallet has no available credit.'; end if;
 insert into public.customer_wallet_transactions(customer_account_id,customer_branch_id,transaction_type,direction,amount,source_type,
  source_id,invoice_id,order_id,reference,notes,created_by,metadata)
 values(i.customer_account_id,i.customer_branch_id,case when v_today_paid then 'MANUAL_PAID_TODAY_INVOICE_DEBIT' else 'MANUAL_INVOICE_DEBIT' end,
  'DEBIT',v_apply,case when v_today_paid then 'CUSTOMER_INVOICE_MANUAL_PAID_TODAY' else 'CUSTOMER_INVOICE_MANUAL' end,
  i.id::text||':'||gen_random_uuid()::text,i.id,i.order_id,i.invoice_number,'Return / Wallet credit applied to invoice',a.username,
  jsonb_build_object('paid_before_wallet',v_paid,'preserve_paid_watermark',v_today_paid));
 update public.customer_invoices set wallet_applied_amount=v_existing+v_apply,wallet_application_mode=case when v_today_paid then 'MANUAL_PAID_TODAY' else 'MANUAL' end,
  wallet_preserve_paid_watermark=coalesce(wallet_preserve_paid_watermark,false) or v_today_paid,updated_at=now() where id=i.id;
 v_remaining:=greatest(0,i.invoice_total-public.fc_collection_paid_amount_v1(i.id));
 update public.customer_invoices set amount_to_collect=v_remaining where id=i.id;
 perform public.fc_sync_collection_invoice_status_v1(i.id);
 return jsonb_build_object('ok',true,'invoice_id',i.id,'invoice_number',i.invoice_number,'wallet_applied_now',v_apply,
  'wallet_applied_total',v_existing+v_apply,'amount_to_collect',v_remaining,'wallet_balance',public.fc_customer_wallet_balance_v1(i.customer_account_id),
  'today_paid_invoice',v_today_paid,'preserve_paid_watermark',v_today_paid);
end; $$;
revoke all on function public.fc_apply_customer_wallet_to_invoice_v1(text,text,uuid,numeric) from public;
grant execute on function public.fc_apply_customer_wallet_to_invoice_v1(text,text,uuid,numeric) to anon,authenticated;
notify pgrst,'reload schema';
commit;
