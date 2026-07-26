-- Keep Customer Credit, Driver Collection, and Sales Rep Collection on one
-- read-only, RLS-safe account/branch/financial statement.

create or replace function public.get_customer_financial_statement(p_customer_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'customer', coalesce((
      select jsonb_build_object(
        'id', c.id,
        'account_name', c.account_name,
        'credit_limit', c.credit_limit,
        'active', c.active
      )
      from public.customer_accounts c
      where c.id = p_customer_account_id
    ), 'null'::jsonb),
    'branches', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.branch_name, b.id)
      from public.customer_branches b
      where b.customer_account_id = p_customer_account_id
        and b.active is not false
    ), '[]'::jsonb),
    'opening_balances', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.effective_at, b.created_at)
      from public.customer_branch_opening_balances b
      where b.customer_account_id = p_customer_account_id
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.invoice_date, i.created_at)
      from public.customer_invoices i
      where i.customer_account_id = p_customer_account_id
        and i.status <> 'CANCELLED'
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.payment_date, p.created_at)
      from public.customer_payments p
      where p.customer_account_id = p_customer_account_id
        and p.status = 'POSTED'
        and not exists (
          select 1
          from public.central_payment_archive a
          where a.payment_id = p.id
        )
    ), '[]'::jsonb),
    'allocations', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.allocated_at, a.created_at)
      from public.customer_payment_allocations a
      where a.customer_account_id = p_customer_account_id
        and a.status = 'active'
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_customer_financial_statement(uuid) from public;
grant execute on function public.get_customer_financial_statement(uuid) to anon, authenticated;
