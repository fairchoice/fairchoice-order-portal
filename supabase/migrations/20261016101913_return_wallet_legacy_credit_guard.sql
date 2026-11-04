-- Do not turn an older return already represented as a payment into a second Wallet credit.
-- Those records require an explicit allocation reconciliation first.
begin;
create or replace function public.fc_return_credit_effect_v1(
  p_return_id uuid, p_actor text, p_staff_id uuid, p_staff_name text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  r public.customer_returns%rowtype; g public.financial_transactions%rowtype;
  w public.customer_wallet_transactions%rowtype; v_amount numeric; v_count integer;
begin
  select * into strict r from public.customer_returns where id=p_return_id for update;
  if r.reversed_at is not null or r.financial_disposition<>'CUSTOMER_CREDIT' then
    raise exception 'This return does not have an active customer credit.';
  end if;
  if r.customer_account_id is null then raise exception 'Link this return to its customer account before posting credit.'; end if;
  perform 1 from public.customer_accounts where id=r.customer_account_id for update;
  if not found then raise exception 'Return customer account was not found.'; end if;
  if coalesce(r.customer_branch_id,r.branch_id) is not null and not exists(
    select 1 from public.customer_branches where id=coalesce(r.customer_branch_id,r.branch_id)
      and customer_account_id=r.customer_account_id) then raise exception 'Return branch does not belong to this customer.'; end if;
  if exists(select 1 from public.customer_ledger where reference_no=r.return_number
    and source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY') and upper(entry_type)='PAYMENT'
    and coalesce(financial_status,'ACTIVE')<>'VOID') then
    raise exception 'This return is already recorded as a payment credit. Reconcile its existing payment allocations before moving or reversing the credit.';
  end if;
  v_amount:=round(r.return_total,2);
  if v_amount is null or v_amount<=0 or v_amount<>r.return_total then raise exception 'Return credit amount must be positive and have at most two decimals.'; end if;
  select * into g from public.financial_transactions where source_type='CUSTOMER_RETURN' and source_id=r.id::text for update;
  if found then
    if g.customer_account_id is distinct from r.customer_account_id or g.customer_branch_id is distinct from coalesce(r.customer_branch_id,r.branch_id)
      or g.amount<>v_amount or g.credit_amount<>v_amount or g.debit_amount<>0 or g.status<>'ACTIVE' then
      raise exception 'Existing return ledger credit conflicts with this approval. Reconciliation is required.';
    end if;
  else
    insert into public.financial_transactions(source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
      transaction_date,amount,debit_amount,credit_amount,reference,description,staff_id,staff_name,status,metadata,created_by)
    values('CUSTOMER_RETURN',r.id::text,'RETURN_CREDIT',r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),
      now(),v_amount,0,v_amount,r.return_number,'Approved customer return credit',p_staff_id,p_staff_name,'ACTIVE',
      jsonb_build_object('return_id',r.id,'return_number',r.return_number,'order_number',r.order_number,'financial_disposition','CUSTOMER_CREDIT'),p_actor)
    returning * into g;
  end if;
  select count(*) into v_count from public.customer_ledger where reference_no=r.return_number
    and source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY') and coalesce(financial_status,'ACTIVE')<>'VOID';
  if v_count>1 then raise exception 'Duplicate return ledger credits require reconciliation.'; end if;
  if v_count=0 then
    insert into public.customer_ledger(customer_name,entry_type,reference_no,debit,credit,notes,confirmed_by,
      customer_account_id,customer_branch_id,branch_id,branch_name,description,amount,order_number,price_mode,source,transaction_type,financial_status)
    values(r.customer_name,'RETURN_CREDIT',r.return_number,0,v_amount,'Customer return credited to Wallet',p_staff_name,
      r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),coalesce(r.customer_branch_id,r.branch_id),r.branch_name,
      'Customer return credit',v_amount,r.order_number,r.price_mode,'CUSTOMER_RETURN','RETURN_CREDIT','ACTIVE');
  elsif not exists(select 1 from public.customer_ledger where reference_no=r.return_number
    and source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY') and coalesce(financial_status,'ACTIVE')<>'VOID'
    and customer_account_id=r.customer_account_id and customer_branch_id is not distinct from coalesce(r.customer_branch_id,r.branch_id)
    and credit=v_amount and debit=0) then raise exception 'Return customer ledger credit conflicts with this approval.';
  end if;
  if exists(select 1 from public.customer_wallet_transactions where return_id is null and reference=r.return_number
    and direction='CREDIT' and status='ACTIVE') then raise exception 'An unlinked wallet credit with this return reference requires reconciliation.'; end if;
  select count(*) into v_count from public.customer_wallet_transactions where return_id=r.id and direction='CREDIT';
  if v_count>1 then raise exception 'Duplicate return wallet credits require reconciliation.'; end if;
  select * into w from public.customer_wallet_transactions where return_id=r.id and direction='CREDIT' for update;
  if found then
    if w.customer_account_id is distinct from r.customer_account_id or w.customer_branch_id is distinct from coalesce(r.customer_branch_id,r.branch_id)
      or w.amount<>v_amount or w.status<>'ACTIVE' then raise exception 'Existing return wallet credit conflicts with this approval.'; end if;
  else
    insert into public.customer_wallet_transactions(customer_account_id,customer_branch_id,transaction_type,direction,amount,
      source_type,source_id,return_id,order_id,reference,notes,created_by,metadata)
    values(r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),'RETURN_CREDIT','CREDIT',v_amount,
      'CUSTOMER_RETURN',r.id::text,r.id,r.order_id,r.return_number,'Approved customer return credit',p_actor,
      jsonb_build_object('financial_transaction_id',g.id)) returning * into w;
  end if;
  update public.customer_returns set ledger_transaction_id=g.id where id=r.id;
  return jsonb_build_object('ledger_transaction_id',g.id,'wallet_transaction_id',w.id,'wallet_credit',v_amount);
end;
$$;
create or replace function public.fc_reverse_customer_return_v1(p_username text,p_session_token text,p_return_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; r public.customer_returns%rowtype; w public.customer_wallet_transactions%rowtype; v_global_id uuid; v_reason text:=nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'returns.reverse');
  if regexp_replace(lower(coalesce(a.staff_role,'')),'[^a-z]','','g') not in ('admin','superadmin') then raise exception 'Return reversal role denied.' using errcode='42501'; end if;
  if v_reason is null then raise exception 'Reversal reason is required.'; end if;
  select * into r from public.customer_returns where id=p_return_id for update;
  if not found then raise exception 'Return was not found.'; end if;
  if r.reversed_at is not null then return jsonb_build_object('ok',true,'reversed',true,'duplicate',true); end if;
  if r.status<>'Confirmed' then raise exception 'Only a confirmed return can be reversed.'; end if;
  if exists(select 1 from public.customer_ledger where reference_no=r.return_number
    and source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY') and upper(entry_type)='PAYMENT'
    and coalesce(financial_status,'ACTIVE')<>'VOID') then
    raise exception 'This return is already recorded as a payment credit. Reconcile its existing payment allocations before moving or reversing the credit.';
  end if;
  if r.financial_disposition='CUSTOMER_CREDIT' then
    -- Block concurrent wallet writes while checking and debiting available credit.
    lock table public.customer_wallet_transactions in share row exclusive mode;
    select * into w from public.customer_wallet_transactions where return_id=r.id and direction='CREDIT' and status='ACTIVE' for update;
    if found then
      if w.customer_account_id is distinct from r.customer_account_id or w.amount is distinct from r.return_total then raise exception 'Return wallet scope or amount conflicts with the approval.'; end if;
      if public.fc_customer_wallet_balance_v1(w.customer_account_id)<w.amount then
        raise exception 'This return credit has already been used. Reverse its wallet applications before reversing approval.';
      end if;
      insert into public.customer_wallet_transactions(customer_account_id,customer_branch_id,transaction_type,direction,amount,
        source_type,source_id,return_id,reference,notes,created_by,metadata)
      values(w.customer_account_id,w.customer_branch_id,'RETURN_CREDIT_REVERSAL','DEBIT',w.amount,
        'CUSTOMER_RETURN_REVERSAL',r.id::text,r.id,r.return_number||'-REV',v_reason,a.username,jsonb_build_object('reversal_of',w.id));
    end if;
    if r.ledger_transaction_id is null then raise exception 'Original return ledger credit is missing. Reconciliation is required.'; end if;
    if not exists(select 1 from public.financial_transactions where id=r.ledger_transaction_id
      and source_type='CUSTOMER_RETURN' and source_id=r.id::text and credit_amount=r.return_total and status='ACTIVE'
      and customer_account_id is not distinct from r.customer_account_id) then raise exception 'Original return ledger credit conflicts with this reversal.'; end if;
    insert into public.financial_transactions(source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
      transaction_date,amount,debit_amount,credit_amount,reference,description,staff_id,staff_name,status,metadata,created_by)
    values('CUSTOMER_RETURN_REVERSAL',r.id::text,'RETURN_CREDIT_REVERSAL',r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),
      now(),r.return_total,r.return_total,0,r.return_number||'-REV','Customer return credit reversal',a.staff_id,a.staff_name,'ACTIVE',
      jsonb_build_object('reversal_of_transaction_id',r.ledger_transaction_id,'return_id',r.id,'reversal_reason',v_reason),a.username) returning id into v_global_id;
    insert into public.customer_ledger(customer_name,entry_type,reference_no,debit,credit,notes,confirmed_by,customer_account_id,
      customer_branch_id,branch_id,branch_name,description,amount,order_number,price_mode,source,transaction_type,financial_status)
    values(r.customer_name,'RETURN_CREDIT_REVERSAL',r.return_number||'-REV',r.return_total,0,v_reason,a.staff_name,r.customer_account_id,
      coalesce(r.customer_branch_id,r.branch_id),coalesce(r.customer_branch_id,r.branch_id),r.branch_name,'Customer return credit reversal',r.return_total,
      r.order_number,r.price_mode,'CUSTOMER_RETURN_REVERSAL','RETURN_CREDIT_REVERSAL','ACTIVE');
  end if;
  update public.customer_returns set reversal_ledger_transaction_id=v_global_id,reversed_by=a.staff_id,reversed_by_name=a.staff_name,
    reversed_at=now(),reversal_reason=v_reason,updated_at=now() where id=r.id;
  insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
  values('REVERSE','CUSTOMER_RETURN',r.id::text,r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),v_reason,to_jsonb(r),
    jsonb_build_object('reversed',true,'reversal_ledger_transaction_id',v_global_id),a.username);
  return jsonb_build_object('ok',true,'reversed',true,'duplicate',false,'reversal_ledger_transaction_id',v_global_id);
end;
$$;
revoke all on function public.fc_return_credit_effect_v1(uuid,text,uuid,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
