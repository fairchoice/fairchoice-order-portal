# One individual customer price code

The new workflow replaces the multiple-offer assignment screens. Existing legacy
assignments remain readable and unchanged until a customer explicitly generates
an individual code. Installation does not generate codes or migrate customer
assignments automatically.

## Use

1. Open Customers and click **Generate Code** beside a saved customer, or use the
   same control in Edit Customer → Payment Details. The code uses the first three
   letters of the customer name plus a six-digit random number, for example
   `BIL-482731`. Database uniqueness and a customer-row lock prevent duplicates.
2. Generation copies the customer's effective exact prices and current code
   percentage. With no active Base Code it retains the normal Inc.VAT percentage
   or zero Ex.VAT percentage. Existing offer exact prices take priority over the
   previous Base Code as before. The customer is assigned the new single code;
   legacy definitions and source prices remain intact for review.
3. In Customer Code Prices choose **Bulk / Geography**, country, city, excluded
   cities and Inc.VAT / Ex.VAT / Both. Customers without generated individual
   codes are shown and skipped. Select products, enter prices and confirm the
   matching target count. Up to 100 products and 500 customers per atomic action.
4. Choose **Individual Code** to select a customer by name and code and assign
   product prices only to that code. **Use percentage for selected products**
   explicitly clears those exact overrides, leaving all other products intact.
5. Pricing Rules shows customer names beside every code. **Edit percentage**
   applies the existing Ex.VAT net or Inc.VAT inclusive calculation. Exact prices
   take priority. Old shared codes are labelled legacy. New codes are generated
   from the customer, not created as arbitrary shared codes in Pricing Rules.

Generating/updating prices refreshes customer/code metadata in the ordering
screen. Catalogue product saves preserve individual overrides and only rewrite
legacy shared code entries. Price reads page beyond 1000 rows so customer-specific
prices are not dropped as the number of codes grows.

## Protection and audit

Verified FC sessions with the registered `page.product.pricing_rules` permission
are required by generation, scoped product-price and percentage RPCs. Individual
writes require a private, transaction/backend-bound context table; caller-provided
usernames or custom configuration flags cannot grant write access. Individual
codes cannot be borrowed by another customer, replaced through normal assignment,
or combined with overlay codes. Generation/price/percentage actions have immutable
before/after audits. Expected customer modes/code IDs and percentage revisions
prevent stale writes; geographic, inactive-customer and mode checks run again on
the server. Bulk operations are atomic.

Customer names/details, VAT modes, credit, payments, order/invoice rows and ledger
contents are never updated by these actions. Saved invoices keep their existing
read-only protections. Original legacy prices are not overwritten by generation.

## Validation and release state

- Installed only on Fairchoice-V4-test (`gezflswhzapymabhkbga`).
- Installation checksummed 22 existing customer/financial/pricing tables inside
  one transaction and aborted on any row change. All checks passed.
- Hosted real FC-session fixtures exercised generation/idempotency, exact-price
  copying, percentage editing, geography/mode skips, audit writes and denied
  direct edits. All temporary customers/codes/sessions were rolled back.
- All 22 fingerprints match before/after hosted fixtures. There are still 128
  real test customers, three legacy codes and 208 exact prices; no individual
  customer codes or individual-price audit rows were left by testing. Test
  invoices remain 412 with saved totals £178,830.03.
- 40 database/client isolation tests and 28 focused pricing/document tests pass.
  The production build and lint for new helpers, service, button and bulk screen
  pass. A signed-in manual UI check remains part of local acceptance testing.
- Security advisors were reviewed. The two new private tables intentionally have
  RLS and no client policies/grants. The three SECURITY DEFINER RPC execution
  warnings are intentional: the app uses FC sessions and each entry point
  verifies the session and registered permission before privileged work.
- Production has not received this migration or any customer pricing changes.
  Its 442 saved invoices still total £196,412.41. Main remains unchanged.
