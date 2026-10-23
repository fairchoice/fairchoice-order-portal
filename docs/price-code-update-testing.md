# Warehouse price updates and customer price codes

The Received / Warehouse price review previously loaded raw products and pricing_settings alone. That omitted customer price-code percentages and exact per-product code overrides. An Inc.VAT customer-code order could consequently receive an undiscounted calculated price.

The review and Apply action now reload the selected products, active price codes and their exact product prices together. Exact prices take precedence over the code percentage; ordinary Inc.VAT orders retain the general Inc.VAT rule. Missing pricing inputs stop the update. The preview identifies each order’s pricing mode/code. Existing approval, order-stage checks and reviewed-write protections remain in place.

Reproduction fixture: product Ex.VAT price 15.69, VAT 20%, general Inc.VAT discount 1.5%, RCCASH01 discount 3.5%, exact RCCASH01 product price 17.75. General Inc.VAT preview is 18.50; the code order must use 17.75, without another VAT addition. Before this fix, missing code inputs produced 19.00.

Validation: price-management suite (16), existing price-preview tests (5), focused ESLint, migration contracts and build pass. The database integration test applies the reviewed exact price through the real existing update function and checks saved line/header totals. UI rendering checks show the customer code beside its proposed price.

No hosted database changes or order corrections are included. The reported live order was inspected read-only. Main and production remain unchanged. Test locally against V4, preview the pending product update and check the pricing code and proposed price before applying.
