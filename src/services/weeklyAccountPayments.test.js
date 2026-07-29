import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  isActiveLegacyPaymentRow,
  loadWeeklyAccountPayments,
  mergeWeeklyAccountPaymentRows,
} from "./weeklyAccountPayments.js";

test("joins Sales Rep payments to invoice totals and chronological balances", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [
      {
        id: "sales-payment-1",
        customer_account_id: "account-1",
        customer_branch_id: "branch-1",
        amount: 15,
        payment_date: "2026-07-27T10:00:00Z",
        status: "POSTED",
        verification_status: "CONFIRMED",
        source: "SALES_REP_COLLECTION",
        payment_reference: "SALES_REP_COLLECTION",
        collector_name: "Nisstaj Sales",
      },
      {
        id: "sales-payment-2",
        customer_account_id: "account-1",
        customer_branch_id: "branch-1",
        amount: 10,
        payment_date: "2026-07-27T11:00:00Z",
        status: "POSTED",
        verification_status: "CONFIRMED",
        source: "SALES_REP_COLLECTION",
        payment_reference: "SALES_REP_COLLECTION",
        collector_name: "Nisstaj Sales",
      },
    ],
    allocations: [
      {
        id: "allocation-1",
        payment_id: "sales-payment-1",
        invoice_reference: "INV-67",
        allocated_amount: 15,
        status: "active",
      },
      {
        id: "allocation-2",
        payment_id: "sales-payment-2",
        invoice_reference: "INV-67",
        allocated_amount: 10,
        status: "active",
      },
    ],
    invoices: [
      {
        id: "invoice-67",
        invoice_number: "INV-67",
        invoice_total: 67.41,
      },
    ],
    accountNames: new Map([["account-1", "Test Shop"]]),
    branchNames: new Map([["branch-1", "Test Branch"]]),
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => ({
      invoice: row.invoice_no,
      invoiceTotal: row.invoice_total,
      paid: row.payment_amount,
      balance: row.running_balance,
      collector: row.collected_by,
    })),
    [
      {
        invoice: "INV-67",
        invoiceTotal: 67.41,
        paid: 10,
        balance: 42.41,
        collector: "Nisstaj Sales",
      },
      {
        invoice: "INV-67",
        invoiceTotal: 67.41,
        paid: 15,
        balance: 52.41,
        collector: "Nisstaj Sales",
      },
    ]
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.payment_amount, 0),
    25
  );
});

test("split allocations preserve one canonical payment amount exactly once", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [
      {
        id: "split-payment",
        customer_account_id: "account-1",
        amount: 15,
        payment_date: "2026-07-27T10:00:00Z",
        status: "POSTED",
        verification_status: "CONFIRMED",
        source: "SALES_REP_COLLECTION",
      },
    ],
    allocations: [
      {
        id: "allocation-a",
        payment_id: "split-payment",
        invoice_reference: "INV-A",
        allocated_amount: 10,
        status: "active",
      },
      {
        id: "allocation-b",
        payment_id: "split-payment",
        invoice_reference: "INV-B",
        allocated_amount: 5,
        status: "active",
      },
    ],
    invoices: [
      { id: "invoice-a", invoice_number: "INV-A", invoice_total: 30 },
      { id: "invoice-b", invoice_number: "INV-B", invoice_total: 20 },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(
    rows.reduce((sum, row) => sum + row.payment_amount, 0),
    15
  );
  assert.deepEqual(
    rows.map((row) => [row.invoice_no, row.running_balance]),
    [
      ["INV-A", 20],
      ["INV-B", 15],
    ]
  );
});

test("includes unmatched SALES_REP_COLLECTION legacy rows once", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    legacyPayments: [{
      id: 211,
      entry_type: "PAYMENT",
      customer_account_id: "account-1",
      customer_branch_id: "branch-1",
      branch_name: "3s Life Style",
      credit: 401.42,
      created_at: "2026-07-21T12:00:00Z",
      collection_source: "SALES_REP_COLLECTION",
      collected_by_name: "Nisstaj",
      reference_no: "SALES_REP_COLLECTION",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].customer_name, "3s Life Style");
  assert.equal(rows[0].payment_amount, 401.42);
});

test("canonical legacy import suppresses its matching legacy row", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "payment-1",
      customer_account_id: "account-1",
      amount: 401.42,
      payment_date: "2026-07-21T12:00:00Z",
      created_at: "2026-07-22T09:00:00Z",
      status: "POSTED",
      verification_status: "CONFIRMED",
      source: "LEGACY_CUSTOMER_LEDGER",
      idempotency_key: "legacy-customer-ledger:211",
      payment_reference: "SALES_REP_COLLECTION",
    }],
    legacyPayments: [{
      id: 211,
      entry_type: "PAYMENT",
      customer_account_id: "account-1",
      credit: 401.42,
      created_at: "2026-07-21T12:00:00Z",
      collection_source: "SALES_REP_COLLECTION",
      reference_no: "SALES_REP_COLLECTION",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_kind, "canonical");
  assert.equal(rows[0].source_table, "customer_payments");
  assert.equal(rows[0].is_legacy, false);
});

test("canonical payment linked by central_payment_id wins over its ledger copy", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "payment-linked",
      customer_account_id: "account-1",
      amount: 50,
      payment_date: "2026-07-20T09:00:00Z",
      status: "POSTED",
      verification_status: "CONFIRMED",
    }],
    legacyPayments: [{
      id: 300,
      central_payment_id: "payment-linked",
      entry_type: "PAYMENT",
      customer_account_id: "account-1",
      credit: 50,
      payment_date: "2026-07-20T09:00:00Z",
    }],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonical_payment_key, "customer_payments:payment-linked");
});

test("duplicate legacy ledger rows are represented exactly once", () => {
  const legacyBase = {
    entry_type: "PAYMENT",
    customer_account_id: "account-1",
    customer_branch_id: "branch-1",
    credit: 414.75,
    payment_date: "2026-07-16T10:30:00Z",
    reference_no: "ORD-1784144566386",
    collection_source: "DRIVER_COLLECTION",
  };
  const rows = mergeWeeklyAccountPaymentRows({
    legacyPayments: [
      { ...legacyBase, id: 186, created_at: "2026-07-16T10:30:00Z" },
      { ...legacyBase, id: 187, created_at: "2026-07-16T10:30:00Z" },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_record_id, 186);
  assert.equal(rows[0].source_table, "customer_ledger");
  assert.equal(rows[0].is_legacy, true);
});

test("invalid, zero, voided, reversed, and deleted legacy rows are excluded", () => {
  const base = {
    entry_type: "PAYMENT",
    customer_account_id: "account-1",
    credit: 15,
  };
  assert.equal(isActiveLegacyPaymentRow(base), true);
  assert.equal(isActiveLegacyPaymentRow({ ...base, credit: 0 }), false);
  assert.equal(isActiveLegacyPaymentRow({ ...base, entry_type: "INVOICE" }), false);
  assert.equal(isActiveLegacyPaymentRow({ ...base, payment_status: "VOIDED" }), false);
  assert.equal(isActiveLegacyPaymentRow({ ...base, reversed_at: "2026-07-20" }), false);
  assert.equal(isActiveLegacyPaymentRow({ ...base, deleted_at: "2026-07-20" }), false);
});

test("Test Shop payments are excluded by confirmed account ID while genuine shops remain", () => {
  const canonicalBase = {
    amount: 15,
    payment_date: "2026-07-27T10:00:00Z",
    status: "POSTED",
    verification_status: "CONFIRMED",
  };
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [
      {
        ...canonicalBase,
        id: "test-payment",
        customer_account_id: "confirmed-test-id",
      },
      {
        ...canonicalBase,
        id: "real-payment",
        customer_account_id: "real-shop-id",
      },
    ],
    accountNames: new Map([
      ["confirmed-test-id", "Test Shop"],
      ["real-shop-id", "Ravensden Corner Shop"],
    ]),
    testAccountIds: new Set(["confirmed-test-id"]),
  });

  assert.deepEqual(rows.map((row) => row.payment_id), ["real-payment"]);
  assert.equal(rows.reduce((sum, row) => sum + row.payment_amount, 0), 15);
});

test("voided Test Shop payments no longer affect Total Collection", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "voided-test-payment",
      customer_account_id: "confirmed-test-id",
      amount: 244.15,
      payment_date: "2026-07-27",
      status: "VOIDED",
      verification_status: "VOIDED",
    }],
  });

  assert.equal(rows.length, 0);
});

test("Weekly Account loader reads customer_ledger and includes unmatched legacy payments", async () => {
  const calls = [];
  const rowsByTable = {
    customer_payments: [],
    v_reportable_total_collection_payments: [],
    customer_ledger: [{
      id: 901,
      entry_type: "PAYMENT",
      customer_account_id: "account-legacy",
      customer_name: "Legacy Shop",
      credit: 25,
      payment_date: "2026-07-18",
      reference_no: "LEGACY-901",
    }],
    customer_accounts: [{ id: "account-legacy", account_name: "Legacy Shop" }],
  };
  const supabase = {
    from(table) {
      calls.push(table);
      const result = table === "v_reportable_total_collection_payments"
        ? {
            data: [],
            error: {
              code: "PGRST205",
              message: "Could not find v_reportable_total_collection_payments in the schema cache",
            },
          }
        : { data: rowsByTable[table] || [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        then: (resolve) => resolve(result),
      };
      return builder;
    },
  };

  const rows = await loadWeeklyAccountPayments(supabase);

  assert.ok(calls.includes("customer_ledger"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_amount, 25);
  assert.equal(rows[0].canonical_payment_key, "customer_ledger:901");
});

test("Weekly Account loader consumes the shared compatibility view when available", async () => {
  const calls = [];
  const rowsByTable = {
    customer_payments: [],
    v_reportable_total_collection_payments: [{
      canonical_payment_key: "customer_ledger:902",
      payment_id: null,
      customer_account_id: "account-legacy",
      customer_branch_id: null,
      customer_name: "View Shop",
      order_number: "LEGACY-902",
      payment_date: "2026-07-19",
      created_at: "2026-07-19T10:00:00Z",
      amount: 30,
      payment_method: "Cash",
      who_paid: "Owner",
      collected_by: "Sales One",
      collection_type: "Sales Rep Collection",
      status: "POSTED",
      source_table: "customer_ledger",
      source_record_id: "902",
      is_legacy: true,
    }],
    customer_accounts: [{ id: "account-legacy", account_name: "View Shop" }],
  };
  const supabase = {
    from(table) {
      calls.push(table);
      const result = { data: rowsByTable[table] || [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        then: (resolve) => resolve(result),
      };
      return builder;
    },
  };

  const rows = await loadWeeklyAccountPayments(supabase);

  assert.ok(calls.includes("v_reportable_total_collection_payments"));
  assert.ok(!calls.includes("customer_ledger"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment_amount, 30);
  assert.equal(rows[0].source_table, "customer_ledger");
});

test("row 221 appears exactly once after canonical migration", () => {
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [{
      id: "canonical-221",
      customer_account_id: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
      customer_branch_id: "8f598571-db45-424b-9d23-1fe2fba98d78",
      amount: 43,
      payment_date: "2026-07-22T01:23:39.892083Z",
      created_at: "2026-07-22T02:00:00Z",
      status: "POSTED",
      verification_status: "CONFIRMED",
      source: "PREVIOUS_BALANCE_COLLECTION",
      idempotency_key: "legacy-customer-ledger:221",
      payment_reference: "PBC-20260722-L221",
      payment_method: "Cash",
      paid_by: "Vijay",
    }],
    legacyPayments: [{
      id: 221,
      entry_type: "PAYMENT",
      customer_account_id: "7a673fb8-e01d-4165-8c12-3d243f5eb7b3",
      customer_branch_id: "8f598571-db45-424b-9d23-1fe2fba98d78",
      credit: 43,
      created_at: "2026-07-22T01:23:39.892083Z",
      reference_no: "PREVIOUS_BALANCE",
      collection_source: "DRIVER_PREVIOUS_BALANCE",
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].canonical_payment_id, "canonical-221");
  assert.equal(rows[0].payment_amount, 43);
});

test("pending and voided canonical payments do not contribute", () => {
  const base = {
    customer_account_id: "account-1",
    amount: 20,
    payment_date: "2026-07-22T10:00:00Z",
  };
  const rows = mergeWeeklyAccountPaymentRows({
    canonicalPayments: [
      {
        ...base,
        id: "pending",
        status: "POSTED",
        verification_status: "PENDING_VERIFICATION",
      },
      {
        ...base,
        id: "voided",
        status: "VOIDED",
        verification_status: "CONFIRMED",
      },
    ],
  });
  assert.equal(rows.length, 0);
});

test("Weekly Account payment tables remain read-only", () => {
  const source = fs.readFileSync(
    new URL("../pages/AdminSetup/WeeklyAccount.jsx", import.meta.url),
    "utf8",
  );

  for (const forbidden of [
    "editPayment",
    "onEditPayment",
    "handleEditPayment",
    "editingPayment",
    "setEditingPayment",
    "Edit Payment",
  ]) {
    assert.doesNotMatch(source, new RegExp(forbidden, "i"));
  }

  assert.doesNotMatch(source, /<th[^>]*>\s*Action\s*<\/th>/i);
  assert.doesNotMatch(
    source,
    /\.from\(["'](?:customer_ledger|customer_payments|financial_transactions)["']\)[\s\S]{0,200}\.update\(/,
  );

  for (const column of [
    "Customer",
    "Order No",
    "Invoice Total",
    "Paid Amount",
    "Balance",
    "Payment Date",
    "Payment Type",
    "Collected By",
    "Collection Type",
    "Source",
  ]) {
    assert.match(source, new RegExp(`>${column}<`));
  }
  assert.match(source, /row\.running_balance/);
  assert.match(source, /legacy \? "Legacy" : "Current"/);
});

test("legacy compatibility migration preserves source tables and creates the shared read model", () => {
  const source = fs.readFileSync(
    new URL(
      "../../supabase/migrations/20260728140000_total_collection_legacy_compatibility.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /DO NOT DELETE/i);
  assert.match(source, /comment on table public\.customer_ledger/i);
  assert.match(source, /create or replace view public\.v_total_collection_payments/i);
  assert.match(source, /customer_payments/i);
  assert.match(source, /customer_ledger/i);
  assert.match(source, /row_number\(\)/i);
  assert.match(source, /notify pgrst, 'reload schema'/i);
  assert.doesNotMatch(source, /\b(?:delete|truncate)\s+from\b|\bdrop\s+table\b/i);
});

test("nisstaj_sales receives cash collection permission through an idempotent migration", () => {
  const source = fs.readFileSync(
    new URL(
      "../../supabase/migrations/20260727160000_grant_nisstaj_sales_cash_collection.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(source, /lower\(trim\(login\.username\)\) = 'nisstaj_sales'/);
  assert.match(source, /'payments\.collect_cash'/);
  assert.match(source, /on conflict \(staff_id, permission_key\)/);
  assert.match(source, /allowed = true/);
});
