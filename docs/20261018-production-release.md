# 18 October 2026 production release

The user explicitly authorised releasing test commits 750abd2 and 379929f to main,
including the zero-amount invoice-printing resolution. The release retains main's
existing production/return release records and includes both original commits as
ancestors of its release merge commit.

## Changes

- Ten customers per agency page with First/Previous/Next/Last navigation.
- Estimated agency profit, expenses and earnings, with cost-coverage reporting.
- Optional agency assignment on expenses; existing unassigned expenses remain
  separate. Approvers can allocate posted expenses without changing financial
  postings. Existing scope/permission checks remain in effect.
- Invoice document/amendment calculations use saved invoice unit prices and
  quantities before cached net amounts. Free lines still render as zero; original
  prices, quantities, statuses and source objects are preserved. No catalogue
  repricing is introduced.

## Production database updates

Applied and verified on production naobitwzrkovmwvzvgvf before app publication:

- agency_earnings_and_expense_groups, source 20261018114102
- invoice_saved_unit_calculation, source 20261018122246

These schema/function updates have no invoice backfill. Before/after hashes for
all order items, payments, allocations and Wallet transactions match. The earlier
separately authorised invoice data repair was not rerun. Private helpers remain
inaccessible to anon/authenticated; new public RPCs reject invalid FC sessions.
Ten-customer pagination and saved-unit-price precedence are confirmed on production.

Supabase advisors report their standard anon/authenticated SECURITY DEFINER RPC
warnings for the five new FC-session endpoints. They intentionally expose guarded
entry points for the app's custom session scheme; permission/session checks are
inside the RPCs and negative checks pass. Private writer/document helpers are
revoked. Background guidance:
https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable

## Validation

84 focused database/UI/expense/invoice tests pass; production build and migration
contracts pass. The existing root-suite baseline remains 65 pre-existing failures
(550 tests, 485 passing). Source/migrations/tests match test commit 379929f exactly.

The real saved-line snapshot of packing order ORD-1792167433181-6eaeecb9 was passed
through the release calculation: all 13 positive-price zero-net lines calculate
positive amounts, with original rows unchanged. Net 947.25, VAT 189.45, printable
total 1136.70 for the snapshot reviewed; this is a preview calculation, not a
posted invoice or a packing-order database rewrite.

The live October Middleton report query runs successfully. Its 206 missing-cost
lines cause estimated profit/earnings to remain unavailable; this is intentional
rather than counting missing costs as profit. Dates remain unchanged, and the nine
historical invoice exceptions in the earlier review remain unresolved.

## Deployment targets

Git integration deploys main to both Vite production projects in team
team_JH49m1b4jmdqZ3olyphaYT54:

- fairchoice-order-portal: https://order.fairchoice.co.uk
- fairchoice-app: https://fairchoice-app.vercel.app

Confirm both production deployments reach READY for this release SHA and public
HTML/entry assets respond successfully before closing the release.
