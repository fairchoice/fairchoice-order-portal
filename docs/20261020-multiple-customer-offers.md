# Multiple customer offer codes

Customers keep one Base Code and can now receive multiple exact-price offer / Sub Codes belonging to that Base Code. Adding an offer keeps existing assignments. Repeated assignment is ignored. If multiple offers price the same product, the lowest exact offer price wins; percentages are never stacked. Products without a matching offer use their existing Base Code pricing.

Use **Bulk Customer Code Prices → Offer Codes / Geographic Rules**. Select an offer code and filter customers by name or location, then add it to matching customers. Remove the selected offer from the filtered list, or use the × next to an individual customer's offer. The Base Code assignment table also shows offers and has a Manage Offers shortcut.

Inactive offers and offers belonging to a different Base Code are ignored when selecting current customer order prices. Changing a customer's Base Code does not delete saved offer assignments; offers from a different Base Code are labelled in the assignment view.

The new array column is additive. Existing single offer assignments are backfilled and retained for compatibility. Assignment writes compare the loaded Base Code and both offer fields; a concurrent change stops the operation instead of overwriting another edit. Bulk operations may partially complete; the screen reloads saved results and reports the completed count if a write fails.

No invoice records, invoice totals, or saved order prices are updated by assignment. New order pricing and an explicitly requested Received/Warehouse price review understand multiple offer codes.

## Validation

- Production build passes.
- 19 focused tests pass, covering assignments, duplicate handling, active/Base Code filtering, overlapping and separate product offers, VAT, legacy single offers, Base Code fallback, and Received/Warehouse price previews.
- Migration applied only to Fairchoice-V4-test (`gezflswhzapymabhkbga`). SQL checks verify multiple assignments, stale-write rejection and individual removal, with test writes rolled back.
- Both existing migration contract validators pass.
- The broad suite has 65 existing failures, matching the unchanged branch by failure name. Existing lint errors in the edited pricing and bulk assignment files were also present before this change; new helper/service and preview code passes targeted lint.
- Browser interaction verification could not run: Chromium was unavailable and its download returned invalid archives. UI behavior still needs a manual check on test.
- Production database and main branch are unchanged. Production requires the additive migration before deploying this code.
