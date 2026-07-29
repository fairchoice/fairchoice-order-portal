import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");

const serviceSource = read("./centralPaymentService.js");
const customerCreditSource = read("../pages/AdminSetup/CustomerCredit.jsx");
const permissionSource = read("../security/fcPermissions.js");
const migrationSource = read(
  "../../supabase/migrations/20260728130000_canonical_customer_account_history.sql"
);

test("all customer-history screens receive the shared canonical model", () => {
  assert.match(serviceSource, /buildCustomerAccountTransactionModel/);
  assert.match(serviceSource, /transactionHistory:\s*accountHistory\.transactions/);
  assert.match(serviceSource, /paymentHistory:\s*accountHistory\.paymentHistory/);
  assert.match(serviceSource, /customerSummary:\s*fullAccountHistory\.summary|const customerSummary = fullAccountHistory\.summary/);
  assert.match(customerCreditSource, /snapshot\?\.accountHistory\?\.transactions/);
  assert.match(customerCreditSource, /\["payments", "Payment History"\]/);
});

test("history UI defaults oldest-first and exposes consistent accounting columns", () => {
  assert.match(customerCreditSource, /useState\("oldest"\)/);
  for (const heading of [
    "Date and time",
    "Reference",
    "Details",
    "Debit",
    "Credit",
    "Running balance",
    "Related invoice",
  ]) {
    assert.match(customerCreditSource, new RegExp(heading));
  }
  assert.doesNotMatch(customerCreditSource, />Not available</);
});

test("summary separates debt, overpayment credit, and available credit limit", () => {
  assert.match(customerCreditSource, /Outstanding Balance/);
  assert.match(customerCreditSource, /Customer Credit/);
  assert.match(customerCreditSource, /Available Credit Limit/);
  assert.match(customerCreditSource, /outstandingBalance/);
  assert.match(customerCreditSource, /customerCredit/);
  assert.match(customerCreditSource, /availableCreditLimit/);
});

test("opening-balance edits are backend authorized and audited", () => {
  assert.match(serviceSource, /set_customer_opening_balance_v1/);
  assert.doesNotMatch(
    customerCreditSource,
    /\.from\("customer_branch_opening_balances"\)\s*\.(?:insert|update)/
  );
  assert.match(
    migrationSource,
    /fc_require_session_permission\([\s\S]*'customer_credit\.opening_balance_edit'/
  );
  assert.match(migrationSource, /customer_opening_balance_audit/);
  assert.match(migrationSource, /Amendment reason is required/);
});

test("all-account reconciliation and invoice synchronization are installed securely", () => {
  assert.match(migrationSource, /customer_account_reconciliation_v1/);
  assert.match(migrationSource, /calculated_closing_balance/);
  assert.match(migrationSource, /abs\([\s\S]*\) <= 0\.01 as reconciled/);
  assert.match(migrationSource, /orders_customer_invoice_sync_v1/);
  assert.match(migrationSource, /order_items_customer_invoice_sync_v1/);
  assert.match(migrationSource, /recalculate_central_payment_fifo/);
  assert.match(
    migrationSource,
    /fc_require_session_permission\([\s\S]*'customer_credit\.audit_view'/
  );
  assert.match(
    migrationSource,
    /revoke all on public\.customer_account_reconciliation_v1/
  );
});

test("separate customer-credit permissions are declared", () => {
  for (const permission of [
    "customer_credit.view",
    "customer_credit.payment_view",
    "customer_credit.payment_edit",
    "customer_credit.payment_void",
    "customer_credit.opening_balance_edit",
    "customer_credit.audit_view",
  ]) {
    assert.match(permissionSource + migrationSource, new RegExp(permission.replace(".", "\\.")));
  }
});
