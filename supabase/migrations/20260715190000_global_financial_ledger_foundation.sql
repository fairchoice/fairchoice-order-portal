-- FairChoice global financial ledger foundation.
-- Additive only: existing orders, invoices, payments, allocations, accounts and branches are preserved.

create extension if not exists pgcrypto;

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random