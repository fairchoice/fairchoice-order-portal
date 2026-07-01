import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";

const getOrderReference = (order = {}) => order.orderId || order.order_number || order.id;
const getCustomerName = (order = {}) => order.companyName || order.company_name || order.customerName || "Unknown Customer";
const getBranchName = (order = {}) => order.branchName || order.branch_name || order.delivery_branch_name || "";
const getBranchId = (order = {}) => order.customerBranchId || order.customer_branch_id || null;
const getCustomerAccountId = (order = {}) => order.customerAccountId || order.customer_account_id || null;

export function getInvoiceTotal(order = {}) {
  return calculateDocumentTotals(order.items || order.order_items || [], order).grandTotal;
}

export function buildInvoiceLedgerPayload({ order, confirmedBy, currentUser } = {}) {
  const orderTotal = getInvoiceTotal(order);

  return {
    customer_account_id: getCustomerAccountId(order),
    customer_branch_id: getBranchId(order),
    branch_id: getBranchId(order),
    branch_name: getBranchName(order) || null,
    customer_name: getCustomerName(order),

    entry_type: "INVOICE",
    transaction_type: "INVOICE",
    reference_no: getOrderReference(order),
    description: "Delivery confirmed invoice",

    debit: orderTotal,
    credit: 0,
    amount: orderTotal,
    invoice_amount: orderTotal,
    invoice_status: "UNPAID",

    price_mode: order.priceMode || order.price_mode || null,
    order_price_mode: order.priceMode || order.price_mode || null,
    order_id: order.dbId || order.id || null,
    order_number: getOrderReference(order),

    confirmed_by: confirmedBy || null,
    driver_name: currentUser?.name || currentUser?.username || null,
    driver_username: currentUser?.username || null,
    driver_role: currentUser?.role || null,
    driver_staff_id: currentUser?.id || currentUser?.staff_id || null,
    notes: "Delivery confirmed",
  };
}

const stripUnsupportedColumns = (payload, errorMessage = "") => {
  const text = String(errorMessage).toLowerCase();
  const next = { ...payload };

  [
    "customer_account_id",
    "customer_branch_id",
    "branch_id",
    "branch_name",
    "transaction_type",
    "description",
    "amount",
    "invoice_amount",
    "price_mode",
    "order_price_mode",
    "order_id",
    "order_number",
    "driver_username",
    "driver_role",
    "driver_staff_id",
  ].forEach((key) => {
    if (text.includes(key.toLowerCase())) delete next[key];
  });

  return next;
};

export async function createOrUpdateInvoiceForDeliveredOrder({ order, confirmedBy, currentUser } = {}) {
  if (!order) throw new Error("Order is required");

  const referenceNo = getOrderReference(order);
  if (!referenceNo) throw new Error("Order reference is required");

  const payload = buildInvoiceLedgerPayload({ order, confirmedBy, currentUser });

  const existing = await supabase
    .from("customer_ledger")
    .select("id")
    .eq("reference_no", referenceNo)
    .eq("entry_type", "INVOICE")
    .maybeSingle();

  let query = existing.data?.id
    ? supabase.from("customer_ledger").update(payload).eq("id", existing.data.id)
    : supabase.from("customer_ledger").insert(payload);

  let { data, error } = await query.select().single();

  if (error) {
    const fallbackPayload = stripUnsupportedColumns(payload, error.message || error.details || "");
    query = existing.data?.id
      ? supabase.from("customer_ledger").update(fallbackPayload).eq("id", existing.data.id)
      : supabase.from("customer_ledger").insert(fallbackPayload);

    const retry = await query.select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return data;
}
