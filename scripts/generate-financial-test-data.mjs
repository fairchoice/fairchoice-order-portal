import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CONFIRM_VALUE = "YES_CREATE_FAIRCHOICE_TEST_DATA";
const SOURCE = "TEST_DATA_GENERATOR_V1";

function readEnvFile(filename) {
  if (!fs.existsSync(filename)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filename, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).trim()];
      })
  );
}

const localEnv = readEnvFile(path.resolve(".env.local"));
const productionEnv = readEnvFile(path.resolve(".env"));
const testUrl = process.env.VITE_SUPABASE_URL || localEnv.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  localEnv.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  localEnv.VITE_SUPABASE_ANON_KEY;
const productionUrl = productionEnv.VITE_SUPABASE_URL;

if (process.env.FAIRCHOICE_TEST_DATA_CONFIRM !== CONFIRM_VALUE) {
  throw new Error(
    `Safety confirmation missing. Run with FAIRCHOICE_TEST_DATA_CONFIRM=${CONFIRM_VALUE}.`
  );
}

if (!testUrl || !key) {
  throw new Error(
    "Missing Test Supabase credentials. Configure VITE_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY in .env.local."
  );
}

if (productionUrl && testUrl.replace(/\/$/, "") === productionUrl.replace(/\/$/, "")) {
  throw new Error(
    "REFUSED: .env.local points to the same Supabase URL as .env. This generator must never run against production."
  );
}

const supabase = createClient(testUrl, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ids = {
  fifoAccount: "10000000-0000-4000-8000-000000000001",
  branchAccount: "10000000-0000-4000-8000-000000000002",
  birmingham: "20000000-0000-4000-8000-000000000001",
  london: "20000000-0000-4000-8000-000000000002",
  fifoInvoice1: "30000000-0000-4000-8000-000000000001",
  fifoInvoice2: "30000000-0000-4000-8000-000000000002",
  fifoInvoice3: "30000000-0000-4000-8000-000000000003",
  fifoPayment1: "40000000-0000-4000-8000-000000000001",
  branchInvoice1: "30000000-0000-4000-8000-000000000011",
  branchInvoice2: "30000000-0000-4000-8000-000000000012",
  branchInvoice3: "30000000-0000-4000-8000-000000000013",
  branchPayment1: "40000000-0000-4000-8000-000000000011",
  branchPayment2: "40000000-0000-4000-8000-000000000012",
};

const accountIds = [ids.fifoAccount, ids.branchAccount];
const invoiceIds = [
  ids.fifoInvoice1,
  ids.fifoInvoice2,
  ids.fifoInvoice3,
  ids.branchInvoice1,
  ids.branchInvoice2,
  ids.branchInvoice3,
];
const paymentIds = [ids.fifoPayment1, ids.branchPayment1, ids.branchPayment2];

function fail(step, error) {
  if (error) throw new Error(`${step}: ${error.message || JSON.stringify(error)}`);
}

function isMissingTableOrColumn(error) {
  return ["42P01", "42703", "PGRST204", "PGRST205"].includes(error?.code) ||
    /does not exist|schema cache|could not find/i.test(error?.message || "");
}

async function deleteWhere(table, build, { optional = false } = {}) {
  const { error } = await build(supabase.from(table).delete());
  if (error && optional && isMissingTableOrColumn(error)) {
    console.log(`  skipped optional cleanup ${table}: ${error.message}`);
    return;
  }
  fail(`cleanup ${table}`, error);
}

async function insertRows(table, rows, { optional = false, returning = false } = {}) {
  let query = supabase.from(table).insert(rows);
  if (returning) query = query.select("*");
  const { data, error } = await query;
  if (error && optional && isMissingTableOrColumn(error)) {
    console.log(`  skipped optional insert ${table}: ${error.message}`);
    return [];
  }
  fail(`insert ${table}`, error);
  return data || [];
}

async function cleanup() {
  console.log("Cleaning previous deterministic test data...");
  await deleteWhere(
    "customer_payment_allocations",
    (query) => query.in("customer_account_id", accountIds),
    { optional: true }
  );
  await deleteWhere(
    "financial_audit_log",
    (query) => query.in("customer_account_id", accountIds),
    { optional: true }
  );
  await deleteWhere(
    "customer_ledger",
    (query) => query.in("customer_account_id", accountIds),
    { optional: true }
  );
  await deleteWhere("customer_payments", (query) => query.in("id", paymentIds));
  await deleteWhere("customer_invoices", (query) => query.in("id", invoiceIds));
  await deleteWhere(
    "customer_branch_opening_balances",
    (query) => query.in("customer_account_id", accountIds)
  );
  await deleteWhere("customer_branches", (query) => query.in("customer_account_id", accountIds));
  await deleteWhere("customer_accounts", (query) => query.in("id", accountIds));
}

async function seedAccounts() {
  console.log("Creating deterministic customers and branches...");
  await insertRows("customer_accounts", [
    {
      id: ids.fifoAccount,
      account_name: "FC TEST - FIFO SINGLE ACCOUNT",
      active: true,
      credit_limit: 2000,
    },
    {
      id: ids.branchAccount,
      account_name: "FC TEST - MULTI BRANCH ACCOUNT",
      active: true,
      credit_limit: 5000,
    },
  ]);

  await insertRows("customer_branches", [
    {
      id: ids.birmingham,
      customer_account_id: ids.branchAccount,
      branch_name: "FC TEST Birmingham",
      postcode: "B1 1AA",
      active: true,
    },
    {
      id: ids.london,
      customer_account_id: ids.branchAccount,
      branch_name: "FC TEST London",
      postcode: "E1 1AA",
      active: true,
    },
  ]);

  await insertRows("customer_branch_opening_balances", [
    {
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      opening_balance: 0,
      effective_at: "2026-07-01T00:00:00Z",
      notes: SOURCE,
      created_by: SOURCE,
    },
    {
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      opening_balance: 500,
      effective_at: "2026-07-01T00:00:00Z",
      notes: SOURCE,
      created_by: SOURCE,
    },
    {
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.london,
      opening_balance: 250,
      effective_at: "2026-07-01T00:00:00Z",
      notes: SOURCE,
      created_by: SOURCE,
    },
  ]);
}

async function seedCanonicalFinancialRows() {
  console.log("Creating canonical invoices, payments, and FIFO allocations...");
  await insertRows("customer_invoices", [
    {
      id: ids.fifoInvoice1,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      invoice_number: "FC-FIFO-INV-001",
      invoice_date: "2026-07-01T09:00:00Z",
      invoice_total: 100,
      price_mode: "vat",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-01T09:00:00Z",
    },
    {
      id: ids.fifoInvoice2,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      invoice_number: "FC-FIFO-INV-002",
      invoice_date: "2026-07-03T09:00:00Z",
      invoice_total: 200,
      price_mode: "server",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-03T09:00:00Z",
    },
    {
      id: ids.fifoInvoice3,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      invoice_number: "FC-FIFO-INV-003",
      invoice_date: "2026-07-05T09:00:00Z",
      invoice_total: 300,
      price_mode: "super",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-05T09:00:00Z",
    },
    {
      id: ids.branchInvoice1,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      invoice_number: "FC-BHM-INV-001",
      invoice_date: "2026-07-02T10:00:00Z",
      invoice_total: 300,
      price_mode: "vat",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-02T10:00:00Z",
    },
    {
      id: ids.branchInvoice2,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      invoice_number: "FC-BHM-INV-002",
      invoice_date: "2026-07-07T10:00:00Z",
      invoice_total: 450,
      price_mode: "manager",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-07T10:00:00Z",
    },
    {
      id: ids.branchInvoice3,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.london,
      invoice_number: "FC-LON-INV-001",
      invoice_date: "2026-07-04T11:00:00Z",
      invoice_total: 600,
      price_mode: "super",
      status: "ISSUED",
      created_by: SOURCE,
      created_at: "2026-07-04T11:00:00Z",
    },
  ]);

  await insertRows("customer_payments", [
    {
      id: ids.fifoPayment1,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      payment_reference: "FC-FIFO-PAY-001",
      payment_date: "2026-07-06T12:00:00Z",
      amount: 150,
      payment_method: "Bank Transfer",
      paid_by: "FIFO Tester",
      notes: "Expected: INV-001 paid, INV-002 has 150 outstanding",
      source: SOURCE,
      idempotency_key: "fc-test-fifo-payment-001",
      status: "POSTED",
      created_by: SOURCE,
      created_at: "2026-07-06T12:00:00Z",
    },
    {
      id: ids.branchPayment1,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      payment_reference: "FC-BHM-PAY-001",
      payment_date: "2026-07-08T12:00:00Z",
      amount: 500,
      payment_method: "Cash",
      paid_by: "Birmingham Tester",
      notes: "Pays oldest Birmingham invoice first, then next",
      source: SOURCE,
      idempotency_key: "fc-test-bhm-payment-001",
      status: "POSTED",
      created_by: SOURCE,
      created_at: "2026-07-08T12:00:00Z",
    },
    {
      id: ids.branchPayment2,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.london,
      payment_reference: "FC-LON-PAY-001",
      payment_date: "2026-07-09T12:00:00Z",
      amount: 700,
      payment_method: "Card",
      paid_by: "London Tester",
      notes: "Pays London invoice and leaves 100 account credit",
      source: SOURCE,
      idempotency_key: "fc-test-lon-payment-001",
      status: "POSTED",
      created_by: SOURCE,
      created_at: "2026-07-09T12:00:00Z",
    },
  ]);

  await insertRows("customer_payment_allocations", [
    {
      payment_id: ids.fifoPayment1,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      invoice_reference: "FC-FIFO-INV-001",
      invoice_source_id: ids.fifoInvoice1,
      allocated_amount: 100,
      allocation_type: "automatic",
      status: "active",
      allocated_at: "2026-07-06T12:00:00Z",
      created_by: SOURCE,
      created_at: "2026-07-06T12:00:00Z",
    },
    {
      payment_id: ids.fifoPayment1,
      customer_account_id: ids.fifoAccount,
      customer_branch_id: null,
      invoice_reference: "FC-FIFO-INV-002",
      invoice_source_id: ids.fifoInvoice2,
      allocated_amount: 50,
      allocation_type: "automatic",
      status: "active",
      allocated_at: "2026-07-06T12:00:00Z",
      created_by: SOURCE,
      created_at: "2026-07-06T12:00:00Z",
    },
    {
      payment_id: ids.branchPayment1,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      invoice_reference: "FC-BHM-INV-001",
      invoice_source_id: ids.branchInvoice1,
      allocated_amount: 300,
      allocation_type: "automatic",
      status: "active",
      allocated_at: "2026-07-08T12:00:00Z",
      created_by: SOURCE,
      created_at: "2026-07-08T12:00:00Z",
    },
    {
      payment_id: ids.branchPayment1,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.birmingham,
      invoice_reference: "FC-BHM-INV-002",
      invoice_source_id: ids.branchInvoice2,
      allocated_amount: 200,
      allocation_type: "automatic",
      status: "active",
      allocated_at: "2026-07-08T12:00:00Z",
      created_by: SOURCE,
      created_at: "2026-07-08T12:00:00Z",
    },
    {
      payment_id: ids.branchPayment2,
      customer_account_id: ids.branchAccount,
      customer_branch_id: ids.london,
      invoice_reference: "FC-LON-INV-001",
      invoice_source_id: ids.branchInvoice3,
      allocated_amount: 600,
      allocation_type: "automatic",
      status: "active",
      allocated_at: "2026-07-09T12:00:00Z",
      created_by: SOURCE,
      created_at: "2026-07-09T12:00:00Z",
    },
  ]);
}

async function seedLegacyPortalMirror() {
  console.log("Creating optional customer_ledger mirror for Customer Portal testing...");
  const ledgerRows = await insertRows(
    "customer_ledger",
    [
      {
        customer_name: "FC TEST - FIFO SINGLE ACCOUNT",
        customer_account_id: ids.fifoAccount,
        entry_type: "INVOICE",
        transaction_type: "INVOICE",
        reference_no: "FC-FIFO-INV-001",
        description: "FIFO oldest invoice",
        debit: 100,
        credit: 0,
        invoice_total: 100,
        invoice_amount: 100,
        paid_amount: 100,
        remaining_amount: 0,
        invoice_status: "PAID",
        price_mode: "vat",
        created_at: "2026-07-01T09:00:00Z",
        invoice_date: "2026-07-01T09:00:00Z",
        source: SOURCE,
      },
      {
        customer_name: "FC TEST - FIFO SINGLE ACCOUNT",
        customer_account_id: ids.fifoAccount,
        entry_type: "INVOICE",
        transaction_type: "INVOICE",
        reference_no: "FC-FIFO-INV-002",
        description: "FIFO second invoice",
        debit: 200,
        credit: 0,
        invoice_total: 200,
        invoice_amount: 200,
        paid_amount: 50,
        remaining_amount: 150,
        invoice_status: "PARTIALLY PAID",
        price_mode: "server",
        created_at: "2026-07-03T09:00:00Z",
        invoice_date: "2026-07-03T09:00:00Z",
        source: SOURCE,
      },
      {
        customer_name: "FC TEST - FIFO SINGLE ACCOUNT",
        customer_account_id: ids.fifoAccount,
        entry_type: "INVOICE",
        transaction_type: "INVOICE",
        reference_no: "FC-FIFO-INV-003",
        description: "FIFO newest invoice",
        debit: 300,
        credit: 0,
        invoice_total: 300,
        invoice_amount: 300,
        paid_amount: 0,
        remaining_amount: 300,
        invoice_status: "UNPAID",
        price_mode: "super",
        created_at: "2026-07-05T09:00:00Z",
        invoice_date: "2026-07-05T09:00:00Z",
        source: SOURCE,
      },
      {
        customer_name: "FC TEST - FIFO SINGLE ACCOUNT",
        customer_account_id: ids.fifoAccount,
        entry_type: "PAYMENT",
        transaction_type: "PAYMENT",
        reference_no: "FC-FIFO-PAY-001",
        payment_reference: "FC-FIFO-PAY-001",
        description: "FIFO payment",
        debit: 0,
        credit: 150,
        amount: 150,
        payment_amount: 150,
        amount_collected: 150,
        payment_type: "Bank Transfer",
        payment_method: "Bank Transfer",
        payment_status: "POSTED",
        paid_by: "FIFO Tester",
        payment_date: "2026-07-06T12:00:00Z",
        created_at: "2026-07-06T12:00:00Z",
        source: SOURCE,
      },
    ],
    { optional: true, returning: true }
  );

  if (ledgerRows.length) {
    const byReference = Object.fromEntries(
      ledgerRows.map((row) => [row.reference_no || row.payment_reference, row])
    );
    const payment = byReference["FC-FIFO-PAY-001"];
    const invoice1 = byReference["FC-FIFO-INV-001"];
    const invoice2 = byReference["FC-FIFO-INV-002"];

    if (payment?.id && invoice1?.id && invoice2?.id) {
      await insertRows(
        "customer_payment_allocations",
        [
          {
            payment_ledger_id: payment.id,
            invoice_ledger_id: invoice1.id,
            customer_account_id: ids.fifoAccount,
            customer_branch_id: null,
            allocated_amount: 100,
            allocation_type: "automatic",
            status: "active",
          },
          {
            payment_ledger_id: payment.id,
            invoice_ledger_id: invoice2.id,
            customer_account_id: ids.fifoAccount,
            customer_branch_id: null,
            allocated_amount: 50,
            allocation_type: "automatic",
            status: "active",
          },
        ],
        { optional: true }
      );
    }
  }
}

async function seedAuditLog() {
  await insertRows(
    "financial_audit_log",
    [
      {
        action: "TEST_DATA_CREATED",
        entity_type: "customer_account",
        entity_id: ids.fifoAccount,
        customer_account_id: ids.fifoAccount,
        reason: "Deterministic FIFO financial scenario",
        after_data: {
          expected: {
            invoice1: "PAID",
            invoice2Outstanding: 150,
            invoice3Outstanding: 300,
            totalOutstanding: 450,
            displayOrder: "NEWEST_FIRST",
            allocationOrder: "OLDEST_INVOICE_FIRST",
          },
        },
        changed_by: SOURCE,
        changed_at: "2026-07-10T12:00:00Z",
      },
      {
        action: "TEST_DATA_CREATED",
        entity_type: "customer_account",
        entity_id: ids.branchAccount,
        customer_account_id: ids.branchAccount,
        reason: "Deterministic multi-branch financial scenario",
        after_data: {
          expected: {
            birminghamOpeningBalance: 500,
            londonOpeningBalance: 250,
            customerOpeningBalance: 750,
            historiesRemainBranchSpecific: true,
          },
        },
        changed_by: SOURCE,
        changed_at: "2026-07-10T12:05:00Z",
      },
    ],
    { optional: true }
  );
}

async function verify() {
  console.log("Verifying deterministic expectations...");
  const { data: invoices, error: invoiceError } = await supabase
    .from("customer_invoices")
    .select("id, invoice_number, invoice_total, invoice_date")
    .eq("customer_account_id", ids.fifoAccount)
    .order("invoice_date", { ascending: true });
  fail("verify FIFO invoices", invoiceError);

  const { data: allocations, error: allocationError } = await supabase
    .from("customer_payment_allocations")
    .select("invoice_reference, allocated_amount, status")
    .eq("customer_account_id", ids.fifoAccount)
    .eq("status", "active");
  fail("verify FIFO allocations", allocationError);

  const allocatedByInvoice = (allocations || []).reduce((result, row) => {
    result[row.invoice_reference] =
      Number(result[row.invoice_reference] || 0) + Number(row.allocated_amount || 0);
    return result;
  }, {});

  const expected = {
    "FC-FIFO-INV-001": 0,
    "FC-FIFO-INV-002": 150,
    "FC-FIFO-INV-003": 300,
  };

  for (const invoice of invoices || []) {
    const remaining =
      Number(invoice.invoice_total || 0) -
      Number(allocatedByInvoice[invoice.invoice_number] || 0);
    if (remaining !== expected[invoice.invoice_number]) {
      throw new Error(
        `Verification failed for ${invoice.invoice_number}: expected ${expected[invoice.invoice_number]}, got ${remaining}.`
      );
    }
  }

  console.log("\nVerified FIFO result:");
  console.log("  FC-FIFO-INV-001 = PAID");
  console.log("  FC-FIFO-INV-002 = £150 outstanding");
  console.log("  FC-FIFO-INV-003 = £300 outstanding");
  console.log("  Account outstanding = £450");
  console.log("  UI expectation = newest transaction first");
}

async function main() {
  console.log(`Target Test Supabase: ${testUrl}`);
  console.log(
    process.env.SUPABASE_SERVICE_ROLE_KEY || localEnv.SUPABASE_SERVICE_ROLE_KEY
      ? "Using service-role credentials."
      : "Using anon credentials. RLS must permit test-data writes."
  );

  await cleanup();
  await seedAccounts();
  await seedCanonicalFinancialRows();
  await seedLegacyPortalMirror();
  await seedAuditLog();
  await verify();

  console.log("\nFinancial test data created successfully.");
  console.log("Search customers beginning with: FC TEST -");
}

main().catch((error) => {
  console.error("\nFinancial test data generation failed:");
  console.error(error);
  process.exitCode = 1;
});
