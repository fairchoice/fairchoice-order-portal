import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";
import { collectorOptionMatchesRow } from "./weeklyAccountCollectors.js";
import { supabase } from "./supabase.js";

const normalizeTotal = (row = {}) => ({
  ...row,
  approved_expense_total: Number(row.approved_expense_total || 0),
});

export function approvedExpenseTotalForCollector(rows = [], collectorOption) {
  if (!collectorOption) return 0;
  return rows
    .filter((row) => collectorOptionMatchesRow(collectorOption, row))
    .reduce((sum, row) => sum + Number(row.approved_expense_total || 0), 0);
}

export async function loadWeeklyApprovedCashExpenseTotals(
  currentUser = {},
  { periodStart = null, periodEnd = null } = {},
) {
  let session = getFcSessionState(currentUser);
  if (!session.valid) session = getFcSessionState(readStoredFcProfile());
  if (!session.valid) {
    throw new Error(
      "A valid FC login session is required to load approved cash expenses.",
    );
  }

  const { data, error } = await supabase.rpc(
    "fc_weekly_account_approved_cash_expense_totals_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_period_start: periodStart || null,
      p_period_end: periodEnd || null,
    },
  );
  if (error) throw error;
  return (data || []).map(normalizeTotal);
}
