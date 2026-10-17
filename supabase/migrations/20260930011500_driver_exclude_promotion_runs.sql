-- Promotion Run is completed and paid by the Sales Rep at checkout.
-- Driver Portal receives a read-only order-number list so Promotion Run sales
-- never enter delivery/cash-collection workflow. This does not update order,
-- invoice, payment, customer-credit, or stock data.

create or replace function public.fc_list_promotion_run_order_numbers_v1(
  p_username text,
  p_session_token text
)
returns table(order_number text)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $function$
declare
  v_actor record;
begin
  select * into v_actor
  from public.fc_require_session_permission_v2(
    p_username,
    p_session_token,
    'page.operations.driver'
  )
  limit 1;

  return query
  select distinct promotion_order_number
  from (
    select nullif(trim(coalesce(pr.order_number, '')), '') as promotion_order_number
    from public.promotion_runs pr

    union

    select nullif(trim(coalesce(
      cp.metadata->>'order_number',
      cp.payment_reference,
      ''
    )), '') as promotion_order_number
    from public.customer_payments cp
    where upper(coalesce(cp.metadata->>'payment_applies_to', '')) = 'PROMOTION_RUN'
      and cp.voided_at is null
  ) promotion_orders
  where promotion_order_number is not null;
end;
$function$;

revoke all on function public.fc_list_promotion_run_order_numbers_v1(text, text) from public;
grant execute on function public.fc_list_promotion_run_order_numbers_v1(text, text) to anon, authenticated;

comment on function public.fc_list_promotion_run_order_numbers_v1(text, text) is
  'Read-only Promotion Run order-number list for Driver Portal exclusion, sourced from promotion audit and canonical Promotion Run payments.';

notify pgrst, 'reload schema';