# Product price propagation checks

Run `npm ci` at the repository root, then `npm ci --prefix tests/price-management`
and `npm test --prefix tests/price-management`.

The database scenarios run in isolated Postgres and cover Received/Warehouse
pricing, unchanged quantities and stage, stale previews, all-or-nothing batches,
admin access and free lines. UI checks render the actual password dialog and
both stage selectors. No scenario connects to a hosted database.
