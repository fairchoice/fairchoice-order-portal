# Issued invoices: read-only isolation and audit

## Read-only live audit

Inspected `fairchoice-order-system` (`naobitwzrkovmwvzvgvf`) on 20 October 2026.
The audit made no invoice/order/line/ledger/payment edits. After explicit user
authorization, the protection schema was installed without changing any existing
row in those tables; only immutable original archive copies were added.

- 442 canonical invoices; 440 positive totals, two zero totals, no NULL or negative totals.
- Stored invoice totals sum to £196,412.41.
- No canonical invoice with a referenced order was missing its order or order lines.
- Content checksum of invoice id/number/total/mode: `74a236dfd4cc46fec83c098bf402907d`.
- The verified protected owner account is `nisstaj_admin`. No `nisstaj_adm` account exists.

The two pre-existing zero exceptions remain unchanged:

| Invoice | Current stored total | Saved line state |
| --- | --- | --- |
| ORD-1783463051863 | £0.00 | 15 Need Supplier and two Cannot Supply lines; no billable supplied lines |
| ORD-1782415703998 | £0.00 | 12 removed lines, two Cannot Supply lines and one zero-priced In Stock line |

Raw quantity × price on unavailable lines is not an amount to charge. No price,
quantity, classification, amendment or replacement total has been inferred.

## Installed protection

The database migration archives each existing original invoice/header/line
snapshot into a new private, RLS-protected table. It does not UPDATE or DELETE
any existing invoice, order, line, ledger or payment record. Archives cannot be
modified or deleted by the amendment workflow. No new Data API grants expose
the private archive or transaction edit context.

Guards protect canonical invoices, their original orders and lines, and invoice
ledger contents. Direct edits, deletes, line additions/reparenting and TRUNCATE
are blocked. Source-order total triggers no longer rewrite existing invoices.
Repeated invoice sync returns without updates or FIFO reallocation. New zero,
negative, NULL or nonfinite invoice amounts are rejected. Existing zero
exceptions are preserved for explicit owner review, not silently repaired.

Opening, previewing, printing and downloading remain read-only. Existing ledger
or canonical invoices are returned without resaving or resynchronizing them.
The legacy browser amendment method is disabled. General admins cannot open
amendment forms; a role or client username alone cannot authorize an edit.

The new owner amendment path verifies the existing `nisstaj_admin` FC session
on the database, checks the current invoice revision, requires an explicit
reason and user confirmation, then updates saved lines/header/totals and writes
a before/after financial audit in one transaction. No catalogue lookup or price
refresh is performed. Stale versions, cross-invoice line IDs or zero totals
roll back the whole transaction. The original archived snapshot remains intact.

Payment collection, wallet application and settlement statuses remain separate
and can change without changing original invoice contents. The guard allows
only the enumerated payment/collection fields for ordinary updates. Existing
legacy cancellation, void and deletion routines cannot bypass these guards;
a separate reviewed owner workflow would be required to support those actions.

## Validation and live verification

- 15 local integration tests pass against isolated PostgreSQL (PGlite) and the
  real client invoice modules. Thirteen focused invoice/action/status/totals
  tests and the production build pass. The broad suite retains the same 65
  failing test names as the unchanged baseline.
- Run `npm ci`, `npm ci --prefix tests/invoice-isolation`, then
  `npm test --prefix tests/invoice-isolation` to reproduce the integration tests.
- On Fairchoice-V4-test, all 412 original invoices were archived. Full-row
  checksums of invoices, orders, items and ledger matched before and after.
  Five attempted historical mutations were rejected. The real delivery trigger
  created exactly one positive invoice, one ledger entry and an original
  snapshot; repeat sync kept a single ledger entry. All fixture writes rolled back.
- A temporary new hosted test invoice and synthetic, transaction-local owner
  session verified the real FC session validator, owner amendment, financial
  audit and immutable original. Invalid tokens and idle-expired sessions were
  rejected. All fixtures and the synthetic session were rolled back.
- The owner amendment helper uses `fc_require_session_permission_v2`, checking
  revocation, idle and absolute expiry, auth version, active identity and
  effective invoice permissions, followed by the exact owner username check.
- The live release applied the two reviewed schema files as one transaction:
  `issued_invoice_read_only_guards` and `issued_invoice_owner_session_v2`.
  It used short write locks, a 5-second lock timeout and a 90-second statement
  timeout, with an in-transaction assertion that every original row checksum
  remained unchanged. No live test transactions or invoice repairs were run.
- Live verification: 442 invoices, 442 matching immutable snapshots, all four
  content guards enabled, zero active edit contexts. Stored totals remain
  £196,412.41 and the two pre-existing zero invoices are unchanged.

The full-row live checksums match before and after installation:

| Original table | MD5 |
| --- | --- |
| customer_invoices | aee6e5cf378e934ca2b167bf4c4b0bff |
| orders | 5234cc9f4dade9b528029080dcd35191 |
| order_items | 05d67c409c3cc40942191e2fa2de37b0 |
| customer_ledger | 7301ff7e07377014f546c80327af8fd8 |

The two archive/context tables deliberately have RLS with no client policies
or grants. The guarded amendment RPCs intentionally accept the public client
role used by FC login, but authenticate the FC session and exact owner on the
server; a supplied username alone is never authorization. Security-advisor
notices about those deliberate entry points were reviewed against the tested
session checks.

The accompanying application change makes existing invoice reads idempotent,
hides amendments from ordinary admins and routes explicit owner edits through
one atomic RPC. The production release contains only invoice protection; the
customer-offer and city-exclusion changes remain on test.
