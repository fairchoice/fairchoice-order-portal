# Wallet invoice settlement checks

Run `npm ci` at the repository root, then `npm ci --prefix tests/wallet-invoices`
and `npm test --prefix tests/wallet-invoices`.

The database scenarios use an isolated in-memory Postgres database. They cover
partial and full Wallet settlement, cash plus Wallet, previous-payment baselines,
account access, invalid amounts, and avoiding new cash payment records.
The print checks build the invoice engine and inspect its actual generated HTML.
No test connects to V4 or production or writes real financial transactions.
