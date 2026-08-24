Pre-order Queue live-demand fix

Copy these files into the matching paths in:
C:\Users\nisst\my-app\fairchoice-app

Changes:
- Working queue now accepts only current Received, In Progress, or Warehouse Packing orders.
- Persistent Bought/Cannot Supply history remains audit-only and cannot repopulate the queue.
- Stale local pending actions are removed when their source live order/item no longer exists.
- If Received Orders and Warehouse are empty, Pre-order Queue and Next Supplier are empty.

No SQL or migration is included.
