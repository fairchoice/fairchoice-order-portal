create extension if not exists pgcrypto;

create table if not exists public.business_payouts (
  id uuid primary key default gen_random_uuid(), payout_date date not null default current_date,
  payout_type text not null check (payout_type in ('Wages','Commission','Bonus','Own Car Mileage','Supplier Payout')),
  payment_type text not null check (payment_type in ('Cash','Bank','Credit','Card')),
  payee_name text, supplier_id uuid references public.suppliers(id) on delete set null,
  pay_period text, notes text, amount numeric(14,2) not null check (amount > 0),
  status text not null check (status in ('Paid','Pending','Approval Needed','Cancelled')),
  created_by text, created_by_username text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.direct_debit_reminders (
  id uuid primary key default gen_random_uuid(), name text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  amount numeric(14,2) not null check (amount > 0), frequency text not null check (frequency in ('Weekly','Monthly')),
  next_due_date date not null, payment_type text not null check (payment_type in ('Cash','Bank','Credit','Card')),
  account_reference text, whatsapp_number text not null, reminder_days_before integer not null default 1 check (reminder_days_before between 0 and 30),
  notes text, active boolean not null default true, last_notified_at timestamptz,
  created_by text, created_by_username text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_notification_queue (
  id uuid primary key default gen_random_uuid(), source_type text not null, source_id uuid not null,
  phone_number text not null, message text not null, scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','CANCELLED')),
  provider_message_id text, error_message text, created_at timestamptz not null default now(), sent_at timestamptz
);
create unique index if not exists whatsapp_notification_queue_unique_due on public.whatsapp_notification_queue(source_type, source_id, scheduled_for);

create table if not exists public.supplier_credit_transactions (
  id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.suppliers(id) on delete restrict,
  transaction_date date not null default current_date,
  transaction_type text not null check (transaction_type in ('Credit Purchase','Payment','Credit Note','Adjustment')),
  amount numeric(14,2) not null check (amount > 0), invoice_number text,
  payment_type text check (payment_type is null or payment_type in ('Cash','Bank','Credit','Card')),
  reference text, notes text, created_by text, created_by_username text,
  created_at timestamptz not null default now()
);

create or replace function public.fc_supplier_credit_statement(p_supplier_id uuid)
returns table(transaction_date date, source text, transaction_type text, invoice_number text, reference text, debit numeric, credit numeric, running_balance numeric)
language sql stable security definer set search_path=public as $$
  with tx as (
    select sct.transaction_date, 'Supplier Credit'::text source, sct.transaction_type,
      sct.invoice_number, sct.reference,
      case when sct.transaction_type in ('Credit Purchase','Adjustment') then sct.amount else 0 end debit,
      case when sct.transaction_type in ('Payment','Credit Note') then sct.amount else 0 end credit,
      sct.created_at
    from public.supplier_credit_transactions sct where sct.supplier_id=p_supplier_id
    union all
    select sr.received_date::date, 'Stock Receipt'::text, 'Credit Purchase'::text,
      sr.invoice_number, sr.purchase_type,
      coalesce(sr.total_cost,0)::numeric, 0::numeric, sr.received_date
    from public.stock_receipts sr join public.suppliers s on lower(trim(s.supplier_name))=lower(trim(sr.supplier_name))
    where s.id=p_supplier_id and lower(coalesce(sr.payment_method,'')) in ('account','credit')
  )
  select transaction_date, source, transaction_type, invoice_number, reference, debit, credit,
    sum(debit-credit) over(order by transaction_date, created_at rows between unbounded preceding and current row)::numeric running_balance
  from tx order by transaction_date, created_at;
$$;

create or replace function public.fc_queue_due_direct_debit_whatsapp()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  insert into public.whatsapp_notification_queue(source_type,source_id,phone_number,message,scheduled_for)
  select 'DIRECT_DEBIT', d.id, d.whatsapp_number,
    'Direct debit reminder: '||d.name||' - £'||to_char(d.amount,'FM999999990.00')||' is due on '||to_char(d.next_due_date,'DD/MM/YYYY'),
    (d.next_due_date - d.reminder_days_before)::timestamp
  from public.direct_debit_reminders d
  where d.active and current_date >= d.next_due_date-d.reminder_days_before and current_date <= d.next_due_date
  on conflict do nothing;
  get diagnostics v_count=row_count; return v_count;
end $$;

create index if not exists business_payouts_date_idx on public.business_payouts(payout_date desc);
create index if not exists direct_debit_due_idx on public.direct_debit_reminders(active,next_due_date);
create index if not exists supplier_credit_supplier_date_idx on public.supplier_credit_transactions(supplier_id,transaction_date);

alter table public.business_payouts enable row level security;
alter table public.direct_debit_reminders enable row level security;
alter table public.whatsapp_notification_queue enable row level security;
alter table public.supplier_credit_transactions enable row level security;

drop policy if exists business_payouts_all on public.business_payouts;
create policy business_payouts_all on public.business_payouts for all to anon, authenticated using (true) with check (true);
drop policy if exists direct_debit_reminders_all on public.direct_debit_reminders;
create policy direct_debit_reminders_all on public.direct_debit_reminders for all to anon, authenticated using (true) with check (true);
drop policy if exists supplier_credit_transactions_all on public.supplier_credit_transactions;
create policy supplier_credit_transactions_all on public.supplier_credit_transactions for all to anon, authenticated using (true) with check (true);
grant select,insert,update on public.business_payouts to anon, authenticated;
grant select,insert,update on public.direct_debit_reminders to anon, authenticated;
grant select,insert,update on public.supplier_credit_transactions to anon, authenticated;
grant execute on function public.fc_supplier_credit_statement(uuid) to anon, authenticated;
grant execute on function public.fc_queue_due_direct_debit_whatsapp() to anon, authenticated;
notify pgrst, 'reload schema';
