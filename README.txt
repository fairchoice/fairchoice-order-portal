FairChoice TEST - Staff / Customer Login lifecycle update

Copy these files into the matching paths inside local fairchoice-app on branch test.

New files:
- src/pages/AdminSetup/StaffLogin.jsx
- src/pages/AdminSetup/CustomerLogin.jsx

Replace/update:
- src/pages/AdminSetup/AccessControl.jsx
- src/security/accessControlRegistry.js
- src/utils/permissions.js
- src/pages/CustomerOrder.jsx
- supabase/migrations/20260817232018_staff_access_control_registry.sql

What changed:
- Admin Setup now keeps Staff Setup and Customer Setup as profile/account pages.
- Login now contains Staff Login, Customer Login, Access Control.
- Staff Login handles onboarding/offboarding, username, role, enabled status, password reset/change.
- Customer Login preserves existing customer login records and only changes a password when a new password is explicitly supplied.
- Customer offboarding disables portal access only; customer account/history is preserved.
- Access Control no longer edits username/password/status; it saves permissions only.
- New secure RPCs separate staff login, customer login, and permission writes.

IMPORTANT:
- Do not execute the migration on LIVE.
- Review/apply to TEST only after confirming TEST Supabase target.
- No existing customer password is displayed.
- Existing customer login password/password_hash is preserved when new password is blank.
- No customer_accounts rows are deleted or updated by this migration.
