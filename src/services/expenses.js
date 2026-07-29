import { supabase } from "./supabase";

export const PAYMENT_TYPES = ["Cash", "Card", "Bank Transfer", "Cheque", "Other"];
export const PAYOUT_STATUSES = ["DRAFT", "SUBMITTED", "POSTED", "REJECTED", "VOIDED"];

function storedUser() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(
      localStorage.getItem("loggedInUser") ||
        localStorage.getItem("fairchoice_user") ||
        "null",
    ) || {};
  } catch {
    return {};
  }
}

function sessionArguments(user = {}) {
  const saved = storedUser();
  const username = String(user.username || saved.username || "").trim();
  const sessionToken =
    user.fc_session_token ||
    user.session_token ||
    saved.fc_session_token ||
    saved.session_token ||
    "";

  if (!username || !sessionToken) {
    throw new Error("Your Fair Choice session is missing. Please sign in again.");
  }

  return {
    p_username: username,
    p_session_token: sessionToken,
  };
}

async function callExpenseRpc(name, parameters) {
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw error;
  return data;
}

export async function loadSuppliers() {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, supplier_name")
    .eq("active", true)
    .order("supplier_name");
  if (error) throw error;
  return data || [];
}

export async function loadExpenseTypes(user = {}, includeInactive = false) {
  const data = await callExpenseRpc("fc_list_expense_types", {
    ...sessionArguments(user),
    p_include_inactive: includeInactive,
  });
  return data || [];
}

export async function loadPayouts(user = {}) {
  const data = await callExpenseRpc(
    "fc_list_business_payouts",
    sessionArguments(user),
  );
  return data || [];
}

function payoutArguments(input) {
  const amount = Number(input.amount);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  if (!input.payoutDate) throw new Error("Payout date is required.");
  if (!input.expenseTypeId) throw new Error("Expense type is required.");
  if (!PAYMENT_TYPES.includes(input.paymentMethod)) {
    throw new Error("Select a valid payment method.");
  }

  return {
    p_payout_date: input.payoutDate,
    p_expense_type_id: input.expenseTypeId,
    p_supplier_id: input.supplierId || null,
    p_amount: amount,
    p_payment_method: input.paymentMethod,
    p_description: String(input.description || "").trim() || null,
    p_receipt_reference: String(input.receiptReference || "").trim() || null,
    p_receipt_url: String(input.receiptUrl || "").trim() || null,
    p_paid_by_type: String(input.paidByType || "BUSINESS").trim(),
    p_paid_by_staff_id: input.paidByStaffId || null,
  };
}

export async function createPayout(input, user = {}) {
  return callExpenseRpc("fc_create_business_payout", {
    ...sessionArguments(user),
    ...payoutArguments(input),
    p_submit: Boolean(input.submit),
  });
}

export async function updatePayout(payoutId, input, user = {}) {
  if (!payoutId) throw new Error("Expense ID is required.");
  return callExpenseRpc("fc_update_business_payout", {
    ...sessionArguments(user),
    p_payout_id: payoutId,
    ...payoutArguments(input),
  });
}

async function transitionPayout(rpcName, payoutId, user, reason) {
  if (!payoutId) throw new Error("Expense ID is required.");
  return callExpenseRpc(rpcName, {
    ...sessionArguments(user),
    p_payout_id: payoutId,
    ...(reason === undefined ? {} : { p_reason: String(reason).trim() }),
  });
}

export function submitPayout(payoutId, user = {}) {
  return transitionPayout("fc_submit_business_payout", payoutId, user);
}

export function approvePayout(payoutId, user = {}) {
  return transitionPayout("fc_approve_business_payout", payoutId, user);
}

export function rejectPayout(payoutId, reason, user = {}) {
  if (!String(reason || "").trim()) throw new Error("Rejection reason is required.");
  return transitionPayout("fc_reject_business_payout", payoutId, user, reason);
}

export function voidPayout(payoutId, reason, user = {}) {
  if (!String(reason || "").trim()) throw new Error("Void reason is required.");
  return transitionPayout("fc_void_business_payout", payoutId, user, reason);
}

export async function upsertExpenseType(input, user = {}) {
  const code = String(input.expenseTypeCode || "").trim().toUpperCase();
  const name = String(input.expenseTypeName || "").trim();
  if (!code || !name) throw new Error("Expense type code and name are required.");

  return callExpenseRpc("fc_upsert_expense_type", {
    ...sessionArguments(user),
    p_expense_type_id: input.id || null,
    p_expense_type_code: code,
    p_expense_type_name: name,
    p_description: String(input.description || "").trim() || null,
    p_ledger_category: String(input.ledgerCategory || "").trim() || null,
    p_active: input.active !== false,
    p_sort_order: Number(input.sortOrder || 0),
  });
}
