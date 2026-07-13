# FairChoice Central Payment and Customer Credit Architecture

Status: Architecture complete for implementation handoff

Source issue: GitHub issue #2

## 1. Objective

Build a new Central Payment and Customer Credit architecture alongside the current production system without renaming, overwriting, deleting, or migrating existing production records until the replacement has been verified.

Authoritative source separation:

- Payments: `customer_payments`
- Payment allocations: `customer_payment_allocations`
- Invoices: `customer_invoices`
- Delivery confirmation: `orders`
- Opening balances: `customer_branch_opening_balances`
- Credit/outstanding balances: calculated only in services/views; never stored as a mutable balance field
- Financial actions: `financial_audit_log`
- Branch separation workflow