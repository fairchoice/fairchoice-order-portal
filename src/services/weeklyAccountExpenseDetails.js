import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";
import { supabase } from "./supabase.js";

export function normalizeApprovedExpenseDetail(row = {}) {
  return {
    ...row,
    amount: Number(row.amount || 0),
    is_legacy_compatibility: Boolean(row.is_legacy_compatibility),
  };
}

export function sumApprovedExpenseDetails(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
}

const normalizeSearchValue = (value) =>
  String(value || "").trim().toLocaleLowerCase("en-GB");

export function filterAndSortApprovedExpenseDetails(
  rows = [],
  { search = "", sortKey = "date", sortDirection = "desc" } = {},
) {
  const term = normalizeSearchValue(search);
  const filtered = term
    ? rows.filter((row) =>
        [
          row.payout_reference,
          row.supplier_name,
          row.expense_type_name,
          row.approved_by_name,
        ].some((value) => normalizeSearchValue(value).includes(term)),
      )
    : [...rows];

  const valueFor = (row) => {
    if (sortKey === "amount") return Number(row.amount || 0);
    if (sortKey === "supplier") return normalizeSearchValue(row.supplier_name);
    if (sortKey === "type") return normalizeSearchValue(row.expense_type_name);
    return new Date(row.payout_date || row.approved_at || 0).getTime();
  };
  const multiplier = sortDirection === "asc" ? 1 : -1;

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftValue = valueFor(left.row);
      const rightValue = valueFor(right.row);
      const comparison =
        typeof leftValue === "number"
          ? leftValue - rightValue
          : leftValue.localeCompare(rightValue, "en-GB");
      return comparison === 0
        ? left.index - right.index
        : comparison * multiplier;
    })
    .map(({ row }) => row);
}

export async function loadWeeklyApprovedCashExpenseDetails(
  currentUser = {},
  { collectorStaffId, periodStart = null, periodEnd = null } = {},
) {
  if (!collectorStaffId) return [];

  let session = getFcSessionState(currentUser);
  if (!session.valid) session = getFcSessionState(readStoredFcProfile());
  if (!session.valid) {
    throw new Error(
      "A valid FC login session is required to load approved expense details.",
    );
  }

  const { data, error } = await supabase.rpc(
    "fc_weekly_account_approved_cash_expense_details_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_collector_staff_id: collectorStaffId,
      p_period_start: periodStart || null,
      p_period_end: periodEnd || null,
    },
  );
  if (error) throw error;
  return (data || []).map(normalizeApprovedExpenseDetail);
}
