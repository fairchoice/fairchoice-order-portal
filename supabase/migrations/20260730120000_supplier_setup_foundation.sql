-- Phase 1 Supplier Setup foundation.
-- Extends the canonical public.suppliers identity without introducing supplier
-- payments, supplier ledgers, credit balances, recurring payments, or POs.

do $$
begin
  if to_regclass('public.suppliers') is null then
    raise exception 'Supplier Setup prerequisite missing: public.suppliers';
  end if;
  if to_regprocedure(
       'public.fc_require_session_permission(text,text,text)'
     ) is null then
    raise exception 'Supplier Setup prerequisite missing: fc_require_session_permission(text,text,text)';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'suppliers'
      and column_name = 'id'
      and data_type = 'uuid'
  ) then
    raise exception 'Supplier Setup requires public.suppliers.id uuid';
  end if;
  if exists (
    select required.column_name
    from (
      values
        ('supplier_name'),
        ('vat_number'),
        ('address'),
        ('phone'),
        ('email'),
        ('payment_terms'),
        ('notes'),
        ('active'),
        ('contact_number')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'suppliers'
        and c.column_name = required.column_name
    )
  ) then
    raise exception 'Supplier Setup requires the existing canonical supplier columns';
  end if;
end
$$;

alter table public.suppliers
  add column if not exists company_legal_name text,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists city text,
  add column if not exists postcode text,
  add column if not exists country text,
  add column if not exists default_payment_method text,
  add column if not exists bank_payment_reference text,
  add column if not exists updated_at timestamptz not null default now();

update public.suppliers
set
  supplier_name = trim(supplier_name),
  company_legal_name = nullif(trim(company_legal_name), ''),
  vat_number = nullif(trim(vat_number), ''),
  address_line_1 = nullif(trim(address_line_1), ''),
  address_line_2 = nullif(trim(address_line_2), ''),
  city = nullif(trim(city), ''),
  postcode = nullif(trim(postcode), ''),
  country = nullif(trim(country), ''),
  phone = nullif(trim(phone), ''),
  email = nullif(trim(email), ''),
  payment_terms = nullif(trim(payment_terms), ''),
  default_payment_method = nullif(trim(default_payment_method), ''),
  bank_payment_reference = nullif(trim(bank_payment_reference), ''),
  notes = nullif(trim(notes), ''),
  active = coalesce(active, true);

alter table public.suppliers
  alter column supplier_name set not null,
  alter column active set default true,
  alter column active set not null;

do $$
begin
  if exists (
    select 1 from public.suppliers
    where supplier_name is null or trim(supplier_name) = ''
  ) then
    raise exception 'Supplier Setup cannot enforce required names while blank supplier names exist';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.suppliers'::regclass
      and conname = 'suppliers_supplier_name_required'
  ) then
    alter table public.suppliers
      add constraint suppliers_supplier_name_required
      check (supplier_name = trim(supplier_name) and char_length(supplier_name) between 1 and 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.suppliers'::regclass
      and conname = 'suppliers_default_payment_method_check'
  ) then
    alter table public.suppliers
      add constraint suppliers_default_payment_method_check
      check (
        default_payment_method is null
        or default_payment_method in (
          'Cash', 'Card', 'Bank Transfer', 'Cheque', 'Direct Debit', 'Other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.suppliers'::regclass
      and conname = 'suppliers_notes_length_check'
  ) then
    alter table public.suppliers
      add constraint suppliers_notes_length_check
      check (notes is null or char_length(notes) <= 4000);
  end if;
end
$$;

create index if not exists suppliers_name_ci_idx
  on public.suppliers (lower(supplier_name));

create index if not exists suppliers_active_name_ci_idx
  on public.suppliers (lower(supplier_name))
  where active is true;

create or replace function public.fc_list_suppliers(
  p_username text,
  p_session_token text,
  p_include_inactive boolean default true,
  p_search text default null
)
returns setof public.suppliers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'access_product_setup'
  );

  return query
  select s.*
  from public.suppliers s
  where (coalesce(p_include_inactive, true) or s.active is true)
    and (
      v_search = ''
      or position(
        v_search in lower(concat_ws(
          ' ',
          s.supplier_name,
          s.company_legal_name,
          s.vat_number,
          s.address_line_1,
          s.address_line_2,
          s.city,
          s.postcode,
          s.country,
          s.phone,
          s.email,
          s.payment_terms,
          s.default_payment_method,
          s.bank_payment_reference,
          s.notes
        ))
      ) > 0
    )
  order by lower(s.supplier_name), s.id;
end;
$$;

create or replace function public.fc_upsert_supplier(
  p_username text,
  p_session_token text,
  p_supplier_id uuid,
  p_supplier jsonb
)
returns public.suppliers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_row public.suppliers%rowtype;
  v_name text := trim(coalesce(p_supplier->>'supplier_name', ''));
  v_email text := nullif(trim(coalesce(p_supplier->>'email', '')), '');
  v_payment_method text :=
    nullif(trim(coalesce(p_supplier->>'default_payment_method', '')), '');
  v_address text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'access_product_setup'
  );

  if v_name = '' then
    raise exception 'Supplier name is required.';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'Supplier name must be 200 characters or fewer.';
  end if;
  if v_email is not null
     and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if v_payment_method is not null
     and v_payment_method not in (
       'Cash', 'Card', 'Bank Transfer', 'Cheque', 'Direct Debit', 'Other'
     ) then
    raise exception 'Select a valid default payment method.';
  end if;
  if char_length(coalesce(p_supplier->>'notes', '')) > 4000 then
    raise exception 'Notes must be 4,000 characters or fewer.';
  end if;

  v_address := nullif(concat_ws(
    ', ',
    nullif(trim(coalesce(p_supplier->>'address_line_1', '')), ''),
    nullif(trim(coalesce(p_supplier->>'address_line_2', '')), ''),
    nullif(trim(coalesce(p_supplier->>'city', '')), ''),
    nullif(trim(coalesce(p_supplier->>'postcode', '')), ''),
    nullif(trim(coalesce(p_supplier->>'country', '')), '')
  ), '');

  if p_supplier_id is null then
    insert into public.suppliers (
      supplier_name,
      company_legal_name,
      vat_number,
      address_line_1,
      address_line_2,
      city,
      postcode,
      country,
      phone,
      email,
      payment_terms,
      default_payment_method,
      bank_payment_reference,
      notes,
      address,
      contact_number,
      active,
      updated_at
    )
    values (
      v_name,
      nullif(trim(coalesce(p_supplier->>'company_legal_name', '')), ''),
      nullif(trim(coalesce(p_supplier->>'vat_number', '')), ''),
      nullif(trim(coalesce(p_supplier->>'address_line_1', '')), ''),
      nullif(trim(coalesce(p_supplier->>'address_line_2', '')), ''),
      nullif(trim(coalesce(p_supplier->>'city', '')), ''),
      nullif(trim(coalesce(p_supplier->>'postcode', '')), ''),
      nullif(trim(coalesce(p_supplier->>'country', '')), ''),
      nullif(trim(coalesce(p_supplier->>'phone', '')), ''),
      v_email,
      nullif(trim(coalesce(p_supplier->>'payment_terms', '')), ''),
      v_payment_method,
      nullif(trim(coalesce(p_supplier->>'bank_payment_reference', '')), ''),
      nullif(trim(coalesce(p_supplier->>'notes', '')), ''),
      v_address,
      nullif(trim(coalesce(p_supplier->>'phone', '')), ''),
      true,
      now()
    )
    returning * into v_row;
  else
    update public.suppliers
    set
      supplier_name = v_name,
      company_legal_name =
        nullif(trim(coalesce(p_supplier->>'company_legal_name', '')), ''),
      vat_number = nullif(trim(coalesce(p_supplier->>'vat_number', '')), ''),
      address_line_1 =
        nullif(trim(coalesce(p_supplier->>'address_line_1', '')), ''),
      address_line_2 =
        nullif(trim(coalesce(p_supplier->>'address_line_2', '')), ''),
      city = nullif(trim(coalesce(p_supplier->>'city', '')), ''),
      postcode = nullif(trim(coalesce(p_supplier->>'postcode', '')), ''),
      country = nullif(trim(coalesce(p_supplier->>'country', '')), ''),
      phone = nullif(trim(coalesce(p_supplier->>'phone', '')), ''),
      contact_number = nullif(trim(coalesce(p_supplier->>'phone', '')), ''),
      email = v_email,
      payment_terms =
        nullif(trim(coalesce(p_supplier->>'payment_terms', '')), ''),
      default_payment_method = v_payment_method,
      bank_payment_reference =
        nullif(trim(coalesce(p_supplier->>'bank_payment_reference', '')), ''),
      notes = nullif(trim(coalesce(p_supplier->>'notes', '')), ''),
      address = v_address,
      updated_at = now()
    where id = p_supplier_id
    returning * into v_row;

    if not found then
      raise exception 'Supplier not found.';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.fc_set_supplier_active(
  p_username text,
  p_session_token text,
  p_supplier_id uuid,
  p_active boolean
)
returns public.suppliers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_row public.suppliers%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'access_product_setup'
  );

  update public.suppliers
  set active = coalesce(p_active, false), updated_at = now()
  where id = p_supplier_id
  returning * into v_row;

  if not found then
    raise exception 'Supplier not found.';
  end if;

  return v_row;
end;
$$;

revoke all on function public.fc_list_suppliers(text,text,boolean,text)
  from public;
revoke all on function public.fc_upsert_supplier(text,text,uuid,jsonb)
  from public;
revoke all on function public.fc_set_supplier_active(text,text,uuid,boolean)
  from public;

grant execute on function public.fc_list_suppliers(text,text,boolean,text)
  to anon, authenticated;
grant execute on function public.fc_upsert_supplier(text,text,uuid,jsonb)
  to anon, authenticated;
grant execute on function public.fc_set_supplier_active(text,text,uuid,boolean)
  to anon, authenticated;

-- Existing selectors continue to read public.suppliers, but writes must pass
-- the FC session and setup-permission checks above.
revoke insert, update, delete on table public.suppliers
  from public, anon, authenticated;
