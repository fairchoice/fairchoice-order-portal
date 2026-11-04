# FairChoice working rules

## Branches

- The user permits only `test`, `main`, and `dev` for future work.
- Make fixes available on `test` for the user's local testing. Use `dev` when
  development work explicitly calls for it.
- Do not create feature, review, fix, release, or other additional branches
  unless the user explicitly changes this rule.
- Do not rename or delete existing branches as an implied cleanup task.
- Do not merge into `main`, change production, or deploy without the user's
  explicit approval for that action. Check the exact diff and relevant tests
  before any such action.

## Editing and testing

- Edit code directly through the connected Git repository. Do not ask the user
  to upload code or install ZIP/patch packages as the normal workflow.
- Preserve the user's existing uncommitted changes and backup files. If they
  prevent a safe checkout, use a separate worktree on one of the allowed
  branches rather than discarding, overwriting, or silently stashing work.
- Fairchoice-V4-test (`gezflswhzapymabhkbga`) is for testing only.
- The production Supabase project (`naobitwzrkovmwvzvgvf`) must not receive test
  migrations or test transactions.
- Never commit environment files, credentials, or session tokens.

## Issued invoice history

- Existing issued invoices and their original order lines are read-only. Never
  repair, reprice, amend, delete, zero, resynchronize or backfill historical
  invoice contents as a side effect of opening, printing, downloading, changing
  catalogue prices or ordinary operational code.
- Existing zero/missing-value exceptions must be reported, not automatically
  repaired. Do not infer a new invoice amount from unavailable/removed lines.
- An explicit edit must use the verified `nisstaj_admin` FC-session amendment RPC,
  with a reason, a current revision and an atomic before/after audit. A general
  admin role, client-side username or service routine is not edit authorization.
- Preserve the immutable original archive even after an authorized amendment.
  Payment collection and settlement are separate from invoice content.
- Apply only the reviewed protection migration. Do not replay older migrations
  containing historical invoice-total backfills against existing invoice data.
