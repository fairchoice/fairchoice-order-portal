import { supabase } from "./supabase";
import { getFcSessionState } from "./fcSession";
import { findMatchingReturn } from "./returnDuplicateDetection.js";
export { findMatchingReturn } from "./returnDuplicateDetection.js";

export const RETURN_TYPES = [
  "Damaged",
  "Wrong Product",
  "Expired",
  "Customer Rejected",
  "Short Shelf Life",
  "Over Delivered",
  "Pricing Issue",
  "Other",
];

export const RETURN_REASONS = [
  "Damaged",
  "Wrong item",
  "Expired",
  "Customer rejected",
  "Over delivered",
  "Other",
];

const getOrderReference = (order = {}) => order.orderId || order.order_number || order.id;
const getCustomerName = (order = {}) => order.companyName || order.company_name || order.customerName || "Unknown Customer";
const getBranchName = (order = {}) => order.branchName || order.branch_name || order.delivery_branch_name || "";
const getBranchId = (order = {}) => order.customerBranchId || order.customer_branch_id || null;
const getCustomerAccountId = (order = {}) => order.customerAccountId || order.customer_account_id || null;

export function normalizeReturnProduct(item = {}) {
  const qty = Number(item.returnQty || item.qty || item.quantity || 0);
  const price = Number(item.price || item.unit_price || item.selectedPrice || 0);
  const netTotal = Number(item.net_total || item.netTotal || item.line_total || item.lineTotal || price * qty);
  const vatTotal = Number(item.vat_total || item.vatTotal || item.vat_amount || 0);

  return {
    product_id: item.id || item.productId || item.product_id || null,
    product_code: item.productCode || item.product_code || item.code || "",
    product_name: item.name || item.productName || item.product_name || "",
    qty,
    unit_price: price,
    net_total: netTotal,
    vat_total: vatTotal,
    gross_total: netTotal + vatTotal,
    reason: item.reason || "Other",
  };
}

export function calculateReturnTotals(items = []) {
  const products = items.map(normalizeReturnProduct).filter((item) => item.qty > 0);
  return products.reduce(
    (total, item) => ({
      qty: total.qty + item.qty,
      netTotal: total.netTotal + item.net_total,
      vatTotal: total.vatTotal + item.vat_total,
      grandTotal: total.grandTotal + item.gross_total,
    }),
    { qty: 0, netTotal: 0, vatTotal: 0, grandTotal: 0 }
  );
}

const insertReturnHeader = async (payload) => {
  let { data, error } = await supabase.from("customer_returns").insert(payload).select().single();

  if (error) {
    const fallback = { ...payload };
    ["customer_account_id", "customer_branch_id", "branch_id", "branch_name", "price_mode", "created_by", "created_by_name", "created_by_role"].forEach(
      (key) => delete fallback[key]
    );
    const retry = await supabase.from("customer_returns").insert(fallback).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return data;
};

export async function createReturnRequest({ order, returnType, items, source, currentUser, notes = "", priceMode, allowDuplicate = false } = {}) {
  if (!order) throw new Error("Order is required");
  if (!RETURN_TYPES.includes(returnType)) throw new Error("Valid return type is required");

  const returnItems = (items || []).map(normalizeReturnProduct).filter((item) => item.qty > 0);
  if (!returnItems.length) throw new Error("Add at least one return product");

  if (!allowDuplicate) {
    const existingReturns = await loadPotentialDuplicateReturns(order);
    const matchingReturn = findMatchingReturn({ order, returnType, items: returnItems, existingReturns });
    if (matchingReturn) {
      const error = new Error(`A matching return already exists (${matchingReturn.return_number || matchingReturn.id}).`);
      error.code = "MATCHING_RETURN_EXISTS";
      throw error;
    }
  }

  const totals = calculateReturnTotals(returnItems);
  const returnNumber = `RET-${Date.now()}`;
  const orderReference = getOrderReference(order);

  const header = await insertReturnHeader({
    return_number: returnNumber,
    order_id: order.dbId || order.id || null,
    order_number: orderReference,
    customer_account_id: getCustomerAccountId(order),
    customer_branch_id: getBranchId(order),
    branch_id: getBranchId(order),
    branch_name: getBranchName(order) || null,
    customer_name: getCustomerName(order),
    return_type: returnType,
    price_mode: priceMode || order.priceMode || order.price_mode || "vat",
    status: "Pending Warehouse Confirmation",
    source: source || "RETURN_PORTAL",
    total_qty: totals.qty,
    net_total: totals.netTotal,
    vat_total: totals.vatTotal,
    return_total: totals.grandTotal,
    created_by: currentUser?.id || currentUser?.staff_id || null,
    created_by_name: currentUser?.name || currentUser?.username || null,
    created_by_role: currentUser?.role || null,
    notes,
  });

  const lines = returnItems.map((item) => ({
    return_id: header.id,
    return_number: returnNumber,
    ...item,
  }));

  const { error: itemError } = await supabase.from("customer_return_items").insert(lines);
  if (itemError) throw itemError;

  return { ...header, items: lines };
}

export async function confirmReturnCredit({ returnRequest, currentUser } = {}) {
  if (!returnRequest) throw new Error("Return request is required");
  if (!returnRequest.id) throw new Error("Return database ID is required");
  const session = getFcSessionState(currentUser);
  if (!session.valid) throw new Error("FC login session is missing or expired. Sign in again.");

  const { data, error } = await supabase.rpc("fc_approve_customer_return_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_return_id: returnRequest.id,
    p_approval_note: returnRequest.approvalNote || null,
    p_financial_disposition: returnRequest.financialDisposition,
  });
  if (error) {
    if (["42883", "PGRST202"].includes(String(error.code || ""))) {
      throw new Error("Secure Return Approval service is not installed.");
    }
    throw error;
  }
  return data;
}

export async function reverseReturnApproval({ returnRequest, currentUser, reason } = {}) {
  if (!returnRequest?.id) throw new Error("Return database ID is required");
  if (!String(reason || "").trim()) throw new Error("Reversal reason is required");
  const session = getFcSessionState(currentUser);
  if (!session.valid) throw new Error("FC login session is missing or expired. Sign in again.");
  const { data, error } = await supabase.rpc("fc_reverse_customer_return_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_return_id: returnRequest.id,
    p_reason: String(reason).trim(),
  });
  if (error) {
    if (["42883", "PGRST202"].includes(String(error.code || ""))) {
      throw new Error("Secure Return Reversal service is not installed.");
    }
    throw error;
  }
  return data;
}

export async function loadReturnFinancialReconciliation(currentUser) {
  const session = getFcSessionState(currentUser);
  if (!session.valid) throw new Error("FC login session is missing or expired. Sign in again.");
  const { data, error } = await supabase.rpc("fc_list_customer_return_reconciliation_v1", {
    p_username: session.username,
    p_session_token: session.token,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function loadPotentialDuplicateReturns(order) {
  const orderId = order?.dbId || order?.id || null;
  if (!orderId) return [];
  const { data, error } = await supabase
    .from("customer_returns")
    .select("*, customer_return_items(*)")
    .eq("order_id", orderId)
    .in("status", ["Pending Warehouse Confirmation", "Confirmed"]);
  if (error) throw error;
  return data || [];
}
