# Picking workflow implementation

## Added
- Dedicated mobile/tablet friendly Picking page.
- Atomic database order claiming so two staff cannot pick the same order simultaneously.
- Item actions: Add / In Stock, Pre-Order, Replace, Recall.
- Replacement product search while retaining replacement audit fields.
- Break / Save Progress sets picking status to Pending and releases the active lock.
- Continue Picking restores saved item decisions.
- Complete Picking is enabled only after every item has a decision.
- Completion applies replacements and moves the order to Warehouse Packing.

## Deployment order
1. Apply `supabase/migrations/20260724090000_order_picking_workflow.sql`.
2. Deploy the updated frontend.
3. Test with two staff accounts to confirm the lock rejects the second picker.

## Validation
The new JSX and service files pass ESLint parsing. A full Vite build could not be run in this container because the uploaded `node_modules` contains platform-specific dependencies and package installation was unavailable.
