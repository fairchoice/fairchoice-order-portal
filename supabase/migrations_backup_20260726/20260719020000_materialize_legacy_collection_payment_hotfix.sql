-- Hotfix: expose legacy collection materialisation to PostgREST with the exact
-- argument names used by the Central Payment UI. The implementation reads
-- legacy rows through jsonb so it remains compatible with older schemas.

create extension if not exists pgcrypto;

drop function if exists public.materialize_legacy_collection_payment(text, text, text, text);

create function public.materialize_legacy_collection_payment(
  p_admin_username text,
  p_admin_password text,
  p_source_kind text,
  p_source_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source jsonb;
  v_payment public.customer_payments%rowtype;
  v_kind text := upper(trim(coalesce(p_source_kind, '')));
  v_account_id uuid;
  v_branch_id uuid;
  v_reference text;
  v_payment_date timestamptz;
  v_amount numeric(14,2);
  v_method text;
  v_paid_by text;
  v_notes text;
  v_idempotency_key text;
  v_created_at timestamptz;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username, p_admin_password);

  if v_kind = 'ORDER' then
    select to_jsonb(o) into v_source
    from public.orders o
    where o.id::text = p_source_id
    limit 1;

    if v_source is null then
      raise exception 'Order collection source % was not found', p_source_id;
    end if;

    v_account_id := nullif(v_source->>'customer_account_id', '')::uuid;
    if v_account_id is null then
      select ca.id into v_account_id
      from public.customer_accounts ca
      where lower(trim(ca.account_name)) = lower(trim(coalesce(v_source->>'company_name', '')))
      order by ca.created_at
      limit 1;
    end if;

    v_branch_id := coalesce(
      nullif(v_source->>'customer_branch_id', '')::uuid,
      nullif(v_source->>'branch_id', '')::uuid
    );
    v_reference := coalesce(nullif(trim(v_source->>'order_number'), ''), 'ORDER-' || p_source_id);
    v_payment_date := coalesce(
      nullif(v_source->>'updated_at', '')::timestamptz,
      nullif(v_source->>'created_at', '')::timestamptz,
      now()
    );
    v_amount := coalesce(
      nullif(v_source->>'payment_amount', '')::numeric,
      nullif(v_source->>'paid_amount', '')::numeric,
      0
    );
    v_method := coalesce(nullif(v_source->>'payment_type', ''), nullif(v_source->>'payment_method', ''), 'Other');
    v_paid_by := coalesce(v_source->>'paid_by', v_source->>'received_by', v_source->>'driver_name', '');
    v_notes := concat_ws(E'\n', nullif(v_source->>'notes', ''), 'Imported from order collection');
    v_idempotency_key := 'collection-order-' || p_source_id;
    v_created_at := coalesce(nullif(v_source->>'created_at', '')::timestamptz, now());
  else
    select to_jsonb(l) into v_source
    from public.customer_ledger l
    where l.id::text = p_source_id
    limit 1;

    if v_source is null then
      raise exception 'Ledger collection source % was not found', p_source_id;
    end if;

    v_account_id := nullif(v_source->>'customer_account_id', '')::uuid;
    v_branch_id := coalesce(
      nullif(v_source->>'customer_branch_id', '')::uuid,
      nullif(v_source->>'branch_id', '')::uuid
    );
    v_reference := coalesce(
      nullif(trim(v_source->>'reference_no'), ''),
      nullif(trim(v_source->>'reference'), ''),
      'LEDGER-' || p_source_id
    );
    v_payment_date := coalesce(
      nullif(v_source->>'payment_date', '')::timestamptz,
      nullif(v_source->>'created_at', '')::timestamptz,
      now()
    );
    v_amount := coalesce(
      nullif(v_source->>'credit', '')::numeric,
      nullif(v_source->>'payment_amount', '')::numeric,
      nullif(v_source->>'amount', '')::numeric,
      0
    );
    v_method := coalesce(nullif(v_source->>'payment_type', ''), nullif(v_source->>'payment_method', ''), 'Other');
    v_paid_by := coalesce(v_source->>'paid_by', v_source->>'who_paid', v_source->>'collected_by_name', v_source->>'received_by', '');
    v_notes := concat_ws(E'\n', nullif(v_source->>'notes', ''), 'Imported from customer ledger');
    v_idempotency_key := 'collection-ledger-' || p_source_id;
    v_created_at := coalesce(nullif(v_source->>'created_at', '')::timestamptz, now());
  end if;

  if v_account_id is null then
    raise exception 'Legacy collection % % has no customer account', v_kind, p_source_id;
  end if;
  if coalesce(v_amount, 0) <= 0 then
    raise exception 'Legacy collection % % has no positive payment amount', v_kind, p_source_id;
  end if;

  if v_method not in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other') then
    v_method := 'Other';
  end if;

  insert into public.customer_payments (
    customer_account_id,
    customer_branch_id,
    payment_reference,
    payment_date,
    amount,
    payment_method,
    paid_by,
    notes,
    source,
    idempotency_key,
    status,
    created_by,
    created_at,
    updated_at
  ) values (
    v_account_id,
    v_branch_id,
    v_reference,
    v_payment_date,
    v_amount,
    v_method,
    v_paid_by,
    v_notes,
    'COLLECTION',
    v_idempotency_key,
    'POSTED',
    coalesce(nullif(v_paid_by, ''), 'collection-import'),
    v_created_at,
    now()
  )
  on conflict do nothing;

  select p.* into v_payment
  from public.customer_payments p
  where p.idempotency_key = v_idempotency_key
     or (
       upper(trim(p.payment_reference)) = upper(trim(v_reference))
       and p.amount = v_amount
       and p.payment_date::date = v_payment_date::date
     )
  order by case when p.idempotency_key = v_idempotency_key then 0 else 1 end,
           p.created_at
  limit 1;

  if v_payment.id is null then
    raise exception 'Could not materialize legacy collection % %', v_kind, p_source_id;
  end if;

  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.materialize_legacy_collection_payment(text, text, text, text) from public;
grant execute on function public.materialize_legacy_collection_payment(text, text, text, text) to authenticated;

comment on function public.materialize_legacy_collection_payment(text, text, text, text)
is 'Converts an ORDER or LEDGER legacy collection into an editable/archivable customer payment.';

notify pgrst, 'reload schema';
