-- Return credits belong to a verified customer and enter Wallet once.
-- Existing orphaned returns are repaired only by an explicit admin action.
begin;
alter table public.customer_returns add column if not exists price_mode text;

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
revoke all on function public.fc_return_credit_effect_v1(uuid,text,uuid,text) from public,anon,authenticated;

create or replace function public.fc_approve_customer_return_v1(
  p_username text,p_session_token text,p_return_id uuid,p_approval_note text default null,p_financial_disposition text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; r public.customer_returns%rowtype; v_disposition text:=upper(trim(coalesce(p_financial_disposition,''))); v_effect jsonb:='{}'; v_duplicate boolean;
begin
  select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'returns.approve');
  if regexp_replace(lower(coalesce(a.staff_role,'')),'[^a-z]','','g') not in ('admin','superadmin','warehouse') then raise exception 'Return approval role denied.' using errcode='42501'; end if;
  if v_disposition not in ('CUSTOMER_CREDIT','NO_CREDIT') then raise exception 'Select a valid return financial effect.'; end if;
  select * into r from public.customer_returns where id=p_return_id for update;
  if not found then raise exception 'Return was not found.'; end if;
  if r.reversed_at is not null then raise exception 'A reversed return cannot be approved again.'; end if;
  if r.status not in ('Pending Warehouse Confirmation','Confirmed') then raise exception 'This return is not eligible for approval.'; end if;
  v_duplicate:=r.status='Confirmed';
  if v_duplicate and r.financial_disposition is distinct from v_disposition then raise exception 'The return was already approved with a different financial effect.'; end if;
  if not v_duplicate then
    update public.customer_returns set financial_disposition=v_disposition where id=r.id;
  end if;
  if v_disposition='CUSTOMER_CREDIT' then v_effect:=public.fc_return_credit_effect_v1(r.id,a.username,a.staff_id,a.staff_name); end if;
  if not v_duplicate then
    update public.customer_returns set status='Confirmed',approval_note=nullif(trim(coalesce(p_approval_note,'')),''),
      confirmed_by=a.staff_id,confirmed_by_name=a.staff_name,confirmed_by_role=a.staff_role,confirmed_at=now(),updated_at=now() where id=r.id;
    insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
    values('APPROVE','CUSTOMER_RETURN',r.id::text,r.customer_account_id,coalesce(r.customer_branch_id,r.branch_id),p_approval_note,to_jsonb(r),
      jsonb_build_object('financial_disposition',v_disposition,'wallet',v_effect),a.username);
  end if;
  return jsonb_build_object('ok',true,'return_id',r.id,'status','Confirmed','financial_disposition',v_disposition,'duplicate',v_duplicate)||v_effect;
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

create or replace function public.fc_link_customer_return_v1(p_username text,p_session_token text,p_return_id uuid,
  p_customer_account_id uuid,p_customer_branch_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a record; r public.customer_returns%rowtype; v_name text; v_branch text; v_effect jsonb:='{}';
begin
  select * into strict a from public.fc_require_session_permission_v2(p_username,p_session_token,'returns.reconcile');
  if regexp_replace(lower(coalesce(a.staff_role,'')),'[^a-z]','','g') not in ('admin','superadmin') then raise exception 'Return reconciliation role denied.' using errcode='42501'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Customer linking reason is required.'; end if;
  select * into r from public.customer_returns where id=p_return_id for update;
  if not found then raise exception 'Return was not found.'; end if;
  if r.customer_account_id is not null and (r.customer_account_id is distinct from p_customer_account_id
    or coalesce(r.customer_branch_id,r.branch_id) is distinct from p_customer_branch_id) then raise exception 'An already linked return cannot be moved to another customer or branch.'; end if;
  select account_name into v_name from public.customer_accounts where id=p_customer_account_id for update;
  if not found then raise exception 'Select a valid customer account.'; end if;
  if p_customer_branch_id is not null then
    select branch_name into v_branch from public.customer_branches where id=p_customer_branch_id and customer_account_id=p_customer_account_id;
    if not found then raise exception 'Selected branch does not belong to the customer.'; end if;
  end if;
  if r.order_id is not null and not exists(select 1 from public.orders where id=r.order_id
    and customer_account_id=p_customer_account_id and coalesce(customer_branch_id,branch_id) is not distinct from p_customer_branch_id) then
    raise exception 'Selected customer and branch do not match the original order.';
  end if;
  if exists(select 1 from public.financial_transactions where source_type in ('CUSTOMER_RETURN','CUSTOMER_RETURN_REVERSAL') and source_id=r.id::text
    and customer_account_id is not null and customer_account_id is distinct from p_customer_account_id) then raise exception 'Existing return financial records belong to another customer.'; end if;
  if exists(select 1 from public.customer_wallet_transactions where return_id=r.id and customer_account_id is distinct from p_customer_account_id) then raise exception 'Existing return wallet records belong to another customer.'; end if;
  if exists(select 1 from public.customer_ledger where source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY','CUSTOMER_RETURN_REVERSAL')
    and reference_no in (r.return_number,r.return_number||'-REV') and customer_account_id is not null and customer_account_id is distinct from p_customer_account_id) then
    raise exception 'Existing customer ledger credit belongs to another customer.';
  end if;
  update public.customer_returns set customer_account_id=p_customer_account_id,customer_branch_id=p_customer_branch_id,branch_id=p_customer_branch_id,
    customer_name=v_name,branch_name=v_branch,updated_at=now() where id=r.id;
  update public.financial_transactions set customer_account_id=p_customer_account_id,customer_branch_id=p_customer_branch_id
    where source_type in ('CUSTOMER_RETURN','CUSTOMER_RETURN_REVERSAL') and source_id=r.id::text;
  update public.customer_ledger set customer_account_id=p_customer_account_id,customer_branch_id=p_customer_branch_id,branch_id=p_customer_branch_id,
    customer_name=v_name,branch_name=v_branch where (reference_no=r.return_number and source in ('CUSTOMER_RETURN','CUSTOMER_RETURN_COMPATIBILITY'))
    or (reference_no=r.return_number||'-REV' and source='CUSTOMER_RETURN_REVERSAL');
  if r.status='Confirmed' and r.reversed_at is null and r.financial_disposition='CUSTOMER_CREDIT' then
    v_effect:=public.fc_return_credit_effect_v1(r.id,a.username,a.staff_id,a.staff_name);
  end if;
  insert into public.financial_audit_log(action,entity_type,entity_id,customer_account_id,customer_branch_id,reason,before_data,after_data,changed_by)
  values('LINK_CUSTOMER','CUSTOMER_RETURN',r.id::text,p_customer_account_id,p_customer_branch_id,p_reason,to_jsonb(r),
    jsonb_build_object('customer_account_id',p_customer_account_id,'customer_branch_id',p_customer_branch_id,'wallet',v_effect),a.username);
  return jsonb_build_object('ok',true,'return_id',r.id,'customer_account_id',p_customer_account_id)||v_effect;
end;
$$;
revoke all on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) from public;
revoke all on function public.fc_reverse_customer_return_v1(text,text,uuid,text) from public;
revoke all on function public.fc_link_customer_return_v1(text,text,uuid,uuid,uuid,text) from public;
grant execute on function public.fc_approve_customer_return_v1(text,text,uuid,text,text) to anon,authenticated;
grant execute on function public.fc_reverse_customer_return_v1(text,text,uuid,text) to anon,authenticated;
grant execute on function public.fc_link_customer_return_v1(text,text,uuid,uuid,uuid,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
