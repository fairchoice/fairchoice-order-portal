-- Make customer_payments the single source of truth for Payment History and Customer Credit.
-- This migration is idempotent and does not physically delete business records.

-- 1) Backfill legacy customer_ledger payment/collection rows.
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
  transaction_type,
  verification_status,
  created_at,
  updated_at
)
select
  nullif(to_jsonb(l)->>'customer_account_id', '')::uuid,
  nullif(to_jsonb(l)->>'customer_branch_id', '')::uuid,
  coalesce(
    nullif(trim(to_jsonb(l)->>'payment_reference'), ''),
    nullif(trim(to_jsonb(l)->>'reference_no'), ''),
    nullif(trim(to_jsonb(l)->>'order_number'), ''),
    'LEDGER-' || l.id::text
  ),
  coalesce(
    nullif(to_jsonb(l)->>'payment_date', '')::timestamptz,
    nullif(to_jsonb(l)->>'collection_date', '')::timestamptz,
    l.created_at,
    now()
  ),
  coalesce(
    nullif(to_jsonb(l)->>'credit', '')::numeric,
    nullif(to_jsonb(l)->>'payment_amount', '')::numeric,
    nullif(to_jsonb(l)->>'paid_amount', '')::numeric,
    nullif(to_jsonb(l)->>'amount', '')::numeric,
    0
  ),
  case
    when coalesce(to_jsonb(l)->>'payment_method', to_jsonb(l)->>'payment_type', '') in ('Cash','Card','Bank Transfer','Cheque','Other')
      then coalesce(to_jsonb(l)->>'payment_method', to_jsonb(l)->>'payment_type')
    else 'Other'
  end,
  coalesce(
    nullif(trim(to_jsonb(l)->>'paid_by'), ''),
    nullif(trim(to_jsonb(l)->>'who_paid'), ''),
    nullif(trim(to_jsonb(l)->>'collected_by_name'), ''),
    nullif(trim(to_jsonb(l)->>'received_by'), ''),
    'Legacy collection'
  ),
  concat_ws(E'\n',
    nullif(trim(to_jsonb(l)->>'notes'), ''),
    nullif(trim(to_jsonb(l)->>'description'), ''),
    'Imported from customer_ledger'
  ),
  'COLLECTION',
  'legacy-ledger-' || l.id::text,
  'POSTED',
  coalesce(nullif(trim(to_jsonb(l)->>'created_by'), ''), 'migration'),
  'PAYMENT',
  'CONFIRMED',
  coalesce(l.created_at, now()),
  now()
from public.customer_ledger l
where upper(coalesce(to_jsonb(l)->>'entry_type', to_jsonb(l)->>'transaction_type', '')) in ('PAYMENT','COLLECTION')
  and nullif(to_jsonb(l)->>'customer_account_id', '') is not null
  and coalesce(
    nullif(to_jsonb(l)->>'credit', '')::numeric,
    nullif(to_jsonb(l)->>'payment_amount', '')::numeric,
    nullif(to_jsonb(l)->>'paid_amount', '')::numeric,
    nullif(to_jsonb(l)->>'amount', '')::numeric,
    0
  ) > 0
  and not exists (
    select 1
    from public.customer_payments p
    where p.idempotency_key = 'legacy-ledger-' || l.id::text
       or (
         p.customer_account_id = nullif(to_jsonb(l)->>'customer_account_id', '')::uuid
         and upper(coalesce(p.payment_reference, '')) = upper(coalesce(
           nullif(trim(to_jsonb(l)->>'payment_reference'), ''),
           nullif(trim(to_jsonb(l)->>'reference_no'), ''),
           nullif(trim(to_jsonb(l)->>'order_number'), ''),
           'LEDGER-' || l.id::text
         ))
         and p.amount = coalesce(
           nullif(to_jsonb(l)->>'credit', '')::numeric,
           nullif(to_jsonb(l)->>'payment_amount', '')::numeric,
           nullif(to_jsonb(l)->>'paid_amount', '')::numeric,
           nullif(to_jsonb(l)->>'amount', '')::numeric,
           0
         )
       )
  );

-- 2) Backfill order-level collections that never reached customer_ledger.
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
  transaction_type,
  verification_status,
  created_at,
  updated_at
)
select
  nullif(to_jsonb(o)->>'customer_account_id', '')::uuid,
  coalesce(
    nullif(to_jsonb(o)->>'customer_branch_id', '')::uuid,
    nullif(to_jsonb(o)->>'branch_id', '')::uuid,
    nullif(to_jsonb(o)->>'delivery_branch_id', '')::uuid
  ),
  coalesce(
    nullif(trim(to_jsonb(o)->>'order_number'), ''),
    nullif(trim(to_jsonb(o)->>'orderId'), ''),
    'ORDER-' || o.id::text
  ),
  coalesce(
    nullif(to_jsonb(o)->>'collection_date', '')::timestamptz,
    nullif(to_jsonb(o)->>'payment_date', '')::timestamptz,
    nullif(to_jsonb(o)->>'delivered_at', '')::timestamptz,
    o.updated_at,
    o.created_at,
    now()
  ),
  coalesce(
    nullif(to_jsonb(o)->>'paid_amount', '')::numeric,
    nullif(to_jsonb(o)->>'payment_amount', '')::numeric,
    nullif(to_jsonb(o)->>'amount_paid', '')::numeric,
    0
  ),
  case
    when coalesce(to_jsonb(o)->>'payment_method', to_jsonb(o)->>'payment_type', '') in ('Cash','Card','Bank Transfer','Cheque','Other')
      then coalesce(to_jsonb(o)->>'payment_method', to_jsonb(o)->>'payment_type')
    else 'Other'
  end,
  coalesce(
    nullif(trim(to_jsonb(o)->>'paid_by'), ''),
    nullif(trim(to_jsonb(o)->>'collected_by'), ''),
    nullif(trim(to_jsonb(o)->>'driver_name'), ''),
    'Order collection'
  ),
  concat_ws(E'\n', nullif(trim(to_jsonb(o)->>'payment_notes'), ''), 'Imported from orders'),
  'COLLECTION',
  'legacy-order-' || o.id::text,
  'POSTED',
  coalesce(nullif(trim(to_jsonb(o)->>'collected_by'), ''), 'migration'),
  'PAYMENT',
  'CONFIRMED',
  coalesce(o.created_at, now()),
  now()
from public.orders o
where nullif(to_jsonb(o)->>'customer_account_id', '') is not null
  and coalesce(
    nullif(to_jsonb(o)->>'paid_amount', '')::numeric,
    nullif(to_jsonb(o)->>'payment_amount', '')::numeric,
    nullif(to_jsonb(o)->>'amount_paid', '')::numeric,
    0
  ) > 0
  and not exists (
    select 1
    from public.customer_payments p
    where p.idempotency_key = 'legacy-order-' || o.id::text
       or (
         p.customer_account_id = nullif(to_jsonb(o)->>'customer_account_id', '')::uuid
         and upper(coalesce(p.payment_reference, '')) = upper(coalesce(
           nullif(trim(to_jsonb(o)->>'order_number'), ''),
           nullif(trim(to_jsonb(o)->>'orderId'), ''),
           'ORDER-' || o.id::text
         ))
         and p.amount = coalesce(
           nullif(to_jsonb(o)->>'paid_amount', '')::numeric,
           nullif(to_jsonb(o)->>'payment_amount', '')::numeric,
           nullif(to_jsonb(o)->>'amount_paid', '')::numeric,
           0
         )
       )
  );

-- 3) Global Payment History: no customer selection, 30 rows per page.
create or replace function public.list_central_payment_records(
  p_admin_username text,
  p_admin_password text,
  p_customer_account_id uuid default null,
  p_customer_branch_id uuid default null,
  p_archived boolean default false,
  p_search text default '',
  p_method text default '',
  p_date_from date default null,
  p_date_to date default null,
  p_page integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page_size constant integer := 30;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total integer;
  v_rows jsonb;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username, p_admin_password);

  select count(*) into v_total
  from public.customer_payments p
  left join public.central_payment_archive a on a.payment_id = p.id
  left join public.customer_accounts c on c.id = p.customer_account_id
  where (a.payment_id is not null) = p_archived
    and (coalesce(trim(p_search), '') = ''
      or coalesce(p.payment_reference, '') ilike '%' || trim(p_search) || '%'
      or coalesce(p.paid_by, '') ilike '%' || trim(p_search) || '%'
      or coalesce(p.notes, '') ilike '%' || trim(p_search) || '%'
      or coalesce(c.account_name, c.company_name, '') ilike '%' || trim(p_search) || '%')
    and (coalesce(trim(p_method), '') = '' or p.payment_method = p_method)
    and (p_date_from is null or p.payment_date::date >= p_date_from)
    and (p_date_to is null or p.payment_date::date <= p_date_to);

  select coalesce(jsonb_agg(row_data order by payment_date desc, created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      to_jsonb(p) || jsonb_build_object(
        'customer_name', coalesce(c.account_name, c.company_name, ''),
        'branch_name', coalesce(b.branch_name, ''),
        'archived', p_archived,
        'removed_reason', a.removed_reason,
        'removed_by', a.removed_by,
        'removed_at', a.removed_at
      ) as row_data,
      p.payment_date,
      p.created_at
    from public.customer_payments p
    left join public.customer_accounts c on c.id = p.customer_account_id
    left join public.customer_branches b on b.id = p.customer_branch_id
    left join public.central_payment_archive a on a.payment_id = p.id
    where (a.payment_id is not null) = p_archived
      and (coalesce(trim(p_search), '') = ''
        or coalesce(p.payment_reference, '') ilike '%' || trim(p_search) || '%'
        or coalesce(p.paid_by, '') ilike '%' || trim(p_search) || '%'
        or coalesce(p.notes, '') ilike '%' || trim(p_search) || '%'
        or coalesce(c.account_name, c.company_name, '') ilike '%' || trim(p_search) || '%')
      and (coalesce(trim(p_method), '') = '' or p.payment_method = p_method)
      and (p_date_from is null or p.payment_date::date >= p_date_from)
      and (p_date_to is null or p.payment_date::date <= p_date_to)
    order by p.payment_date desc, p.created_at desc
    limit v_page_size offset ((v_page - 1) * v_page_size)
  ) rows_page;

  return jsonb_build_object(
    'records', v_rows,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;

-- 4) Physical deletion guard. Normal workflows must archive instead.
create or replace function public.prevent_business_record_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  v_actor text := lower(coalesce(v_claims->>'username', v_claims->>'user_name', v_claims->>'email', ''));
begin
  -- Supabase migration/service roles and SECURITY DEFINER admin routines remain operational.
  if current_user in ('postgres', 'service_role', 'supabase_admin') or v_actor = 'nisstaj_admin' or v_actor like 'nisstaj_admin@%' then
    return old;
  end if;

  raise exception 'Permanent deletion is blocked for %. Archive the record instead. Only nisstaj_admin may permanently delete it.', tg_table_name
    using errcode = '42501';
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['orders', 'customer_accounts', 'customer_invoices', 'customer_payments']
  loop
    if to_regclass('public.' || v_table) is not null then
      execute format('drop trigger if exists prevent_%I_delete on public.%I', v_table, v_table);
      execute format(
        'create trigger prevent_%I_delete before delete on public.%I for each row execute function public.prevent_business_record_delete()',
        v_table,
        v_table
      );
    end if;
  end loop;
end $$;

create index if not exists customer_payments_history_date_idx
  on public.customer_payments (payment_date desc, created_at desc);

notify pgrst, 'reload schema';
