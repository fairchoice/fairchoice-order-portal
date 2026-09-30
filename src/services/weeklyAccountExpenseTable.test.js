import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  filterAndSortApprovedExpenseDetails,
  sumApprovedExpenseDetails,
} from "./weeklyAccountExpenseDetails.js";

const page = fs.readFileSync(
  new URL("../pages/AdminSetup/WeeklyAccount.jsx", import.meta.url),
  "utf8",
);

const row = (overrides = {}) => ({
  business_payout_id: "11111111-1111-4111-8111-111111111111",
  weekly_effect_id: "22222222-2222-4222-8222-222222222222",
  payout_reference: "E-260731-A7",
  payout_date: "2026-07-31",
  amount: 100,
  expense_type_name: "Supplier Payment",
  supplier_name: "A to Z Drink Limited",
  payment_method: "Cash",
  approved_at: "2026-07-31T21:47:00Z",
  approved_by_name: "Nisstaj",
  weekly_effect_status: "APPROVED",
  ...overrides,
});

test("one approved expense renders the final single-line columns and detail fields", () => {
  for (const heading of ["Date", "Reference", "Amount", "Type", "Supplier", "Method", "Approved", "Approved By"]) {
    assert.match(page, new RegExp(`(?:label=|>)["']?${heading}`));
  }
  for (const label of ["Paid from", "Description", "Receipt reference", "Status"]) {
    assert.match(page, new RegExp(`label="${label}"`));
  }
  assert.match(page, /ApprovedExpenseTableRow/);
  assert.doesNotMatch(page, /const renderRow = \(row\) => <article/);
});

test("50+ rows remain searchable, sortable, and pageable", () => {
  const rows = Array.from({ length: 60 }, (_, index) =>
    row({
      weekly_effect_id: `effect-${index}`,
      payout_reference: `E-260731-${String(index).padStart(2, "0")}`,
      amount: 60 - index,
      supplier_name: index % 2 ? "Beta Supplier" : "Alpha Supplier",
      expense_type_name: index % 3 ? "Fuel" : "Supplier Payment",
      approved_by_name: index % 5 ? "Nisstaj" : "Another Approver",
    }),
  );
  assert.equal(filterAndSortApprovedExpenseDetails(rows, { search: "another approver" }).length, 12);
  assert.equal(filterAndSortApprovedExpenseDetails(rows, { search: "supplier payment" }).length, 20);
  assert.equal(filterAndSortApprovedExpenseDetails(rows, { search: "beta supplier" }).length, 30);
  assert.equal(filterAndSortApprovedExpenseDetails(rows, { sortKey: "amount", sortDirection: "asc" })[0].amount, 1);
  assert.equal(filterAndSortApprovedExpenseDetails(rows, { sortKey: "supplier", sortDirection: "asc" })[0].supplier_name, "Alpha Supplier");
  assert.match(page, /\[10, 25, 50, 100\]/);
  assert.match(page, /filteredRows\.slice/);
  assert.match(page, /Previous/);
  assert.match(page, /Next/);
});

test("sticky header, scroll container, footer count, total, and warning render", () => {
  assert.match(page, /max-h-96 overflow-auto/);
  assert.match(page, /sticky top-0/);
  assert.match(page, /Approved Expense Count: \{rows\.length\}/);
  assert.match(page, /Total Approved Expenses: \{money\(total\)\}/);
  assert.match(page, /Warning: the approved-expense detail total does not match the handover summary/);
  assert.equal(sumApprovedExpenseDetails([row(), row({ amount: 25.5 })]), 125.5);
});

test("legacy rows remain safe and empty state remains available", () => {
  assert.match(page, /row\.is_legacy_compatibility/);
  assert.match(page, /Legacy compatibility entry/);
  assert.match(page, /No approved expenses/);
});

test("backend remains the source for void, date, and collector filtering", () => {
  assert.match(page, /loadWeeklyApprovedCashExpenseDetails/);
  assert.match(page, /collectorStaffId/);
  assert.match(page, /periodStart: startDate \|\| null/);
  assert.match(page, /periodEnd: endDate \|\| null/);
  assert.match(page, /selectedApprovedExpenses = approvedExpenseDetailTotal/);
});
