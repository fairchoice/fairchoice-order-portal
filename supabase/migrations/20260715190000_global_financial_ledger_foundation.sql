-- FairChoice global financial ledger foundation.
-- Additive only: this migration does not update or delete existing orders,
-- invoices, payments, allocations, customer accounts, branches, or ledger rows.

create extension if not exists pgcrypto;

create table if not exists public.financial_transactions (
  id uuid primary key default