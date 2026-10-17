# Agency Performance

On `test`, open **Reports → Agency Performance → England Performance**.
Sales Reps also have an Agency Performance button in their order menu. The report
is read only and available to all active staff roles, including Warehouse,
Driver and Brand Partner. Customer logins and invalid/revoked/expired FC sessions
cannot call the aggregate RPC. No standalone finance-page access or financial
write permissions are added.

## Scope and totals

- All England is the default. Country comes from the branch, then account.
  MK/LU postcodes identify England only when country is blank or UK. Explicit
  Wales/other countries never become England because of a postcode.
- Filter by postcode prefix (MK, LU, or another prefix) and saved **customer
  town/city**. Bedford also matches a whole word in the delivery address. This
  is not geocoding: a branch without its own city field uses its account's
  town/city. Correct country/postcode/address data is needed for accurate scope.
  Additional saved England customer towns automatically appear in the dropdown.
- Sales: issued, financially active canonical invoice totals, including VAT;
  older delivered orders without a canonical invoice contribute their saved
  order totals. Void/cancelled canonical invoices suppress order fallback.
  Ledger invoice postings are never used as another sale.
- Collections: confirmed active canonical payments plus deduplicated legacy
  payment records. Voided/archived/pending/reversed payments, discounts, return
  credits and Wallet payments are excluded. Migrated identities and matching
  reference/amount/date records suppress legacy mirrors, even if the canonical
  payment was subsequently voided.
- Outstanding: current opening balances + invoice/order totals − actual active
  payments/discounts − applied Wallet debits. Net within each selected customer
  account, floor at zero per account, then sum; another customer's overpayment
  cannot hide debt. Previous-paid status acknowledgements alone do not create
  another payment or alter the account balance. Unused Wallet credit is not cash
  and is not subtracted a second time. Branch-level filters include only that
  geographic portion of an account.
- Sales and collections use the selected **UK dates**, including British Summer
  Time. Older order timestamp columns contain UTC ISO values written by the app.
  Outstanding and stock are **current snapshots**, unaffected by date filters.
- Stock: active England location quantities only, all cities. Global legacy
  inventory without a location is not attributed to England or repeated by city.
- Expenses: posted, nonvoid `business_payouts` in the chosen dates. Expenses have
  no country/city columns, so the card explicitly says **Shared business
  expenses** and includes all business locations. Area filters do not allocate
  these costs. Country/city expense allocation needs a future tagging feature.

The RPC returns aggregate amounts, postcode-area rows, location stock totals and
city choices. It does not return customer names, invoices, payment details or
staff records. It uses the existing custom FC all-active-staff session guard;
anon/authenticated EXECUTE is intentional for the FC client, PUBLIC is revoked,
and source tables remain protected. Reading refreshes session activity only;
no business transactions or stock quantities are changed.

## Verification

```sh
npm ci --prefix tests/agency-performance
npm test --prefix tests/agency-performance
npm run build
npm run test:migrations
```

Isolated PGlite tests cover area/country scope, branches, opening balances, valid
payments/legacy mirror suppression, Wallet settlement, posted expenses, shared
stock, account-credit isolation, old-order fallback, UK date boundaries, role
navigation and customer/session rejection. UI rendering tests exercise every
staff layout and initial filters. The full existing `npm test` baseline has 65
pre-existing failures; compare against the unchanged test head for regressions.

Both report migrations are installed on V4 (`gezflswhzapymabhkbga`). Production
has not received this feature. To test locally, use your existing V4 `.env.local`,
pull `test`, restart the local dev server, then compare date/prefix/city filters
with known invoices, collections and England stock. Confirm failed refreshes
show an error rather than stale totals. A production release must include both
migrations and the UI/navigation changes after approval.
