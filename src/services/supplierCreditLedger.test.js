import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  calculateSupplierRunningBalances,
  canPostSupplierLedger,
  canViewSupplierAccounts,
  filterSupplierStatementRows,
  supplierTransactionDirection,
  validateManualSupplierLedgerEntry,
} from "./suppliers.js";

const read = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
const migration = read(
  "../../supabase/migrations/20260730130000_supplier_credit_ledger_phase2.sql",
);
const obsoleteMigration = read(
  "../../supabase/migrations/20260727150000_expenses_payout_direct_debit_supplier_credit.sql",
);
const serviceSource = read("./suppliers.js");
const pageSource = read("../pages/AdminSetup/SupplierAccounts.jsx");
const layoutSource = read("../pages/AdminSetup/BackOfficeLayout.jsx");
const customerOrderSource = read("../pages/CustomerOrder.jsx");

test("every supported supplier transaction type has the documented sign", () => {
  for (const type of [
    "opening_balance",
    "purchase_invoice",
    "debit_adjustment",
    "Credit Purchase",
    "Adjustment",
  ]) {
    assert.equal(supplierTransactionDirection(type), "debit");
  }
  for (const type of [
    "payment",
    "credit_note",
    "refund",
    "credit_adjustment",
    "Payment",
    "Credit Note",
  ]) {
    assert.equal(supplierTransactionDirection(type), "credit");
  }
});

test("opening balance, running balance, and current balance reconcile", () => {
  const rows = calculateSupplierRunningBalances(
    [
      {
        id: "b",
        transaction_date: "2026-07-02",
        created_at: "2026-07-02T09:00:00Z",
        transaction_type: "payment",
        amount: 40,
        status: "posted",
      },
      {
        id: "a",
        transaction_date: "2026-07-01",
        created_at: "2026-07-01T09:00:00Z",
        transaction_type: "purchase_invoice",
        amount: 100,
        status: "posted",
      },
    ],
    25,
  );

  assert.deepEqual(
    rows.map(({ debit, credit, running_balance }) => ({
      debit,
      credit,
      running_balance,
    })),
    [
      { debit: 100, credit: 0, running_balance: 125 },
      { debit: 0, credit: 40, running_balance: 85 },
    ],
  );
  assert.equal(rows.at(-1).running_balance, 25 + 100 - 40);
});

test("voided and cancelled entries remain visible but do not affect balance", () => {
  const rows = calculateSupplierRunningBalances([
    {
      id: "posted",
      transaction_date: "2026-07-01",
      transaction_type: "purchase_invoice",
      amount: 100,
      status: "posted",
    },
    {
      id: "voided",
      transaction_date: "2026-07-02",
      transaction_type: "payment",
      amount: 90,
      status: "voided",
    },
    {
      id: "cancelled",
      transaction_date: "2026-07-03",
      transaction_type: "credit_note",
      amount: 10,
      status: "cancelled",
    },
  ]);

  assert.equal(rows.at(-1).running_balance, 100);
  assert.equal(rows[1].credit, 0);
  assert.equal(rows[2].credit, 0);
});

test("date, transaction type, and literal statement search compose", () => {
  const rows = [
    {
      row_key: "opening",
      is_opening_balance: true,
      transaction_date: "2026-07-01",
    },
    {
      row_key: "1",
      transaction_date: "2026-07-02",
      transaction_type: "purchase_invoice",
      reference: "PO_%_100",
      description: String.raw`Back\slash stock`,
      status: "posted",
    },
    {
      row_key: "2",
      transaction_date: "2026-06-20",
      transaction_type: "payment",
      reference: "ordinary",
      status: "posted",
    },
  ];

  assert.deepEqual(
    filterSupplierStatementRows(rows, {
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      transactionTypes: ["purchase_invoice"],
      search: "%_",
    }).map(({ row_key }) => row_key),
    ["opening", "1"],
  );
  assert.deepEqual(
    filterSupplierStatementRows(rows, {
      search: String.raw`\slash`,
    }).map(({ row_key }) => row_key),
    ["opening", "1"],
  );
  assert.deepEqual(
    filterSupplierStatementRows(rows, { search: "%not-wildcard" }).map(
      ({ row_key }) => row_key,
    ),
    ["opening"],
  );
});

test("same-date statement ordering uses created timestamp then stable ID", () => {
  const rows = calculateSupplierRunningBalances([
    {
      id: "b",
      transaction_date: "2026-07-01",
      created_at: "2026-07-01T10:00:00Z",
      transaction_type: "payment",
      amount: 10,
    },
    {
      id: "c",
      transaction_date: "2026-07-01",
      created_at: "2026-07-01T09:00:00Z",
      transaction_type: "purchase_invoice",
      amount: 20,
    },
    {
      id: "a",
      transaction_date: "2026-07-01",
      created_at: "2026-07-01T10:00:00Z",
      transaction_type: "debit_adjustment",
      amount: 5,
    },
  ]);
  assert.deepEqual(rows.map(({ id }) => id), ["c", "a", "b"]);
});

test("supplier statement and posting permissions remain separate", () => {
  assert.equal(
    canViewSupplierAccounts({
      effective_permissions: { "suppliers.view": true },
    }),
    true,
  );
  assert.equal(
    canPostSupplierLedger({
      effective_permissions: { "suppliers.view": true },
    }),
    false,
  );
  assert.equal(
    canPostSupplierLedger({
      effective_permissions: { "suppliers.pay": true },
    }),
    true,
  );
});

test("manual entries require active supplier, positive amount, reference, and reason", () => {
  const invalid = validateManualSupplierLedgerEntry({
    supplierId: "supplier-1",
    supplierActive: false,
    transactionDate: "",
    transactionType: "payment",
    amount: 0,
    reference: " ",
    description: "",
  });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.supplierId, /inactive/i);
  assert.match(invalid.errors.transactionDate, /required/i);
  assert.match(invalid.errors.transactionType, /opening balance/i);
  assert.match(invalid.errors.amount, /greater than zero/i);
  assert.match(invalid.errors.reference, /required/i);
  assert.match(invalid.errors.description, /required/i);

  const valid = validateManualSupplierLedgerEntry({
    supplierId: "supplier-1",
    supplierActive: true,
    transactionDate: "2026-07-30",
    transactionType: "credit_adjustment",
    amount: "12.50",
    reference: " COR-12 ",
    description: " Price correction ",
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.entry.amount, 12.5);
  assert.equal(valid.entry.reference, "COR-12");
});

test("migration creates the canonical ledger from the actual Preview baseline", () => {
  assert.match(
    migration,
    /create table if not exists public\.supplier_credit_transactions/i,
  );
  const prerequisiteBlock = migration.slice(
    0,
    migration.indexOf(
      "create table if not exists public.supplier_credit_transactions",
    ),
  );
  assert.doesNotMatch(
    prerequisiteBlock,
    /to_regclass\('public\.supplier_credit_transactions'\)/i,
  );
  assert.doesNotMatch(
    prerequisiteBlock,
    /fc_supplier_credit_statement\(uuid\)/i,
  );
  assert.doesNotMatch(
    migration,
    /create\s+(?:table|function)[\s\S]*supplier_payments/i,
  );
  for (const column of [
    "id uuid primary key",
    "supplier_id uuid not null",
    "transaction_date date not null",
    "transaction_type text not null",
    "amount numeric(14,2) not null",
    "invoice_number text",
    "reference text",
    "description",
    "notes text",
    "status",
    "created_by text",
    "created_by_username text",
    "created_by_login_id",
    "created_by_staff_id",
    "created_at timestamptz",
    "voided_by_login_id",
    "voided_by_staff_id",
    "voided_by_username",
    "voided_at",
    "void_reason",
    "reversal_of_transaction_id",
  ]) {
    assert.ok(migration.includes(column), `missing ledger field: ${column}`);
  }
  assert.match(migration, /check \(amount > 0\)/i);
  assert.match(
    migration,
    /foreign key \(supplier_id\)[\s\S]*references public\.suppliers\(id\)[\s\S]*on delete restrict/i,
  );
  assert.match(
    migration,
    /alter table public\.supplier_credit_transactions enable row level security/i,
  );
});

test("statement v2 calculates prior opening and current balances deterministically", () => {
  const statement = migration.slice(
    migration.indexOf(
      "create or replace function public.fc_supplier_credit_statement_v2",
    ),
    migration.indexOf(
      "create or replace function public.fc_post_supplier_credit_adjustment_v1",
    ),
  );
  assert.match(
    statement,
    /source_transaction_date < p_date_from[\s\S]*calculated_opening_balance/i,
  );
  assert.match(
    statement,
    /sum\(r\.source_debit - r\.source_credit\)/i,
  );
  assert.match(
    statement,
    /order by[\s\S]*source_transaction_date[\s\S]*source_created_at[\s\S]*source_row_key/i,
  );
  assert.match(statement, /position\(/i);
  assert.doesNotMatch(statement, /\bilike\b|\blike\b/i);
  assert.match(statement, /stock_receipt/i);
  assert.match(
    statement,
    /sr\.supplier_id = p_supplier_id[\s\S]*sr\.supplier_id is null[\s\S]*sr\.supplier_name/i,
  );
});

test("posting and void RPCs enforce FC permission and preserve audit rows", () => {
  assert.ok(
    (
      migration.match(
        /fc_require_session_permission\([\s\S]*?'suppliers\.pay'/g,
      ) || []
    ).length >= 2,
  );
  assert.match(
    migration,
    /status = 'voided'[\s\S]*void_reason = v_reason[\s\S]*voided_by_login_id[\s\S]*voided_by_staff_id[\s\S]*voided_at = now\(\)/i,
  );
  assert.doesNotMatch(migration, /delete from public\.supplier_credit_transactions/i);
  assert.match(
    migration,
    /revoke all on table public\.supplier_credit_transactions[\s\S]*from public, anon, authenticated/i,
  );
});

test("alleged legacy ledger objects have no real application caller", () => {
  assert.match(
    obsoleteMigration,
    /create table if not exists public\.supplier_credit_transactions/i,
  );
  assert.match(
    obsoleteMigration,
    /function public\.fc_supplier_credit_statement\(p_supplier_id uuid\)/i,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function public\.fc_supplier_credit_statement\s*\(/i,
  );
  assert.match(serviceSource, /"fc_supplier_credit_statement_v2"/);
  assert.doesNotMatch(serviceSource, /"fc_supplier_credit_statement"/);
  assert.doesNotMatch(serviceSource, /\.from\("supplier_credit_transactions"\)/);
});

test("migration verifies every Preview stock receipt column it references", () => {
  for (const column of [
    "id",
    "supplier_id",
    "supplier_name",
    "received_date",
    "total_cost",
    "payment_method",
    "invoice_number",
    "purchase_type",
  ]) {
    assert.match(migration, new RegExp(`\\('${column}'\\)`));
  }
});

test("Supplier Accounts extends the existing Accounts route and printable UI", () => {
  assert.match(
    layoutSource,
    /title: "Accounts"[\s\S]*label: "Supplier Accounts"[\s\S]*permission: "page\.supplier_accounts"/,
  );
  assert.match(
    customerOrderSource,
    /page === "supplierAccounts"[\s\S]*<SupplierAccounts user=\{activeUser\}/,
  );
  assert.match(pageSource, /Print statement/);
  assert.match(pageSource, /True current balance/);
  assert.match(pageSource, /Opening balance/);
});
