-- Apply only after the canonical writer is installed and all frontend payment
-- writers have been deployed and verified.

create or replace function public.reject_direct_customer_ledger_payment_write_v1()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
       upper(coalesce(nullif(trim(new.transaction_type), ''), '')) = 'PAYMENT'
       or (
         upper(coalesce(nullif(trim(new.entry_type), ''), '')) = 'PAYMENT'
         and upper(coalesce(nullif(trim(new.transaction_type), ''), 'PAYMENT'))
           in ('PAYMENT', 'COLLECTION')
       )
     )
     and pg_trigger_depth() <= 1
     and not (
       tg_op = 'UPDATE'
       and new.central_payment_id is distinct from old.central_payment_id
       and (
         to_jsonb(new) - 'central_payment_id' - 'updated_at'
       ) = (
         to_jsonb(old) - 'central_payment_id' - 'updated_at'
       )
     ) then
    raise exception
      'Direct customer_ledger PAYMENT writes are disabled. Post through the canonical customer payment service.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_ledger_reject_direct_payment_write_v1
  on public.customer_ledger;
create trigger customer_ledger_reject_direct_payment_write_v1
before insert or update on public.customer_ledger
for each row
execute function public.reject_direct_customer_ledger_payment_write_v1();

revoke all on function public.reject_direct_customer_ledger_payment_write_v1()
  from public;

comment on function public.reject_direct_customer_ledger_payment_write_v1() is
  'Prevents future PAYMENT rows from originating directly in customer_ledger while preserving non-payment ledger entries.';
