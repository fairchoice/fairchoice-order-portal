import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";
import { roundMoney } from "../utils/pricing";

const getOrderReference = (order = {}) => order.orderId || order.order_number || order.id;
const getCustomerName = (order = {}) => order.companyName || order.company_name || order.customerName || "Unknown Customer";
const getBranchName = (order = {}) => order.branchName || order.branch_name || order.delivery_branch_name || "";
const getBranchId = (order = {}) => order.customerBranchId || order.customer_branch_id || null;
const getCustomerAccountId = (order = {}) => order.customerAccountId || order.customer_account_id || null;
const getDeliveredDate = (order = {}) =>
  order.deliveredAt ||
  order.delivered_at ||
  order.delivery_confirmed_at ||
  order.confirmed_at ||
  order.updated_at ||
  new Date().toISOString();

export function getInvoiceTotal(order = {}) {
  return calculateDocumentTotals(order.items || order.order_items || [], order).grandTotal;
}

const getLedgerType = (row = {}) =>
  String(row.entry_type || row.transaction_type || "")
    .trim()
    .toUpperCase();

const getInvoiceLedgerTotal = (row = {}) =>
  roundMoney(
    Number(
      row.invoice_total ||
        row.invoiceTotal ||
        row.invoice_amount ||
        row.amount ||
        row.debit ||
        0
    )
  );

const getPaymentLedgerTotal = (row = {}) =>
  roundMoney(Number(row.credit || row.amount || row.payment_amount || 0));

export const getInvoiceStatusFromAmounts = (invoiceTotal, paidAmount) => {
  const total = roundMoney(invoiceTotal);
  const paid = roundMoney(paidAmount);

  if (paid <= 0) return "UNPAID";
  if (paid >= total) return "PAID";
  return "PART PAID";
};

export function applyInvoicePaymentAllocations(ledgerRows = []) {
  const invoiceRows = [];

  return (ledgerRows || []).map((row) => {
    const type = getLedgerType(row);

    if (type === "INVOICE") {
      const invoiceTotal = getInvoiceLedgerTotal(row);
      const paidAmount = 0;
      const remainingAmount = invoiceTotal;
      const invoiceRow = {
        ...row,
        invoice_total: invoiceTotal,
        invoiceTotal,
        paid_amount: paidAmount,
        paidAmount,
        remaining_amount: remainingAmount,
        remainingAmount,
        invoice_status:
          row.invoice_status ||
          getInvoiceStatusFromAmounts(invoiceTotal, paidAmount),
      };

      invoiceRows.push(invoiceRow);
      return invoiceRow;
    }

    if (type !== "PAYMENT") return row;

    let paymentRemaining = getPaymentLedgerTotal(row);

    for (const invoice of invoiceRows) {
      if (paymentRemaining <= 0) break;

      const currentRemaining = roundMoney(invoice.remaining_amount);
      if (currentRemaining <= 0) continue;

      const appliedAmount = roundMoney(Math.min(currentRemaining, paymentRemaining));
      invoice.paid_amount = roundMoney(invoice.paid_amount + appliedAmount);
      invoice.paidAmount = invoice.paid_amount;
      invoice.remaining_amount = roundMoney(currentRemaining - appliedAmount);
      invoice.remainingAmount = invoice.remaining_amount;
      invoice.invoice_status = getInvoiceStatusFromAmounts(
        invoice.invoice_total,
        invoice.paid_amount
      );
      paymentRemaining = roundMoney(paymentRemaining - appliedAmount);
    }

    return row;
  });
}

export function buildInvoiceLedgerPayload({ order, confirmedBy, currentUser } = {}) {
  const orderTotal = getInvoiceTotal(order);
  const invoiceDate = getDeliveredDate(order);

  return {
    customer_account_id: getCustomerAccountId(order),
    customer_branch_id: getBranchId(order),
    branch_id: getBranchId(order),
    branch_name: getBranchName(order) || null,
    customer_name: getCustomerName(order),

    entry_type: "INVOICE",
    transaction_type: "INVOICE",
    reference_no: getOrderReference(order),
    description: "Invoice",
    created_at: invoiceDate,
    delivered_date: invoiceDate,
    invoice_date: invoiceDate,

    debit: orderTotal,
    credit: 0,
    invoice_total: orderTotal,
    amount: orderTotal,
    invoice_amount: orderTotal,
    paid_amount: 0,
    remaining_amount: orderTotal,
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
    notes: "Invoice",
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
    "invoice_total",
    "paid_amount",
    "remaining_amount",
    "delivered_date",
    "invoice_date",
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
    .select("*")
    .eq("reference_no", referenceNo)
    .eq("entry_type", "INVOICE")
    .maybeSingle();

  if (existing.data?.id) {
    const paidAmount = roundMoney(
      Number(existing.data.paid_amount || existing.data.paidAmount || 0)
    );
    payload.paid_amount = paidAmount;
    payload.remaining_amount = roundMoney(payload.invoice_total - paidAmount);
    payload.invoice_status = getInvoiceStatusFromAmounts(
      payload.invoice_total,
      paidAmount
    );
  }

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

export async function allocateCustomerPaymentToInvoices({
  customerAccountId,
  customerName,
} = {}) {
  let query = supabase
    .from("customer_ledger")
    .select("*")
    .order("created_at", { ascending: true });

  if (customerName) {
    query = query.eq("customer_name", customerName);
  } else if (customerAccountId) {
    query = query.eq("customer_account_id", customerAccountId);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw error;

  const allocatedRows = applyInvoicePaymentAllocations(data || []);
  const invoiceRows = allocatedRows.filter((row) => getLedgerType(row) === "INVOICE");

  for (const invoice of invoiceRows) {
    if (!invoice.id || String(invoice.id).startsWith("delivered-invoice-")) continue;

    const payload = {
      invoice_total: roundMoney(invoice.invoice_total),
      invoice_amount: roundMoney(invoice.invoice_total),
      paid_amount: roundMoney(invoice.paid_amount),
      remaining_amount: roundMoney(invoice.remaining_amount),
      invoice_status: invoice.invoice_status,
    };

    let { error: updateError } = await supabase
      .from("customer_ledger")
      .update(payload)
      .eq("id", invoice.id);

    if (updateError) {
      const fallbackPayload = stripUnsupportedColumns(
        payload,
        updateError.message || updateError.details || ""
      );
      const retry = await supabase
        .from("customer_ledger")
        .update(fallbackPayload)
        .eq("id", invoice.id);
      updateError = retry.error;
    }

    if (updateError) throw updateError;
  }

  return invoiceRows;
}

const isDeliveredInvoiceStatus = (status) =>
  ["delivered", "confirmed", "delivery confirmed", "completed"].includes(
    String(status || "").trim().toLowerCase()
  );

const mapOrderItemForLedgerFallback = (item = {}) => ({
  id: item.product_id,
  productCode: item.product_code || item.code || "",
  product_code: item.product_code || item.code || "",
  name: item.product_name,
  productName: item.product_name,
  qty: Number(item.qty || item.quantity || 0),
  quantity: Number(item.quantity || item.qty || 0),
  price: Number(item.price || item.unit_price || 0),
  unit_price: Number(item.unit_price || item.price || 0),
  line_total: Number(item.line_total || item.lineTotal || 0),
  net_total: Number(item.net_total || item.netTotal || 0),
  gross_total: Number(item.gross_total || item.grossTotal || 0),
  vatRate: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
  vat_percent: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
  vat_total: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
});

const mapOrderForLedgerFallback = (order = {}) => ({
  dbId: order.id,
  orderId: order.order_number,
  order_number: order.order_number,
  customerAccountId: order.customer_account_id || "",
  customer_account_id: order.customer_account_id || "",
  customerBranchId: order.customer_branch_id || order.branch_id || "",
  customer_branch_id: order.customer_branch_id || order.branch_id || "",
  companyName: order.company_name,
  customerName: order.company_name,
  branchName:
    order.delivery_branch_name ||
    order.branch_name ||
    order.shop_name ||
    "",
  priceMode: order.price_mode || "vat",
  finalTotal: Number(order.final_total || order.total_amount || order.order_total || 0),
  orderTotal: Number(order.order_total || order.total || 0),
  createdAt: order.created_at,
  deliveredAt: order.delivered_at || order.updated_at || order.created_at,
  status: order.status,
  items: (order.order_items || []).map(mapOrderItemForLedgerFallback),
});

export function mergeDeliveredOrderInvoicesIntoLedgerRows(
  ledgerRows = [],
  deliveredOrders = []
) {
  const invoiceReferences = new Set(
    (ledgerRows || [])
      .filter((row) => getLedgerType(row) === "INVOICE")
      .map((row) => String(row.reference_no || row.order_number || "").trim())
      .filter(Boolean)
  );

  const fallbackRows = deliveredOrders
    .filter((order) => {
      const referenceNo = String(order.orderId || order.order_number || "").trim();
      return referenceNo && !invoiceReferences.has(referenceNo);
    })
    .map((order) => {
      const totals = calculateDocumentTotals(order.items || [], order);
      const invoiceTotal = roundMoney(totals.grandTotal);

      return {
        id: `delivered-invoice-${order.orderId || order.order_number}`,
        created_at: order.deliveredAt || order.createdAt || new Date().toISOString(),
        entry_type: "INVOICE",
        transaction_type: "INVOICE",
        reference_no: order.orderId || order.order_number,
        order_number: order.orderId || order.order_number,
        description: "Invoice",
        debit: invoiceTotal,
        credit: 0,
        amount: invoiceTotal,
        invoice_amount: invoiceTotal,
        invoice_total: invoiceTotal,
        paid_amount: 0,
        remaining_amount: invoiceTotal,
        invoice_status: "UNPAID",
        customer_name: order.companyName || order.customerName || "",
        customer_account_id: order.customerAccountId || order.customer_account_id || null,
        customer_branch_id: order.customerBranchId || order.customer_branch_id || null,
        branch_id: order.customerBranchId || order.customer_branch_id || null,
        branch_name: order.branchName || null,
        price_mode: order.priceMode || null,
        order_price_mode: order.priceMode || null,
      };
    });

  return [...ledgerRows, ...fallbackRows].sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;

    const aType = getLedgerType(a);
    const bType = getLedgerType(b);
    if (aType === "INVOICE" && bType !== "INVOICE") return -1;
    if (aType !== "INVOICE" && bType === "INVOICE") return 1;
    return 0;
  });
}

export const getAllocatedOutstanding = (ledgerRows = [], openingBalance = 0) =>
  roundMoney(
    Number(openingBalance || 0) +
      (ledgerRows || []).reduce(
        (total, row) =>
          total +
          Number(row.debit || row.invoice_amount || 0) -
          getPaymentLedgerTotal(row),
        0
      )
  );

export async function loadCustomerOutstandingSnapshot({
  customerAccountId,
  customerName,
} = {}) {
  if (!customerAccountId && !customerName) {
    return { openingBalance: 0, ledgerRows: [], allocatedRows: [], totalOutstanding: 0, branchOutstanding: {} };
  }

  const [{ data: balanceRow }, ledgerResult, ordersResult] = await Promise.all([
    customerName
      ? supabase
          .from("customer_opening_balances")
          .select("*")
          .eq("customer_name", customerName)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    (customerName
      ? supabase.from("customer_ledger").select("*").eq("customer_name", customerName)
      : supabase.from("customer_ledger").select("*").eq("customer_account_id", customerAccountId)
    ).order("created_at", { ascending: true }),
    (customerAccountId
      ? supabase.from("orders").select("*, order_items(*)").eq("customer_account_id", customerAccountId)
      : supabase.from("orders").select("*, order_items(*)").eq("company_name", customerName)
    ).order("created_at", { ascending: true }).limit(250),
  ]);

  if (ledgerResult.error) throw ledgerResult.error;
  if (ordersResult.error) throw ordersResult.error;

  const openingBalance = Number(balanceRow?.opening_balance || 0);
  const deliveredOrders = (ordersResult.data || [])
    .filter((order) => isDeliveredInvoiceStatus(order.status))
    .map(mapOrderForLedgerFallback);
  const ledgerRows = mergeDeliveredOrderInvoicesIntoLedgerRows(
    ledgerResult.data || [],
    deliveredOrders
  );
  const allocatedRows = applyInvoicePaymentAllocations(ledgerRows);
  const branchOutstanding = {};

  allocatedRows.forEach((row) => {
    const branchKey = String(row.branch_id || row.customer_branch_id || row.branch_name || "");
    if (!branchKey) return;

    branchOutstanding[branchKey] = roundMoney(
      Number(branchOutstanding[branchKey] || 0) +
        Number(row.debit || row.invoice_amount || 0) -
        getPaymentLedgerTotal(row)
    );
  });

  return {
    openingBalance,
    ledgerRows,
    allocatedRows,
    totalOutstanding: getAllocatedOutstanding(allocatedRows, openingBalance),
    branchOutstanding,
  };
}
