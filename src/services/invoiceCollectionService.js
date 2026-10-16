import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";
import { moneyCents } from "../utils/invoiceCollectionActions.js";

export async function saveInvoiceCollection(input, runtime = {}) {
  const amount = moneyCents(input.amount || 0);
  if (amount === null || amount < 0) throw new Error("Collected amount must have at most two decimals.");
  if (!input.customerAccountId || !input.paymentIntentId) throw new Error("Customer and collection intent are required.");
  if (!amount && !input.previousStatuses?.length) throw new Error("Choose a previous-payment correction or enter a new collection.");
  if (amount > 0 && !String(input.paidBy || "").trim()) throw new Error("Please enter who paid.");
  const session = runtime.session || getFcSessionState(readStoredFcProfile());
  if (!session.username || !session.token) throw new Error("FC login session is missing. Sign out and sign in again.");
  const client = runtime.client || (await import("./supabase.js")).supabase;
  const { data, error } = await client.rpc("fc_save_invoice_collection_v1", {
    p_customer_account_id: input.customerAccountId,
    p_customer_branch_id: input.customerBranchId || null,
    p_amount: amount / 100,
    p_payment_date: input.paymentDate || new Date().toISOString(),
    p_payment_method: input.paymentMethod || "Cash",
    p_payment_source: input.paymentSource,
    p_paid_by: String(input.paidBy || "").trim(),
    p_notes: input.notes || "",
    p_metadata: input.metadata || {},
    p_allocations: input.allocations || [],
    p_previous_statuses: input.previousStatuses || [],
    p_request_key: `invoice-collection:${input.paymentIntentId}`,
    p_username: session.username,
    p_session_token: session.token,
  });
  if (error) {
    if (["PGRST202", "42883"].includes(error.code)) {
      throw new Error("The cash collection database update is not installed. No collection was saved.");
    }
    throw error;
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("fairchoice:fc-payment-posted", { detail: {
      customerAccountId: input.customerAccountId,
      customerBranchId: input.customerBranchId || null,
      paymentId: data?.payment?.id || null,
      statusOnly: !amount,
    } }));
  }
  return data;
}

// Never fall back to orders here: an order UUID is not a canonical invoice UUID.
export async function loadInvoiceCollectionSnapshot(input, runtime = {}) {
  if (!input.customerAccountId) throw new Error("Select a customer before loading collection invoices.");
  const session = runtime.session || getFcSessionState(readStoredFcProfile());
  if (!session.username || !session.token) throw new Error("FC login session is missing. Sign out and sign in again.");
  const client = runtime.client || (await import("./supabase.js")).supabase;
  const { data, error } = await client.rpc("fc_invoice_collection_snapshot_v1", {
    p_customer_account_id: input.customerAccountId,
    p_customer_branch_id: input.selectedBranchId || null,
    p_username: session.username,
    p_session_token: session.token,
  });
  if (error) throw error;
  if (!Array.isArray(data?.invoices) || !Array.isArray(data?.allocations)) {
    throw new Error("Could not verify collection invoices. Reload before saving.");
  }
  return data;
}
