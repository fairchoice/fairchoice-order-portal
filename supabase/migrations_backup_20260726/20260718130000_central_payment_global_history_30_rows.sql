-- Central Payment history is global (no customer filter) and paginates 30 rows at a time.
create or replace function public.list_central_payment_records(
  p_admin_username text, p_admin_password text, p_customer_account_id uuid,
  p_customer_branch_id uuid default null, p_archived boolean default false,
  p_search text default '', p_method text default '', p_date_from date default null,
  p_date_to date default null, p_page integer default 1
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_page_size constant integer := 30;
  v_offset integer;
  v_total integer;
  v_rows jsonb;
begin
  perform public.central_payment_require_admin_credentials(p_admin_username, p_admin_password);
  v_offset := greatest(coalesce(p_page, 1) - 1, 0) * v_page_size;

  select count(*) into v_total
  from public.customer_payments p
  where (p_customer_account_id is null or p.customer_account_id = p_customer_account_id)
    and (p_customer_branch_id is null or p.customer_branch_id = p_customer_branch_id)
    and (exists(select 1 from public.central_payment_archive a where a.payment_id = p.id)) = p_archived
    and (coalesce(trim(p_search),'') = '' or p.payment_reference ilike '%' || trim(p_search) || '%' or coalesce(p.paid_by,'') ilike '%' || trim(p_search) || '%' or coalesce(p.notes,'') ilike '%' || trim(p_search) || '%')
    and (coalesce(trim(p_method),'') = '' or p.payment_method = p_method)
    and (p_date_from is null or p.payment_date::date >= p_date_from)
    and (p_date_to is null or p.payment_date::date <= p_date_to);

  select coalesce(jsonb_agg(row_data order by payment_date desc, created_at desc), '[]'::jsonb) into v_rows
  from (
    select to_jsonb(p) || jsonb_build_object(
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
    where (p_customer_account_id is null or p.customer_account_id = p_customer_account_id)
      and (p_customer_branch_id is null or p.customer_branch_id = p_customer_branch_id)
      and (a.payment_id is not null) = p_archived
      and (coalesce(trim(p_search),'') = '' or p.payment_reference ilike '%' || trim(p_search) || '%' or coalesce(p.paid_by,'') ilike '%' || trim(p_search) || '%' or coalesce(p.notes,'') ilike '%' || trim(p_search) || '%')
      and (coalesce(trim(p_method),'') = '' or p.payment_method = p_method)
      and (p_date_from is null or p.payment_date::date >= p_date_from)
      and (p_date_to is null or p.payment_date::date <= p_date_to)
    order by p.payment_date desc, p.created_at desc
    limit v_page_size offset v_offset
  ) q;

  return jsonb_build_object(
    'records', v_rows,
    'total', v_total,
    'page', greatest(coalesce(p_page, 1), 1),
    'page_size', v_page_size,
    'total_pages', greatest(1, ceil(v_total::numeric / v_page_size)::integer)
  );
end;
$$;
