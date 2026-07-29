import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Test Shop invoices and payments are excluded from outstanding calculations", () => {
  const source = fs.readFileSync(
    new URL("./centralPaymentService.js", import.meta.url),
    "utf8"
  );

  assert.match(source, /isTestAccount\(customer\)/);
  assert.match(
    source,
    /return createEmptyCentralPaymentSnapshot\(\)/
  );
  assert.match(source, /customerSummary: summarizeCreditSnapshot\(\)/);
  assert.match(source, /payments: \[\]/);
  assert.match(source, /invoices: \[\]/);
});

test("cleanup migration is audit-safe, permission checked, idempotent, and non-destructive", () => {
  const source = fs.readFileSync(
    new URL(
      "../../supabase/migrations/20260729100000_test_account_financial_isolation.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /is_test_account boolean not null default false/i);
  assert.match(source, /test_transaction_cleanup_archive/i);
  assert.match(
    source,
    /Permanent audit archive of removed test transactions\. DO NOT DELETE\./i
  );
  assert.match(source, /record_snapshot jsonb not null/i);
  assert.match(source, /cleanup_batch_id uuid not null/i);
  assert.match(source, /fc_require_session_permission/i);
  assert.match(source, /customer_accounts\.cleanup_test_data/i);
  assert.match(source, /p_apply boolean default false/i);
  assert.match(source, /on conflict .* do nothing/is);
  assert.match(source, /status = 'VOIDED'/i);
  assert.match(source, /status = 'reversed'/i);
  assert.match(source, /coalesce\(account\.is_test_account, false\) = false/i);
  assert.match(source, /prevent_duplicate_legacy_order_payment_import_v1/i);
  assert.match(source, /Duplicate legacy order payment import blocked/i);
  assert.doesNotMatch(source, /\bdelete\s+from\b|\btruncate\b|\bdrop\s+table\b/i);
});

test("cleanup command defaults to dry-run and requires guarded RPC apply", () => {
  const source = fs.readFileSync(
    new URL("../../scripts/cleanup-test-shop.mjs", import.meta.url),
    "utf8"
  );

  assert.match(source, /const apply = args\.has\("--apply"\)/);
  assert.match(source, /if \(!apply\)/);
  assert.match(source, /Database writes: 0/);
  assert.match(source, /assertSafeCleanupEnvironment/);
  assert.match(source, /TEST_DATA_CLEANUP_ALLOWED/);
  assert.match(source, /TEST_DATA_CLEANUP_SUPABASE_URL/);
  assert.match(source, /cleanup_test_customer_transactions_v1/);
  assert.doesNotMatch(
    source,
    /\.from\([^)]*\)\s*\.(?:delete|update|insert|upsert)\(/s
  );
});

test("payment and collection reports use the test-account flag rather than names", () => {
  const weeklySource = fs.readFileSync(
    new URL("./weeklyAccountPayments.js", import.meta.url),
    "utf8"
  );
  const paymentHistorySource = fs.readFileSync(
    new URL("./paymentHistoryReadOnlyService.js", import.meta.url),
    "utf8"
  );

  assert.match(weeklySource, /is_test_account === true/);
  assert.match(weeklySource, /testAccountIds/);
  assert.match(paymentHistorySource, /is_test_account/);
  assert.match(paymentHistorySource, /\.not\(\s*"customer_account_id"/);
  assert.doesNotMatch(weeklySource, /account_name.*test shop/i);
});
