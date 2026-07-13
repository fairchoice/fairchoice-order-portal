# Financial Test Data Generator

This generator creates deterministic financial records in **Test Supabase only**.
It refuses to run when `.env.local` and `.env` use the same Supabase URL.

## Safety

1. Keep Test Supabase credentials in `.env.local`.
2. Keep Production Supabase credentials in `.env`.
3. For RLS-protected tables, add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`.
   Never prefix the service-role key with `VITE_` and never put it in production client code.
4. Never run this generator while `.env.local` points to production.

## Run on PowerShell

```powershell
$env:FAIRCHOICE_TEST_DATA_CONFIRM="YES_CREATE_FAIRCHOICE_TEST_DATA"
npm run testdata:financial
Remove-Item Env:FAIRCHOICE_TEST_DATA_CONFIRM
```

The generator deletes and recreates only its own fixed test customer IDs, so it is repeatable.

## Created scenarios

### FC TEST - FIFO SINGLE ACCOUNT

- No branches.
- Credit limit: £2,000.
- Invoice 1, 01 July: £100.
- Invoice 2, 03 July: £200.
- Invoice 3, 05 July: £300.
- Payment, 06 July: £150.

Expected allocation, oldest invoice first:

- Invoice 1: paid.
- Invoice 2: £150 outstanding.
- Invoice 3: £300 outstanding.
- Account outstanding: £450.

Expected display order, newest first:

1. Payment, 06 July.
2. Invoice 3, 05 July.
3. Invoice 2, 03 July.
4. Invoice 1, 01 July.

### FC TEST - MULTI BRANCH ACCOUNT

Branches and opening balances:

- Birmingham: £500.
- London: £250.

The account summary combines both branches, but detailed history remains branch-specific.
The Birmingham payment pays its oldest invoice first. The London payment pays its invoice and leaves £100 account credit for that branch.

## Test checklist

- Search for customers beginning with `FC TEST -`.
- Confirm single-account history works without branch selection.
- Confirm multi-branch total outstanding remains customer-wide.
- Select Birmingham and London separately and confirm histories do not mix.
- Confirm opening balances are branch-specific.
- Confirm Customer Credit and Customer Portal show newest records first.
- Confirm paid/unpaid invoice actions and price modes remain unchanged.
