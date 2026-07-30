import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildLedgerFilters,
  normalizeLedgerRecord,
} from "./globalFinancialLedgerService.js";

test("buildLedgerFilters trims values and normalizes status fields", () => {
  assert.deepEqual(
    buildLedgerFilters({
      search: "  INV-100  ",
      method: " Cash ",
      status: " archived ",
      transactionType: " payment ",
      dateFrom: " 2026-07-01 ",
      dateTo: " 2026-07-31 ",
      customerAccountId: " account-1 ",
      customerBranchId: " branch-1 ",
    }),
    {
      search: "INV-100",
      method: "Cash",
      status: "ARCHIVED",
      transactionType: "PAYMENT",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      customerAccountId: "account-1",
      customerBranchId: "branch-1",
    }
  );
});

test("normalizeLedgerRecord provides stable UI fields and numeric amounts", () => {
  const record = normalizeLedgerRecord({
    record_id: "record-1",
    archive_id: "archive-1",
    source_type: "CUSTOMER_PAYMENT",
    source_id: "payment-1",
    transaction_type: "PAYMENT",
    transaction_date: "2026-07-16T10:00:00Z",
    debit_amount: "0.00",
    credit_amount: "42.50",
    amount: "42.50",
    payment_method: "Cash",
    staff_name: "Owner",
    reference: "PAY-100",
    description: "Manual payment",
    status: "archived",
  });

  assert.equal(record.recordId, "record-1");
  assert.equal(record.archiveId, "archive-1");
  assert.equal(record.amount, 42.5);
  assert.equal(record.creditAmount, 42.5);
  assert.equal(record.debitAmount, 0);
  assert.equal(record.status, "ARCHIVED");
  assert.equal(record.paymentMethod, "Cash");
});

test("global ledger reads through the password-validated paginated RPC", () => {
  const service = fs.readFileSync(
    new URL("./globalFinancialLedgerService.js", import.meta.url),
    "utf8",
  );
  const migration = fs.readFileSync(
    new URL(
      "../../supabase/migrations/20260723123000_global_financial_ledger_owner_read.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(service, /\.rpc\("list_global_financial_history_v1"/);
  assert.doesNotMatch(service, /\.from\("global_financial_history"\)/);
  assert.match(migration, /central_payment_require_admin_credentials/);
  assert.match(migration, /order by transaction_date desc, created_at desc, record_id desc/);
});

test("canonical customer payments retain one Global Ledger row and one CREATE event", () => {
  const migration = fs.readFileSync(
    new URL(
      "../../supabase/migrations/20260726130000_complete_canonical_payment_and_global_ledger.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    migration,
    /on conflict \(source_type, source_id\) do update/,
  );
  assert.match(
    migration,
    /on conflict \(transaction_id\) where event_type = 'CREATE' do nothing/,
  );
  assert.match(
    migration,
    /create trigger customer_payments_global_ledger_sync[\s\S]*after insert or update on public\.customer_payments/,
  );
});
