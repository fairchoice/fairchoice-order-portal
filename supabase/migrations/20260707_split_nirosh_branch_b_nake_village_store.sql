-- Split NIROSH LIMITED Branch B into its own customer account/shop.
-- Target account/shop: Village Store - Nelson.
--
-- Live-data basis at time of writing:
--   NIROSH LIMITED account id: d4cf28c6-803f-4d60-9909-e11a6d202059
--   Branch A id:              07067cfb-be6f-4ea8-af7c-e4cf23b883f6
--   Branch B id:              9032bef3-5b2c-45d9-8a09-b46eaed106c6
--   Branch A remains on NIROSH LIMITED, but as main-account activity with no branch.
--   Branch B moves to Village Store - Nelson, also as main-account activity with no branch.
--   Branch B orders:
--     ORD-1782415703998
--     ORD-1783018640672
--   Branch B driver previous-credit payment:
--     customer_ledger id 68 / reference ORD-1782415703998 / credit 452.83

begin;

do $$
declare
  old_account_id uuid := 'd4cf28c6-803f-4d60-9909-e11a6d202059';
  branch_a_id uuid := '07067cfb-be6f-4ea8-af7c-e4cf23b883f6';
  branch_b_id uuid := '9032bef3-5b2c-45d9-8a09-b46eaed106c6';
  new_account_id uuid;
  new_account_name text := 'Village Store - Nelson';
  previous_credit_balance numeric(12, 2) := 452.83;
  nake_opening_balance_exists boolean := false;
begin
  select id
    into new_account_id
  from public.customer_accounts
  where lower(trim(account_name)) = lower(new_account_name)
  order by created_at asc nulls last
  limit 1;

  if new_account_id is null then
    insert into public.customer_accounts (
      account_name,
      contact_name,
      phone,
      mobile,
      email,
      vat_number,
      address_line_1,
      address_line_2,
      town_city,
      postcode,
      address,
      country,
      payment_terms,
      credit_limit,
      default_price_mode,
      status,
      active,
      allow_vat,
      allow_server,
      allow_manager,
      allow_super
    )
    select
      new_account_name,
      contact_name,
      phone,
      mobile,
      email,
      vat_number,
      '57 High St',
      '',
      'Treharris',
      'CF46 6HA',
      '57 High St, Treharris, Nelson, CF46 6HA',
      country,
      payment_terms,
      credit_limit,
      default_price_mode,
      status,
      active,
      allow_vat,
      allow_server,
      false,
      false
    from public.customer_accounts
    where id = old_account_id
    returning id into new_account_id;
  else
    update public.customer_accounts
    set
      address_line_1 = coalesce(nullif(address_line_1, ''), '57 High St'),
      town_city = coalesce(nullif(town_city, ''), 'Treharris'),
      postcode = coalesce(nullif(postcode, ''), 'CF46 6HA'),
      address = coalesce(nullif(address, ''), '57 High St, Treharris, Nelson, CF46 6HA'),
      country = coalesce(nullif(country, ''), 'Wales'),
      active = true,
      allow_manager = false,
      allow_super = false
    where id = new_account_id;
  end if;

  if new_account_id is null then
    raise exception 'Could not create or find % account', new_account_name;
  end if;

  update public.orders
  set
    customer_account_id = new_account_id,
    customer_branch_id = null,
    branch_id = null,
    branch_name = null,
    delivery_branch_name = null,
    company_name = new_account_name
  where
    customer_branch_id = branch_b_id
    or (
      customer_account_id = old_account_id
      and lower(trim(coalesce(delivery_branch_name, branch_name, ''))) in ('b', 'branch b', lower(new_account_name))
    )
    or order_number in ('ORD-1782415703998', 'ORD-1783018640672');

  update public.orders
  set
    customer_account_id = old_account_id,
    customer_branch_id = null,
    branch_id = null,
    branch_name = null,
    delivery_branch_name = null,
    company_name = 'NIROSH LIMITED'
  where
    customer_branch_id = branch_a_id
    or branch_id = branch_a_id
    or (
      customer_account_id = old_account_id
      and lower(trim(coalesce(delivery_branch_name, branch_name, ''))) in ('a', 'branch a')
    )
    or order_number in ('ORD-1782383765878', 'ORD-1782981495034');

  update public.customer_ledger
  set
    customer_account_id = new_account_id,
    customer_branch_id = null,
    branch_id = null,
    branch_name = null,
    customer_name = new_account_name
  where
    reference_no in ('ORD-1782415703998', 'ORD-1783018640672')
    or order_number in ('ORD-1782415703998', 'ORD-1783018640672')
    or customer_branch_id = branch_b_id
    or branch_id = branch_b_id
    or id = 68;

  update public.customer_ledger
  set
    customer_account_id = old_account_id,
    customer_branch_id = null,
    branch_id = null,
    branch_name = null,
    customer_name = 'NIROSH LIMITED'
  where
    reference_no in ('ORD-1782383765878', 'ORD-1782981495034')
    or order_number in ('ORD-1782383765878', 'ORD-1782981495034')
    or customer_branch_id = branch_a_id
    or branch_id = branch_a_id;

  if to_regclass('public.processing_queue') is not null then
    update public.processing_queue
    set
      customer_account_id = new_account_id,
      customer_branch_id = null,
      branch_id = null,
      branch_name = null,
      customer_name = new_account_name
    where
      order_number in ('ORD-1782415703998', 'ORD-1783018640672')
      or customer_branch_id = branch_b_id
      or branch_id = branch_b_id;

    update public.processing_queue
    set
      customer_account_id = old_account_id,
      customer_branch_id = null,
      branch_id = null,
      branch_name = null,
      customer_name = 'NIROSH LIMITED'
    where
      order_number in ('ORD-1782383765878', 'ORD-1782981495034')
      or customer_branch_id = branch_a_id
      or branch_id = branch_a_id;
  end if;

  if to_regclass('public.customer_returns') is not null then
    update public.customer_returns
    set
      customer_account_id = new_account_id,
      customer_branch_id = null,
      branch_id = null,
      branch_name = null,
      customer_name = new_account_name
    where
      order_number in ('ORD-1782415703998', 'ORD-1783018640672')
      or customer_branch_id = branch_b_id
      or branch_id = branch_b_id;

    update public.customer_returns
    set
      customer_account_id = old_account_id,
      customer_branch_id = null,
      branch_id = null,
      branch_name = null,
      customer_name = 'NIROSH LIMITED'
    where
      order_number in ('ORD-1782383765878', 'ORD-1782981495034')
      or customer_branch_id = branch_a_id
      or branch_id = branch_a_id;
  end if;

  if to_regclass('public.customer_payment_allocations') is not null then
    update public.customer_payment_allocations
    set
      customer_account_id = new_account_id,
      customer_branch_id = null
    where
      customer_branch_id = branch_b_id
      or (
        customer_account_id = old_account_id
        and (
          invoice_ledger_id in (
            select id
            from public.customer_ledger
            where reference_no in ('ORD-1782415703998', 'ORD-1783018640672')
               or order_number in ('ORD-1782415703998', 'ORD-1783018640672')
          )
          or payment_ledger_id in (
            select id
            from public.customer_ledger
            where reference_no in ('ORD-1782415703998', 'ORD-1783018640672')
               or order_number in ('ORD-1782415703998', 'ORD-1783018640672')
               or id = 68
          )
        )
      );

    update public.customer_payment_allocations
    set
      customer_account_id = old_account_id,
      customer_branch_id = null
    where
      customer_branch_id = branch_a_id
      or (
        customer_account_id = old_account_id
        and (
          invoice_ledger_id in (
            select id
            from public.customer_ledger
            where reference_no in ('ORD-1782383765878', 'ORD-1782981495034')
               or order_number in ('ORD-1782383765878', 'ORD-1782981495034')
          )
          or payment_ledger_id in (
            select id
            from public.customer_ledger
            where reference_no in ('ORD-1782383765878', 'ORD-1782981495034')
               or order_number in ('ORD-1782383765878', 'ORD-1782981495034')
          )
        )
      );
  end if;

  if to_regclass('public.customer_opening_balances') is not null then
    select exists (
      select 1
      from public.customer_opening_balances
      where customer_name = new_account_name
    ) into nake_opening_balance_exists;

    if nake_opening_balance_exists then
      update public.customer_opening_balances
      set opening_balance = previous_credit_balance
      where customer_name = new_account_name;
    else
      insert into public.customer_opening_balances (customer_name, opening_balance)
      values (new_account_name, previous_credit_balance);

      update public.customer_opening_balances
      set opening_balance = greatest(0, coalesce(opening_balance, 0) - previous_credit_balance)
      where customer_name = 'NIROSH LIMITED';
    end if;
  end if;

  delete from public.customer_branches
  where id in (branch_a_id, branch_b_id);
end $$;

commit;

-- Verification queries:
-- select id, account_name from public.customer_accounts where account_name in ('NIROSH LIMITED', 'Village Store - Nelson');
-- select id, customer_account_id, branch_name from public.customer_branches where id in ('07067cfb-be6f-4ea8-af7c-e4cf23b883f6', '9032bef3-5b2c-45d9-8a09-b46eaed106c6');
-- select order_number, company_name, customer_account_id, customer_branch_id, branch_name, delivery_branch_name, order_total
-- from public.orders
-- where order_number in ('ORD-1782415703998', 'ORD-1783018640672', 'ORD-1782383765878', 'ORD-1782981495034')
-- order by created_at;
-- select id, customer_name, customer_account_id, customer_branch_id, branch_name, entry_type, reference_no, debit, credit
-- from public.customer_ledger
-- where customer_name in ('NIROSH LIMITED', 'Village Store - Nelson')
-- order by created_at;
