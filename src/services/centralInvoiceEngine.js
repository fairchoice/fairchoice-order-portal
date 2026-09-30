import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";
import {
  calculateCartOrderItems,
  calculateCartTotals,
  getOrderItemProductCode,
} from "../utils/orderTotals";
import { isServerManagerPriceMode, roundMoney } from "../utils/pricing";
import { formatCurrency } from "../utils/currency";
import {
  getCustomerInvoiceWatermark,
  normalizeInvoicePaymentStatus,
} from "../utils/invoicePaymentStatus";
import { sortPrintItems } from "../utils/printItemSorting";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import fairchoiceLogo from "../assets/fairchoice-logo.png";








const getOrderReference = (order = {}) =>
  order.canonical_order_number ||
  order.full_order_number ||
  order.order_number ||
  order.orderId ||
  order.id;
const getCustomerName = (order = {}) => order.companyName || order.company_name || order.customerName || "Unknown Customer";
const getBranchName = (order = {}) => order.branchName || order.branch_name || order.delivery_branch_name || "";
const getBranchId = (order = {}) =>
  order.customerBranchId || order.customer_branch_id || order.branch_id || null;
const getCustomerAccountId = (order = {}) => order.customerAccountId || order.customer_account_id || null;
const getInvoiceReference = (row = {}) =>
  row.canonical_order_number ||
  row.full_order_number ||
  row.reference_no ||
  row.order_number ||
  row.invoice_number ||
  row.orderId ||
  row.id ||
  "";
const getInvoiceReferenceCandidates = (rowOrReference = {}) => {
  if (typeof rowOrReference === "string") return [rowOrReference];








  const values = [
    rowOrReference.canonical_order_number,
    rowOrReference.full_order_number,
    rowOrReference._freshOrder?.canonical_order_number,
    rowOrReference._freshOrder?.full_order_number,
    rowOrReference._freshOrder?.order_number,
    rowOrReference._freshOrder?.orderId,
    rowOrReference.order_number,
    rowOrReference.orderNumber,
    rowOrReference.orderId,
    rowOrReference.reference_no,
    rowOrReference.invoice_number,
    rowOrReference.id,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);








  const expanded = values.flatMap((value) => {
    const compact = value.toUpperCase().replace(/\s+/g, "");
    const bare = compact.replace(/^ORD-?/, "");
    return /^\d{6,}$/.test(bare) ? [value, `ORD-${bare}`] : [value];
  });








  return [...new Set(expanded)].sort((a, b) => {
    const aIsOrder = /^ORD-?\d{6,}$/i.test(a);
    const bIsOrder = /^ORD-?\d{6,}$/i.test(b);
    if (aIsOrder === bIsOrder) return 0;
    return aIsOrder ? -1 : 1;
  });
};
const getDeliveredDate = (order = {}) =>
  order.deliveredAt ||
  order.delivered_at ||
  order.delivery_confirmed_at ||
  order.confirmed_at ||
  order.updated_at ||
  new Date().toISOString();
const inactiveInvoiceStatuses = new Set([
  "removed",
  "cancelled",
  "deleted",
  "cannot supply",
  "need supplier",
  "pre-order",
  "pre order",
  "pre-order supply",
  "pre order supply",
  "supply needed",
  "next supplier",
]);
const activeProcessingQueueStatuses = ["queued", "pending", "processing"];








export const getInvoiceLineQuantity = (item = {}) =>
  Number(item.qty ?? item.quantity ?? item.pickedQty ?? item.picked_qty ?? 0);








export const isActiveInvoiceLine = (item = {}) => {
  if (getInvoiceLineQuantity(item) <= 0) return false;








  const status = String(item.sourceStatus || item.source_status || item.status || "")
    .trim()
    .toLowerCase();


  if (inactiveInvoiceStatuses.has(status)) return false;








  if (inactiveInvoiceStatuses.has(status)) return false;








  // Pre-order supply intentionally changes status only. A line moved from
  // Need Supplier to In Stock can still carry a stale include_in_picking=false.
  // Explicit supplied status is authoritative for customer totals/printing.
  if (status === "in stock" || status === "available" || status === "supplied") {
    return true;
  }








  return item.includeInPicking !== false && item.include_in_picking !== false;
};








export const filterActiveInvoiceLines = (items = []) =>
  (items || []).filter(isActiveInvoiceLine);








const normalizeInvoiceOrder = (order = {}) => {
  const activeItems = filterActiveInvoiceLines(order.items || order.order_items || []);








  return {
    ...order,
    order_uuid: order.order_uuid || order.dbId || order.order_id || order.id || null,
    dbId: order.dbId || order.order_id || order.id || null,
    order_id: order.order_id || order.dbId || order.id || null,
    canonical_order_number:
      order.canonical_order_number || order.full_order_number || order.order_number || order.orderId,
    full_order_number:
      order.full_order_number || order.canonical_order_number || order.order_number || order.orderId,
    orderId: order.orderId || order.order_number,
    order_number: order.order_number || order.orderId,
    companyName: order.companyName || order.company_name,
    company_name: order.company_name || order.companyName,
    branchName:
      order.branchName ||
      order.delivery_branch_name ||
      order.branch_name ||
      order.shop_name ||
      "",
    branch_name: order.branch_name || order.delivery_branch_name || order.branchName || "",
    items: activeItems,
    order_items: activeItems,
  };
};








const ORDER_ITEMS_PAGE_SIZE = 1000;
const ORDER_ITEMS_ORDER_ID_CHUNK_SIZE = 100;








async function fetchAllOrderItemsForOrderIds(orderIds = []) {
  const uniqueOrderIds = [...new Set(orderIds.map(String).filter(Boolean))];
  if (!uniqueOrderIds.length) return [];








  const allItems = [];








  for (let chunkStart = 0; chunkStart < uniqueOrderIds.length; chunkStart += ORDER_ITEMS_ORDER_ID_CHUNK_SIZE) {
    const orderIdChunk = uniqueOrderIds.slice(
      chunkStart,
      chunkStart + ORDER_ITEMS_ORDER_ID_CHUNK_SIZE
    );








    for (let from = 0; ; from += ORDER_ITEMS_PAGE_SIZE) {
      const to = from + ORDER_ITEMS_PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from("order_items")
        .select("*")
        .in("order_id", orderIdChunk)
        .order("order_id", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);








      if (error) throw error;








      const rows = data || [];
      allItems.push(...rows);








      if (rows.length < ORDER_ITEMS_PAGE_SIZE) break;
    }
  }








  return allItems;
}








export async function hydrateOrdersWithFullOrderItems(orders = []) {
  if (!Array.isArray(orders) || !orders.length) return orders || [];








  const orderIds = orders.map((order) => order?.id).filter(Boolean);
  if (!orderIds.length) return orders;








  const orderItems = await fetchAllOrderItemsForOrderIds(orderIds);
  const itemsByOrderId = orderItems.reduce((groups, item) => {
    const key = String(item.order_id || "");
    if (!key) return groups;
    groups[key] = [...(groups[key] || []), item];
    return groups;
  }, {});








  return orders.map((order) => ({
    ...order,
    order_items: itemsByOrderId[String(order.id)] || [],
  }));
}








export async function fetchInvoiceOrderFromDb(rowOrReference = {}) {
  const references = getInvoiceReferenceCandidates(rowOrReference);








  if (!references.length) throw new Error("Invoice reference is required.");








  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .in("order_number", references)
    .order("created_at", { ascending: false })
    .limit(1);








  if (error) throw error;








  const order = Array.isArray(data) ? data[0] : data;
  if (!order) return null;








  const orderItems = await fetchAllOrderItemsForOrderIds([order.id]);
  const customerAccountId = order.customer_account_id || rowOrReference.customer_account_id;
  const customerBranchId =
    order.customer_branch_id ||
    order.branch_id ||
    rowOrReference.customer_branch_id ||
    rowOrReference.branch_id;
  const [customerAccountResult, customerBranchResult, invoiceRecordResult] = await Promise.all([
    customerAccountId
      ? supabase
          .from("customer_accounts")
          .select("*")
          .eq("id", customerAccountId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    customerBranchId
      ? supabase
          .from("customer_branches")
          .select("*")
          .eq("id", customerBranchId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("customer_invoices")
      .select("id, invoice_number, invoice_total, wallet_applied_amount, amount_to_collect, wallet_application_mode, wallet_preserve_paid_watermark")
      .eq("order_id", order.id)
      .neq("status", "CANCELLED")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const customerAccount = customerAccountResult.data || null;
  const customerBranch = customerBranchResult.data || null;
  const invoiceRecord = invoiceRecordResult.error ? null : invoiceRecordResult.data || null;








  const productIds = [
    ...new Set((orderItems || []).map((item) => item.product_id).filter(Boolean)),
  ];
  let productsById = {};
  let productsByName = {};








  if (productIds.length) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, product_code")
      .in("id", productIds);








    if (!productsError) {
      productsById = Object.fromEntries(
        (products || []).map((product) => [String(product.id), product])
      );
    }
  }








  const missingCodeNames = [
    ...new Set(
      (orderItems || [])
        .filter((item) => !getProductCodeFromInvoiceItem(item))
        .map((item) => String(item.product_name || item.name || "").trim())
        .filter(Boolean)
    ),
  ];








  if (missingCodeNames.length) {
    const { data: namedProducts, error: namedProductsError } = await supabase
      .from("products")
      .select("id, product_name, product_code")
      .in("product_name", missingCodeNames);








    if (!namedProductsError) {
      const groupedByName = (namedProducts || []).reduce((groups, product) => {
        const key = String(product.product_name || "").trim().toLowerCase();
        if (!key) return groups;
        groups[key] = [...(groups[key] || []), product];
        return groups;
      }, {});








      productsByName = Object.fromEntries(
        Object.entries(groupedByName)
          .filter(([, matches]) => matches.length === 1)
          .map(([name, matches]) => [name, matches[0]])
      );
    }
  }








  return normalizeInvoiceOrder({
    ...order,
    invoice_id: invoiceRecord?.id || order.invoice_id || null,
    invoice_number: invoiceRecord?.invoice_number || order.invoice_number || order.order_number,
    invoice_total: Number(invoiceRecord?.invoice_total ?? order.invoice_total ?? order.order_total ?? 0),
    wallet_applied_amount: Number(
      invoiceRecord?.wallet_applied_amount ?? order.wallet_applied_amount ?? order.wallet_requested_amount ?? 0
    ),
    amount_to_collect:
      invoiceRecord?.amount_to_collect !== null && invoiceRecord?.amount_to_collect !== undefined
        ? Number(invoiceRecord.amount_to_collect)
        : Number(order.order_total ?? order.invoice_total ?? 0) -
          Number(order.wallet_applied_amount ?? order.wallet_requested_amount ?? 0),
    wallet_application_mode:
      invoiceRecord?.wallet_application_mode ||
      (Number(order.wallet_applied_amount ?? order.wallet_requested_amount ?? 0) > 0
        ? "ORDER_SELECTED"
        : null),
    wallet_preserve_paid_watermark: Boolean(invoiceRecord?.wallet_preserve_paid_watermark),
    customer_accounts: customerAccount || order.customer_accounts || null,
    customer: customerAccount || order.customer || null,
    customer_branches: customerBranch || order.customer_branches || null,
    branch: customerBranch || order.branch || null,
    order_items: (orderItems || []).map((item) => ({
      ...item,
      ...(() => {
        const fallbackProduct =
          productsById[String(item.product_id)] ||
          productsByName[String(item.product_name || item.name || "").trim().toLowerCase()] ||
          null;
        const productCode = getProductCodeFromInvoiceItem({
          ...item,
          products: item.products || fallbackProduct,
          product: item.product || fallbackProduct,
        });








        return {
          product_code: item.product_code || productCode,
          productCode: item.productCode || productCode,
          products: item.products || fallbackProduct,
          product: item.product || fallbackProduct,
        };
      })(),
    })),
  });
}








const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");








const escapePdfText = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/£/g, "\\243");








const formatReceiptDateTime = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("en-GB");
  return date.toLocaleString("en-GB");
};








const isInvoiceGeneratedForOrder = (order = {}) => {
  if (order.invoice_number || order.invoiceNo || order.invoice_id || order.invoiceId) {
    return true;
  }








  return isDeliveredInvoiceStatus(order.status);
};








const pushAddressValue = (lines, value) => {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach((entry) => pushAddressValue(lines, entry));
    return;
  }








  String(value)
    .split(/\r?\n|,\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => lines.push(line));
};








const uniqueAddressLines = (lines = []) => {
  const seen = new Set();
  return lines.filter((line) => {
    const key = String(line || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};








const getCustomerAccountAddressLines = (account = {}) => {
  const lines = [];
  pushAddressValue(lines, account.address_line_1 || account.addressLine1 || account.address);
  pushAddressValue(lines, account.address_line_2 || account.addressLine2);
  pushAddressValue(lines, account.town || account.city);
  pushAddressValue(lines, account.county);
  pushAddressValue(lines, account.postcode || account.post_code);
  return uniqueAddressLines(lines);
};








const getOrderBillingAddressLines = (order = {}) => {
  const lines = [];
  pushAddressValue(
    lines,
    order.billingAddress ||
      order.billing_address ||
      order.invoiceAddress ||
      order.invoice_address ||
      order.customerInvoiceAddress ||
      order.customer_invoice_address
  );
  pushAddressValue(lines, order.billing_address_line_1 || order.billingAddressLine1);
  pushAddressValue(lines, order.billing_address_line_2 || order.billingAddressLine2);
  pushAddressValue(lines, order.billing_town || order.billing_city);
  pushAddressValue(lines, order.billing_postcode || order.billingPostcode);
  return uniqueAddressLines(lines);
};








export const getDeliveryAddressLines = (order = {}) => {
  const branchLines = [];
  pushAddressValue(
    branchLines,
    order.branchDeliveryAddress ||
      order.branch_delivery_address ||
      order.customer_branches?.delivery_address ||
      order.branch?.delivery_address ||
      order.branchAddress ||
      order.branch_address ||
      order.customer_branches?.address ||
      order.branch?.address
  );
  pushAddressValue(branchLines, order.branch_address_line_1 || order.branchAddressLine1);
  pushAddressValue(branchLines, order.branch_address_line_2 || order.branchAddressLine2);
  pushAddressValue(branchLines, order.branch_town || order.branch_city);
  pushAddressValue(
    branchLines,
    order.branch_postcode ||
      order.branchPostcode ||
      order.customer_branches?.postcode ||
      order.branch?.postcode
  );








  if (branchLines.length) return uniqueAddressLines(branchLines);








  const orderLines = [];
  pushAddressValue(orderLines, order.deliveryAddress || order.delivery_address);
  pushAddressValue(orderLines, order.delivery_address_line_1 || order.deliveryAddressLine1);
  pushAddressValue(orderLines, order.delivery_address_line_2 || order.deliveryAddressLine2);
  pushAddressValue(orderLines, order.delivery_town || order.delivery_city);
  pushAddressValue(orderLines, order.deliveryPostcode || order.delivery_postcode);








  if (orderLines.length) return uniqueAddressLines(orderLines);








  const customerLines = [];
  pushAddressValue(
    customerLines,
    order.customerAddress ||
      order.customer_address ||
      order.account_address ||
      order.customer_accounts?.address ||
      order.customer?.address ||
      order.address
  );
  pushAddressValue(customerLines, order.addressLine1 || order.address_line_1);
  pushAddressValue(customerLines, order.addressLine2 || order.address_line_2);
  pushAddressValue(customerLines, order.town || order.city);
  pushAddressValue(customerLines, order.postcode || order.billing_postcode);








  if (customerLines.length) return uniqueAddressLines(customerLines);








  return ["Address not available"];
};








export const getDeliveryAddress = (order = {}) =>
  getDeliveryAddressLines(order).join(", ");








const getBillingAddress = (order = {}) => {
  const customerAccount = order.customer_accounts || order.customer || {};








  const accountInvoiceLines = [];
  pushAddressValue(accountInvoiceLines, customerAccount.invoice_address);
  if (accountInvoiceLines.length) return uniqueAddressLines(accountInvoiceLines).join(", ");








  const accountBillingLines = [];
  pushAddressValue(accountBillingLines, customerAccount.billing_address);
  if (accountBillingLines.length) return uniqueAddressLines(accountBillingLines).join(", ");








  const accountMainLines = getCustomerAccountAddressLines(customerAccount);
  if (accountMainLines.length) return accountMainLines.join(", ");








  const orderBillingLines = getOrderBillingAddressLines(order);
  if (orderBillingLines.length) return orderBillingLines.join(", ");








  return getDeliveryAddress(order);
};








const getDriverName = (order = {}) =>
  order.driverName ||
  order.driver_name ||
  order.delivered_confirmed_by ||
  order.confirmedBy ||
  order.confirmed_by ||
  "";








const parseMoneyValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};



