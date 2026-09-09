FairChoice Sales Rep Header Update

What changes
- Removes the large FairChoice Order Portal banner from the Sales Rep ORDER screen only.
- Uses the real FairChoice logo in the compact search/category bar.
- Keeps the search/category bar visible while browsing products.
- Adds a three-line (hamburger) Sales Rep menu.
- Menu keeps the existing actions: Order, Route, Expenses, Cash Collection, Return, No Order and Logout (only when each action applies).
- Cart remains on the right.
- Customer/Admin headers are not intentionally redesigned by this patch.
- No database change.
- No Git command.

How to apply
1. Extract this ZIP.
2. Open PowerShell in your Fairchoice-app root folder.
3. Run the script using its extracted path, for example:
   powershell -ExecutionPolicy Bypass -File "C:\path\Fairchoice-salesrep-header-update\apply-salesrep-header.ps1"
4. Run your normal local app and test Sales Rep > Order.

The script also creates a small timestamped safety copy of the files it changes under backups\salesrep-header-<timestamp>.
