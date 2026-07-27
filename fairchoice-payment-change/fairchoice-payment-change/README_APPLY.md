# Fair Choice payment migration change

Files:

- `supabase/migrations/20260726130000_complete_canonical_payment_and_global_ledger.sql`
- `POST_STABILISATION_CLEANUP.md`

## Before deployment

1. Ensure production backups and the three pre-migration snapshot tables still exist.
2. Commit these files to the application repository.
3. Run `npm test`.
4. Apply through the normal Supabase migration deployment process.

The SQL is fail-closed: it aborts if the reviewed legacy candidate counts no longer match the audited set (40 missing, 39 approved, one Credit excluded, three Bank Transfers, one Account-to-Card mapping).

## Expected production outcome

- 39 reviewed legacy money receipts become canonical `customer_payments`.
- The legacy Credit row is excluded.
- Three Bank Transfers remain `PENDING_VERIFICATION` and contribute zero income.
- Existing legacy `customer_ledger` rows are linked, not duplicated.
- All canonical payment rows receive exactly one `financial_transactions` row.
- The payment-to-Global-Ledger trigger is restored.
