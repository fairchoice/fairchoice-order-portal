# Canonical payment rollout and rollback

This is a review document. It does not authorise or execute a production change.

## Required production order

1. Confirm a current recoverable Supabase backup and record its timestamp.
2. Save the output of `20260723_canonical_payment_migration_dry_run.sql`.
3. Apply `20260723120000_canonical_payment_writer_and_ledger_sync.sql`.
4. Deploy the frontend writers and verify one approved payment intent in a production-equivalent environment.
5. Apply `20260723121000_block_direct_customer_ledger_payment_writes.sql`.
6. Apply `20260723122000_legacy_customer_payment_reconciliation.sql`.
7. Run the dry-run report again. Review every `MISSING`, `AMBIGUOUS`, `DUPLICATE`, `INVALID`, and `VOIDED_OR_INACTIVE` row.
8. Call `apply_reviewed_customer_ledger_payment_migration_v1` only with explicitly approved `MATCHED` or `MISSING` ledger IDs.
9. Reconcile Central Payment, Weekly Account, Customer Credit, allocations, and audit rows before release.

## Rollback before historical migration

- Revert the frontend to the previous release.
- Drop `customer_ledger_reject_direct_payment_write_v1` first so the previous frontend can write.
- Keep canonical payment and ledger rows already created; do not delete financial history.
- Disable the canonical writer only after the previous frontend is restored.
- Use a forward migration to remove triggers/functions. Do not edit an applied migration.

## Rollback after historical migration

- Do not delete migrated payments or original ledger rows.
- Restore from the confirmed backup if the whole migration must be reversed.
- Otherwise use an audited compensating migration that marks affected canonical payments inactive and clears only the reviewed links, preserving audit evidence.
- Re-run reconciliation and obtain financial approval before reopening payment entry.
