-- Complete legacy collection backfill, add on-demand materialisation, and protect
-- core financial records from direct deletion by anyone except nisstaj_admin.

create extension if not exists pgcrypto;

-- Backfill collection rows already present in customer_ledger.
insert into public.customer_payments (
  customer_account_id, customer_branch_id, payment_reference, payment_date,
  amount, payment_method, paid_by, notes, source, idempotency_key,
  status, created_by, created_at, updated_at
)
select
  l.customer_account_id,
  l.customer_branch_id,
  coalesce(nullif(trim(l.reference_no), ''), 'LEDGER-' || l.id::text),
  coalesce(l.payment_date, l.created_at, now()),
  coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0)),
  case when l.payment_type in ('Cash','Card','Bank Transfer','Cheque','Other') then l.payment_type else 'Other' end,
  coalesce(l.paid_by, l.who_paid, l.collected_by_name, l.received_by, ''),
  concat_ws(E'\n', nullif(l.notes, ''), 'Imported from customer ledger'),
  'COLLECTION',
  'collection-ledger-' || l.id::text,
  'POSTED',
  coalesce(l.collected_by_name, l.received_by, l.paid_by, 'collection-backfill'),
  coalesce(l.created_at, now()), now()
from public.customer_ledger l
where l.customer_account_id is not null
  and upper(coalesce(l.entry_type, l.transaction_type, '')) in ('PAYMENT','COLLECTION')
  and coalesce(nullif(l.credit, 0), nullif(l.payment_amount, 0), nullif(l.amount, 0), 0) > 0
  and not exists (
    select 1 from public.customer_payments p
    where p.idempotency_key = 'collection-ledger-' || l.id::text
       or (upper(trim(p.payment_reference)) = upper(trim(coalesce(nullif(l.reference_no,''),'LEDGER-'||l.id::text)))
           and p.amount = coalesce(nullif(l.credit,0),nullif(l.payment_amount,0),nullif(l.amount,0))
           and p.payment_date::date = coalesce(l.payment_date,l.created_at,now())::date)
  );

-- Backfill order collections not represented in customer_ledger.
insert into public.customer_payments (
  customer_account_id, customer_branch_id, payment_reference, payment_date,
  amount, payment_method, paid_by, notes, source, idempotency_key,
  status, created_by, created_at, updated_at
)
select
  coalesce(o.customer_account_id, ca.id),
  o.customer_branch_id,
  coalesce(nullif(trim(o.order_number), ''), 'ORDER-' || o.id::text),
  coalesce(o.updated_at, o.created_at, now()),
  o.payment_amount,
  case when o.payment_type in ('Cash','Card','Bank Transfer','Cheque','Other') then o.payment_type else 'Other' end,
  coalesce(o.paid_by, o.received_by, o.driver_name, ''),
  concat_ws(E'\n', 'Imported from order collection', nullif(o.driver_name,'')),
  'COLLECTION',
  'collection-order-' || o.id::text,
  'POSTED',
  coalesce(o.received_by, o.paid_by, o.driver_name, 'collection-backfill'),
  coalesce(o.created_at, now()), now()
from public.orders o
left join public.customer_accounts ca
  on lower(trim(ca.account_name)) = lower(trim(o.company_name))
where coalesce(o.payment_collected, 'No') = 'Yes'
  and coalesce(o.payment_amount, 0) > 0
  and coalesce(o.customer_account_id, ca.id) is not null
  and not exists (
    select 1 from public.customer_payments p
    where p.idempotency_key = 'collection-order-' || o.id::text
       or (upper(trim(p.payment_reference)) = upper(trim(coalesce(nullif(o.order_number,''),'ORDER-'||o.id::text)))
           and p.amount = o.payment_amount
           and p.payment_date::date = coalesce(o.updated_at,o.created_at,now())::date)
  );

create or replace function public.materialize_legacy_collection_payment(
  p_admin_username text,
  p_admin_password text,
  p_source_kind text,
  p_source_id text
) returns jsonb
language plpgsql security definer set search_path=public
as $$
declare v_payment public.customer_payments%rowtype;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username,p_admin_password);

  if upper(p_source_kind) = 'ORDER' then
    insert into public.customer_payments (
      customer_account_id, customer_branch_id, payment_reference, payment_date,
      amount, payment_method, paid_by, notes, source, idempotency_key,
      status, created_by, created_at, updated_at
    )
    select coalesce(o.customer_account_id,ca.id), o.customer_branch_id,
      coalesce(nullif(trim(o.order_number),''),'ORDER-'||o.id::text),
      coalesce(o.updated_at,o.created_at,now()), o.payment_amount,
      case when o.payment_type in ('Cash','Card','Bank Transfer','Cheque','Other') then o.payment_type else 'Other' end,
      coalesce(o.paid_by,o.received_by,o.driver_name,''), 'Imported from order collection',
      'COLLECTION','collection-order-'||o.id::text,'POSTED',
      coalesce(o.received_by,o.paid_by,o.driver_name,'collection-import'),coalesce(o.created_at,now()),now()
    from public.orders o
    left join public.customer_accounts ca on lower(trim(ca.account_name))=lower(trim(o.company_name))
    where o.id::text=p_source_id
    on conflict do nothing;
    select * into v_payment from public.customer_payments where idempotency_key='collection-order-'||p_source_id limit 1;
  else
    insert into public.customer_payments (
      customer_account_id, customer_branch_id, payment_reference, payment_date,
      amount, payment_method, paid_by, notes, source, idempotency_key,
      status, created_by, created_at, updated_at
    )
    select l.customer_account_id,l.customer_branch_id,
      coalesce(nullif(trim(l.reference_no),''),'LEDGER-'||l.id::text),
      coalesce(l.payment_date,l.created_at,now()),
      coalesce(nullif(l.credit,0),nullif(l.payment_amount,0),nullif(l.amount,0)),
      case when l.payment_type in ('Cash','Card','Bank Transfer','Cheque','Other') then l.payment_type else 'Other' end,
      coalesce(l.paid_by,l.who_paid,l.collected_by_name,l.received_by,''),
      concat_ws(E'\n',nullif(l.notes,''),'Imported from customer ledger'),
      'COLLECTION','collection-ledger-'||l.id::text,'POSTED',
      coalesce(l.collected_by_name,l.received_by,l.paid_by,'collection-import'),coalesce(l.created_at,now()),now()
    from public.customer_ledger l where l.id::text=p_source_id
    on conflict do nothing;
    select * into v_payment from public.customer_payments where idempotency_key='collection-ledger-'||p_source_id limit 1;
  end if;

  if v_payment.id is null then raise exception 'Could not materialize legacy collection % %',p_source_kind,p_source_id; end if;
  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.materialize_legacy_collection_payment(text,text,text,text) from public;
grant execute on function public.materialize_legacy_collection_payment(text,text,text,text) to authenticated;

-- Direct deletes are blocked for ordinary users. Archiving remains the normal action.
create or replace function public.block_core_financial_delete()
returns trigger language plpgsql as $$
declare v_claims jsonb; v_actor text;
begin
  if current_user in ('postgres','service_role','supabase_admin') then return old; end if;
  begin v_claims := nullif(current_setting('request.jwt.claims',true),'')::jsonb; exception when others then v_claims := '{}'::jsonb; end;
  v_actor := lower(coalesce(v_claims->>'email',v_claims->>'user_name',v_claims->>'username',v_claims->'user_metadata'->>'username',''));
  if v_actor not in ('nisstaj_admin','nisstaj_admin@fairchoice.co.uk') then
    raise exception 'Permanent deletion is restricted to nisstaj_admin. Archive the record instead.';
  end if;
  return old;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['orders','customer_accounts','customer_invoices','customer_payments'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists protect_%I_delete on public.%I',t,t);
      execute format('create trigger protect_%I_delete before delete on public.%I for each row execute function public.block_core_financial_delete()',t,t);
      execute format('revoke delete on table public.%I from anon, authenticated',t);
    end if;
  end loop;
end $$;
