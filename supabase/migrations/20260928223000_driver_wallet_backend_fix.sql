-- Driver Wallet backend fix
-- Scope: add missing wallet backend required by Driver cash collection.
-- No historical invoice/payment/customer-credit rows are modified.


create table if not exists public.customer_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_account_id uuid not null references public.customer_accounts(id),
  customer_branch_id uuid references public.customer_branches(id),
  transaction_type text not null,
  direction text not null check (direction in ('CREDIT','DEBIT')),
  amount numeric not null check (amount > 0),
  source_type text not null,
  source_id text,
  return_id uuid references public.customer_returns(id),
  invoice_id uuid references public.customer_invoices(id),
  order_id uuid references public.orders(id),
  reference text,
  notes text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','VOID')),
  metadata jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);


create index if not exists customer_wallet_account_created_idx
  on public.customer_wallet_transactions(customer_account_id, created_at, id);


create unique index if not exists customer_wallet_unique_source_txn
  on public.customer_wallet_transactions(source_type, source_id, transaction_type)
  where source_id is not null and status='ACTIVE';


alter table public.customer_invoices
  add column if not exists wallet_applied_amount numeric not null default 0,
  add column if not exists amount_to_collect numeric,
  add column if not exists wallet_application_mode text,
  add column if not exists wallet_preserve_paid_watermark boolean not null default false;


create or replace function public.fc_customer_wallet_balance_v1(p_customer_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public','extensions'
as $$
  select round(coalesce(sum(
    case
      when status <> 'ACTIVE' then 0
      when direction = 'CREDIT' then amount
      when direction = 'DEBIT' then -amount
      else 0
    end
  ),0)::numeric,2)
  from public.customer_wallet_transactions
  where customer_account_id = p_customer_account_id;
$$;


create or replace function public.fc_get_delivery_wallet_preview_v1(
  p_username text,
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_invoice public.customer_invoices%rowtype;
  v_balance numeric := 0;
  v_reserved numeric := 0;
  v_applied numeric := 0;
  v_invoice_total numeric := 0;
  v_amount_to_collect numeric := 0;
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'page.operations.driver'
  );


  select * into v_order
  from public.orders
  where id=p_order_id;


  if not found then
    raise exception 'Order was not found.';
  end if;


  select * into v_invoice
  from public.customer_invoices
  where order_id=v_order.id
    and upper(coalesce(financial_status,'ACTIVE')) <> 'VOID'
    and upper(coalesce(status,'ISSUED')) <> 'CANCELLED'
  order by created_at desc
  limit 1;


  v_balance := greatest(public.fc_customer_wallet_balance_v1(v_order.customer_account_id),0);
  v_reserved := greatest(coalesce(v_order.wallet_applied_amount, v_order.wallet_requested_amount, 0),0);
  v_applied := greatest(coalesce(v_invoice.wallet_applied_amount,0), v_reserved);
  v_invoice_total := coalesce(v_invoice.invoice_total, v_order.order_total, 0);
  v_amount_to_collect := case
    when v_invoice.id is not null and v_invoice.amount_to_collect is not null
      then least(v_invoice.amount_to_collect, greatest(v_invoice_total-v_applied,0))
    else greatest(v_invoice_total-v_applied,0)
  end;


  return jsonb_build_object(
    'order_id',v_order.id,
    'order_number',v_order.order_number,
    'customer_account_id',v_order.customer_account_id,
    'wallet_balance',round(v_balance::numeric,2),
    'wallet_reserved_amount',round(v_reserved::numeric,2),
    'invoice_id',v_invoice.id,
    'invoice_number',v_invoice.invoice_number,
    'invoice_total',round(v_invoice_total::numeric,2),
    'wallet_applied_amount',round(v_applied::numeric,2),
    'amount_to_collect',round(v_amount_to_collect::numeric,2),
    'already_applied',v_applied>0,
    'reserved_on_order',v_reserved>0
  );
end;
$$;


create or replace function public.fc_apply_delivery_wallet_v1(
  p_username text,
  p_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_actor record;
  v_order public.orders%rowtype;
  v_invoice public.customer_invoices%rowtype;
  v_balance numeric := 0;
  v_paid numeric := 0;
  v_existing numeric := 0;
  v_reserved numeric := 0;
  v_collect numeric := 0;
  v_apply numeric := 0;
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'page.operations.driver'
  );


  select * into v_order
  from public.orders
  where id=p_order_id
  for update;


  if not found then raise exception 'Order was not found.'; end if;


  if lower(trim(coalesce(v_order.status,''))) <> 'delivered' then
    raise exception 'Wallet can only be applied in the delivery flow after delivery confirmation.';
  end if;


  if v_order.customer_account_id is null then
    raise exception 'Order has no customer account.';
  end if;


  select * into v_invoice
  from public.customer_invoices
  where order_id=v_order.id
    and upper(coalesce(financial_status,'ACTIVE')) <> 'VOID'
    and upper(coalesce(status,'ISSUED')) <> 'CANCELLED'
  order by created_at desc
  limit 1
  for update;


  if not found then raise exception 'Delivery invoice was not found.'; end if;


  v_reserved := greatest(coalesce(v_order.wallet_applied_amount,0),0);


  if v_reserved > 0 then
    update public.customer_wallet_transactions
    set invoice_id=v_invoice.id,
        reference=v_invoice.invoice_number,
        notes='Wallet selected on order and applied to delivery invoice',
        metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'application_mode','ORDER_SELECTED_DELIVERY',
          'invoice_number',v_invoice.invoice_number
        )
    where order_id=v_order.id
      and transaction_type='ORDER_RESERVATION'
      and status='ACTIVE';


    update public.customer_invoices
    set wallet_applied_amount=v_reserved,
        amount_to_collect=round(greatest(coalesce(invoice_total,0)-v_reserved,0)::numeric,2),
        wallet_application_mode='ORDER_SELECTED_DELIVERY',
        updated_at=now()
    where id=v_invoice.id;


    return jsonb_build_object(
      'ok',true,
      'already_reserved',true,
      'invoice_id',v_invoice.id,
      'invoice_number',v_invoice.invoice_number,
      'wallet_applied_now',0,
      'wallet_applied_total',v_reserved,
      'amount_to_collect',round(greatest(coalesce(v_invoice.invoice_total,0)-v_reserved,0)::numeric,2),
      'wallet_balance',public.fc_customer_wallet_balance_v1(v_order.customer_account_id)
    );
  end if;


  select coalesce(sum(a.allocated_amount),0)
    into v_paid
  from public.customer_payment_allocations a
  where a.customer_account_id=v_invoice.customer_account_id
    and (a.invoice_reference=v_invoice.invoice_number or a.invoice_source_id=v_invoice.id::text)
    and a.reversed_at is null
    and a.voided_at is null
    and upper(coalesce(a.status,'ACTIVE')) not in ('VOID','VOIDED','REVERSED','CANCELLED','CANCELED');


  if coalesce(v_paid,0) > 0.01 then
    raise exception 'Payment already exists for this invoice. Use Customer Wallet manual application instead.';
  end if;


  v_existing := greatest(coalesce(v_invoice.wallet_applied_amount,0),0);
  v_collect := greatest(coalesce(v_invoice.invoice_total,0)-v_existing,0);
  v_balance := greatest(public.fc_customer_wallet_balance_v1(v_order.customer_account_id),0);
  v_apply := round(least(v_balance,v_collect)::numeric,2);


  if v_apply <= 0 then
    raise exception 'Customer Wallet has no available balance.';
  end if;


  insert into public.customer_wallet_transactions(
    customer_account_id,customer_branch_id,transaction_type,direction,amount,
    source_type,source_id,invoice_id,order_id,reference,notes,created_by,metadata
  ) values (
    v_invoice.customer_account_id,
    v_invoice.customer_branch_id,
    'DELIVERY_INVOICE_DEBIT',
    'DEBIT',
    v_apply,
    'CUSTOMER_INVOICE_DELIVERY',
    v_invoice.id::text,
    v_invoice.id,
    v_invoice.order_id,
    v_invoice.invoice_number,
    'Wallet used at delivery because customer selected Use Wallet Money',
    v_actor.username,
    jsonb_build_object('application_mode','DELIVERY_SELECTED','staff_name',v_actor.staff_name,'order_number',v_order.order_number)
  )
  on conflict do nothing;


  update public.customer_invoices
  set wallet_applied_amount=round((v_existing+v_apply)::numeric,2),
      amount_to_collect=round(greatest(coalesce(invoice_total,0)-v_existing-v_apply,0)::numeric,2),
      wallet_application_mode='DELIVERY_SELECTED',
      updated_at=now()
  where id=v_invoice.id;


  update public.orders
  set wallet_use_requested=true,
      wallet_requested_amount=v_apply,
      wallet_requested_at=now(),
      wallet_applied_amount=v_apply,
      updated_at=now()
  where id=v_order.id;


  return jsonb_build_object(
    'ok',true,'already_reserved',false,
    'invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,
    'wallet_applied_now',v_apply,'wallet_applied_total',round((v_existing+v_apply)::numeric,2),
    'amount_to_collect',round(greatest(coalesce(v_invoice.invoice_total,0)-v_existing-v_apply,0)::numeric,2),
    'wallet_balance',public.fc_customer_wallet_balance_v1(v_order.customer_account_id)
  );
end;
$$;


grant execute on function public.fc_customer_wallet_balance_v1(uuid) to anon, authenticated;
grant execute on function public.fc_get_delivery_wallet_preview_v1(text,text,uuid) to anon, authenticated;
grant execute on function public.fc_apply_delivery_wallet_v1(text,text,uuid) to anon, authenticated;


notify pgrst, 'reload schema';