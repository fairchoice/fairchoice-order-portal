-- Restrict the Central Payment history/archive reader to the authenticated
-- Fair Choice owner session. Operational customer-payment reads remain
-- available to existing customer statement and credit workflows.

begin;

create or replace function public.list_owner_central_payment_records_v1(
  p_username text,
  p_session_token text,
  p_archived boolean default false,
  p_search text default '',
  p_method text default '',
  p_date_from date default null,
  p_date_to date default null,
  p_page integer default 1,
  p_page_size integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor record;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 30), 1), 100);
  v_total bigint := 0;
  v_records jsonb := '[]'::jsonb;
  v_search_pattern text := null;
begin
  select *
  into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'payments.view'
  );

  if lower(trim(coalesce(v_actor.username, ''))) <> 'nisstaj_admin' then
    raise exception 'Payment History is restricted to nisstaj_admin.'
      using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_search, '')), '') is not null then
    v_search_pattern :=
      '%' ||
      replace(
        replace(
          replace(trim(p_search), E'\\', E'\\\\'),
          '%',
          E'\\%'
        ),
        '_',
        E'\\_'
      ) ||
      '%';
  end if;

  select count(*)
  into v_total
  from public.customer_payments p
  left join public.customer_accounts c
    on c.id = p.customer_account_id
  where upper(coalesce(p.status, '')) =
        case when p_archived then 'VOIDED' else 'POSTED' end
    and (
      v_search_pattern is null
      or coalesce(p.payment_reference, '') ilike v_search_pattern escape E'\\'
      or coalesce(c.account_name, '') ilike v_search_pattern escape E'\\'
      or coalesce(p.paid_by, '') ilike v_search_pattern escape E'\\'
      or coalesce(p.collector_name, '') ilike v_search_pattern escape E'\\'
      or coalesce(p.metadata->>'manager_name', '') ilike v_search_pattern escape E'\\'
      or coalesce(p.metadata->>'manager', '') ilike v_search_pattern escape E'\\'
      or coalesce(p.metadata->'transaction_snapshot'->>'manager_name', '')
           ilike v_search_pattern escape E'\\'
      or coalesce(p.metadata->'transaction_snapshot'->>'manager', '')
           ilike v_search_pattern escape E'\\'
      or coalesce(p.notes, '') ilike v_search_pattern escape E'\\'
    )
    and (
      nullif(trim(coalesce(p_method, '')), '') is null
      or p.payment_method = trim(p_method)
    )
    and (p_date_from is null or p.payment_date::date >= p_date_from)
    and (p_date_to is null or p.payment_date::date <= p_date_to);

  select coalesce(
    jsonb_agg(
      page_rows.row_data
      order by page_rows.payment_date desc,
               page_rows.created_at desc,
               page_rows.payment_id desc
    ),
    '[]'::jsonb
  )
  into v_records
  from (
    select
      jsonb_build_object(
        'id', p.id,
        'payment_date', p.payment_date,
        'created_at', p.created_at,
        'customer_name',
          coalesce(c.account_name, ''),
        'payment_reference', p.payment_reference,
        'payment_method', p.payment_method,
        'paid_by', p.paid_by,
        'verification_status', p.verification_status,
        'amount', p.amount,
        'status', p.status,
        'price_mode',
          coalesce(
            nullif(trim(p.metadata->>'price_mode'), ''),
            nullif(trim(p.metadata->>'priceMode'), ''),
            nullif(trim(p.metadata->'transaction_snapshot'->>'price_mode'), ''),
            nullif(trim(p.metadata->'transaction_snapshot'->>'priceMode'), '')
          ),
        'inc_vat',
          coalesce(
            p.metadata->'inc_vat',
            p.metadata->'vat_included',
            p.metadata->'transaction_snapshot'->'inc_vat',
            p.metadata->'transaction_snapshot'->'vat_included'
          ),
        'manager_name',
          coalesce(
            nullif(trim(p.metadata->>'manager_name'), ''),
            nullif(trim(p.metadata->>'manager'), ''),
            nullif(trim(p.metadata->'transaction_snapshot'->>'manager_name'), ''),
            nullif(trim(p.metadata->'transaction_snapshot'->>'manager'), ''),
            case
              when upper(coalesce(p.collector_role, '')) = 'MANAGER'
                then coalesce(
                  nullif(trim(p.collector_name), ''),
                  nullif(trim(p.paid_by), '')
                )
            end
          )
      ) as row_data,
      p.payment_date,
      p.created_at,
      p.id as payment_id
    from public.customer_payments p
    left join public.customer_accounts c
      on c.id = p.customer_account_id
    where upper(coalesce(p.status, '')) =
          case when p_archived then 'VOIDED' else 'POSTED' end
      and (
        v_search_pattern is null
        or coalesce(p.payment_reference, '') ilike v_search_pattern escape E'\\'
        or coalesce(c.account_name, '') ilike v_search_pattern escape E'\\'
        or coalesce(p.paid_by, '') ilike v_search_pattern escape E'\\'
        or coalesce(p.collector_name, '') ilike v_search_pattern escape E'\\'
        or coalesce(p.metadata->>'manager_name', '') ilike v_search_pattern escape E'\\'
        or coalesce(p.metadata->>'manager', '') ilike v_search_pattern escape E'\\'
        or coalesce(p.metadata->'transaction_snapshot'->>'manager_name', '')
             ilike v_search_pattern escape E'\\'
        or coalesce(p.metadata->'transaction_snapshot'->>'manager', '')
             ilike v_search_pattern escape E'\\'
        or coalesce(p.notes, '') ilike v_search_pattern escape E'\\'
      )
      and (
        nullif(trim(coalesce(p_method, '')), '') is null
        or p.payment_method = trim(p_method)
      )
      and (p_date_from is null or p.payment_date::date >= p_date_from)
      and (p_date_to is null or p.payment_date::date <= p_date_to)
    order by p.payment_date desc, p.created_at desc, p.id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  ) page_rows;

  return jsonb_build_object(
    'records', v_records,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages',
    greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;

revoke all
on function public.list_owner_central_payment_records_v1(
  text, text, boolean, text, text, date, date, integer, integer
)
from public;

grant execute
on function public.list_owner_central_payment_records_v1(
  text, text, boolean, text, text, date, date, integer, integer
)
to anon, authenticated;

comment on function public.list_owner_central_payment_records_v1(
  text, text, boolean, text, text, date, date, integer, integer
) is
  'Returns paginated Central Payment history only after validating the active nisstaj_admin FC session.';

notify pgrst, 'reload schema';

commit;
