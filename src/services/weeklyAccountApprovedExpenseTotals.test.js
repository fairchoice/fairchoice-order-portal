import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  calculateWeeklyHandoverAmounts,
} from "./weeklyAccountPayments.js";
import {
  approvedExpenseTotalForCollector,
} from "./weeklyAccountExpenseTotals.js";
import { buildCollectorOptions } from "./weeklyAccountCollectors.js";

const DRIVER_A = "11111111-1111-4111-8111-111111111111";
const DRIVER_B = "22222222-2222-4222-8222-222222222222";
const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260731130000_weekly_account_approved_cash_expense_totals.sql",
    import.meta.url,
  ),
  "utf8",
);
const weeklyAccountPage = fs.readFileSync(
  new URL("../pages/AdminSetup/WeeklyAccount.jsx", import.meta.url),
  "utf8",
);
const totalsService = fs.readFileSync(
  new URL("./weeklyAccountExpenseTotals.js", import.meta.url),
  "utf8",
);

const [driverA, driverB] = buildCollectorOptions([
  {
    staff_id: DRIVER_A,
    staff_name: "Driver A",
    username: "driver_a",
    collector_type: "Driver",
  },
  {
    staff_id: DRIVER_B,
    staff_name: "Driver B",
    username: "driver_b",
    collector_type: "Driver",
  },
]);

test("handover balance subtracts approved expenses and existing handovers", () => {
  assert.deepEqual(
    calculateWeeklyHandoverAmounts({
      cashCollected: 1000,
      approvedExpenses: 150,
      cashHandedOver: 600,
      cashReceived: 250,
    }),
    { amountDue: 250, difference: 0 },
  );
});

test("grouped totals use stable staff UUID and never cross collectors", () => {
  const totals = [
    {
      collector_staff_id: DRIVER_A,
      collector_type: "Driver",
      collector_name: "driver_a",
      approved_expense_total: 100,
    },
    {
      collector_staff_id: DRIVER_B,
      collector_type: "Driver",
      collector_name: "Driver A",
      approved_expense_total: 75,
    },
  ];

  assert.equal(approvedExpenseTotalForCollector(totals, driverA), 100);
  assert.equal(approvedExpenseTotalForCollector(totals, driverB), 75);
});

test("historical name-only totals retain normalized-name fallback", () => {
  assert.equal(
    approvedExpenseTotalForCollector(
      [
        {
          collector_staff_id: null,
          collector_type: "Driver",
          collector_name: "DRIVER_A",
          approved_expense_total: 40,
        },
      ],
      driverA,
    ),
    40,
  );
});

test("RPC includes only posted cash paid from collected cash", () => {
  assert.match(migration, /bp\.status = 'POSTED'/);
  assert.match(
    migration,
    /bp\.payment_method = 'Cash'/,
  );
  assert.match(migration, /bp\.paid_by_staff_id is not null/);
  assert.match(
    migration,
    /upper\(trim\(coalesce\(bp\.paid_by_type, ''\)\)\) in \([\s\S]*'STAFF'[\s\S]*'MY COLLECTED CASH'/,
  );
  assert.match(migration, /sce\.status = 'APPROVED'/);
  assert.match(migration, /sce\.paid_by_staff_id = bp\.paid_by_staff_id/);
});

test("RPC is transactional, permission checked, and narrowly executable", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /perform public\.fc_require_session_permission\([\s\S]*'access_accounts'/);
  assert.match(migration, /language plpgsql[\s\S]*security definer[\s\S]*set search_path = public/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to anon, authenticated/);
  assert.match(migration, /commit;\s*$/);
});

test("business funds, bank transfers, and voided expenses cannot enter totals", () => {
  assert.doesNotMatch(
    migration.match(/upper\(trim\(coalesce\(bp\.paid_by_type[\s\S]*?\n {6}\)/)?.[0] || "",
    /BUSINESS|COMPANY/,
  );
  assert.doesNotMatch(migration, /payment_method[^\n]*bank transfer/i);
  assert.doesNotMatch(migration, /bp\.status\s+in\s*\([^)]*VOIDED/i);
  assert.doesNotMatch(migration, /sce\.status\s+in\s*\([^)]*VOIDED/i);
});

test("void and collector separation are enforced by source status and SQL grouping", () => {
  assert.match(
    migration,
    /group by[\s\S]*ee\.effect_staff_id[\s\S]*ee\.effect_collector_type[\s\S]*ee\.effect_collector_name/,
  );
  assert.match(migration, /bp\.status = 'POSTED'/);
  assert.match(migration, /sce\.status = 'APPROVED'/);
});

test("Weekly Account loads grouped totals instead of all expense rows", () => {
  assert.match(
    weeklyAccountPage,
    /loadWeeklyApprovedCashExpenseTotals\(currentUser \|\| getLoggedInUser\(\)\)/,
  );
  assert.doesNotMatch(weeklyAccountPage, /loadStaffCashExpenses/);
  assert.doesNotMatch(weeklyAccountPage, /from\(["']staff_cash_expenses["']\)/);
  assert.match(
    weeklyAccountPage,
    /cashCollected: selectedCashCollected,[\s\S]*approvedExpenses: selectedApprovedExpenses,[\s\S]*cashHandedOver: selectedCashHandedOver/,
  );
  assert.match(
    totalsService,
    /fc_weekly_account_approved_cash_expense_totals_v1/,
  );
  assert.match(totalsService, /p_period_start: periodStart \|\| null/);
  assert.match(totalsService, /p_period_end: periodEnd \|\| null/);
});

test("legacy unlinked approved rows remain available without invented IDs", () => {
  assert.match(migration, /sce\.business_payout_id is null/);
  assert.match(migration, /sce\.status = 'APPROVED'/);
  assert.doesNotMatch(migration, /update\s+public\.staff_cash_expenses/i);
});
