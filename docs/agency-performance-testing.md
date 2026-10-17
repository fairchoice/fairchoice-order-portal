# Agency Performance

On `test`, open **Reports → Agency Performance → Middleton England Performance**.
Sales Reps also have an Agency Performance button in their order menu. The report
is read only and available to all active staff roles, including Warehouse,
Driver and Brand Partner. Customer logins and invalid/revoked/expired FC sessions
cannot call the aggregate RPC. No standalone finance-page access or financial
write permissions are added.

## Scope and totals

- **Performance Group** is compulsory for every customer account. The options
  are Middleton England, South England, West England, East England and Wales.
  Customer setup, workbook import/export and the list filter include this field.
  New/edit forms and workbook rows require a valid explicit selection. Older
  integrations that omit the column are classified by a database insert trigger;
  explicit blank/invalid groups and clearing an existing group are rejected.
- The one-time migration assigns Southampton, Portsmouth and Shillington to
  South England; Swindon to West England; Newport to Wales; Kent to East England.
  It checks whole place names in account town/address fields. Other Wales
  accounts remain Wales; the remaining customers become Middleton England.
  Existing town/address spelling and completeness determine the initial result;
  review and correct groups in Customer Setup where needed.
- The report defaults to **Middleton England Performance**. Separate tabs show
  South England, West England, East England and Wales. Membership uses the saved
  Performance Group, so other groups are excluded from Middleton England.
  Branches follow their account's group. Editing an address never silently
  changes a saved group. Trade applications receive an initial group using their
  shop address/country and can be corrected in Customer Setup.
- Postcode prefix and saved customer town/city filters narrow the selected group.
  Bedford also matches a whole word in the delivery address. This is not
  geocoding: branches without a city field use the account town/city. Additional
  saved towns automatically appear in their Performance Group's dropdown.
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
- Stock: active country location quantities only, shared by all groups in that country. Wales uses Wales stock; the England groups use England stock. Global legacy
  inventory without a location is not attributed to England or repeated by city.
- Expenses: posted, nonvoid `business_payouts` in the chosen dates. Expenses have
  no country/city columns, so the card explicitly says **Shared business
  expenses** and includes all business locations. Area filters do not allocate
  these costs. Country/city expense allocation needs a future tagging feature.

The RPC returns aggregate amounts, postcode-area rows, location stock totals and
city choices. A separate staff-guarded customer sales RPC returns at most 30
customer names, IDs, invoice/order counts and sales amounts per page; it returns
no contacts, addresses, invoice details, payment details or staff records.
Customer sales use the identical group/date/area/invoice rules as the summary,
with one row per customer (including zero sales), highest sales first and stable
name/ID ordering for ties. First/Previous/Next/Last controls show the page and
row count. Date/area/group changes restart at page 1; navigation keeps the applied
filters even if filter controls have been edited but not applied. Out-of-range
pages clamp to the last page, and totals across all pages reconcile to sales. It uses the existing custom FC all-active-staff session guard;
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

The report and Performance Group migrations are installed on V4 (`gezflswhzapymabhkbga`). Production
has not received this feature. To test locally, use your existing V4 `.env.local`,
pull `test`, restart the local dev server, then compare date/prefix/city filters
with known invoices, collections and England stock. Confirm failed refreshes
show an error rather than stale totals. A production release must include the report and Performance Group
migrations, customer sales pagination migration and the UI/navigation changes after approval.
