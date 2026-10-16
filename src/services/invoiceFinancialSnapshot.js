import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";

export async function loadInvoiceFinancialSnapshot(
  { customerAccountId = null, invoiceNumbers = null } = {},
  runtime = {}
) {
  const session = runtime.session || getFcSessionState(readStoredFcProfile());
  if (!session.username || !session.token) return null;
  const client = runtime.client || (await import("./supabase.js")).supabase;
  const { data, error } = await client.rpc("fc_invoice_financial_snapshot_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_customer_account_id: customerAccountId,
    p_invoice_numbers: invoiceNumbers,
  });
  if (error) throw error;
  if (!Array.isArray(data?.invoices) || !Array.isArray(data?.wallet_applications)) {
    throw new Error("Invoice financial snapshot is incomplete.");
  }
  return data;
}

export function withInvoiceFinancialState(order = {}, state) {
  if (!state) return order;
  return {
    ...order,
    invoice_id: state.id,
    invoice_number: state.invoice_number,
    wallet_applied_amount: Number(state.wallet_applied_amount || 0),
    wallet_application_mode: state.wallet_application_mode,
    wallet_preserve_paid_watermark: state.wallet_preserve_paid_watermark,
    amount_to_collect: Number(state.remaining_amount),
    remaining_amount: Number(state.remaining_amount),
    paid_amount: Number(state.paid_amount),
    cash_allocated_amount: Number(state.cash_allocated_amount || 0),
    payment_status: state.invoice_status,
    _documentPaymentStatus: state.invoice_status,
    _financialStatusVerified: true,
    _ledgerPaid: state.invoice_status === "PAID",
  };
}

export function currentInvoiceNotes(notes = "", verified = false) {
  if (!verified) return notes;
  return String(notes)
    .replace(/Payment status:\s*(?:UNPAID|PAID|PART(?:IALLY)? PAID)\.?/gi, "")
    .replace(/No Payment Now selected\.?/gi, "")
    .trim();
}
