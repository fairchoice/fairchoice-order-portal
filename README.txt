Replace these files:
1. src/pages/AdminSetup/Driver.jsx
2. src/pages/CustomerOrder.jsx

Changes:
- Driver/cash collection now requires an allocation choice.
- Choices: Previous Balance Only, Today's Invoice Only, Previous Balance First then Today's Invoice, Today's Invoice First then Previous Balance.
- Saved payment metadata records payment_applies_to.
- Canonical payment allocations follow the selected order.
- Customer statement uses the saved choice for same-day ordering.
- View Order remains available for every invoice/order.
- Download Invoice appears only when invoice status is PAID.
