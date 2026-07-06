import { supabase } from "./supabase";
import { allocateCustomerPaymentToInvoices } from "./centralInvoiceEngine";

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
    ["customer_account_id", "customer_branch_id", "branch_id", "branch_name", "created_by", "created_by_name", "created_by_role"].forEach(
      (key) => delete fallback[key]
    );
    const retry = await supabase.from("customer_returns").insert(fallback).select().single();
    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;
  return data;
};

export async function createReturnRequest({ order, returnType, items, source, currentUser, notes = "" } = {}) {
  if (!order) throw new Error("Order is required");
  if (!RETURN_TYPES.includes(returnType)) throw new Error("Valid return type is required");

  const returnItems = (items || []).map(normalizeReturnProduct).filter((item) => item.qty > 0);
  if (!returnItems.length) throw new Error("Add at least one return product");

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

  const amount = Number(returnRequest.return_total || returnRequest.grandTotal || 0);
  if (!amount || amount <= 0) throw new Error("Return credit amount is required");

  const payload = {
    customer_account_id: returnRequest.customer_account_id || null,
    customer_branch_id: returnRequest.customer_branch_id || returnRequest.branch_id || null,
    branch_id: returnRequest.branch_id || returnRequest.customer_branch_id || null,
    branch_name: returnRequest.branch_name || null,
    customer_name: returnRequest.customer_name,
    entry_type: "PAYMENT",
    transaction_type: "RETURN_CREDIT",
    reference_no: returnRequest.return_number,
    debit: 0,
    credit: amount,
    amount,
    payment_type: "Return Credit",
    payment_applies_to: "RETURN",
    collection_source: "WAREHOUSE_RETURN_CONFIRMATION",
    received_by: currentUser?.name || currentUser?.username || null,
    received_by_role: currentUser?.role || null,
    confirmed_by: currentUser?.name || currentUser?.username || null,
    notes: `Return confirmed - ${returnRequest.return_type || "Return"}`,
  };

  const existing = await supabase
    .from("customer_ledger")
    .select("*")
    .eq("reference_no", returnRequest.return_number)
    .order("created_at", { ascending: true })
    .limit(25);

  if (existing.error) throw existing.error;

  const existingRows = Array.isArray(existing.data) ? existing.data : [];
  const existingCredit = existingRows.find((row) => {
    const transactionType = String(row.transaction_type || "").toUpperCase();
    const paymentType = String(row.payment_type || "").toUpperCase();
    const paymentAppliesTo = String(row.payment_applies_to || "").toUpperCase();

    return (
      transactionType === "RETURN_CREDIT" ||
      paymentType === "RETURN CREDIT" ||
      paymentAppliesTo === "RETURN"
    );
  });

  const query = existingCredit?.id
    ? supabase.from("customer_ledger").update(payload).eq("id", existingCredit.id)
    : supabase.from("customer_ledger").insert(payload);

  const { data, error } = await query.select().single();

  if (error) throw error;

  const { error: returnUpdateError } = await supabase
    .from("customer_returns")
    .update({
      status: "Confirmed",
      confirmed_by: currentUser?.id || currentUser?.staff_id || null,
      confirmed_by_name: currentUser?.name || currentUser?.username || null,
      confirmed_by_role: currentUser?.role || null,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", returnRequest.id);

  if (returnUpdateError) throw returnUpdateError;

  await allocateCustomerPaymentToInvoices({
    customerAccountId: returnRequest.customer_account_id,
    customerName: returnRequest.customer_name,
  });

  return data;
}
