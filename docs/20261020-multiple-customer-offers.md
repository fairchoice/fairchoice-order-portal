# Multiple customer offer codes

Customers keep one Base Code and can now receive multiple existing price codes as exact-price offers, as well as compatible Sub Codes. Adding an offer keeps existing assignments. Repeated assignment is ignored. If multiple offers price the same product, the lowest exact offer price wins; percentages are never stacked. Products without a matching offer use their existing Base Code pricing.

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
