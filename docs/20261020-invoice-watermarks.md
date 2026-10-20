# Remove invoice watermark overlays

Invoice documents no longer render PAID, PART PAID or IN PROGRESS watermark overlays. The central template is shared by previews, print and downloads, including previously issued invoices when reopened. Already downloaded or printed copies are not rewritten.

This release does not run database updates or migrations. Previous order and invoice records, line prices, quantities, totals, payment allocations and statuses are preserved. Payment-status resolution remains available for normal invoice actions and financial calculations.

Validation: production build passes; ten focused invoice action/status/totals tests pass. Twelve generated documents (three payment states across invoices, returns, order forms and delivery notes) were compared with the previous template. Their HTML is identical after removing only the watermark markup and CSS.

The release is based directly on main. The customer-code and city-exclusion changes on test are not included.
