import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  normalizeApprovedExpenseDetail,
  sumApprovedExpenseDetails,
} from "./weeklyAccountExpenseDetails.js";

const migration = fs.readFileSync(
  new URL(
    "../../supabase/migrations/20260801080000_weekly_account_approved_expense_details.sql",
    import.meta.url,
  ),
  "utf8",
);
const page = fs.readFileSync(
  new URL("../pages/AdminSetup/WeeklyAccount.jsx", import.meta.url),
  "utf8",
);
const service = fs.readFileSync(
  new URL("./weeklyAccountExpenseDetails.js", import.meta.url),
  "utf8",
);

test("one approved Supplier Payment retains its drill-down fields", () => {
  const detail = normalizeApprovedExpenseDetail({
    business_payout_id: "11111111-1111-4111-8111-111111111111",
    payout_reference: "E-260731-UMNUW4",
    expense_type_name: "Supplier Payment",
    supplier_name: "A to Z Drink Limited",
    payment_method: "Cash",
    amount: "100.00",
    approved_by_name: "Nisstaj",
    weekly_effect_status: "APPROVED",
  });

  assert.equal(detail.amount, 100);
  assert.equal(detail.supplier_name, "A to Z Drink Limited");
  assert.equal(detail.approved_by_name, "Nisstaj");
  assert.equal(detail.is_legacy_compatibility, false);
});

test("multiple detail rows sum to the exact displayed expense total", () => {
  assert.equal(
    sumApprovedExpenseDetails([
      { amount: 100 },
      { amount: "25.50" },
      { amount: 4.5 },
    ]),
    130,
  );
  assert.match(
    page,
    /const approvedExpenseDetailTotal = sumApprovedExpenseDetails\([\s\S]*approvedExpenseDetails[\s\S]*const selectedApprovedExpenses = approvedExpenseDetailTotal/,
  );
});

test("canonical query applies every approved collector-cash rule", () => {
  assert.match(migration, /bp\.status = 'POSTED'/);
  assert.match(migration, /bp\.payment_method = 'Cash'/);
  assert.match(migration, /bp\.paid_by_staff_id = p_collector_staff_id/);
  assert.match(
    migration,
    /upper\(trim\(coalesce\(bp\.paid_by_type, ''\)\)\) in \([\s\S]*'STAFF'[\s\S]*'MY COLLECTED CASH'/,
  );
  assert.match(migration, /sce\.status = 'APPROVED'/);
  assert.match(migration, /sce\.paid_by_staff_id = bp\.paid_by_staff_id/);
});

test("Business funds, bank transfer, and non-posted or voided rows are excluded", () => {
  const canonical = migration.match(/with canonical_details as \([\s\S]*?\n {2}\),/)?.[0] || "";
  assert.doesNotMatch(canonical, /'BUSINESS'|'COMPANY'/);
  assert.doesNotMatch(canonical, /Bank Transfer|Card/);
  assert.doesNotMatch(canonical, /SUBMITTED|REJECTED|VOIDED/);
  assert.match(canonical, /bp\.status = 'POSTED'/);
  assert.match(canonical, /sce\.status = 'APPROVED'/);
});

test("date range is inclusive and scoped to the selected collector", () => {
  assert.match(migration, /bp\.payout_date >= p_period_start/);
  assert.match(migration, /bp\.payout_date <= p_period_end/);
  assert.match(migration, /sce\.expense_date >= p_period_start/);
  assert.match(migration, /sce\.expense_date <= p_period_end/);
  assert.match(service, /p_collector_staff_id: collectorStaffId/);
  assert.match(service, /p_period_start: periodStart \|\| null/);
  assert.match(service, /p_period_end: periodEnd \|\| null/);
});

test("supplier and approved-by identities use stable joins", () => {
  assert.match(migration, /left join public\.suppliers supplier[\s\S]*supplier\.id = bp\.supplier_id/);
  assert.match(migration, /left join public\.staff_users approver[\s\S]*approver\.id = bp\.approved_by_staff_id/);
  assert.match(migration, /coalesce\(approver\.staff_name, sce\.approved_by\)/);
  assert.match(page, /row\.supplier_name \|\| "Not applicable"/);
  assert.match(page, /row\.approved_by_name \|\| "Not recorded"/);
});

test("legacy compatibility details expose only recorded fields", () => {
  assert.match(migration, /sce\.business_payout_id is null/);
  assert.match(migration, /null::uuid,[\s\S]*sce\.reference,[\s\S]*sce\.expense_date/);
  assert.match(page, /Legacy compatibility entry/);
  assert.match(page, /no linked business payout or supplier details are inferred/);
});

test("drill-down defaults collapsed and exposes loading, empty, totals, and warning states", () => {
  assert.match(page, /approvedExpensesExpanded, setApprovedExpensesExpanded\] = useState\(false\)/);
  assert.match(page, /expanded \? "▲" : "▼"/);
  assert.match(page, /Loading approved expenses\.\.\./);
  assert.match(page, /No approved expenses/);
  assert.match(page, /Total Approved Expenses/);
  assert.match(page, /detail total does not match the handover summary/);
  assert.match(page, /aria-expanded=\{expanded\}/);
});

test("voided effects disappear and normal page loading refreshes both summary and details", () => {
  assert.match(migration, /bp\.status = 'POSTED'/);
  assert.match(migration, /sce\.status = 'APPROVED'/);
  assert.match(
    page,
    /loadWeeklyApprovedCashExpenseDetails\(\s*currentUser \|\| getLoggedInUser\(\)/,
  );
  assert.match(page, /selectedApprovedExpenses = approvedExpenseDetailTotal/);
});

test("RPC is session protected and narrowly granted", () => {
  assert.match(migration, /fc_require_session_permission\([\s\S]*'access_accounts'/);
  assert.match(migration, /security definer[\s\S]*set search_path = public/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to anon, authenticated/);
});
