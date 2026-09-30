import { supabase } from "./supabase";

export async function saveHandover(data) {
  const payload = {
    collector_staff_id: data.collectorStaffId || null,
    collector_type: data.collectorType,
    collector_name: data.collectorName,

    handover_date: data.handoverDate,
    period_start: data.periodStart,
    period_end: data.periodEnd,

    system_collection: Number(data.systemCollection || 0),
    cash_received: Number(data.cashReceived || 0),
    difference: Number(data.difference || 0),
    reason: data.reason || "",
  };

  const { data: result, error } = await supabase
    .from("driver_handovers")
    .insert([payload])
    .select()
    .single();

  if (error) {
    console.error("SUPABASE HANDOVER INSERT ERROR:", error);
    throw error;
  }

  return result;
}

export async function getHandoverHistory() {
  const { data, error } = await supabase
    .from("driver_handovers")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}
