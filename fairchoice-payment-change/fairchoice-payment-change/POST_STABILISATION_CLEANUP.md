# Post-stabilisation cleanup plan

**Status:** Deferred intentionally. Do not delete files or database objects until the completed payment system has been verified in production and remained stable.

## Exit criteria before cleanup

- Canonical Payment is the only payment write path.
- The reviewed legacy-payment migration is complete and reconciled.
- Customer Credit totals are unchanged and correct.
- Weekly Account remains read-only and its totals are unchanged.
- Global Financial Ledger shows confirmed payment income correctly.
- Pending bank transfers contribute zero income until confirmed.
- No duplicate `customer_payments`, derived `customer_ledger` rows, or `financial_transactions` exist.
- The promotion-calculation issue has been resolved and regression-tested.
- A current production backup and recovery plan have been confirmed.

## Files to review later — do not delete now

### Migrations

Classify every migration as one of:

- Required historical migration
- Current active architecture
- Superseded but required for migration history
- One-off production repair
- Temporary diagnostic or test migration
- Safe to archive from the working view

Important: never remove or rewrite an already-applied production migration merely to make the folder look cleaner. Preserve migration history; archive only through an agreed repository policy.

### Temporary SQL and investigation artefacts

Review and remove or archive only after stability:

- one-off audit queries
- temporary repair scripts
- reconciliation exports
- duplicate test-data scripts
- local database dumps and snapshots

Database backups containing customer or financial information must never be committed to Git.

### Documentation

Review:

- `FINANCIAL_TEST_DATA.md`
- `FC_SECURITY_UPDATE.md`
- `PICKING_WORKFLOW_IMPLEMENTATION.md`
- old payment investigation notes
- duplicated architecture notes and stale TODO files

Keep one final payment architecture and operations document.

### Application code

Identify, test, then remove:

- legacy direct payment writers
- unused payment services and compatibility helpers
- obsolete collection screens or duplicate report logic
- dead React components
- unused imports and commented-out code
- deprecated RPC calls

### Database objects

After dependency checks and production observation, review:

- obsolete payment functions
- legacy write triggers
- superseded views
- unused indexes
- temporary reconciliation functions
- compatibility objects no longer called by the application
- pre-migration snapshot tables:
  - `backup_customer_payments_before_payment_migration`
  - `backup_customer_ledger_before_payment_migration`
  - `backup_financial_transactions_before_payment_migration`

Do not drop snapshot tables until the retention period is agreed and a full backup is independently confirmed.

## Cleanup execution rules

1. Create a separate cleanup branch and migration series.
2. Produce a dependency report before deleting any code or database object.
3. Delete in small groups with tests after every group.
4. Deploy cleanup independently from business-feature changes.
5. Keep a rollback plan and verify production after each deployment.
