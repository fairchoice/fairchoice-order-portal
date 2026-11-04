-- Order checkout payment is part of completing a sale.
-- It requires a valid active FC staff session, but no separate payment permission.
-- Other payment sources keep their existing permission checks.

do $$
declare
  v_row record;
  v_definition text;
  v_patched text;
begin
  -- Teach the session permission guard one internal pseudo-permission that means
  -- "valid staff session only". This is used only by ORDER_PAYMENT.
  select p.oid, pg_get_functiondef(p.oid) as definition
    into v_row
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'fc_require_session_permission_v2'
  limit 1;

  if v_row.oid is null then
    raise exception 'fc_require_session_permission_v2 is not installed.';
  end if;

  v_definition := v_row.definition;

  if v_definition !~* 'p_permission_key[[:space:]]*=[[:space:]]*''order\.checkout\.payment''' then
    v_patched := regexp_replace(
      v_definition,
      'v_effective := public\.fc_effective_permissions_v2\(v_login\.id,v_staff\.id,v_role\);',
      E'v_effective := public.fc_effective_permissions_v2(v_login.id,v_staff.id,v_role);\n\n  -- Checkout payment is allowed for any valid active staff session. It is not\n  -- a grant to the standalone cash collection or finance pages.\n  if p_permission_key = ''order.checkout.payment'' then\n    return query select v_session.id,v_login.id,v_login.login_code,v_staff.id,v_staff.staff_code,\n      v_login.username,coalesce(v_staff.staff_name,v_login.username),v_role,\n      v_login.customer_account_id,v_effective;\n    return;\n  end if;',
      'i'
    );

    if v_patched = v_definition then
      raise exception 'Could not safely patch fc_require_session_permission_v2.';
    end if;

    execute v_patched;
  end if;

  -- Map ORDER_PAYMENT to the internal session-only checkout key.
  for v_row in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('post_canonical_customer_payment_v2')
  loop
    v_definition := pg_get_functiondef(v_row.oid);

    if v_definition ~* 'when[[:space:]]+v_source[[:space:]]*=[[:space:]]*''ORDER_PAYMENT''[[:space:]]+then[[:space:]]+''order\.checkout\.payment''' then
      continue;
    end if;

    v_patched := regexp_replace(
      v_definition,
      'case[[:space:]]+when[[:space:]]+v_source[[:space:]]*=[[:space:]]*''CUSTOMER_PORTAL_PAYMENT''',
      E'case\n    when v_source = ''ORDER_PAYMENT'' then ''order.checkout.payment''\n    when v_source = ''CUSTOMER_PORTAL_PAYMENT''',
      'i'
    );

    if v_patched = v_definition then
      raise exception 'Could not safely patch % for ORDER_PAYMENT.', v_row.proname;
    end if;

    execute v_patched;
  end loop;
end
$$;
