import { supabase } from "./supabase.js";
import { getFcSessionState } from "./fcSession.js";

const ownerSession = (user) => {
  const session = getFcSessionState(user);
  if (String(session.username || "").trim().toLowerCase() !== "nisstaj_admin" || !session.valid) {
    throw new Error("Issued invoices are read-only. A valid nisstaj_admin session is required for an audited amendment.");
  }
  return { p_username: session.username, p_session_token: session.token };
};
const orderId = (order) => order?.order_uuid || order?.dbId || order?.order_id || order?.id;

export async function prepareIssuedInvoiceAmendment(order, user) {
  const { data, error } = await supabase.rpc("fc_prepare_issued_invoice_edit_v1", {
    ...ownerSession(user), p_order_id: orderId(order),
  });
  if (error) throw error;
  return data;
}

export async function saveIssuedInvoiceAmendment({ order, user, revision, reason, header, lines }) {
  if (!revision || String(reason || "").trim().length < 5) throw new Error("Reopen the invoice and provide a specific amendment reason.");
  const { data, error } = await supabase.rpc("fc_amend_issued_invoice_v1", {
    ...ownerSession(user), p_order_id: orderId(order), p_expected_revision: revision,
    p_reason: reason.trim(), p_header: header, p_lines: lines.map((line) => ({
      db_id: line.dbId || null, product_id: line.productId || line.product_id || line.id,
      product_code: line.product_code || line.productCode || "", product_name: line.name || line.product_name || "",
      qty: Number(line.qty ?? line.quantity ?? 0), price: Number(line.price ?? line.unit_price ?? 0),
      vat_rate: Number(line.vatRate ?? line.vat_rate ?? 0), source_status: line.sourceStatus || line.source_status || "In Stock",
    })),
  });
  if (error) throw error;
  return data;
}
