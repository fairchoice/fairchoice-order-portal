import { supabase } from "../../services/supabase";
import { getFcSessionState } from "../../services/fcSession";
import { buildPromotionRunRecords } from "./promotionRunInventory";

const text = (value) => String(value || "").trim();

export const persistPromotionRunForOrder = async ({
  orderNumber = "",
  cart = [],
  customer = null,
  branch = null,
  actor = null,
  audienceType = "all",
  country = "",
  profile = null,
} = {}) => {
  const cleanOrderNumber = text(orderNumber);
  if (!cleanOrderNumber) {
    return { recorded: 0, skipped: true, reason: "missing_order_number" };
  }

  const records = buildPromotionRunRecords({
    cart,
    orderNumber: cleanOrderNumber,
    customer,
    branch,
    actor,
    audienceType,
    country,
  });

  if (!records.length) {
    return { recorded: 0, skipped: true, reason: "no_promotion_run" };
  }

  if (!supabase) {
    return { recorded: 0, skipped: true, reason: "supabase_not_configured" };
  }

  const session = getFcSessionState(profile || actor || {});
  if (!session.valid) {
    return { recorded: 0, skipped: true, reason: "fc_session_unavailable" };
  }

  const { data, error } = await supabase.rpc("fc_record_promotion_runs_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_order_number: cleanOrderNumber,
    p_records: records,
  });

  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  return {
    recorded: Number(result?.recorded_count ?? result?.inserted_count ?? records.length),
    skipped: false,
  };
};
