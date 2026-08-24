import { getFcSessionState } from "./fcSession.js";
import { supabase } from "./supabase.js";

const normalizeDate = (value) => (value ? String(value).slice(0, 10) : null);

export async function loadProfitAnalysis(user, filters = {}) {
  const session = getFcSessionState(user);
  if (!session.valid) throw new Error("A valid Fair Choice staff session is required.");

  const { data, error } = await supabase.rpc("fc_profit_analysis_v2", {
    p_username: session.username,
    p_session_token: session.token,
    p_date_from: normalizeDate(filters.dateFrom),
    p_date_to: normalizeDate(filters.dateTo),
    p_country: filters.country && filters.country !== "All" ? filters.country : null,
    p_customer: String(filters.customer || "").trim() || null,
    p_product: String(filters.product || "").trim() || null,
    p_price_mode: filters.priceMode && filters.priceMode !== "All" ? filters.priceMode : null,
  });

  if (error) throw error;
  return data || {};
}
