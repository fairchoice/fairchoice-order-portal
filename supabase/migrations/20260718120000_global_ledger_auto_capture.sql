-- Additive automatic capture for payments and invoices.

create or replace function public.sync_payment_to_global_ledger()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  v_transaction_id uuid;
begin
  insert into public.financial_transactions(
    source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
    transaction_date,amount,debit_amount,credit_amount,payment_method,reference,
    description,staff_name,status,metadata,created_by,created_at
  ) values (
    'CUSTOMER_PAYMENT',new.id::text,
    'PAYMENT',
    new.customer_account_id,new.customer_branch_id,new.payment_date,new.amount,0,
    case
      when upper(coalesce(to_jsonb(new)->>'verification_status','CONFIRMED'))
        in ('PENDING','PENDING_VERIFICATION','REJECTED')
        then 0
      when upper(coalesce(new.status,'POSTED'))
        in ('VOIDED','REVERSED','ARCHIVED','INACTIVE','CANCELLED')
        then 0
      else new.amount
    end,
    new.payment_method,new.payment_reference,new.notes,coalesce(new.paid_by,new.created_by),
    case
      when upper(coalesce(new.status,'POSTED'))
        in ('VOIDED','REVERSED','ARCHIVED','INACTIVE','CANCELLED')
        then 'VOIDED'
      else 'ACTIVE'
    end,
    jsonb_build_object(
      'source_status',new.status,
      'verification_status',to_jsonb(new)->>'verification_status',
      'payment_source',new.source
    ),
    new.created_by,new.created_at
  ) on conflict(source_type,source_id) do update set
    transaction_type=excluded.transaction_type,
    customer_account_id=excluded.customer_account_id,
    customer_branch_id=excluded.customer_branch_id,
    transaction_date=excluded.transaction_date,
    amount=excluded.amount,credit_amount=excluded.credit_amount,payment_method=excluded.payment_method,
    reference=excluded.reference,description=excluded.description,staff_name=excluded.staff_name,
    status=excluded.status,metadata=excluded.metadata,updated_by=excluded.created_by
  returning id into v_transaction_id;

  insert into public.financial_ledger_events (
    transaction_id, event_type, actor, event_data
  )
  values (
    v_transaction_id,
    'CREATE',
    coalesce(nullif(new.created_by, ''), nullif(new.paid_by, ''), 'SYSTEM'),
    jsonb_build_object(
      'source_type', 'CUSTOMER_PAYMENT',
      'source_id', new.id::text
    )
  )
  on conflict (transaction_id) where event_type = 'CREATE' do nothing;
  return new;
end $$;

drop trigger if exists customer_payments_global_ledger_sync on public.customer_payments;
create trigger customer_payments_global_ledger_sync
after insert or update on public.customer_payments
for each row execute function public.sync_payment_to_global_ledger();

revoke execute on function public.sync_payment_to_global_ledger()
  from public, anon, authenticated;

create or replace function public.sync_invoice_to_global_ledger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.financial_transactions(
    source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
    transaction_date,amount,debit_amount,credit_amount,reference,description,
    status,metadata,created_by,created_at
  ) values (
    'CUSTOMER_INVOICE',new.id::text,'INVOICE',new.customer_account_id,new.customer_branch_id,
    new.invoice_date,new.invoice_total,new.invoice_total,0,new.invoice_number,
    'Customer invoice '||new.invoice_number,
    case when upper(coalesce(new.status,'ISSUED'))='CANCELLED' then 'VOIDED' else 'ACTIVE' end,
    jsonb_build_object('invoice_status',new.status,'order_id',new.order_id),new.created_by,new.created_at
  ) on conflict(source_type,source_id) do update set
    transaction_date=excluded.transaction_date,amount=excluded.amount,debit_amount=excluded.debit_amount,
    reference=excluded.reference,description=excluded.description,status=excluded.status,
    metadata=excluded.metadata,updated_by=excluded.created_by;
  return new;
end $$;

drop trigger if exists customer_invoices_global_ledger_sync on public.customer_invoices;
create trigger customer_invoices_global_ledger_sync
after insert or update on public.customer_invoices
for each row execute function public.sync_invoice_to_global_ledger();

revoke execute on function public.sync_invoice_to_global_ledger()
  from public, anon, authenticated;

insert into public.financial_transactions(
  source_type,source_id,transaction_type,customer_account_id,customer_branch_id,
  transaction_date,amount,debit_amount,credit_amount,reference,description,status,
  metadata,created_by,created_at
)
select 'CUSTOMER_INVOICE',i.id::text,'INVOICE',i.customer_account_id,i.customer_branch_id,
  i.invoice_date,i.invoice_total,i.invoice_total,0,i.invoice_number,
  'Customer invoice '||i.invoice_number,
  case when upper(coalesce(i.status,'ISSUED'))='CANCELLED' then 'VOIDED' else 'ACTIVE' end,
  jsonb_build_object('invoice_status',i.status,'order_id',i.order_id),i.created_by,i.created_at
from public.customer_invoices i
on conflict(source_type,source_id) do nothing;
