# FC Security Update

## Apply database migration first

Run the full contents of:

`supabase/migrations/20260725120000_fc_identity_security_and_payment.sql`

in the Supabase SQL Editor, then refresh the application.

## What changed

- Username/password login now uses `fc_login_v1`.
- No email address is required for staff login.
- Passwords are verified in the database and migrated to bcrypt hashes.
- The browser receives a temporary 12-hour FC session token; the plaintext password is not stored in localStorage.
- One permanent `staff_users.id` remains the internal identity.
- Staff and login records receive readable short IDs such as `FC-S-000001` and `FC-L-000001`.
- FC permission catalogue and per-staff permission tables were added.
- Driver, sales-rep and other customer-payment postings now validate the FC session and permission before writing payments.
- Existing role permissions remain temporarily compatible while individual FC permissions are assigned.

## Important after deployment

All users must sign out and sign in again after the migration. Old browser sessions do not contain an FC session token.
