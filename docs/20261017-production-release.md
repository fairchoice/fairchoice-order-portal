# 17 October 2026 complete production release

The user authorized release of all remaining test work and required production migrations. This release includes agency reports, mandatory customer Performance Groups, customer-sales pagination, per-person agency permissions, invoice total/amendment consistency, Driver read-path fixes and the previously released customer-code price update fix. The Driver exclusion loader also now marks successful loads ready, preventing all orders being hidden.

Production database migration: `20261017192416_agency_invoice_driver_release_v1`. The following reviewed source migrations were installed atomically:

- `20260930011500_driver_exclude_promotion_runs.sql`
- `20260930110000_optimize_driver_read_paths.sql`
- `20261017112535_agency_performance_report.sql`
- `20261017113246_agency_performance_order_dates.sql`
- `20261017115049_customer_performance_groups.sql`
- `20261017121055_agency_customer_sales_pages.sql`
- `20261017122607_agency_access_control.sql`
- `20261017131209_invoice_document_total_consistency.sql`

Do not reapply these individual sources to production: its migration history records the atomic release above. No production test transactions or real-user agency assignments were made.

Verification:

- All 101 feature tests pass: agency (36), invoice totals (11), price updates (16), collections (14), Wallet invoice settlement (11), returns (13). The two Driver loader regressions and five existing price-preview tests also pass. Build and migration contracts pass. Root tests: 548 total, 483 passing, the same 65 existing failures as the unchanged baseline; no new failures.
- All 15 resulting function definitions match V4. Private helpers remain unavailable to public API roles. The six guarded report/Driver entry points reject invalid FC sessions.
- 428 active delivered order-backed canonical invoices checked; 108 totals reconciled with saved printable lines and audited; no remaining mismatches. Aggregate canonical correction: +GBP 14,968.12. No order-item quantities or prices were changed by this migration.
- Before/after row checksums match for all customer payments (536), allocations (491), Wallet transactions (2) and order items (13,470). FIFO was not rerun.
- All 128 customer accounts have a Performance Group: Middleton England 52, South England 4, West England 2, East England 1, Wales 69. Initial classification remains editable in Customer Setup.

The reported IVG Warehouse order retains its saved prices until a deliberate price-update action is applied. Its current RCCASH01 exact product prices are 17.75, while general Inc.VAT pricing is 18.50 for a 15.69 Ex.VAT product. Publishing code does not retroactively reprice orders. Live price acceptance should verify the preview code/price before applying.

Authenticated acceptance testing remains with the user; no customer or staff session was impersonated.
