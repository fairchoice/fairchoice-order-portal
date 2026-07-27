-- Password-validated owner read path for the Global Financial Ledger.
-- The application uses custom FairChoice login state, so a client-side owner
-- check alone is not sufficient authorization for a direct view SELECT.

create or replace function public.list_global_financial_history_v1(
  p_owner_username text,
  p_owner_password text,
  p_search text default null,
  p_payment_method text default null,
  p_status text default null,
  p_transaction_type text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_customer_account_id uuid default null,
  p_customer_branch_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint;
  v_records jsonb;
begin
  perform public.central_payment_require_admin_credentials(
    p_owner_username,
    p_owner_password
  );

  with filtered as (
    select h.*
    from public.global_financial_history h
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or h.reference ilike '%' || trim(p_search) || '%'
      or h.description ilike '%' || trim(p_search) || '%'
      or h.staff_name ilike '%' || trim(p_search) || '%'
      or h.source_id ilike '%' || trim(p_search) || '%'
    )
      and (
        nullif(trim(coalesce(p_payment_method, '')), '') is null
        or h.payment_method = trim(p_payment_method)
      )
      and (
        nullif(trim(coalesce(p_status, '')), '') is null
        or h.status = upper(trim(p_status))
      )
      and (
        nullif(trim(coalesce(p_transaction_type, '')), '') is null
        or h.transaction_type = upper(trim(p_transaction_type))
      )
      and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
      and (
        p_date_to is null
        or h.transaction_date < (p_date_to + 1)::timestamptz
      )
      and (
        p_customer_account_id is null
        or h.customer_account_id = p_customer_account_id
      )
      and (
        p_customer_branch_id is null
        or h.customer_branch_id = p_customer_branch_id
      )
  )
  select count(*) into v_total
  from filtered;

  with filtered as (
    select h.*
    from public.global_financial_history h
    where (
      nullif(trim(coalesce(p_search, '')), '') is null
      or h.reference ilike '%' || trim(p_search) || '%'
      or h.description ilike '%' || trim(p_search) || '%'
      or h.staff_name ilike '%' || trim(p_search) || '%'
      or h.source_id ilike '%' || trim(p_search) || '%'
    )
      and (
        nullif(trim(coalesce(p_payment_method, '')), '') is null
        or h.payment_method = trim(p_payment_method)
      )
      and (
        nullif(trim(coalesce(p_status, '')), '') is null
        or h.status = upper(trim(p_status))
      )
      and (
        nullif(trim(coalesce(p_transaction_type, '')), '') is null
        or h.transaction_type = upper(trim(p_transaction_type))
      )
      and (p_date_from is null or h.transaction_date >= p_date_from::timestamptz)
      and (
        p_date_to is null
        or h.transaction_date < (p_date_to + 1)::timestamptz
      )
      and (
        p_customer_account_id is null
        or h.customer_account_id = p_customer_account_id
      )
      and (
        p_customer_branch_id is null
        or h.customer_branch_id = p_customer_branch_id
      )
  ),
  page_rows as (
    select *
    from filtered
    order by transaction_date desc, created_at desc, record_id desc
    offset (v_page - 1) * v_page_size
    limit v_page_size
  )
  select coalesce(
    jsonb_agg(
      to_jsonb(page_rows)
      order by page_rows.transaction_date desc,
               page_rows.created_at desc,
               page_rows.record_id desc
    ),
    '[]'::jsonb
  )
    into v_records
  from page_rows;

  return jsonb_build_object(
    'records', v_records,
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;

revoke all on function public.list_global_financial_history_v1(
  text,text,text,text,text,text,date,date,uuid,uuid,integer,integer
) from public;
grant execute on function public.list_global_financial_history_v1(
  text,text,text,text,text,text,date,date,uuid,uuid,integer,integer
) to anon, authenticated;

comment on function public.list_global_financial_history_v1(
  text,text,text,text,text,text,date,date,uuid,uuid,integer,integer
) is
  'Password-validated, server-paginated owner read of active and archived global financial history.';

notify pgrst, 'reload schema';
