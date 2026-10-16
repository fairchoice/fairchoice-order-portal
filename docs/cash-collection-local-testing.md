# Cash collection local testing

Review branch: `fix/cash-collection-review`, based on `test` at `7c90477`.

This branch keeps previous-payment invoice status acknowledgements separate from
newly collected money. Previous Part Paid is the total already paid toward the
invoice, never another incremental payment. Re-entering the same previous paid
total leaves the invoice's paid amount unchanged.

The migration `20261015235717_invoice_collection_status_only.sql` is already
installed on **Fairchoice-V4-test** (`gezflswhzapymabhkbga`). Its filename matches
that test project's recorded migration version. Do not apply it to production or
run a broad migration push while testing this branch.

The branch's `vercel.json` disables automatic Vercel deployment for this exact
review branch. `main` and `test` are unchanged.

## Preserve the existing local work

Your original folder has unrelated, uncommitted updates. Test this branch in a
separate worktree so those files stay in place. From the original repository's
PowerShell terminal:

```powershell
git fetch origin
git worktree add ..\fairchoice-cash-collection-review -b fix/cash-collection-review origin/fix/cash-collection-review
Copy-Item .env.local ..\fairchoice-cash-collection-review\.env.local
```

The copied `.env.local` must remain the confirmed V4 test configuration. Do not
copy the production `.env`. Environment files remain ignored by Git.

Stop the old local dev server before starting this one, so the browser uses the
intended project:

```powershell
cd ..\fairchoice-cash-collection-review
npm ci
npm run dev
```

## Acceptance checks

Test the sales cash collection screen and driver previous-balance collection:

1. Previous Paid, with £0 collected: invoice becomes Paid; no payment or
   allocation is created.
2. Previous Part Paid: enter the total already paid, below the full invoice
   total and no lower than the currently recognised paid amount. Save and reload.
   Re-enter the same total; it must not increase.
3. Paid: a single new payment clears the selected invoice's remaining balance.
4. Part Paid: a single new payment below the balance leaves Part Paid status.
5. Mix a previous-status correction and a new payment on different invoices;
   only the new money appears in payment history.
6. Double-click and retry; a saved request must not post money twice.
7. Check invoice list/search, the selected customer and branch, customer credit,
   and payment history after reloading.

Previous acknowledgements change invoice status only. They do not invent missing
account-level financial records or change collection/payment totals. Account-level
discrepancies still require reconciliation against actual payment records.

Bank transfers remain pending until verified. They cannot immediately settle new
invoice selections from this screen.

## Automated checks

```powershell
node --test src/services/invoiceCollectionService.test.js src/services/invoiceAllocationStatus.test.js src/utils/centralPaymentCalculations.test.js src/pages/InvoicesPortalAllocationStatus.test.js
npm run test:migrations
npm run build
```

The focused tests and build pass. The full pre-existing suite has failures, so
this branch is not a claim that every existing project test passes.

The isolated PostgreSQL tests use a synthetic schema and a fixture adapter for
the existing payment writer. They execute the new migration and FIFO code,
including rollback, repeat requests, branch checks and migration preflight:

```powershell
npm ci --prefix tests/invoice-collection --ignore-scripts
npm test --prefix tests/invoice-collection
```

Do not merge to `main`, deploy, or change production while performing these
local acceptance checks.
