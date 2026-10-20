# Multiple customer offer codes

Customers may keep one Base Code and can now receive multiple existing price codes as exact-price offers, as well as compatible Sub Codes. Adding an offer keeps existing assignments. Repeated assignment is ignored. If multiple offers price the same product, the lowest exact offer price wins; percentages are never stacked. Products without a matching offer use their existing Base Code pricing.

Use **Bulk Customer Code Prices → Offer Codes / Geographic Rules**. Select any existing code as an offer and filter customers by name or location, then add it to matching customers. Remove the selected offer from the filtered list, or use the × next to an individual customer's offer. The Base Code assignment table also shows offers and has a Manage Offers shortcut.

Inactive offers and Sub Codes belonging to a different Base Code are ignored when selecting current customer order prices. Changing a customer's Base Code does not delete saved offer assignments; offers from a different Base Code are labelled in the assignment view.

The new array column is additive. Existing single offer assignments are backfilled and retained for compatibility. Assignment writes compare the loaded Base Code and both offer fields; a concurrent change stops the operation instead of overwriting another edit. Bulk operations may partially complete; the screen reloads saved results and reports the completed count if a write fails.

No invoice records, invoice totals, or saved order prices are updated by assignment. New order pricing and an explicitly requested Received/Warehouse price review understand multiple offer codes.

## Validation

- Production build passes.
- 21 focused tests pass, covering assignments, duplicate handling, active/Base Code filtering, overlapping and separate product offers, VAT, legacy single offers, Base Code fallback, and Received/Warehouse price previews.
- Migration applied only to Fairchoice-V4-test (`gezflswhzapymabhkbga`). SQL checks verify multiple assignments, stale-write rejection and individual removal, with test writes rolled back.
- Both existing migration contract validators pass.
- The broad suite has 65 existing failures, matching the unchanged branch by failure name. Existing lint errors in the edited pricing and bulk assignment files were also present before this change; new helper/service and preview code passes targeted lint.
- Browser interaction verification could not run: Chromium was unavailable and its download returned invalid archives. UI behavior still needs a manual check on test.
- Production database and main branch are unchanged. Production requires the additive migration before deploying this code.

## Local testing correction

The first version only listed Sub Codes as offers, which excluded existing Base Codes such as ENGDRN01 and RCCASH01. Existing active codes are now available as additional offers without changing their code type. Additional codes use only exact product prices; their percentage discounts are not stacked. A compatible parent is still required for a Sub Code.

The customer assignment page distinguishes **Set Base Code** (replaces the main code) from **Add as Offer Code** (keeps existing codes). After changing assignments, the main order page reloads customer accounts and refreshes the selected customer's current price mode. No customer assignments were changed automatically by this correction.

## City exclusions for every code assignment

Both the Base Code assignment tab and the Offer Codes / Geographic Rules tab now include **Exclude towns / cities**. Choose a country (or all countries), tick cities to leave out, then check the filtered customer list and count before assigning or removing a code. Exclusions are also named in confirmation dialogs. Changing country clears the previous city exclusions; Clear city exclusions restores the full selected scope.

This is a filter for the current bulk action, available for every selected code. It does not create an automatic rule for future customers, remove existing code assignments in excluded cities, or change the customer's VAT mode. Base assignment, additional-offer assignment, and both bulk removal actions share the same filtered list. Single-customer removal still acts on the explicitly selected customer.

Five scope tests cover England exclusions, all-country exclusions, multiple cities, case/whitespace matching, conflicting included/excluded cities, search, inactive customers and clearing exclusions. All 26 focused scope/pricing tests and the production build pass. Browser interaction testing remains unavailable in this environment.


## VAT-mode matching and recorded reversals — test update

Code assignment no longer writes `customer_accounts.default_price_mode`. Each
code has **Applies to: Inc.VAT / Ex.VAT / Both**, editable in Pricing Rules and
Bulk Customer Code Prices. Bulk/city assignments filter the customer's existing
mode; the secured assignment RPC checks it again under a row lock. Mismatches
are skipped without customer or audit writes. Legacy combined code-and-mode
updates are rejected. Duplicate offers are not stacked. Customers without a
Base Code can receive multiple exact-price offers too.

For tonight's test: choose ENGDRN01 (configured **Inc.VAT only** on the test
project), Country **England**, Town/City **All**, exclude any required cities,
then **Add as Offer Code**. The existing SKE/Base Code and customer VAT modes
are retained. Existing Dr Pepper exact prices stay £8.50. Applying a code does
not rewrite orders, issued invoices, customer details, credit or payments.

Every later customer code/VAT-mode change captures an immutable before/after
configuration. In the bulk customer table, `nisstaj_admin` can open **History /
Restore**, provide a reason and restore a recorded change. The server validates
the FC session/registered Pricing Rules permission and refuses stale reversals.
Older values cannot be reconstructed by this feature: read-only inspection of
live customer import, financial and general audit logs found **no previous
customer VAT modes**. Do not infer them from invoice pricing. No live customer
VAT mode has been automatically restored.

New Ex.VAT code carts and newly issued invoices add VAT exactly once. Existing
issued invoice saved totals retain the previously deployed read-only behaviour.
The two new migrations are installed only on Fairchoice-V4-test. The live
schema still has no code applicability field, and the live 442 invoice grand
totals remain £196,412.41. No new price-code work is published to main.

Validation: 29 focused pricing/scope/document tests and 26 local database/client
security/isolation tests pass, including mismatch skips, multiple offers,
mode preservation, stale-write/reversal rejection, permission failures and
unchanged credit/payment fields. A hosted test with a real verified FC owner
session exercised assignment, history, reversal and a new Ex.VAT code order
through delivery; all temporary customers/codes/orders/invoices/sessions were
rolled back. Build passes. Existing lint findings in bulk effects/pricing
helpers remain; the new helper/service/metadata code has no new lint findings.
A manual signed-in UI check is still required for tonight's test.
