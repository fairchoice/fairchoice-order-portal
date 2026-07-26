-- Audited, transactional customer workbook imports.
-- Additive only: existing customer and financial records are never replaced or removed.

create extension if not exists pgcrypto;

alter table public.customer_accounts
  add column if not exists account_code text,
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists address_line_1 text,
  add column if not exists town_city text,
  add column if not exists postcode text,
  add column if not exists country text,
  add column if not exists default_price_mode text,
  add column if not exists allow_vat boolean not null default true,
  add column if not exists allow_server boolean not null default false;

alter table public.customer_branches
  add column if not exists delivery_address text,
  add column if not exists country text,
  add column if not exists phone text,
  add column if not exists email text;

create table if not exists public.customer_import_audit (
  id uuid primary key default gen_random_uuid(),
  workbook_name text not null,
  sheet_name text not null,
  row_number integer not null,
  customer_id uuid null,
  branch_id uuid null,
  action text not null check (action in ('new', 'updated')),
  changed_fields jsonb not null default '[]'::jsonb,
  before_values jsonb not null default '{}'::jsonb,
  after_values jsonb not null default '{}'::jsonb,
  imported_by text not null,
  imported_at timestamptz not null default now()
);

create index if not exists customer_import_audit_customer_time_idx
  on public.customer_import_audit (customer_id, imported_at desc);

alter table public.customer_import_audit enable row level security;

revoke all on public.customer_import_audit from anon, authenticated;

create or replace function public.apply_customer_workbook_import(
  p_workbook_name text,
  p_rows jsonb,
  p_branches jsonb,
  p_imported_by text,
  p_confirm_opening_balance boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb;
  v_payload jsonb;
  v_customer public.customer_accounts%rowtype;
  v_customer_id uuid;
  v_branch public.customer_branches%rowtype;
  v_branch_id uuid;
  v_customer_name text;
  v_client_ids jsonb := '{}'::jsonb;
  v_account_count integer := 0;
  v_branch_count integer := 0;
  v_affected integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('customer_workbook_import'));
  if nullif(btrim(p_workbook_name), '') is null then
    raise exception 'Workbook name is required';
  end if;
  if nullif(btrim(p_imported_by), '') is null then
    raise exception 'Imported by is required';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    v_payload := coalesce(v_row->'payload', '{}'::jsonb);
    v_customer_id := nullif(v_row->>'customer_id', '')::uuid;

    if v_row->>'action' = 'updated' then
      select * into v_customer from public.customer_accounts where id = v_customer_id for update;
      if not found then raise exception 'Customer % no longer exists', v_customer_id; end if;

      update public.customer_accounts set
        account_name = case when v_payload ? 'account_name' then v_payload->>'account_name' else account_name end,
        account_code = case when v_payload ? 'account_code' then v_payload->>'account_code' else account_code end,
        contact_name = case when v_payload ? 'contact_name' then v_payload->>'contact_name' else contact_name end,
        phone = case when v_payload ? 'phone' then v_payload->>'phone' else phone end,
        email = case when v_payload ? 'email' then v_payload->>'email' else email end,
        address = case when v_payload ? 'address' then v_payload->>'address' else address end,
        address_line_1 = case when v_payload ? 'address_line_1' then v_payload->>'address_line_1' else address_line_1 end,
        town_city = case when v_payload ? 'town_city' then v_payload->>'town_city' else town_city end,
        postcode = case when v_payload ? 'postcode' then v_payload->>'postcode' else postcode end,
        country = case when v_payload ? 'country' then v_payload->>'country' else country end,
        credit_limit = case when v_payload ? 'credit_limit' then (v_payload->>'credit_limit')::numeric else credit_limit end,
        default_price_mode = case when v_payload ? 'default_price_mode' then v_payload->>'default_price_mode' else default_price_mode end,
        active = case when v_payload ? 'active' then (v_payload->>'active')::boolean else active end,
        allow_vat = case when v_payload ? 'allow_vat' then (v_payload->>'allow_vat')::boolean else allow_vat end,
        allow_server = case when v_payload ? 'allow_server' then (v_payload->>'allow_server')::boolean else allow_server end,
        updated_at = now()
      where id = v_customer_id;
    elsif v_row->>'action' = 'new' then
      if exists (
        select 1 from public.customer_accounts
        where (nullif(btrim(v_payload->>'account_code'), '') is not null and lower(btrim(account_code)) = lower(btrim(v_payload->>'account_code')))
           or lower(regexp_replace(btrim(account_name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(v_payload->>'account_name'), '\s+', ' ', 'g'))
      ) then
        raise exception 'Customer row % now matches an existing account', v_row->>'row_number';
      end if;

      insert into public.customer_accounts (
        account_name, account_code, contact_name, phone, email, address, address_line_1,
        town_city, postcode, country, credit_limit, default_price_mode, active, allow_vat, allow_server
      ) values (
        v_payload->>'account_name', nullif(v_payload->>'account_code', ''), coalesce(v_payload->>'contact_name', ''),
        coalesce(v_payload->>'phone', ''), coalesce(v_payload->>'email', ''), coalesce(v_payload->>'address', ''),
        coalesce(v_payload->>'address_line_1', v_payload->>'address', ''), coalesce(v_payload->>'town_city', ''),
        coalesce(v_payload->>'postcode', ''), coalesce(v_payload->>'country', 'Wales'),
        coalesce((v_payload->>'credit_limit')::numeric, 0), coalesce(v_payload->>'default_price_mode', 'VAT'),
        coalesce((v_payload->>'active')::boolean, true), coalesce((v_payload->>'allow_vat')::boolean, true),
        coalesce((v_payload->>'allow_server')::boolean, false)
      ) returning id into v_customer_id;
      v_client_ids := v_client_ids || jsonb_build_object(v_row->>'client_key', v_customer_id::text);
    else
      raise exception 'Unsupported customer import action';
    end if;

    if coalesce((v_row->>'opening_balance_supplied')::boolean, false) then
      if not p_confirm_opening_balance then raise exception 'Opening balance confirmation is required'; end if;
      if exists (select 1 from public.customer_branch_opening_balances where customer_account_id = v_customer_id and customer_branch_id is null) then
        update public.customer_branch_opening_balances
        set opening_balance = (v_row->>'opening_balance')::numeric,
            updated_by = p_imported_by,
            updated_at = now()
        where customer_account_id = v_customer_id and customer_branch_id is null;
      else
        insert into public.customer_branch_opening_balances
          (customer_account_id, customer_branch_id, opening_balance, created_by, updated_by)
        values (v_customer_id, null, (v_row->>'opening_balance')::numeric, p_imported_by, p_imported_by);
      end if;

      -- Keep the legacy name-keyed balance in sync while the portal still reads it.
      if to_regclass('public.customer_opening_balances') is not null then
        select account_name into v_customer_name from public.customer_accounts where id = v_customer_id;
        execute 'update public.customer_opening_balances set opening_balance = $1 where customer_name = $2'
          using (v_row->>'opening_balance')::numeric, v_customer_name;
        get diagnostics v_affected = row_count;
        if v_affected = 0 then
          execute 'insert into public.customer_opening_balances (customer_name, opening_balance) values ($1, $2)'
            using v_customer_name, (v_row->>'opening_balance')::numeric;
        end if;
      end if;
    end if;

    insert into public.customer_import_audit
      (workbook_name, sheet_name, row_number, customer_id, action, changed_fields, before_values, after_values, imported_by)
    values
      (p_workbook_name, 'Customer Accounts', (v_row->>'row_number')::integer, v_customer_id,
       v_row->>'action', coalesce(v_row->'changed_fields', '[]'::jsonb),
       coalesce(v_row->'before_values', '{}'::jsonb), coalesce(v_row->'after_values', '{}'::jsonb), p_imported_by);
    v_account_count := v_account_count + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_branches, '[]'::jsonb))
  loop
    v_payload := coalesce(v_row->'payload', '{}'::jsonb);
    v_customer_id := coalesce(
      nullif(v_row->>'customer_id', '')::uuid,
      nullif(v_client_ids->>(v_row->>'customer_client_key'), '')::uuid
    );
    if v_customer_id is null then raise exception 'Branch row % has no customer', v_row->>'row_number'; end if;
    v_branch_id := nullif(v_row->>'branch_id', '')::uuid;

    if v_row->>'action' = 'updated' then
      select * into v_branch from public.customer_branches where id = v_branch_id for update;
      if not found or v_branch.customer_account_id <> v_customer_id then
        raise exception 'Branch % no longer belongs to the matched customer', v_branch_id;
      end if;
      update public.customer_branches set
        branch_name = case when v_payload ? 'branch_name' then v_payload->>'branch_name' else branch_name end,
        delivery_address = case when v_payload ? 'delivery_address' then v_payload->>'delivery_address' else delivery_address end,
        postcode = case when v_payload ? 'postcode' then v_payload->>'postcode' else postcode end,
        country = case when v_payload ? 'country' then v_payload->>'country' else country end,
        phone = case when v_payload ? 'phone' then v_payload->>'phone' else phone end,
        email = case when v_payload ? 'email' then v_payload->>'email' else email end,
        active = case when v_payload ? 'active' then (v_payload->>'active')::boolean else active end,
        updated_at = now()
      where id = v_branch_id;
    elsif v_row->>'action' = 'new' then
      insert into public.customer_branches
        (customer_account_id, branch_name, delivery_address, postcode, country, phone, email, active)
      values
        (v_customer_id, v_payload->>'branch_name', coalesce(v_payload->>'delivery_address', ''),
         coalesce(v_payload->>'postcode', ''), coalesce(v_payload->>'country', 'Wales'),
         coalesce(v_payload->>'phone', ''), coalesce(v_payload->>'email', ''),
         coalesce((v_payload->>'active')::boolean, true))
      returning id into v_branch_id;
    else
      raise exception 'Unsupported branch import action';
    end if;

    insert into public.customer_import_audit
      (workbook_name, sheet_name, row_number, customer_id, branch_id, action, changed_fields, before_values, after_values, imported_by)
    values
      (p_workbook_name, 'Customer Branches', (v_row->>'row_number')::integer, v_customer_id, v_branch_id,
       v_row->>'action', coalesce(v_row->'changed_fields', '[]'::jsonb),
       coalesce(v_row->'before_values', '{}'::jsonb), coalesce(v_row->'after_values', '{}'::jsonb), p_imported_by);
    v_branch_count := v_branch_count + 1;
  end loop;

  return jsonb_build_object('customers_applied', v_account_count, 'branches_applied', v_branch_count);
end;
$$;

revoke all on function public.apply_customer_workbook_import(text, jsonb, jsonb, text, boolean) from public;
grant execute on function public.apply_customer_workbook_import(text, jsonb, jsonb, text, boolean) to anon, authenticated;
