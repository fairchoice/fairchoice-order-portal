import { supabase } from "./supabase";
import { getFcSessionState } from "./fcSession";
import { isOwnerUser } from "./ownerFinancialSecurity";

const requireOwnerSession = (currentUser = {}) => {
  if (!isOwnerUser(currentUser)) {
    throw new Error("Financial Corrections is restricted to nisstaj_admin.");
  }

  const session = getFcSessionState(currentUser);
  if (!session.valid || !session.username || !session.token) {
    throw new Error("FC login session is missing or expired. Sign in again.");
  }

  return session;
};

export const isFinanciallyVoided = (row = {}) =>
  String(row.financial_status || "ACTIVE").trim().toUpperCase() === "VOID";

export const filterFinanciallyActiveRows = (rows = []) =>
  (rows || []).filter((row) => !isFinanciallyVoided(row));

export async function previewInvoiceFinancialCorrection({
  currentUser,
  orderNumber,
} = {}) {
  const session = requireOwnerSession(currentUser);
  const reference = String(orderNumber || "").trim();
  if (!reference) throw new Error("Order number is required.");

  const { data, error } = await supabase.rpc(
    "preview_owner_invoice_correction_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_order_number: reference,
    }
  );

  if (error) throw error;
  return data || null;
}

export async function voidDuplicateInvoiceFinancially({
  currentUser,
  orderNumber,
  reason,
} = {}) {
  const session = requireOwnerSession(currentUser);
  const reference = String(orderNumber || "").trim();
  const correctionReason = String(reason || "").trim();

  if (!reference) throw new Error("Order number is required.");
  if (!correctionReason) throw new Error("Correction reason is required.");

  const { data, error } = await supabase.rpc(
    "void_owner_duplicate_invoice_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_order_number: reference,
      p_reason: correctionReason,
    }
  );

  if (error) throw error;
  return data || null;
}

export async function previewLegacyPaymentLink({
  currentUser,
  ledgerId,
} = {}) {
  const session = requireOwnerSession(currentUser);
  const id = Number(ledgerId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid customer_ledger payment ID is required.");
  }

  const { data, error } = await supabase.rpc(
    "preview_matched_legacy_payment_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_ledger_id: id,
    }
  );

  if (error) throw error;
  return data || null;
}

export async function linkMatchedLegacyPayment({
  currentUser,
  ledgerId,
  reason,
} = {}) {
  const session = requireOwnerSession(currentUser);
  const id = Number(ledgerId);
  const correctionReason = String(reason || "").trim();

  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("A valid customer_ledger payment ID is required.");
  }
  if (!correctionReason) throw new Error("Link reason is required.");

  const { data, error } = await supabase.rpc(
    "link_matched_legacy_payment_v1",
    {
      p_username: session.username,
      p_session_token: session.token,
      p_ledger_id: id,
      p_reason: correctionReason,
    }
  );

  if (error) throw error;
  return data || null;
}
