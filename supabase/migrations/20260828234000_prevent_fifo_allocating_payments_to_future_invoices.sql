-- Prevent historical payments from being reallocated to invoices created after the payment date.
-- Verified in Fairchoice-app-V2 before production rollout.

do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid
  into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'recalculate_central_payment_fifo'
    and pg_get_function_identity_arguments(p.oid) = 'p_customer_account_id uuid';

  if v_oid is null then
    raise exception 'FIFO function not found';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if position(
    'and i.invoice_date <= coalesce(v_payment.payment_date, v_payment.created_at, now())'
    in v_def
  ) > 0 then
    return;
  end if;

  v_def := regexp_replace(
    v_def,
    '(where i\.customer_account_id = p_customer_account_id[[:space:]]+and i\.status <> ''CANCELLED'')',
    E'\\1\n        and i.invoice_date <= coalesce(v_payment.payment_date, v_payment.created_at, now())',
    'g'
  );

  if position(
    'and i.invoice_date <= coalesce(v_payment.payment_date, v_payment.created_at, now())'
    in v_def
  ) = 0 then
    raise exception 'FIFO invoice selector not found; stopped safely';
  end if;

  execute v_def;
end
$$;

notify pgrst, 'reload schema';
