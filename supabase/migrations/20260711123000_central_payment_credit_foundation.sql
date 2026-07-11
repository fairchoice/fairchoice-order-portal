-- Central Payment / Customer Credit foundation
-- Additive only: this migration does not rename, update, delete, or copy existing production rows.

create extension if not exists pgcrypto;

create table if not exists public.customer_invoices (
  id uuid primary key default gen_random_uuid(),