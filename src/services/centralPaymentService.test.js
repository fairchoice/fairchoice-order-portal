import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  applyAllocationsToInvoices,
  buildCustomerTransactionHistory,
  filterRowsForBranchScope,
  summarizeCreditSnapshot,
  summarizeCreditSummaryRows,
  resolveLegacyCompatibilityRows,
  withResolvedBranchScope,
} from "../utils/centralPaymentCalculations.js";
import {
  customerUsesBranchCredit,
  getActiveCustomerBranches,
} from "../utils/customerBranchScope.js";

const serviceSource = fs.readFileSync(
  new URL("./centralPaymentService.js", import.meta.url),
  "utf8"
);
const centralPaymentComponentSource = fs.readFileSync(
  new URL("../pages/AdminSetup/CentralPayment.jsx", import.meta.url),
  "utf8"
);
const customerCreditComponentSource = fs.readFileSync(
  new URL("../pages/AdminSetup/CustomerCredit.jsx", import.meta.url),
  "utf8"
);

function getFunctionSource(name) {
  const start = serviceSource.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);

  const bodyMatch = serviceSource.slice(start).match(/\)\s*\{/);
  assert.ok(bodyMatch, `${name} should have a function body`);
  const openBrace = start + bodyMatch.index + bodyMatch[0].lastIndexOf("{");
  let depth = 0;
  for (let index = openBrace; index < serviceSource.length; index += 1) {
    const char = serviceSource[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return serviceSource.slice(start, index + 1);
  }

  throw new Error(`Could not parse ${name}`);
}

test("legacy payments fill missing history when new invoices exist", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["legacy-payment"]);
});

test("legacy customer_ledger invoice rows are excluded from active Customer Credit", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [
      {
        id: "current-order-invoice",
        invoice_number: "ORD-1784197506132",
        invoice_total: 838.9,
        source: "orders",
      },
    ],
    payments: [],
    legacyInvoices: [
      {
        id: "legacy-invoice",
        invoice_number: "ORD-1784197506132",
        debit: 973.21,
        amount: 973.21,
        invoice_amount: 973.21,
        source: "legacy_customer_ledger",
      },
    ],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.equal(result.invoices.length, 1);
  assert.equal(result.invoices[0].id, "current-order-invoice");
  assert.equal(result.invoices[0].invoice_total, 838.9);
  assert.equal(result.invoices[0].source, "orders");
  assert.deepEqual(result.payments.map((row) => row.id), ["legacy-payment"]);
});

test("equivalent legacy and new records do not duplicate", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-1" }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1" }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["new-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["new-payment"]);
});

test("legacy payment fallback remains available when customer_payments are missing", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "current-invoice", invoice_number: "INV-1", invoice_total: 100 }],
    payments: [],
    legacyInvoices: [{ id: "legacy-invoice", invoice_number: "INV-2", debit: 999 }],
    legacyPayments: [{ id: "legacy-payment", payment_reference: "PAY-1", amount: 25 }],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), ["current-invoice"]);
  assert.deepEqual(result.payments.map((row) => row.id), ["legacy-payment"]);
});

test("customer credit invoice rows prefer current order item totals", () => {
  assert.match(serviceSource, /const getCurrentOrderItemsInvoiceTotal/);
  assert.match(serviceSource, /currentOrderItemsInvoiceTotal \?\?/);
  assert.match(serviceSource, /currentOrderItemsTotalApplied/);
  assert.match(serviceSource, /hydrateOrdersWithFullOrderItems/);

  const loadDeliveredInvoicesSource = getFunctionSource("loadDeliveredInvoices");
  assert.match(loadDeliveredInvoicesSource, /const currentOrderItemsInvoiceTotal = getCurrentOrderItemsInvoiceTotal\(order\)/);
  assert.match(loadDeliveredInvoicesSource, /order_items\(\*\)/);
  assert.match(loadDeliveredInvoicesSource, /invoice_total:\s*invoiceTotal/);
  assert.doesNotMatch(
    loadDeliveredInvoicesSource,
    /invoice_total:\s*savedTotal !== undefined \? Number\(savedTotal\)/
  );
});

test("invoice amendments use current order_items before stale saved totals", () => {
  const loadDeliveredInvoicesSource = getFunctionSource("loadDeliveredInvoices");

  assert.match(
    loadDeliveredInvoicesSource,
    /const invoiceTotal =\s*currentOrderItemsInvoiceTotal \?\?/s
  );
  assert.match(loadDeliveredInvoicesSource, /savedTotal !== undefined/);
  assert.doesNotMatch(
    loadDeliveredInvoicesSource,
    /customer_ledger[\s\S]*invoice_total/
  );
});

test("protected owner payment RPC fails closed without direct browser writes", () => {
  const source = getFunctionSource("createCentralPayment");

  assert.match(source, /supabase\.rpc\("post_owner_central_transaction"/);
  assert.match(source, /Protected Central Payment is not installed/);
  assert.doesNotMatch(source, /\.from\("customer_payments"\)\s*\.\s*insert/);
  assert.doesNotMatch(source, /\.from\("customer_payment_allocations"\)\s*\.\s*insert/);
  assert.doesNotMatch(source, /\.from\("financial_audit_log"\)/);
  assert.doesNotMatch(source, /\.update\(\{\s*status:\s*"VOIDED"/);
});

test("authorization failure from payment posting is surfaced", () => {
  const source = getFunctionSource("createCentralPayment");

  assert.match(source, /if \(isMissingRpcError\(error\)\)/);
  assert.match(source, /throw error;/);
  assert.doesNotMatch(source, /42501.*Central Payment service is unavailable/s);
});

test("missing void_central_payment RPC fails closed without direct updates", () => {
  const source = getFunctionSource("voidCentralPayment");

  assert.match(source, /supabase\.rpc\("void_central_payment"/);
  assert.match(source, /paymentVoidUnavailableMessage/);
  assert.match(serviceSource, /Payment void service is unavailable/);
  assert.doesNotMatch(source, /\.from\("customer_payments"\)/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /financial_audit_log/);
});

test("authorization failure from voiding is surfaced", () => {
  const source = getFunctionSource("voidCentralPayment");

  assert.match(source, /if \(isMissingRpcError\(rpcError\)\)/);
  assert.match(source, /throw rpcError;/);
  assert.doesNotMatch(source, /42501.*Payment void service is unavailable/s);
});

test("applyBranchSeparation remains RPC-only and fails closed when unavailable", () => {
  const source = getFunctionSource("applyBranchSeparation");

  assert.match(source, /supabase\.rpc\("apply_branch_separation"/);
  assert.match(source, /branchSeparationUnavailableMessage/);
  assert.match(serviceSource, /Branch Separation service is unavailable/);
  assert.doesNotMatch(source, /\.from\(/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test("read-only branch preview fallback is marked local and performs no writes", () => {
  const source = getFunctionSource("previewBranchSeparation");

  assert.match(source, /local_read_only_preview:\s*true/);
  assert.match(source, /applyRpcAvailable:\s*false/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test("missing RPC detection does not classify authorization failures as unavailable services", () => {
  assert.match(serviceSource, /code === "42883"/);
  assert.match(serviceSource, /code === "PGRST202"/);
  assert.doesNotMatch(serviceSource, /code === "42501"/);
  assert.doesNotMatch(serviceSource, /code === "PGRST301"/);
});

test("bank confirmation is owner RPC-only and sends allocation preview", () => {
  const source = getFunctionSource("confirmOwnerBankTransfer");

  assert.match(source, /supabase\.rpc\("confirm_owner_bank_transfer"/);
  assert.match(source, /p_owner_username:\s*"nisstaj_admin"/);
  assert.match(source, /p_allocations:\s*preview\.allocations/);
  assert.match(source, /bank verification note is compulsory/i);
  assert.doesNotMatch(source, /\.from\("customer_payments"\).*\.update/s);
  assert.doesNotMatch(source, /\.from\("customer_payment_allocations"\).*\.insert/s);
});

test("remove archives an active payment without physical deletion", () => {
  const source = getFunctionSource("removeCentralPayment");

  assert.match(source, /Archive reason is required/);
  assert.match(source, /status:\s*"VOIDED"/);
  assert.match(source, /removed_at/);
  assert.doesNotMatch(source, /\.delete\(/);
});

test("only nisstaj_admin sees permanent deletion and history does not require owner password", () => {
  const permanentSource = getFunctionSource("permanentlyDeleteCentralPayment");
  const listSource = getFunctionSource("listCentralPaymentRecords");

  assert.match(permanentSource, /requirePermanentDeleteAdmin/);
  assert.match(permanentSource, /permanently_delete_central_payment/);
  assert.doesNotMatch(listSource, /ownerPassword/);
  assert.match(centralPaymentComponentSource, /isOwnerUser\(currentUser\).*Permanent delete/s);
  assert.match(centralPaymentComponentSource, /Payment History/);
  assert.match(centralPaymentComponentSource, /Payment Archive/);
});

test("payment history uses exact-count server pagination with stable 20-row pages", () => {
  const source = getFunctionSource("listCentralPaymentRecords");

  assert.match(source, /const pageSize = 20/);
  assert.match(source, /select\("\*", \{ count: "exact" \}\)/);
  assert.match(source, /\.range\(from, to\)/);
  assert.match(source, /order\("payment_date", \{ ascending: false \}\)/);
  assert.match(source, /order\("created_at", \{ ascending: false \}\)/);
  assert.match(source, /order\("id", \{ ascending: false \}\)/);
  assert.match(source, /customer_account_id/);
  assert.match(source, /customer_branch_id/);
  assert.match(source, /transaction_type/);
});

test("Central Payment is one page with shared owner password", () => {
  assert.match(
    centralPaymentComponentSource,
    /const \[ownerPassword, setOwnerPassword\] = useState\(""\)/
  );
  assert.match(centralPaymentComponentSource, /function PaymentRecordsPanel/);
  assert.match(centralPaymentComponentSource, /function GlobalLedgerPanel/);
  assert.match(centralPaymentComponentSource, /function AllocationPreview/);
  assert.match(centralPaymentComponentSource, /function ManualPaymentPanel/);
  assert.match(centralPaymentComponentSource, /export default function CentralPayment/);
  assert.doesNotMatch(centralPaymentComponentSource, /from "\.\/CentralPaymentCore"/);
  assert.doesNotMatch(centralPaymentComponentSource, /from "\.\/GlobalFinancialLedger"/);
  assert.doesNotMatch(centralPaymentComponentSource, /form\.ownerPassword/);
  assert.doesNotMatch(
    centralPaymentComponentSource,
    /ownerPassword:\s*""/
  );
});

test("voided payment disappears from active totals and history", () => {
  const payments = [
    { id: "valid-payment", amount: 100, status: "POSTED", payment_date: "2026-01-02" },
    { id: "deleted-payment", amount: 50, status: "VOIDED", payment_date: "2026-01-03" },
    { id: "soft-deleted-payment", amount: 25, status: "DELETED", payment_date: "2026-01-04" },
  ];
  const summary = summarizeCreditSnapshot({
    openingBalance: 0,
    invoices: [{ invoice_number: "INV-1", invoice_total: 200 }],
    payments,
  });
  const history = buildCustomerTransactionHistory({
    invoices: [{ invoice_number: "INV-1", invoice_total: 200 }],
    payments,
    newestFirst: false,
  });

  assert.equal(summary.paymentTotal, 100);
  assert.equal(summary.outstanding, 100);
  assert.deepEqual(
    history.filter((row) => row.type === "PAYMENT").map((row) => row.reference),
    ["valid-payment"]
  );
});

test("voided allocation recalculates FIFO status and invoice remains unchanged", () => {
  const invoices = [{ id: "invoice-1", invoice_number: "INV-1", invoice_total: 100 }];
  const allocated = applyAllocationsToInvoices(invoices, [
    {
      payment_id: "deleted-payment",
      invoice_reference: "INV-1",
      allocated_amount: 100,
      status: "void",
    },
  ]);

  assert.equal(allocated[0].invoiceAmount, 100);
  assert.equal(allocated[0].paidAmount, 0);
  assert.equal(allocated[0].remainingAmount, 100);
  assert.equal(allocated[0].paymentStatus, "UNPAID");
});

test("deleting one duplicate leaves the valid payment", () => {
  const payments = [
    { id: "duplicate-valid", amount: 75, status: "POSTED" },
    { id: "duplicate-deleted", amount: 75, status: "VOIDED" },
  ];
  const summary = summarizeCreditSnapshot({
    invoices: [{ invoice_number: "INV-1", invoice_total: 150 }],
    payments,
  });

  assert.equal(summary.paymentTotal, 75);
  assert.equal(summary.outstanding, 75);
});

test("double-submit cannot create duplicate owner payments", () => {
  const source = getFunctionSource("createCentralPayment");

  assert.match(source, /createPaymentIdempotencyKey/);
  assert.match(source, /activeDuplicate/);
  assert.match(centralPaymentComponentSource, /if \(saving\) return/);
  assert.match(centralPaymentComponentSource, /disabled=\{\s*saving/s);
});

test("Penarth does not show Life Style payments", () => {
  const branches = [
    { id: "penarth", branch_name: "3S Penarth Store" },
    { id: "life", branch_name: "3s Life Style" },
  ];
  const payments = withResolvedBranchScope(
    [
      { id: "pay-penarth", branch_name: "3S Penarth Store", amount: 10 },
      { id: "pay-life", branch_name: "3S Life Style", amount: 20 },
    ],
    branches
  );

  assert.deepEqual(
    filterRowsForBranchScope(payments, "penarth").map((row) => row.id),
    ["pay-penarth"]
  );
});

test("no active branches uses main account scope without branch selection", () => {
  const scopedRows = withResolvedBranchScope(
    [
      { id: "main-invoice", invoice_number: "INV-MAIN", invoice_total: 100 },
      { id: "main-payment", payment_reference: "PAY-MAIN", amount: 40 },
    ],
    []
  );

  assert.deepEqual(
    filterRowsForBranchScope(scopedRows, "").map((row) => row.id),
    ["main-invoice", "main-payment"]
  );
  assert.match(centralPaymentComponentSource, /const hasBranches = branches\.length > 0/);
  assert.match(centralPaymentComponentSource, /hasBranches && selectedBranchId === BRANCH_SELECT/);
  assert.match(centralPaymentComponentSource, /setSelectedBranchId\(""\)/);
  assert.match(centralPaymentComponentSource, /Manual Payment/);
  assert.match(centralPaymentComponentSource, /Select branch/);
  assert.match(customerCreditComponentSource, /Branch Credit: \{hasBranches \? "ON" : "OFF"\}/);
  assert.match(customerCreditComponentSource, /Financial scope:/);
  assert.match(customerCreditComponentSource, /Main Customer Account/);
});

test("active branches require explicit selected-branch scope", () => {
  const branches = [
    { id: "penarth", branch_name: "3S Penarth Store" },
    { id: "life", branch_name: "3S Life Style" },
  ];
  const invoices = withResolvedBranchScope(
    [
      { id: "inv-penarth", branch_name: "3S Penarth Store", invoice_total: 100 },
      { id: "inv-life", branch_name: "3S Life Style", invoice_total: 200 },
    ],
    branches
  );
  const payments = withResolvedBranchScope(
    [
      { id: "pay-penarth", branch_name: "3S Penarth Store", amount: 50 },
      { id: "pay-life", branch_name: "3S Life Style", amount: 75 },
    ],
    branches
  );

  assert.deepEqual(
    filterRowsForBranchScope(invoices, "penarth").map((row) => row.id),
    ["inv-penarth"]
  );
  assert.deepEqual(
    filterRowsForBranchScope(payments, "penarth").map((row) => row.id),
    ["pay-penarth"]
  );
  assert.match(centralPaymentComponentSource, /setSelectedBranchId\(BRANCH_SELECT\)/);
  assert.match(centralPaymentComponentSource, /branchSelectionRequired/);
  assert.match(centralPaymentComponentSource, /Select branch/);
  assert.match(customerCreditComponentSource, /hasBranches && selectedBranchId === MAIN_ACCOUNT/);
  assert.match(customerCreditComponentSource, /setSelectedBranchId\(MAIN_ACCOUNT\)/);
  assert.match(customerCreditComponentSource, /Main Customer Account/);
});

test("shared active branch utility excludes inactive branch markers", () => {
  const customer = {
    id: "customer-1",
    customer_branches: [
      { id: "active", customer_account_id: "customer-1", branch_name: "Active" },
      { id: "inactive", customer_account_id: "customer-1", branch_name: "Inactive", active: false },
      { id: "disabled", customer_account_id: "customer-1", branch_name: "Disabled", disabled: true },
      { id: "archived", customer_account_id: "customer-1", branch_name: "Archived", archived: true },
      { id: "deleted", customer_account_id: "customer-1", branch_name: "Deleted", deleted: true },
      { id: "status", customer_account_id: "customer-1", branch_name: "Status", status: "inactive" },
      { id: "other", customer_account_id: "customer-2", branch_name: "Other customer" },
    ],
  };

  assert.deepEqual(
    getActiveCustomerBranches(customer).map((branch) => branch.id),
    ["active"]
  );
  assert.equal(customerUsesBranchCredit(customer), true);
  assert.equal(customerUsesBranchCredit({ customer_branches: [] }), false);
});

test("central snapshot exposes branch summaries for Customer Credit Summary", () => {
  const source = getFunctionSource("loadCentralPaymentSnapshot");

  assert.match(source, /const branchSummaries = branches\.map/);
  assert.match(source, /filterRowsForBranchScope\(invoices, branchId\)/);
  assert.match(source, /summarizeCreditSnapshot\(\{/);
  assert.match(source, /branchSummaries,/);
  assert.match(source, /difference:\s*money\(customerSummary\.outstanding - branchOutstandingTotal\)/);
  assert.match(customerCreditComponentSource, /Total Outstanding/);
  assert.match(customerCreditComponentSource, /snapshot\?\.branchSummaries/);
  assert.match(customerCreditComponentSource, /Branch Outstanding/);
});

test("Life Style does not show Penarth invoices", () => {
  const branches = [
    { id: "penarth", branch_name: "3S Penarth Store" },
    { id: "life", branch_name: "3s Life Style" },
  ];
  const invoices = withResolvedBranchScope(
    [
      { id: "inv-penarth", branch_name: "3S Penarth Store", invoice_total: 100 },
      { id: "inv-life", branch_name: "3S Life Style", invoice_total: 200 },
    ],
    branches
  );

  assert.deepEqual(
    filterRowsForBranchScope(invoices, "life").map((row) => row.id),
    ["inv-life"]
  );
});

test("outstanding uses opening plus current invoices minus posted payments", () => {
  const summary = summarizeCreditSnapshot({
    openingBalance: 1529.93,
    invoices: [
      { invoice_number: "ORD-CURRENT-1", invoice_total: 2000 },
      { invoice_number: "ORD-CURRENT-2", invoice_total: 1160.14 },
    ],
    payments: [{ payment_reference: "PAY-1", amount: 2928.9 }],
  });

  assert.equal(summary.invoiceTotal, 3160.14);
  assert.equal(summary.paymentTotal, 2928.9);
  assert.equal(summary.outstanding, 1761.17);
});

test("customer total is exactly the sum of branch and unassigned summaries", () => {
  const summaries = [
    summarizeCreditSnapshot({
      openingBalance: 100,
      invoices: [{ invoice_total: 250 }],
      payments: [{ amount: 80 }],
    }),
    summarizeCreditSnapshot({
      openingBalance: -25,
      invoices: [{ invoice_total: 40 }],
      payments: [{ amount: -10 }],
    }),
    summarizeCreditSnapshot({ openingBalance: 15 }),
  ];
  const customer = summarizeCreditSummaryRows({ creditLimit: 1000, summaries });

  assert.equal(customer.outstanding, 290);
  assert.equal(
    customer.outstanding,
    summaries.reduce((sum, branch) => sum + branch.outstanding, 0)
  );
  assert.equal(customer.availableCredit, 710);
});

test("customer order account summaries use the canonical credit snapshot", () => {
  const customerOrderSource = fs.readFileSync(
    new URL("../pages/CustomerOrder.jsx", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(customerOrderSource, /loadCustomerOutstandingSnapshot/);
  assert.match(customerOrderSource, /loadReadOnlyCustomerCreditSnapshot/);
  assert.match(customerOrderSource, /selectedSnapshot\.branchSummaries/);
  assert.doesNotMatch(customerOrderSource, /const branchSnapshots = await Promise\.all/);
});

test("All branches contains current invoices and unique fallback payments exactly once", () => {
  const result = resolveLegacyCompatibilityRows({
    invoices: [{ id: "new-invoice", invoice_number: "INV-1" }],
    payments: [{ id: "new-payment", payment_reference: "PAY-1" }],
    legacyInvoices: [
      { id: "legacy-duplicate-invoice", invoice_number: "INV-1" },
      { id: "legacy-missing-invoice", invoice_number: "INV-2" },
    ],
    legacyPayments: [
      { id: "legacy-duplicate-payment", payment_reference: "PAY-1" },
      { id: "legacy-missing-payment", payment_reference: "PAY-2" },
    ],
  });

  assert.deepEqual(result.invoices.map((row) => row.id), [
    "new-invoice",
  ]);
  assert.deepEqual(result.payments.map((row) => row.id), [
    "new-payment",
    "legacy-missing-payment",
  ]);
});

test("branch opening balances save and reload independently", () => {
  const componentSource = fs.readFileSync(
    new URL("../pages/AdminSetup/CustomerCredit.jsx", import.meta.url),
    "utf8"
  );

  assert.match(componentSource, /\.from\("customer_branch_opening_balances"\)/);
  assert.match(componentSource, /customer_branch_id:\s*openingBranchId/);
  assert.match(componentSource, /lookup\.eq\("customer_branch_id", openingBranchId\)/);
  assert.match(componentSource, /lookup\.is\("customer_branch_id", null\)/);
  assert.doesNotMatch(componentSource, /\.from\("customer_opening_balances"\)/);
});

test("running balances do not include other branch activity", () => {
  const branches = [
    { id: "penarth", branch_name: "3S Penarth Store" },
    { id: "life", branch_name: "3s Life Style" },
  ];
  const invoices = filterRowsForBranchScope(
    withResolvedBranchScope(
      [
        {
          id: "inv-penarth",
          branch_name: "3S Penarth Store",
          invoice_number: "INV-P",
          invoice_total: 50,
          invoice_date: "2026-01-02",
        },
        {
          id: "inv-life",
          branch_name: "3S Life Style",
          invoice_number: "INV-L",
          invoice_total: 200,
          invoice_date: "2026-01-03",
        },
      ],
      branches
    ),
    "penarth"
  );
  const payments = filterRowsForBranchScope(
    withResolvedBranchScope(
      [
        {
          id: "pay-life",
          branch_name: "3S Life Style",
          payment_reference: "PAY-L",
          amount: 25,
          payment_date: "2026-01-04",
        },
      ],
      branches
    ),
    "penarth"
  );

  const history = buildCustomerTransactionHistory({
    openingBalance: 100,
    invoices,
    payments,
    newestFirst: false,
  });

  assert.deepEqual(
    history.map((row) => [row.reference, row.runningBalance]),
    [
      ["Opening Balance", 100],
      ["INV-P", 150],
    ]
  );
});
