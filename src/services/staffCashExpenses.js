import { supabase } from "./supabase";

const normalizeExpense = (row = {}) => ({
  ...row,
  amount: Number(row.amount || 0),
  collector_type: row.collector_type || "Driver",
  collector_name: row.collector_name || "",
  collector_staff_id: row.collector_staff_id || row.paid_by_staff_id || null,
  expense_date: row.expense_date || row.created_at,
  status: String(row.status || "APPROVED").toUpperCase(),
});

export async function loadStaffCashExpenses() {
  const { data, error } = await supabase
    .from("staff_cash_expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []).map(normalizeExpense);
}

export async function saveStaffCashExpense(input) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error("Expense amount must be greater than zero.");
  if (!String(input.collectorName || "").trim()) {
    throw new Error("Please select the driver or sales representative.");
  }
  if (!String(input.reason || "").trim()) {
    throw new Error("Please enter the expense reason.");
  }

  const payload = {
    paid_by_staff_id: input.collectorStaffId || null,
    collector_type: input.collectorType,
    collector_name: String(input.collectorName).trim(),
    expense_date: input.expenseDate,
    amount,
    category: String(input.category || "Other").trim(),
    reason: String(input.reason).trim(),
    reference: String(input.reference || "").trim() || null,
    status: String(input.status || "APPROVED").toUpperCase(),
    notes: String(input.notes || "").trim() || null,
    created_by: String(input.createdBy || "").trim() || null,
    approved_by:
      String(input.status || "APPROVED").toUpperCase() === "APPROVED"
        ? String(input.approvedBy || input.createdBy || "").trim() || null
        : null,
    approved_at:
      String(input.status || "APPROVED").toUpperCase() === "APPROVED"
        ? new Date().toISOString()
        : null,
  };

  const { data, error } = await supabase
    .from("staff_cash_expenses")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return normalizeExpense(data);
}

export async function updateStaffCashExpenseStatus(id, status, actor = "") {
  const normalizedStatus = String(status || "").toUpperCase();
  if (!["PENDING", "APPROVED", "REJECTED", "VOIDED"].includes(normalizedStatus)) {
    throw new Error("Invalid expense status.");
  }

  const update = {
    status: normalizedStatus,
    approved_by: normalizedStatus === "APPROVED" ? actor || null : null,
    approved_at: normalizedStatus === "APPROVED" ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("staff_cash_expenses")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return normalizeExpense(data);
}
