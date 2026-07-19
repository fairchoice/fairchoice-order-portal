
## 19 July security correction

- Payment History and Payment Archive no longer require the `nisstaj_admin` password to load.
- Payment History is global and shows 30 records per page.
- Edit and Remove (archive) are normal update actions and do not physically delete data.
- Permanent delete is shown only to `nisstaj_admin` in Payment Archive and asks for the database-backed financial password at the moment of deletion.
- Apply `20260719040000_payment_history_access_and_permanent_delete_security.sql` to the test Supabase project.
