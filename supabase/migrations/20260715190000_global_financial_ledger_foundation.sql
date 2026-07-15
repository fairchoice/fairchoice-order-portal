-- FairChoice global financial ledger foundation.
-- Additive only: this migration does not update or delete existing orders,
-- invoices, payments, allocations, customer accounts, branches, or ledger rows.
-- Existing customer payments are exposed through a read-only union view.

create extension if not exists pgcrypto;

create table if not exists public.fin