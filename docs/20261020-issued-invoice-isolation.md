# Issued invoices: read-only isolation and audit

## Read-only live audit

Inspected `fairchoice-order-system` (`naobitwzrkovmwvzvgvf`) on 20 October 2026.
No live INSERT, UPDATE, DELETE, repair, backfill or migration was executed.

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

## Protection prepared on test branch

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

## Validation and release status

- 15 local integration tests pass against isolated PostgreSQL (PGlite) and the
  real client invoice modules. Tests verify no installation data changes,
  protected content, direct SQL/TRUNCATE rejection, unforgeable edit context,
  exact-owner/session checks, atomic owner edits, immutable originals, zero
  rejection, stale versions, cross-invoice rollback, separate payments and
  repeat view/sync with no write.
- Thirteen focused invoice/action/status/totals tests pass. Production build
  passes. The broad suite has 65 failures with the same failing test names as
  the unchanged baseline; the change introduces no new broad-suite failures.
  Existing UI-lint findings remain outside this protection change.
- Run `npm ci`, `npm ci --prefix tests/invoice-isolation`, then
  `npm test --prefix tests/invoice-isolation` to reproduce the integration tests.
- Hosted test-database verification was blocked by automatic approval review:
  the read-only checksum request targeted the test project rather than the
  live project authorized for this audit. No hosted migration was attempted.
- These new guards are NOT installed on live. Approval is required to verify
  the exact migration on Fairchoice-V4-test, then install and release only this
  invoice-protection change on live after successful hosted checks. Do not
  include the unrelated customer-offer/city-exclusion changes in that release.
