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
