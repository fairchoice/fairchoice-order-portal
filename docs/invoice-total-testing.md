# Invoice totals and unchanged amendments

Test branch and Fairchoice V4 only. Production release requires separate approval.

Collection rows show the full invoice total and the remaining amount due separately. New cash payments still use the remaining amount. Previous-paid acknowledgements retain their existing status-only behavior.

Amending an existing invoice preserves saved line net amounts, including negotiated reductions, when quantity, price and pricing mode are unchanged. Actual edits recalculate the edited line. Saved VAT rounding and zero/free lines are preserved.

The invoice-document-total migration aligns active delivered order-backed canonical invoices with the current printable saved-line calculation. It audits each correction, synchronizes ledger and existing balance summaries, and prevents later stale totals overwriting the document amount. It does not rerun FIFO, create payments, change allocations or move Wallet credit. Manual and void invoices keep their separate handling.

On V4, 99 stale canonical totals were reconciled. Read-only hashes of all payment, allocation and Wallet transaction records were identical before and after. No remaining active order-backed canonical/printed total differences were found.

Validation: `npm test --prefix tests/invoice-totals` (11), collection regression suite (14), Wallet invoice suite (11), migration contract checks and production build pass. The root test suite retains the same 65 failures as the unchanged baseline, with no new failures.

Local checks after pulling test:

1. Open collection: the invoice formerly showing only due GBP 53.90 must also show its full invoice total GBP 885.42.
2. Open the GBP 1,005.70 invoice in Amend. Save without changing lines: it must remain GBP 1,005.70, retaining the saved net reduction.
3. Compare collection amount, printed invoice and invoice list. Due may be lower after payments or Wallet credit, while invoice total remains the full document amount.
4. Edit a quantity or price on a disposable V4 test invoice; verify the printed amount, canonical amount, ledger and amount due agree after refresh.

Authenticated browser checks remain for local testing.
