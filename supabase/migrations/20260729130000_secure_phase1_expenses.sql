-- Secure Phase 1 Expenses.
-- This migration deliberately excludes supplier credit, direct-debit reminders,
-- WhatsApp queueing, purchase-order automation and Weekly Account deductions.

begin;

create extension if not exists pgcrypto;

-- Fail before dependent DDL if the installed Fair Choice identity, supplier,
-- canonical ledger or audit contracts do not match the types used below.
do $$
declare
  v_check record;
begin
  if to_regclass('public.staff_users') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: public.staff_users';
  end if;
  if to_regclass('public.login_users') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: public.login_users';
  end if;
  if to_regclass('public.suppliers') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: public.suppliers';
  end if;
  if to_regclass('public.fc_permissions') is null
     or to_regclass('public.fc_staff_permissions') is null
     or to_regclass('public.fc_login_sessions') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: FC permission/session tables';
  end if;
  if to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_transaction_archive') is null
     or to_regclass('public.financial_ledger_events') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: canonical Global Ledger tables';
  end if;
  if to_regclass('public.financial_audit_log') is null then
    raise exception 'Phase 1 Expenses prerequisite missing: public.financial_audit_log';
  end if;
  if to_regprocedure(
       'public.fc_require_session_permission(text,text,text)'
     ) is null then
    raise exception 'Phase 1 Expenses prerequisite missing: fc_require_session_permission(text,text,text)';
  end if;
  if to_regprocedure(
       'public.archive_financial_transactions(uuid[],text,text)'
     ) is null then
    raise exception 'Phase 1 Expenses prerequisite missing: archive_financial_transactions(uuid[],text,text)';
  end if;
  if to_regprocedure(
       'public.touch_financial_transaction_updated_at()'
     ) is null then
    raise exception 'Phase 1 Expenses prerequisite missing: touch_financial_transaction_updated_at()';
  end if;
  if not exists (
    select 1
    from pg_index i
    where i.indrelid = 'public.financial_transactions'::regclass
      and i.indisunique
      and i.indexprs is null
      and pg_get_indexdef(i.indexrelid)
        ~* '\(source_type, source_id\)'
  ) then
    raise exception
      'Phase 1 Expenses prerequisite missing: unique Global Ledger source_type/source_id key';
  end if;

  for v_check in
    select *
    from (
      values
        ('staff_users', 'id', 'uuid'),
        ('staff_users', 'active', 'boolean'),
        ('login_users', 'id', 'uuid'),
        ('login_users', 'staff_id', 'uuid'),
        ('login_users', 'active', 'boolean'),
        ('suppliers', 'id', 'uuid'),
        ('suppliers', 'supplier_name', 'text'),
        ('suppliers', 'active', 'boolean'),
        ('financial_transactions', 'id', 'uuid'),
        ('financial_transactions', 'source_type', 'text'),
        ('financial_transactions', 'source_id', 'text'),
        ('financial_transactions', 'transaction_type', 'text'),
        ('financial_transactions', 'transaction_date', 'timestamp with time zone'),
        ('financial_transactions', 'amount', 'numeric(14,2)'),
        ('financial_transactions', 'debit_amount', 'numeric(14,2)'),
        ('financial_transactions', 'credit_amount', 'numeric(14,2)'),
        ('financial_transactions', 'payment_method', 'text'),
        ('financial_transactions', 'reference', 'text'),
        ('financial_transactions', 'description', 'text'),
        ('financial_transactions', 'staff_id', 'uuid'),
        ('financial_transactions', 'staff_name', 'text'),
        ('financial_transactions', 'status', 'text'),
        ('financial_transactions', 'metadata', 'jsonb'),
        ('financial_transactions', 'created_by', 'text'),
        ('financial_ledger_events', 'transaction_id', 'uuid'),
        ('financial_ledger_events', 'event_type', 'text'),
        ('financial_ledger_events', 'actor', 'text'),
        ('financial_ledger_events', 'event_data', 'jsonb'),
        ('financial_audit_log', 'id', 'uuid'),
        ('financial_audit_log', 'action', 'text'),
        ('financial_audit_log', 'entity_type', 'text'),
        ('financial_audit_log', 'entity_id', 'text')
    ) as required(table_name, column_name, expected_type)
  loop
    if not exists (
      select 1
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_check.table_name
        and a.attname = v_check.column_name
        and a.attnum > 0
        and not a.attisdropped
        and format_type(a.atttypid, a.atttypmod) = v_check.expected_type
    ) then
      raise exception
        'Phase 1 Expenses prerequisite mismatch: public.%.% must be %',
        v_check.table_name,
        v_check.column_name,
        v_check.expected_type;
    end if;
  end loop;
end;
$$;

insert into public.fc_permissions (
  permission_key,
  permission_name,
  category,
  description
)
values
  ('expenses.view', 'View Expenses', 'Expenses', 'View Phase 1 business expenses.'),
  ('expenses.create', 'Create Expenses', 'Expenses', 'Create and edit own draft expenses.'),
  ('expenses.submit', 'Submit Expenses', 'Expenses', 'Submit expenses for approval.'),
  ('expenses.approve', 'Approve Expenses', 'Expenses', 'Approve or reject submitted expenses and post them to the Global Ledger.'),
  ('expenses.void', 'Void Expenses', 'Expenses', 'Void expenses and archive their active Global Ledger effect.'),
  ('expense_types.manage', 'Manage Expense Types', 'Expenses', 'Create, edit and deactivate expense types.')
on conflict (permission_key) do nothing;

create table if not exists public.expense_types (
  id uuid primary key default gen_random_uuid(),
  expense_type_code text not null,
  expense_type_name text not null,
  description text null,
  ledger_category text null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  created_by_staff_id uuid null references public.staff_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by_staff_id uuid null references public.staff_users(id) on delete set null,
  constraint expense_types_code_not_blank
    check (nullif(trim(expense_type_code), '') is not null),
  constraint expense_types_name_not_blank
    check (nullif(trim(expense_type_name), '') is not null)
);

create unique index if not exists expense_types_code_uidx
  on public.expense_types (expense_type_code);
create index if not exists expense_types_active_sort_idx
  on public.expense_types (active, sort_order, expense_type_name);

insert into public.expense_types (
  expense_type_code,
  expense_type_name,
  description,
  ledger_category,
  sort_order
)
values
  ('FUEL', 'Fuel', 'Fuel purchased for business vehicles or deliveries.', 'VEHICLE', 10),
  ('VEHICLE_MAINTENANCE', 'Vehicle Maintenance', 'Repairs, servicing and maintenance for business vehicles.', 'VEHICLE', 20),
  ('SUPPLIER_PAYMENT', 'Supplier Payment', 'Approved money paid to a supplier.', 'SUPPLIER', 30),
  ('RENT', 'Rent', 'Business premises rent.', 'OCCUPANCY', 40),
  ('UTILITIES', 'Utilities', 'Business utility costs.', 'OCCUPANCY', 50),
  ('STAFF_EXPENSE', 'Staff Expense', 'Approved staff business expense.', 'STAFF', 60),
  ('BANK_FEE', 'Bank Fee', 'Bank and payment-provider fees.', 'FINANCE', 70),
  ('DELIVERY_EXPENSE', 'Delivery Expense', 'Delivery and distribution costs.', 'DELIVERY', 80),
  ('OTHER', 'Other', 'Other approved business expense.', 'OTHER', 999)
on conflict (expense_type_code) do nothing;

create table if not exists public.business_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_reference text not null,
  payout_date date not null,
  expense_type_id uuid not null,
  supplier_id uuid null,
  amount numeric(14,2) not null,
  payment_method text not null,
  description text null,
  receipt_reference text null,
  receipt_url text null,
  paid_by_type text null,
  paid_by_staff_id uuid null,
  recorded_by_staff_id uuid not null,
  status text not null default 'DRAFT',
  submitted_at timestamptz null,
  approved_by_staff_id uuid null,
  approved_at timestamptz null,
  rejected_by_staff_id uuid null,
  rejected_at timestamptz null,
  rejection_reason text null,
  voided_by_staff_id uuid null,
  voided_at timestamptz null,
  void_reason text null,
  ledger_transaction_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_payouts_amount_positive check (amount > 0),
  constraint business_payouts_payment_method_check
    check (payment_method in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other')),
  constraint business_payouts_status_check
    check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'VOIDED', 'REJECTED')),
  constraint business_payouts_reference_not_blank
    check (nullif(trim(payout_reference), '') is not null),
  constraint business_payouts_expense_type_fk
    foreign key (expense_type_id) references public.expense_types(id) on delete restrict,
  constraint business_payouts_supplier_fk
    foreign key (supplier_id) references public.suppliers(id) on delete restrict,
  constraint business_payouts_paid_by_staff_fk
    foreign key (paid_by_staff_id) references public.staff_users(id) on delete restrict,
  constraint business_payouts_recorded_by_staff_fk
    foreign key (recorded_by_staff_id) references public.staff_users(id) on delete restrict,
  constraint business_payouts_approved_by_staff_fk
    foreign key (approved_by_staff_id) references public.staff_users(id) on delete restrict,
  constraint business_payouts_rejected_by_staff_fk
    foreign key (rejected_by_staff_id) references public.staff_users(id) on delete restrict,
  constraint business_payouts_voided_by_staff_fk
    foreign key (voided_by_staff_id) references public.staff_users(id) on delete restrict,
  constraint business_payouts_ledger_transaction_fk
    foreign key (ledger_transaction_id) references public.financial_transactions(id) on delete restrict
);

-- Additive repair path for an empty or already-compatible pre-existing table.
-- Legacy rows are never guessed, rewritten or deleted.
alter table public.business_payouts
  add column if not exists payout_reference text,
  add column if not exists payout_date date,
  add column if not exists expense_type_id uuid,
  add column if not exists supplier_id uuid,
  add column if not exists amount numeric(14,2),
  add column if not exists payment_method text,
  add column if not exists description text,
  add column if not exists receipt_reference text,
  add column if not exists receipt_url text,
  add column if not exists paid_by_type text,
  add column if not exists paid_by_staff_id uuid,
  add column if not exists recorded_by_staff_id uuid,
  add column if not exists status text default 'DRAFT',
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_by_staff_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by_staff_id uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text,
  add column if not exists voided_by_staff_id uuid,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists ledger_transaction_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

do $$
declare
  v_constraint record;
begin
  if exists (
    select 1
    from public.business_payouts
    where payout_reference is null
       or payout_date is null
       or expense_type_id is null
       or amount is null
       or amount <= 0
       or payment_method is null
       or recorded_by_staff_id is null
       or status is null
  ) then
    raise exception
      'Phase 1 Expenses cannot safely repair existing business_payouts rows. Resolve required fields manually before applying this migration.';
  end if;

  for v_constraint in
    select conname, pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%payment_type%'
        or pg_get_constraintdef(oid) ilike '%payment_method%'
        or pg_get_constraintdef(oid) ilike '%status%'
      )
  loop
    if v_constraint.definition ilike '%payment_type%'
       or (
         v_constraint.definition ilike '%payment_method%'
         and v_constraint.definition not ilike '%Bank Transfer%'
       )
       or (
         v_constraint.definition ilike '%status%'
         and v_constraint.definition not ilike '%SUBMITTED%'
       ) then
      raise exception
        'Phase 1 Expenses found incompatible legacy business_payouts constraint %: %',
        v_constraint.conname,
        v_constraint.definition;
    end if;
  end loop;
end;
$$;

alter table public.business_payouts
  alter column payout_reference set not null,
  alter column payout_date set not null,
  alter column expense_type_id set not null,
  alter column amount set not null,
  alter column payment_method set not null,
  alter column recorded_by_staff_id set not null,
  alter column status set default 'DRAFT',
  alter column status set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_expense_type_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_expense_type_fk
      foreign key (expense_type_id)
      references public.expense_types(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_supplier_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_supplier_fk
      foreign key (supplier_id)
      references public.suppliers(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_paid_by_staff_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_paid_by_staff_fk
      foreign key (paid_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_recorded_by_staff_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_recorded_by_staff_fk
      foreign key (recorded_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_approved_by_staff_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_approved_by_staff_fk
      foreign key (approved_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_rejected_by_staff_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_rejected_by_staff_fk
      foreign key (rejected_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_voided_by_staff_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_voided_by_staff_fk
      foreign key (voided_by_staff_id)
      references public.staff_users(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_ledger_transaction_fk'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_ledger_transaction_fk
      foreign key (ledger_transaction_id)
      references public.financial_transactions(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_amount_positive'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_amount_positive
      check (amount > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_payment_method_check'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_payment_method_check
      check (payment_method in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_status_check'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_status_check
      check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'VOIDED', 'REJECTED'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.business_payouts'::regclass
      and conname = 'business_payouts_reference_not_blank'
  ) then
    alter table public.business_payouts
      add constraint business_payouts_reference_not_blank
      check (nullif(trim(payout_reference), '') is not null);
  end if;
end;
$$;

create unique index if not exists business_payouts_reference_uidx
  on public.business_payouts (payout_reference);
create unique index if not exists business_payouts_ledger_transaction_uidx
  on public.business_payouts (ledger_transaction_id)
  where ledger_transaction_id is not null;
create index if not exists business_payouts_status_date_idx
  on public.business_payouts (status, payout_date desc);
create index if not exists business_payouts_expense_type_date_idx
  on public.business_payouts (expense_type_id, payout_date desc);
create index if not exists business_payouts_supplier_date_idx
  on public.business_payouts (supplier_id, payout_date desc)
  where supplier_id is not null;

alter table public.financial_audit_log
  add column if not exists actor_staff_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.financial_audit_log'::regclass
      and conname = 'financial_audit_log_actor_staff_fk'
  ) then
    alter table public.financial_audit_log
      add constraint financial_audit_log_actor_staff_fk
      foreign key (actor_staff_id)
      references public.staff_users(id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.expense_types'::regclass
      and tgname = 'expense_types_touch_updated_at'
      and not tgisinternal
  ) then
    create trigger expense_types_touch_updated_at
    before update on public.expense_types
    for each row execute function public.touch_financial_transaction_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.business_payouts'::regclass
      and tgname = 'business_payouts_touch_updated_at'
      and not tgisinternal
  ) then
    create trigger business_payouts_touch_updated_at
    before update on public.business_payouts
    for each row execute function public.touch_financial_transaction_updated_at();
  end if;
end;
$$;

alter table public.expense_types enable row level security;
alter table public.business_payouts enable row level security;

drop policy if exists business_payouts_all on public.business_payouts;
drop policy if exists expense_types_public_access on public.expense_types;

revoke all on table public.expense_types
  from public, anon, authenticated;
revoke all on table public.business_payouts
  from public, anon, authenticated;

create or replace function public.fc_list_expense_types(
  p_username text,
  p_session_token text,
  p_include_inactive boolean default false
)
returns table (
  id uuid,
  expense_type_code text,
  expense_type_name text,
  description text,
  ledger_category text,
  active boolean,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    case when p_include_inactive then 'expense_types.manage' else 'expenses.view' end
  );

  if v_actor.staff_id is null then
    raise exception 'An active FC staff identity is required.'
      using errcode = '42501';
  end if;

  return query
  select
    et.id,
    et.expense_type_code,
    et.expense_type_name,
    et.description,
    et.ledger_category,
    et.active,
    et.sort_order,
    et.created_at,
    et.updated_at
  from public.expense_types et
  where p_include_inactive or et.active is true
  order by et.sort_order, et.expense_type_name, et.id;
end;
$$;

create or replace function public.fc_list_business_payouts(
  p_username text,
  p_session_token text
)
returns table (
  id uuid,
  payout_reference text,
  payout_date date,
  expense_type_id uuid,
  expense_type_code text,
  expense_type_name text,
  supplier_id uuid,
  supplier_name text,
  amount numeric,
  payment_method text,
  description text,
  receipt_reference text,
  receipt_url text,
  paid_by_type text,
  paid_by_staff_id uuid,
  recorded_by_staff_id uuid,
  recorded_by_staff_name text,
  status text,
  submitted_at timestamptz,
  approved_by_staff_id uuid,
  approved_at timestamptz,
  rejected_by_staff_id uuid,
  rejected_at timestamptz,
  rejection_reason text,
  voided_by_staff_id uuid,
  voided_at timestamptz,
  void_reason text,
  ledger_transaction_id uuid,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'expenses.view'
  );

  if v_actor.staff_id is null then
    raise exception 'An active FC staff identity is required.'
      using errcode = '42501';
  end if;

  return query
  select
    bp.id,
    bp.payout_reference,
    bp.payout_date,
    bp.expense_type_id,
    et.expense_type_code,
    et.expense_type_name,
    bp.supplier_id,
    s.supplier_name,
    bp.amount,
    bp.payment_method,
    bp.description,
    bp.receipt_reference,
    bp.receipt_url,
    bp.paid_by_type,
    bp.paid_by_staff_id,
    bp.recorded_by_staff_id,
    recorder.staff_name,
    bp.status,
    bp.submitted_at,
    bp.approved_by_staff_id,
    bp.approved_at,
    bp.rejected_by_staff_id,
    bp.rejected_at,
    bp.rejection_reason,
    bp.voided_by_staff_id,
    bp.voided_at,
    bp.void_reason,
    bp.ledger_transaction_id,
    bp.created_at,
    bp.updated_at
  from public.business_payouts bp
  join public.expense_types et on et.id = bp.expense_type_id
  join public.staff_users recorder on recorder.id = bp.recorded_by_staff_id
  left join public.suppliers s on s.id = bp.supplier_id
  order by bp.payout_date desc, bp.created_at desc, bp.id;
end;
$$;

create or replace function public.fc_create_business_payout(
  p_username text,
  p_session_token text,
  p_payout_date date,
  p_expense_type_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_description text default null,
  p_receipt_reference text default null,
  p_receipt_url text default null,
  p_paid_by_type text default 'BUSINESS',
  p_paid_by_staff_id uuid default null,
  p_submit boolean default false
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_submit_actor record;
  v_row public.business_payouts%rowtype;
  v_reference text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'expenses.create'
  );
  if v_actor.staff_id is null then
    raise exception 'An active FC staff identity is required.'
      using errcode = '42501';
  end if;
  if p_submit then
    select * into v_submit_actor
    from public.fc_require_session_permission(
      p_username,
      p_session_token,
      'expenses.submit'
    );
  end if;
  if p_payout_date is null then
    raise exception 'Payout date is required.';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Amount must be greater than zero.';
  end if;
  if p_payment_method not in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other') then
    raise exception 'Unsupported payment method.';
  end if;
  if not exists (
    select 1 from public.expense_types
    where id = p_expense_type_id and active is true
  ) then
    raise exception 'Expense type is missing or inactive.';
  end if;
  if p_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where id = p_supplier_id
         and coalesce(active, true) is true
     ) then
    raise exception 'Supplier is missing or inactive.';
  end if;
  if p_paid_by_staff_id is not null
     and not exists (
       select 1 from public.staff_users
       where id = p_paid_by_staff_id and active is true
     ) then
    raise exception 'Paid-by staff identity is missing or inactive.';
  end if;

  v_reference :=
    'EXP-' || to_char(p_payout_date, 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.business_payouts (
    payout_reference,
    payout_date,
    expense_type_id,
    supplier_id,
    amount,
    payment_method,
    description,
    receipt_reference,
    receipt_url,
    paid_by_type,
    paid_by_staff_id,
    recorded_by_staff_id,
    status,
    submitted_at
  )
  values (
    v_reference,
    p_payout_date,
    p_expense_type_id,
    p_supplier_id,
    round(p_amount, 2),
    p_payment_method,
    nullif(trim(coalesce(p_description, '')), ''),
    nullif(trim(coalesce(p_receipt_reference, '')), ''),
    nullif(trim(coalesce(p_receipt_url, '')), ''),
    nullif(trim(coalesce(p_paid_by_type, '')), ''),
    p_paid_by_staff_id,
    v_actor.staff_id,
    case when p_submit then 'SUBMITTED' else 'DRAFT' end,
    case when p_submit then now() else null end
  )
  returning * into v_row;

  insert into public.financial_audit_log (
    action,
    entity_type,
    entity_id,
    reason,
    before_data,
    after_data,
    changed_by,
    actor_staff_id
  )
  values (
    'CREATE',
    'BUSINESS_PAYOUT',
    v_row.id::text,
    case when p_submit then 'Created and submitted' else 'Created as draft' end,
    null,
    to_jsonb(v_row),
    v_actor.username,
    v_actor.staff_id
  );

  return v_row;
end;
$$;

create or replace function public.fc_update_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid,
  p_payout_date date,
  p_expense_type_id uuid,
  p_supplier_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_description text default null,
  p_receipt_reference text default null,
  p_receipt_url text default null,
  p_paid_by_type text default 'BUSINESS',
  p_paid_by_staff_id uuid default null
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_admin_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username,
    p_session_token,
    'expenses.create'
  );

  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status not in ('DRAFT', 'REJECTED') then
    raise exception 'Only DRAFT or REJECTED expenses may be edited.';
  end if;
  if v_before.recorded_by_staff_id <> v_actor.staff_id then
    select * into v_admin_actor
    from public.fc_require_session_permission(
      p_username,
      p_session_token,
      'expenses.approve'
    );
  end if;
  if p_payout_date is null or coalesce(p_amount, 0) <= 0 then
    raise exception 'A valid payout date and positive amount are required.';
  end if;
  if p_payment_method not in ('Cash', 'Card', 'Bank Transfer', 'Cheque', 'Other') then
    raise exception 'Unsupported payment method.';
  end if;
  if not exists (
    select 1 from public.expense_types
    where id = p_expense_type_id and active is true
  ) then
    raise exception 'Expense type is missing or inactive.';
  end if;
  if p_supplier_id is not null
     and not exists (
       select 1 from public.suppliers
       where id = p_supplier_id
         and coalesce(active, true) is true
     ) then
    raise exception 'Supplier is missing or inactive.';
  end if;
  if p_paid_by_staff_id is not null
     and not exists (
       select 1 from public.staff_users
       where id = p_paid_by_staff_id and active is true
     ) then
    raise exception 'Paid-by staff identity is missing or inactive.';
  end if;

  update public.business_payouts
  set
    payout_date = p_payout_date,
    expense_type_id = p_expense_type_id,
    supplier_id = p_supplier_id,
    amount = round(p_amount, 2),
    payment_method = p_payment_method,
    description = nullif(trim(coalesce(p_description, '')), ''),
    receipt_reference = nullif(trim(coalesce(p_receipt_reference, '')), ''),
    receipt_url = nullif(trim(coalesce(p_receipt_url, '')), ''),
    paid_by_type = nullif(trim(coalesce(p_paid_by_type, '')), ''),
    paid_by_staff_id = p_paid_by_staff_id,
    status = 'DRAFT',
    submitted_at = null,
    rejected_by_staff_id = null,
    rejected_at = null,
    rejection_reason = null
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'UPDATE', 'BUSINESS_PAYOUT', v_after.id::text, 'Expense amended',
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );

  return v_after;
end;
$$;

create or replace function public.fc_submit_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.submit'
  );
  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status <> 'DRAFT' then
    raise exception 'Only a DRAFT expense may be submitted.';
  end if;

  update public.business_payouts
  set status = 'SUBMITTED', submitted_at = now()
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'SUBMIT', 'BUSINESS_PAYOUT', v_after.id::text, 'Submitted for approval',
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );
  return v_after;
end;
$$;

create or replace function public.fc_approve_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
  v_expense_type public.expense_types%rowtype;
  v_ledger public.financial_transactions%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.approve'
  );
  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status = 'POSTED' then
    if v_before.ledger_transaction_id is null then
      raise exception 'Posted expense is missing its ledger transaction.';
    end if;
    if not exists (
      select 1
      from public.financial_transactions ft
      where ft.id = v_before.ledger_transaction_id
        and ft.source_type = 'business_payouts'
        and ft.source_id = v_before.id::text
        and ft.status = 'ACTIVE'
        and ft.amount = v_before.amount
        and ft.debit_amount = v_before.amount
        and ft.credit_amount = 0
    ) then
      raise exception 'Posted expense does not have one matching active ledger effect.';
    end if;
    return v_before;
  end if;
  if v_before.status <> 'SUBMITTED' then
    raise exception 'Only a SUBMITTED expense may be approved.';
  end if;
  if v_before.voided_at is not null then
    raise exception 'A voided expense cannot be approved.';
  end if;

  select * into v_expense_type
  from public.expense_types
  where id = v_before.expense_type_id;
  if not found then
    raise exception 'Expense type no longer exists.';
  end if;

  select * into v_ledger
  from public.financial_transactions
  where source_type = 'business_payouts'
    and source_id = v_before.id::text
  for update;

  if found then
    if v_ledger.status <> 'ACTIVE'
       or v_ledger.amount <> v_before.amount
       or v_ledger.debit_amount <> v_before.amount
       or v_ledger.credit_amount <> 0 then
      raise exception 'Existing ledger transaction does not match this expense.';
    end if;
  else
    insert into public.financial_transactions (
      source_type,
      source_id,
      transaction_type,
      transaction_date,
      amount,
      debit_amount,
      credit_amount,
      payment_method,
      reference,
      description,
      staff_id,
      staff_name,
      status,
      metadata,
      created_by
    )
    values (
      'business_payouts',
      v_before.id::text,
      'EXPENSE',
      v_before.payout_date::timestamptz,
      v_before.amount,
      v_before.amount,
      0,
      v_before.payment_method,
      v_before.payout_reference,
      coalesce(v_before.description, v_expense_type.expense_type_name),
      v_actor.staff_id,
      v_actor.staff_name,
      'ACTIVE',
      jsonb_build_object(
        'direction', 'OUT',
        'source_table', 'business_payouts',
        'payout_id', v_before.id,
        'expense_type_id', v_before.expense_type_id,
        'expense_type_code', v_expense_type.expense_type_code,
        'supplier_id', v_before.supplier_id,
        'recorded_by_staff_id', v_before.recorded_by_staff_id,
        'approved_by_staff_id', v_actor.staff_id
      ),
      v_actor.username
    )
    returning * into v_ledger;

    insert into public.financial_ledger_events (
      transaction_id,
      event_type,
      actor,
      reason,
      event_data
    )
    values (
      v_ledger.id,
      'CREATE',
      v_actor.username,
      'Approved business expense',
      jsonb_build_object(
        'source_type', 'business_payouts',
        'source_id', v_before.id,
        'direction', 'OUT',
        'amount', v_before.amount
      )
    )
    on conflict do nothing;
  end if;

  update public.business_payouts
  set
    status = 'POSTED',
    approved_by_staff_id = v_actor.staff_id,
    approved_at = now(),
    ledger_transaction_id = v_ledger.id
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'APPROVE', 'BUSINESS_PAYOUT', v_after.id::text,
    'Approved and posted once to the Global Ledger',
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );
  return v_after;
end;
$$;

create or replace function public.fc_reject_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid,
  p_reason text
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.approve'
  );
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Rejection reason is required.';
  end if;
  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status <> 'SUBMITTED' then
    raise exception 'Only a SUBMITTED expense may be rejected.';
  end if;

  update public.business_payouts
  set
    status = 'REJECTED',
    rejected_by_staff_id = v_actor.staff_id,
    rejected_at = now(),
    rejection_reason = trim(p_reason)
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'REJECT', 'BUSINESS_PAYOUT', v_after.id::text, trim(p_reason),
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );
  return v_after;
end;
$$;

create or replace function public.fc_void_business_payout(
  p_username text,
  p_session_token text,
  p_payout_id uuid,
  p_reason text
)
returns public.business_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.business_payouts%rowtype;
  v_after public.business_payouts%rowtype;
  v_archive_count integer := 0;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expenses.void'
  );
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Void reason is required.';
  end if;
  select * into v_before
  from public.business_payouts
  where id = p_payout_id
  for update;
  if not found then
    raise exception 'Expense not found.';
  end if;
  if v_before.status = 'VOIDED' then
    return v_before;
  end if;

  if v_before.ledger_transaction_id is not null then
    v_archive_count := public.archive_financial_transactions(
      array[v_before.ledger_transaction_id],
      v_actor.username,
      trim(p_reason)
    );
    if v_archive_count <> 1
       and not exists (
         select 1
         from public.financial_transactions
         where id = v_before.ledger_transaction_id
           and status in ('ARCHIVED', 'VOIDED')
       ) then
      raise exception 'The linked Global Ledger effect could not be voided.';
    end if;
  end if;

  update public.business_payouts
  set
    status = 'VOIDED',
    voided_by_staff_id = v_actor.staff_id,
    voided_at = now(),
    void_reason = trim(p_reason)
  where id = p_payout_id
  returning * into v_after;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'VOID', 'BUSINESS_PAYOUT', v_after.id::text, trim(p_reason),
    to_jsonb(v_before), to_jsonb(v_after), v_actor.username, v_actor.staff_id
  );
  return v_after;
end;
$$;

create or replace function public.fc_upsert_expense_type(
  p_username text,
  p_session_token text,
  p_expense_type_id uuid,
  p_expense_type_code text,
  p_expense_type_name text,
  p_description text default null,
  p_ledger_category text default null,
  p_active boolean default true,
  p_sort_order integer default 0
)
returns public.expense_types
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor record;
  v_before public.expense_types%rowtype;
  v_after public.expense_types%rowtype;
  v_code text;
begin
  select * into v_actor
  from public.fc_require_session_permission(
    p_username, p_session_token, 'expense_types.manage'
  );
  v_code := upper(trim(coalesce(p_expense_type_code, '')));
  if nullif(v_code, '') is null
     or nullif(trim(coalesce(p_expense_type_name, '')), '') is null then
    raise exception 'Expense type code and name are required.';
  end if;

  if p_expense_type_id is not null then
    select * into v_before
    from public.expense_types
    where id = p_expense_type_id
    for update;
  else
    select * into v_before
    from public.expense_types
    where expense_type_code = v_code
    for update;
  end if;

  if found then
    update public.expense_types
    set
      expense_type_code = v_code,
      expense_type_name = trim(p_expense_type_name),
      description = nullif(trim(coalesce(p_description, '')), ''),
      ledger_category = nullif(trim(coalesce(p_ledger_category, '')), ''),
      active = coalesce(p_active, true),
      sort_order = coalesce(p_sort_order, 0),
      updated_by_staff_id = v_actor.staff_id
    where id = v_before.id
    returning * into v_after;
  else
    insert into public.expense_types (
      expense_type_code,
      expense_type_name,
      description,
      ledger_category,
      active,
      sort_order,
      created_by_staff_id,
      updated_by_staff_id
    )
    values (
      v_code,
      trim(p_expense_type_name),
      nullif(trim(coalesce(p_description, '')), ''),
      nullif(trim(coalesce(p_ledger_category, '')), ''),
      coalesce(p_active, true),
      coalesce(p_sort_order, 0),
      v_actor.staff_id,
      v_actor.staff_id
    )
    returning * into v_after;
  end if;

  insert into public.financial_audit_log (
    action, entity_type, entity_id, reason,
    before_data, after_data, changed_by, actor_staff_id
  )
  values (
    'EXPENSE_TYPE_CHANGE',
    'EXPENSE_TYPE',
    v_after.id::text,
    case
      when v_before.id is null then 'Expense type created'
      when v_after.active is false then 'Expense type deactivated'
      else 'Expense type updated'
    end,
    case when v_before.id is null then null else to_jsonb(v_before) end,
    to_jsonb(v_after),
    v_actor.username,
    v_actor.staff_id
  );
  return v_after;
end;
$$;

revoke all on function public.fc_list_expense_types(text,text,boolean)
  from public, anon, authenticated;
revoke all on function public.fc_list_business_payouts(text,text)
  from public, anon, authenticated;
revoke all on function public.fc_create_business_payout(
  text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean
) from public, anon, authenticated;
revoke all on function public.fc_update_business_payout(
  text,text,uuid,date,uuid,uuid,numeric,text,text,text,text,text,uuid
) from public, anon, authenticated;
revoke all on function public.fc_submit_business_payout(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.fc_approve_business_payout(text,text,uuid)
  from public, anon, authenticated;
revoke all on function public.fc_reject_business_payout(text,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.fc_void_business_payout(text,text,uuid,text)
  from public, anon, authenticated;
revoke all on function public.fc_upsert_expense_type(
  text,text,uuid,text,text,text,text,boolean,integer
) from public, anon, authenticated;

grant execute on function public.fc_list_expense_types(text,text,boolean)
  to anon, authenticated;
grant execute on function public.fc_list_business_payouts(text,text)
  to anon, authenticated;
grant execute on function public.fc_create_business_payout(
  text,text,date,uuid,uuid,numeric,text,text,text,text,text,uuid,boolean
) to anon, authenticated;
grant execute on function public.fc_update_business_payout(
  text,text,uuid,date,uuid,uuid,numeric,text,text,text,text,text,uuid
) to anon, authenticated;
grant execute on function public.fc_submit_business_payout(text,text,uuid)
  to anon, authenticated;
grant execute on function public.fc_approve_business_payout(text,text,uuid)
  to anon, authenticated;
grant execute on function public.fc_reject_business_payout(text,text,uuid,text)
  to anon, authenticated;
grant execute on function public.fc_void_business_payout(text,text,uuid,text)
  to anon, authenticated;
grant execute on function public.fc_upsert_expense_type(
  text,text,uuid,text,text,text,text,boolean,integer
) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
