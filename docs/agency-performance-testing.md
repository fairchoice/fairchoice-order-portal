# Agency Performance

On `test`, open **Reports → Agency Performance → Middleton England Performance**.
Sales Reps also have an Agency Performance button in their order menu. The report
is read only. Every active staff role may open it, including Warehouse, Driver
and Brand Partner, but report data requires individual agency assignments.
In **Access Control → select a user → Agencies**, tick that person's Performance
Groups and Save Access Control. Several people may share a group (for example,
assign Middleton England separately to both Dinesh and Rifkhan). No names are
hard-coded and this migration makes no real-user assignments. No selected
groups means no report data. Master Admin and Super Admin retain automatic
access to every agency. Changing page/role defaults preserves agency selections.

The report loads its permitted tabs from a fresh FC-session-guarded server
snapshot, selects an available group and shows no unassigned tabs. Refresh
agency access picks up new assignments without trusting cached profile JSON.
Summary and customer sales RPCs validate the requested group on every call;
revocation is immediate for subsequent requests. The legacy unscoped England
RPC is restricted to system-wide administrators, closing the old-client path.
This scope applies to Agency Performance reports; other application pages keep
their own permissions.

**Shared country stock and business expenses** is a separate optional checkbox.
Without it, the server removes these values and the UI hides their cards/table;
country/business totals must not leak other agencies' figures. It does not grant
any agency by itself. Group reports also omit the old unrelated-account count. Customer logins and invalid/revoked/expired FC sessions
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
Assigned-group scope is applied before aggregation or pagination.
Customer sales use the identical group/date/area/invoice rules as the summary,
with one row per customer (including zero sales), highest sales first and stable
name/ID ordering for ties. First/Previous/Next/Last controls show the page and
row count. Date/area/group changes restart at page 1; navigation keeps the applied
filters even if filter controls have been edited but not applied. Out-of-range
pages clamp to the last page, and totals across all pages reconcile to sales. It uses the existing custom FC staff-session guard plus fresh registered
per-staff agency permission checks;
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
navigation, multiple users sharing a group, cross-group/legacy denial,
immediate revocation, shared-total redaction and customer/session rejection. UI rendering tests exercise every
staff layout and initial filters. The full existing `npm test` baseline has 65
pre-existing failures; compare against the unchanged test head for regressions.

The report and Performance Group migrations are installed on V4 (`gezflswhzapymabhkbga`). Production
has not received this feature. To test locally, use your existing V4 `.env.local`,
pull `test`, restart the local dev server, then compare date/prefix/city filters
with known invoices, collections and England stock. Confirm failed refreshes
show an error rather than stale totals. A production release must include the report and Performance Group
migrations, customer sales pagination and agency access migrations, and the
UI/navigation changes after approval.

## 18 October: ten-customer pages, agency earnings and expense allocation

The new earnings migration `20261018114102_agency_earnings_and_expense_groups.sql`
is installed on V4 only. Customer pages now contain ten accounts, with First,
Previous, Next and Last navigation. Existing invoice sales totals remain gross;
the separate earnings section uses revenue excluding VAT and confirmed customer
return credits, less estimated product costs and posted agency expenses.

Costs use weighted stock receipts through the invoice date, with positive current
product cost as fallback. Free supplied units carry costs. Missing product costs,
unmapped invoice lines or return tax details suppress the profit and earnings
figures instead of assuming zero cost. Returned-stock cost recovery is excluded.
City/postcode filters suppress earnings after expenses because expenses are
assigned to a whole agency. Gross profit still follows the selected area.

Expenses now offers an optional Agency field. Existing expenses remain Shared /
unassigned until deliberately allocated. An expense approver can assign an active
posted expense through View details. Allocation is audited and changes no amount,
status or financial posting. Shared totals require the existing separate permission;
agency access and expense entry/approval permissions are unchanged.

Validation: 70 focused database/UI/existing expense checks pass, production build
passes and migration contracts pass. Hosted invalid-session rejection and private
helper ACL checks pass. A read-only calculation against V4 October data compiled
successfully: Middleton currently has 159 invoice lines without costs, so the profit
cards are unavailable until those costs are populated. No test expense transactions
were written to V4. Main and production have not received this update.
