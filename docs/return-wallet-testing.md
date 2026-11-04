# Return customer links, Wallet credit and approval reversal

Use branch `test` and Fairchoice-V4-test only for acceptance testing.

New returns must retain their customer and branch IDs. The old missing-column
retry removed them when `customer_returns.price_mode` did not exist. The new
retry removes only a named optional column, never the financial scope. The
migration also adds `price_mode` so new return pricing is retained.

Approving Customer Credit creates one financial ledger credit and one Wallet
credit with the return's stable identity. This does not collect money or apply
Wallet to an invoice automatically. Use the existing Wallet application flow
when credit should settle an invoice. The Invoices Portal shows the active
return credit note; No Financial Credit and reversed returns are excluded.

For an older return without a customer ID, an admin with `returns.reconcile`
uses **Link customer**, chooses the correct account and branch, and supplies a
reason. It updates only the selected return's linked financial records. An
active confirmed credit receives its missing Wallet entry once. There is no
automatic name matching or historical backfill. Older returns already recorded
as payment-style credits are blocked for allocation reconciliation, so they
cannot receive a second Wallet credit or a misleading partial reversal. A linked return cannot be
moved to another customer.

Approval reversal retains the original credit and adds an opposite financial
and Wallet entry. The Returns Portal displays Reversed and errors stay visible
inside its dialog. If available Wallet balance is below the credit being
reversed, the whole reversal fails without writes; reverse the relevant Wallet
applications through the existing workflow before retrying. This change does
not add a Wallet-application reversal service.

## Acceptance checks

1. Create a new return. Confirm its customer/branch remain selected after reload.
2. Approve Customer Credit. Verify one Wallet credit and its return credit note.
3. Retry approval: no extra Wallet credit or financial credit.
4. Link an old orphaned confirmed return explicitly. Its existing financial
   credit must remain a single record; Wallet credit is created once.
5. Reverse an unused approval: Wallet returns to its previous balance; status
   shows Reversed; the return disappears from active invoice credits.
6. Retry reversal: no extra debit. A used credit cannot create a negative Wallet.
7. No Financial Credit does not add Wallet funds or an invoice credit note.
8. Pending, reversed, mismatched-customer and insufficient-permission actions
   reject safely. A reversed orphan can be linked for history without new credit.

Automated checks:

```
node --test src/services/returnHeaderPersistence.test.js src/services/customerReturnApprovalPhase2.test.js src/services/returnRequestSubmissionSafety.test.js
npm ci --prefix tests/returns
npm test --prefix tests/returns
npm run build
```

The SQL fixture is synthetic and does not use a hosted database or customer
session. Its session guard is a fixture adapter; production authorization is
provided by the existing `fc_require_session_permission_v2`.
