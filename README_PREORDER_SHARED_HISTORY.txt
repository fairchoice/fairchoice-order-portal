Pre-order Supply shared history patch

Copy the included files into the matching paths under:
C:\Users\nisst\my-app\fairchoice-app

The additive migration is prepared but was NOT executed:
supabase/migrations/20260803001000_preorder_supply_shared_active_history.sql

Behaviour:
- Synced Bought/Cannot Supply rows are loaded from shared RPC history on every device.
- The page refreshes shared history every 10 seconds and on focus/visibility return.
- Successful Sync All clears local pending storage and reloads shared history.
- Active Bought/Cannot Supply rows are grouped Date -> Supplier.
- Once the linked order is delivery confirmed, the row disappears from the active tab and remains in History.
- Working queues remain based on live unresolved order demand only.
