# Saved invoice price calculation review — 18 October 2026

The user authorised checking every invoice and repairing live calculated amounts
using each invoice's existing unit prices, without catalogue repricing, quantity or
status changes, changes to free rows, or new free classifications.

## Live database result

435 canonical records were reviewed: 433 active issued invoices and two cancelled
void records. The two cancelled/void records were preserved.

424 active order-linked invoices had usable printable lines and valid saved
prices/tax information. After repair, all 424 reconcile to calculations from their
saved invoice prices, with no remaining non-free positive-price zero-net lines or
calculation mismatches. The previously corrected ORD-1782383765878 remains 614.84.

- 19 further canonical invoice totals corrected.
- 4,189 line calculation records repaired (including missing derived VAT/gross
  fields); 253 positive-price lines had zero net fields before this batch.
- 221 order calculation headers corrected.
- 309 changed invoices have full before/after audit snapshots.
- Existing explicit order discount metadata/handling was preserved.

The atomic transaction compared full hashes before/after for all line prices,
quantities, statuses and other non-calculated fields; complete free/zero-price
rows; order non-total fields; invoice non-total fields; all customer payments,
allocations and Wallet transactions; non-invoice ledger rows; and cancelled/void
and unlinked invoice records. Every protected hash matched. Any mismatch would
have rolled back the entire repair. No payment allocations were rebuilt and no
payment or Wallet movements were created. Existing canonical triggers kept invoice
ledger amounts and balances in sync.

Production financial_audit_log records:
`INVOICE_SAVED_UNIT_BATCH_REPAIR` and `INVOICE_SAVED_UNIT_BATCH_VERIFIED`, actor
`user-authorised-saved-unit-batch-20261018`; verification entity
`saved-unit-20261018`.

## Nine records requiring historical review

These were checked and preserved rather than guessing, relinking invoices or
changing supply statuses to manufacture a new amount.

| Invoice | Reason |
| --- | --- |
| ORD-1784045990919 | Legacy canonical invoice has no order_id |
| ORD-1784241808255 | Legacy canonical invoice has no order_id; matched order's lines currently Need Supplier |
| ORD-1784232787877 | Legacy canonical invoice has no order_id; matched current order differs materially from invoice |
| ORD-1784274909662 | Legacy canonical invoice has no order_id |
| ORD-1784106635200 | No current printable lines; saved lines marked Need Supplier |
| ORD-1788189870033-8612bc40 | No current printable lines; saved lines marked Need Supplier |
| ORD-1789138295347-14268961 | No current printable lines; saved lines marked Need Supplier |
| ORD-1788868467609-7e9b2837 | No current printable lines; saved lines marked Need Supplier |
| ORD-1783463051863 | No current printable lines; total already zero |

## Code fix on test / V4 only

Invoice document calculations now prefer the saved unit price multiplied by saved
quantity over cached net amounts, including cached zero values. This also applies
when capturing unchanged amendment pricing. No catalogue price lookup is added.
Free lines remain zero in the document and source rows are never mutated by the
calculation. Inclusive VAT modes retain their existing display treatment; missing
unit prices can still fall back to saved net amounts.

Migration `20261018122246_invoice_saved_unit_calculation.sql` applies the same
precedence to the private canonical document helper. It has no automatic data
backfill. The migration was applied to V4 only; production schema/functions and
main application code were not changed by this task.

Validation: 14 invoice calculation/database regression tests pass; production
build passes; root suite has 550 tests, 485 passing with the same 65 pre-existing
failures (two new passing tests). Focused checks cover zero/stale calculated fields,
unchanged invoice prices, free/zero-price lines, excluded supply lines, VAT modes,
manual/void handling, ledger consistency and payment/Wallet preservation.
