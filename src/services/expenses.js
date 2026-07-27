import { supabase } from "./supabase";

export const EXPENSE_CATEGORIES = ["Fuel", "Vehicle Maintenance", "Food", "Office Accessories", "Other"];
export const PAYOUT_CATEGORIES = ["Wages", "Commission", "Bonus", "Own Car Mileage", "Supplier Payout"];
export const INVOICE_OPTIONS = ["Online", "Paper", "Paid", "Credit", "Part Paid"];
export const PAYMENT_TYPES = ["Cash", "Bank", "Credit", "Card"];
export const PAYOUT_STATUSES = ["Paid", "Pending", "Approval Needed", "Cancelled"];
export const DIRECT_DEBIT_FREQUENCIES = ["Weekly", "Monthly"];

const userName = (user = {}) => user.staff_name || user.name || user.username || "Unknown";

export async function loadSuppliers() {
  const { data, error } = await supabase.from("suppliers").select("*").eq("active", true).order("supplier_name");
  if (error) throw error;
  return data || [];
}

export async function loadExpenses() {
  const { data, error } = await supabase.from("expenses").select("*, suppliers(*)").order("expense_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createExpense(input, user = {}) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  if (input.category === "Other" && !String(input.otherReason || "").trim()) throw new Error("Please enter the reason for Other expense.");
  const description = input.category === "Other" ? String(input.otherReason).trim() : input.category;
  const { data, error } = await supabase.from("expenses").insert({
    expense_date: input.expenseDate,
    category: input.category,
    description,
    amount,
    invoice_option: input.invoiceOption,
    payment_type: input.paymentType,
    reference: String(input.reference || "").trim() || null,
    notes: String(input.notes || "").trim() || null,
    status: "RECORDED",
    created_by: userName(user),
    created_by_username: user.username || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function loadPayouts() {
  const { data, error } = await supabase.from("business_payouts").select("*, suppliers(*)").order("payout_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createPayout(input, user = {}) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  if (!String(input.payeeName || "").trim() && input.type !== "Supplier Payout") throw new Error("Name is required.");
  const { data, error } = await supabase.from("business_payouts").insert({
    payout_date: input.payoutDate,
    payout_type: input.type,
    payment_type: input.paymentType,
    payee_name: String(input.payeeName || "").trim() || null,
    supplier_id: input.supplierId || null,
    pay_period: String(input.payPeriod || "").trim() || null,
    notes: String(input.notes || "").trim() || null,
    amount,
    status: input.status,
    created_by: userName(user),
    created_by_username: user.username || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function loadDirectDebits() {
  const { data, error } = await supabase.from("direct_debit_reminders").select("*, suppliers(*)").order("next_due_date", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createDirectDebit(input, user = {}) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  const { data, error } = await supabase.from("direct_debit_reminders").insert({
    name: String(input.name || "").trim(), supplier_id: input.supplierId || null,
    amount, frequency: input.frequency, next_due_date: input.nextDueDate,
    payment_type: input.paymentType, account_reference: String(input.accountReference || "").trim() || null,
    whatsapp_number: String(input.whatsappNumber || "").trim(), reminder_days_before: Number(input.reminderDaysBefore || 1),
    notes: String(input.notes || "").trim() || null, active: true,
    created_by: userName(user), created_by_username: user.username || null,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function loadSupplierCredit(supplierId) {
  if (!supplierId) return { transactions: [], balance: 0 };
  const { data, error } = await supabase.rpc("fc_supplier_credit_statement", { p_supplier_id: supplierId });
  if (error) throw error;
  const transactions = data || [];
  const balance = transactions.length ? Number(transactions[transactions.length - 1].running_balance || 0) : 0;
  return { transactions, balance };
}

export async function createSupplierCreditTransaction(input, user = {}) {
  const amount = Number(input.amount || 0);
  if (!(amount > 0)) throw new Error("Amount must be greater than zero.");
  const { data, error } = await supabase.from("supplier_credit_transactions").insert({
    supplier_id: input.supplierId,
    transaction_date: input.transactionDate,
    transaction_type: input.transactionType,
    amount,
    invoice_number: String(input.invoiceNumber || "").trim() || null,
    payment_type: input.paymentType || null,
    reference: String(input.reference || "").trim() || null,
    notes: String(input.notes || "").trim() || null,
    created_by: userName(user), created_by_username: user.username || null,
  }).select().single();
  if (error) throw error;
  return data;
}
