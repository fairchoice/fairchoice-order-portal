import { supabase } from "./supabase";
import { calculateDocumentTotals } from "../utils/documentTotals";
import {
  calculateCartOrderItems,
  calculateCartTotals,
  getOrderItemProductCode,
} from "../utils/orderTotals";
import { isServerManagerPriceMode, roundMoney } from "../utils/pricing";
import { formatCurrency } from "../utils/currency";
import { sortPrintItems } from "../utils/printItemSorting";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import fairchoiceLogo from "../assets/fairchoice-logo.png";

const getOrderReference = (order = {}) => order.orderId || order.order_number || order.id;
const getCustomerName = (order = {}) => order.companyName || order.company_name || order.customerName || "Unknown Customer";
const getBranchName = (order = {}) => order.branchName || order.branch_name || order.delivery_branch_name || "";
const getBranchId = (order = {}) => order.customerBranchId || order.customer_branch_id || null;
const getCustomerAccountId = (order = {}) => order.customerAccountId || order.customer_account_id || null;
const getInvoiceReference = (row = {}) =>
  row.reference_no ||
  row.order_number ||
  row.invoice_number ||
  row.orderId ||
  row.id ||
  "";
const getInvoiceReferenceCandidates = (rowOrReference = {}) => {
  if (typeof rowOrReference === "string") return [rowOrReference];

  const values = [
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
const inactiveInvoiceStatuses = new Set(["removed", "cancelled", "deleted"]);
const activeProcessingQueueStatuses = ["queued", "pending", "processing"];

export const getInvoiceLineQuantity = (item = {}) =>
  Number(item.qty ?? item.quantity ?? item.pickedQty ?? item.picked_qty ?? 0);

export const isActiveInvoiceLine = (item = {}) => {
  if (getInvoiceLineQuantity(item) <= 0) return false;
  if (item.includeInPicking === false || item.include_in_picking === false) return false;

  const status = String(item.sourceStatus || item.source_status || item.status || "")
    .trim()
    .toLowerCase();

  return !inactiveInvoiceStatuses.has(status);
};

export const filterActiveInvoiceLines = (items = []) =>
  (items || []).filter(isActiveInvoiceLine);

const normalizeInvoiceOrder = (order = {}) => {
  const activeItems = filterActiveInvoiceLines(order.items || order.order_items || []);

  return {
    ...order,
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
  const [customerAccountResult, customerBranchResult] = await Promise.all([
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
  ]);
  const customerAccount = customerAccountResult.data || null;
  const customerBranch = customerBranchResult.data || null;

  const productIds = [
    ...new Set((orderItems || []).map((item) => item.product_id).filter(Boolean)),
  ];
  let productsById = {};
  let productsByName = {};

  if (productIds.length) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, product_code, code, sku")
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
      .select("id, product_name, product_code, code, sku")
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

const firstMoneyValue = (...values) => {
  for (const value of values) {
    const parsed = parseMoneyValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
};

export const isInvoicePaid = (order = {}, totals = {}) => {
  if (order._ledgerPaid === true || order.ledgerPaid === true) return true;

  const paymentStatus = String(order.payment_status || order.paymentStatus || "")
    .trim()
    .toLowerCase();

  if (paymentStatus === "paid") return true;

  const invoiceTotal = firstMoneyValue(
    totals.grandTotal,
    totals.grand_total,
    order.grandTotal,
    order.grand_total,
    order.invoice_total,
    order.invoiceTotal,
    order.order_total,
    order.orderTotal,
    order.total_amount,
    order.final_total,
    order.total
  );

  const amountDue = firstMoneyValue(
    order.amount_due,
    order.amountDue,
    order.remaining_amount,
    order.remainingAmount,
    order.balance_due,
    order.balanceDue,
    order.outstanding_amount,
    order.outstandingAmount
  );

  if (amountDue !== null && amountDue <= 0) {
    return true;
  }

  const paidAmount = firstMoneyValue(
    order.payment_amount,
    order.paymentAmount,
    order.paid_amount,
    order.paidAmount,
    order.amount_paid,
    order.amountPaid,
    order.total_paid,
    order.totalPaid
  );

  if (invoiceTotal !== null && invoiceTotal > 0 && paidAmount !== null && paidAmount >= invoiceTotal) {
    return true;
  }

  return false;
};

const getInvoiceLedgerReferences = (order = {}) => [
  order.order_number,
  order.orderNumber,
  order.orderId,
  order.reference_no,
  order.invoice_number,
]
  .map((value) => String(value || "").trim())
  .filter(Boolean);

const getLedgerRowDebit = (row = {}) =>
  Number(row.debit ?? row.invoice_amount ?? row.invoice_total ?? 0);

const getLedgerRowCredit = (row = {}) =>
  Number(row.credit ?? row.payment_amount ?? row.amount_paid ?? 0);

const getProductCodeFromInvoiceItem = (item = {}) =>
  item.product_code ||
  item.code ||
  item.sku ||
  item.SKU ||
  item.productCode ||
  item.products?.product_code ||
  item.products?.code ||
  item.products?.sku ||
  item.product?.product_code ||
  item.product?.code ||
  item.product?.sku ||
  item.product?.productCode ||
  "";

const withProductCodeFallbacks = async (order = {}) => {
  const items = order.items || order.order_items || [];
  const missingProductIds = [
    ...new Set(
      (items || [])
        .filter((item) => !getProductCodeFromInvoiceItem(item))
        .map((item) => item.product_id || item.productId || item.id)
        .filter(Boolean)
        .map(String)
    ),
  ];

  const missingProductNames = [
    ...new Set(
      (items || [])
        .filter((item) => !getProductCodeFromInvoiceItem(item))
        .map((item) => String(item.product_name || item.productName || item.name || "").trim())
        .filter(Boolean)
    ),
  ];

  if (!missingProductIds.length && !missingProductNames.length) return order;

  let productsById = {};
  let productsByName = {};

  if (missingProductIds.length) {
    const { data, error } = await supabase
      .from("products")
      .select("id, product_name, product_code, code, sku")
      .in("id", missingProductIds);

    if (error) {
      console.warn("Invoice product code fallback lookup failed", error);
    } else {
      productsById = Object.fromEntries(
        (data || []).map((product) => [String(product.id), product])
      );
    }
  }

  if (missingProductNames.length) {
    const { data, error } = await supabase
      .from("products")
      .select("id, product_name, product_code, code, sku")
      .in("product_name", missingProductNames);

    if (error) {
      console.warn("Invoice product name fallback lookup failed", error);
    } else {
      const groupedByName = (data || []).reduce((groups, product) => {
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

  const nextItems = (items || []).map((item) => {
    if (getProductCodeFromInvoiceItem(item)) return item;

    const product =
      productsById[String(item.product_id || item.productId || item.id)] ||
      productsByName[
        String(item.product_name || item.productName || item.name || "")
          .trim()
          .toLowerCase()
      ];
    const productCode = getProductCodeFromInvoiceItem({ product, products: product });

    return {
      ...item,
      product_code: productCode || item.product_code || "",
      productCode: productCode || item.productCode || "",
      products: item.products || product || null,
      product: item.product || product || null,
    };
  });

  return {
    ...order,
    items: nextItems,
    order_items: nextItems,
  };
};

export async function resolveInvoiceLedgerPaymentStatus(order = {}) {
  const references = [...new Set(getInvoiceLedgerReferences(order))];
  if (!references.length) return { ledgerPaid: false, ledgerBalance: null, ledgerRows: [] };

  const { data, error } = await supabase
    .from("customer_ledger")
    .select("id, reference_no, order_number, entry_type, transaction_type, debit, credit, amount, payment_amount, invoice_amount, invoice_total")
    .or(
      references
        .flatMap((reference) => [
          `reference_no.eq.${reference}`,
          `order_number.eq.${reference}`,
        ])
        .join(",")
    );

  if (error) {
    console.warn("Invoice ledger payment status lookup failed", error);
    return { ledgerPaid: false, ledgerBalance: null, ledgerRows: [] };
  }

  const rows = data || [];
  if (!rows.length) return { ledgerPaid: false, ledgerBalance: null, ledgerRows: [] };

  const netBalance = rows.reduce((sum, row) => {
    const type = String(row.entry_type || row.transaction_type || "").toLowerCase();
    const rawAmount = Number(row.amount || 0);
    const debit =
      getLedgerRowDebit(row) ||
      (type.includes("invoice") && rawAmount > 0 ? rawAmount : 0);
    const credit =
      getLedgerRowCredit(row) ||
      (rawAmount < 0
        ? Math.abs(rawAmount)
        : type.includes("payment") || type.includes("credit")
          ? rawAmount
          : 0);

    return sum + debit - credit;
  }, 0);

  const hasInvoiceDebit = rows.some((row) => {
    const type = String(row.entry_type || row.transaction_type || "").toLowerCase();
    return getLedgerRowDebit(row) > 0 || (type.includes("invoice") && Number(row.amount || 0) > 0);
  });
  const hasCredit = rows.some((row) => getLedgerRowCredit(row) > 0 || Number(row.amount || 0) < 0);

  return {
    ledgerPaid: hasInvoiceDebit && hasCredit && netBalance <= 0.01,
    ledgerBalance: netBalance,
    ledgerRows: rows,
  };
}

export async function withResolvedInvoicePaymentStatus(order = {}) {
  const productCodeOrder = await withProductCodeFallbacks(order);
  const invoiceOrder = normalizeInvoiceOrder(productCodeOrder);
  const totals = calculateDocumentTotals(invoiceOrder.items || [], invoiceOrder);

  if (isInvoicePaid(invoiceOrder, totals)) {
    return { ...invoiceOrder, _ledgerPaid: true };
  }

  const ledgerStatus = await resolveInvoiceLedgerPaymentStatus(invoiceOrder);
  return {
    ...invoiceOrder,
    _ledgerPaid: ledgerStatus.ledgerPaid,
    _ledgerBalance: ledgerStatus.ledgerBalance,
  };
}

const getInvoicePaymentStatus = (order = {}, totals = {}) =>
  order._documentPaymentStatus || order.documentPaymentStatus || (isInvoicePaid(order, totals) ? "PAID" : "UNPAID");

export const getPrintTemplate = (priceMode) =>
  isServerManagerPriceMode(priceMode)
    ? "orderForm"
    : "salesInvoice";

const getThermalReceiptRows = (order = {}) => {
  const invoiceOrder = normalizeInvoiceOrder(order);
  const totals = calculateDocumentTotals(invoiceOrder.items || [], invoiceOrder);
  const hasVat = Number(totals.vatTotal || 0) > 0;
  const isServerManager = isServerManagerPriceMode(invoiceOrder.priceMode || invoiceOrder.price_mode);

  return {
    totals,
    hasVat,
    isServerManager,
    items: sortPrintItems(totals.invoiceItems || []),
    isInvoice: isInvoiceGeneratedForOrder(order),
    reference: getOrderReference(order) || "-",
    customerName: getCustomerName(invoiceOrder),
    branchName: getBranchName(invoiceOrder),
    deliveryAddress: getDeliveryAddress(invoiceOrder),
    deliveryAddressLines: getDeliveryAddressLines(invoiceOrder),
    driverName: getDriverName(invoiceOrder),
    paymentStatus: getInvoicePaymentStatus(invoiceOrder, totals),
    totalQuantity: totals.totalQuantity || 0,
    totalLines: totals.totalLines || 0,
    dateTime: formatReceiptDateTime(
      order.invoiceDate ||
        order.invoice_date ||
        order.deliveredDate ||
        order.delivered_date ||
        order.deliveredAt ||
        order.delivered_at ||
        order.createdAt ||
        order.created_at ||
        new Date()
    ),
  };
};

const getThermalLineAmount = (item = {}) =>
  item.gross_total ?? item.grossTotal ?? item.line_total ?? item.lineTotal ?? item.net_total ?? 0;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getThermalOrderNumber = (order = {}) => {
  const orderNumber = [order.order_number, order.orderNumber, order.orderId]
    .map((value) => String(value || "").trim())
    .find((value) => value && !UUID_PATTERN.test(value));

  return orderNumber ? formatDisplayOrderId(orderNumber) : "Not available";
};

const getThermalUnitAmount = (item = {}) => {
  const savedUnitAmount = item.price ?? item.unit_price ?? item.unitPrice;
  if (savedUnitAmount !== null && savedUnitAmount !== undefined && savedUnitAmount !== "") {
    return Number(savedUnitAmount || 0);
  }

  const quantity = Number(getInvoiceLineQuantity(item) || 0);
  return quantity > 0 ? Number(getThermalLineAmount(item) || 0) / quantity : 0;
};

const wrapText = (text, maxLength = 28) => {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  words.forEach((word) => {
    if (!current) {
      current = word;
      return;
    }

    if (`${current} ${word}`.length <= maxLength) {
      current = `${current} ${word}`;
      return;
    }

    lines.push(current);
    current = word;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

export function buildThermalReceiptHtml(order = {}) {
  const receipt = getThermalReceiptRows(order);
  const title = receipt.isServerManager
    ? "ORDER FORM"
    : receipt.isInvoice
    ? "SALES RECEIPT"
    : "ORDER RECEIPT";
  const orderNumber = getThermalOrderNumber(order);

  return `
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)} - ${escapeHtml(orderNumber)}</title>
        <style>
          @page { margin: 2mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body {
            width: 100%;
            max-width: 80mm;
            margin: 0 auto;
            color: #111;
            background: #fff;
            font-family: "Courier New", Courier, monospace;
            font-size: 10px;
            line-height: 1.22;
          }
          .receipt {
            width: 100%;
            padding: 1.5mm;
          }
          .center { text-align: center; }
          .logo {
            display: block;
            width: auto;
            max-width: 30mm;
            max-height: 14mm;
            margin: 0 auto 1mm;
            object-fit: contain;
            filter: grayscale(1) contrast(1.25);
          }
          .brand { font-size: 13px; font-weight: 900; line-height: 1.1; }
          .title { font-size: 12px; font-weight: 900; margin: 1.5mm 0 2mm; letter-spacing: .4px; }
          .rule { border-top: 1px dashed #111; margin: 2mm 0; }
          .meta { display: grid; gap: .7mm; }
          .meta-row {
            display: grid;
            grid-template-columns: 18mm minmax(0, 1fr);
            gap: 1.5mm;
            align-items: start;
          }
          .meta-label { font-weight: 900; }
          .meta-value { overflow-wrap: anywhere; word-break: break-word; }
          .payment-status {
            display: inline-block;
            border: 1px solid #111;
            padding: .4mm 1.4mm;
            font-weight: 900;
          }
          .column-head,
          .item-detail {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 17mm 18mm;
            gap: 1.5mm;
            align-items: baseline;
          }
          .column-head { font-weight: 900; }
          .product-item { padding: 1.2mm 0; border-bottom: 1px dotted #999; }
          .product-name { margin-bottom: .5mm; font-weight: 700; overflow-wrap: anywhere; }
          .item-detail { color: #222; }
          .right { text-align: right; white-space: nowrap; }
          .totals { margin-top: 1mm; }
          .total-row {
            display: flex;
            justify-content: space-between;
            gap: 3mm;
            padding: .5mm 0;
          }
          .total-row span:last-child { text-align: right; white-space: nowrap; }
          .grand {
            margin-top: 1mm;
            padding-top: 1.5mm;
            border-top: 2px solid #111;
            font-size: 13px;
            font-weight: 900;
          }
          .footer { margin-top: 3mm; font-size: 9px; }
          @media print {
            html, body { width: 100%; max-width: none; }
            .receipt { padding: 0; }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
        <header class="center">
          <img class="logo" src="${escapeHtml(fairchoiceLogo)}" alt="Fair Choice" />
          <div class="brand">Fair Choice Cash &amp; Carry</div>
          <div class="title">${escapeHtml(title)}</div>
        </header>
        <div class="rule"></div>
        <section class="meta">
          <div class="meta-row"><span class="meta-label">Order No</span><span class="meta-value">${escapeHtml(orderNumber)}</span></div>
          <div class="meta-row"><span class="meta-label">Customer</span><span class="meta-value">${escapeHtml(receipt.customerName || "Not available")}</span></div>
          <div class="meta-row"><span class="meta-label">Branch</span><span class="meta-value">${escapeHtml(receipt.branchName || "Main account")}</span></div>
          <div class="meta-row"><span class="meta-label">Deliver To</span><span class="meta-value">${
            receipt.deliveryAddressLines.length
              ? receipt.deliveryAddressLines.map((line) => escapeHtml(line)).join("<br />")
              : "Not available"
          }</span></div>
          <div class="meta-row"><span class="meta-label">Date/Time</span><span class="meta-value">${escapeHtml(receipt.dateTime)}</span></div>
          <div class="meta-row"><span class="meta-label">Driver</span><span class="meta-value">${escapeHtml(receipt.driverName || "Not assigned")}</span></div>
          <div class="meta-row"><span class="meta-label">Payment Status</span><span class="meta-value"><span class="payment-status">${escapeHtml(receipt.paymentStatus || "Not available")}</span></span></div>
        </section>
        <div class="rule"></div>
        <div class="column-head"><span>Product / Qty</span><span class="right">Unit</span><span class="right">Line</span></div>
        <div class="rule"></div>
        <section>
        ${receipt.items
          .map((item) => {
            const quantity = getInvoiceLineQuantity(item);
            return `<div class="product-item">
              <div class="product-name">${escapeHtml(item.name || item.productName || item.product_name || "Product")}</div>
              <div class="item-detail"><span>Qty ${escapeHtml(quantity)}</span><span class="right">${escapeHtml(
                formatCurrency(getThermalUnitAmount(item))
              )}</span><strong class="right">${escapeHtml(formatCurrency(getThermalLineAmount(item)))}</strong></div>
            </div>`;
          })
          .join("")}
        </section>
        <div class="rule"></div>
        <section class="totals">
          <div class="total-row"><span>Item Count</span><span>${escapeHtml(receipt.totalQuantity)}</span></div>
          <div class="total-row"><span>Subtotal</span><span>${escapeHtml(formatCurrency(receipt.totals.netTotal))}</span></div>
          ${receipt.hasVat ? `<div class="total-row"><span>VAT</span><span>${escapeHtml(formatCurrency(receipt.totals.vatTotal))}</span></div>` : ""}
          <div class="total-row grand"><span>Total</span><span>${escapeHtml(formatCurrency(receipt.totals.grandTotal))}</span></div>
        </section>
        <footer class="center footer">Thank you for your order</footer>
        </main>
      </body>
    </html>
  `;
}

const buildThermalReceiptPdf = (order = {}) => {
  const receipt = getThermalReceiptRows(order);
  const title = receipt.isServerManager
    ? "ORDER FORM"
    : receipt.isInvoice
    ? "SALES RECEIPT"
    : "ORDER RECEIPT";
  const orderNumber = getThermalOrderNumber(order);
  const lines = [
    { text: "Fair Choice Cash & Carry", size: 11, bold: true },
    { text: title, size: 11, bold: true },
    { text: `Order No: ${orderNumber}` },
    { text: `Customer: ${receipt.customerName}` },
    { text: `Branch: ${receipt.branchName || "Main account"}` },
  ];

  lines.push({ text: "Delivery Address:", bold: true });
  if (receipt.deliveryAddressLines.length) {
    receipt.deliveryAddressLines.forEach((line) => {
      wrapText(line, 32).forEach((text) => lines.push({ text }));
    });
  } else {
    lines.push({ text: "Not available" });
  }
  lines.push({ text: `Date/Time: ${receipt.dateTime}` });
  lines.push({ text: `Driver: ${receipt.driverName || "Not assigned"}` });
  lines.push({ text: `Payment Status: ${receipt.paymentStatus || "Not available"}`, bold: true });
  lines.push({ text: "--------------------------------" });
  lines.push({ text: "Product / Qty       Unit     Line", bold: true });
  lines.push({ text: "--------------------------------" });

  receipt.items.forEach((item) => {
    const quantity = String(getInvoiceLineQuantity(item));
    const unitAmount = formatCurrency(getThermalUnitAmount(item));
    const lineAmount = formatCurrency(getThermalLineAmount(item));
    wrapText(item.name || item.productName || item.product_name || "Product", 32)
      .forEach((text) => lines.push({ text, bold: true }));
    lines.push({ text: `Qty ${quantity.padEnd(6, " ")} ${unitAmount.padStart(8, " ")} ${lineAmount.padStart(8, " ")}` });
  });

  lines.push({ text: "--------------------------------" });
  lines.push({ text: `Item Count ${receipt.totalQuantity}`, bold: true });
  lines.push({ text: `Subtotal ${formatCurrency(receipt.totals.netTotal)}`, bold: true });
  if (receipt.hasVat) {
    lines.push({ text: `VAT ${formatCurrency(receipt.totals.vatTotal)}`, bold: true });
  }
  lines.push({ text: `TOTAL ${formatCurrency(receipt.totals.grandTotal)}`, size: 11, bold: true });
  lines.push({ text: "Thank you for your order" });

  const width = 226.77;
  const height = Math.max(280, 28 + lines.length * 13);
  let y = height - 18;
  const content = lines
    .map((line) => {
      const font = line.bold ? "F2" : "F1";
      const size = line.size || 9;
      const output = `BT /${font} ${size} Tf 10 ${y} Td (${escapePdfText(line.text)}) Tj ET`;
      y -= 13;
      return output;
    })
    .join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(
      2
    )} ${height.toFixed(
      2
    )}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj",
    `6 0 obj << /Length ${content.length} >> stream\n${content}\nendstream endobj`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object) => {
    offsets.push(pdf.length);
    pdf += `${object}\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return pdf;
};

export function printThermalReceipt(order = {}) {
  const win = window.open("", "_blank", "width=380,height=720");
  if (!win) {
    alert("Popup blocked. Please allow popups to print the thermal receipt.");
    return;
  }

  win.document.write(buildThermalReceiptHtml(order));
  win.document.close();
  win.focus();
  win.print();
}

export function downloadThermalReceipt(order = {}) {
  const orderNumber = getThermalOrderNumber(order).replace(/[^a-z0-9-]+/gi, "-") || "receipt";
  const blob = new Blob([buildThermalReceiptPdf(order)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `thermal-receipt-${orderNumber}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const DEFAULT_INVOICE_SETTINGS = {
  companyLogo: fairchoiceLogo,
  companyName: "Fair Choice Cash & Carry",
  companyAddress:
    "Fair Choice Cash and Carry Ltd\n177 Pant Yr Heol, Panty Yr Heol\nNeath, SA11 2HB\nUnited Kingdom\nRegistered in England and Wales No. 16350457",
  vatNumber: "GB 489728125",
  companyRegistrationNumber: "16350457",
  telephone: "07491116595",
  email: "info@fairchoice.co.uk",
  footerText: "Thank you for your business.",
  paymentTerms: "Payment due according to agreed credit terms.",
  defaultNotes: "",
  invoiceTitle: "SALES INVOICE",
  thermalReceiptWidth: "80mm",
};

export function getInvoiceSettings(overrides = {}) {
  let storedSettings = {};

  try {
    storedSettings = JSON.parse(
      localStorage.getItem("fairchoice_invoice_settings") || "{}"
    );
  } catch {
    storedSettings = {};
  }

  return {
    ...DEFAULT_INVOICE_SETTINGS,
    ...storedSettings,
    ...overrides,
  };
}

export function saveInvoiceSettings(settings = {}) {
  const nextSettings = {
    ...getInvoiceSettings(),
    ...settings,
  };
  localStorage.setItem("fairchoice_invoice_settings", JSON.stringify(nextSettings));
  return nextSettings;
}

const getOrderDate = (order = {}) =>
  order.invoiceDate ||
  order.invoice_date ||
  order.createdAt ||
  order.created_at ||
  order.orderDate ||
  order.order_date ||
  new Date();

const formatInvoiceDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return String(value || "-");
  return date.toLocaleDateString("en-GB");
};

const isSettingFalse = (...values) => values.some((value) => value === false || value === "false");

const shouldShowInvoiceHeaderFooter = (settings = {}, order = {}) => {
  if (
    isSettingFalse(
      settings.showHeaderFooter,
      settings.show_header_footer,
      settings.includeHeaderFooter,
      settings.include_header_footer
    )
  ) {
    return false;
  }

  if (
    isServerManagerPriceMode(order.priceMode || order.price_mode) &&
    (isSettingFalse(
      settings.showServerManagerHeaderFooter,
      settings.show_server_manager_header_footer
    ) ||
      settings.hideServerManagerHeaderFooter === true ||
      settings.hide_server_manager_header_footer === true)
  ) {
    return false;
  }

  return true;
};

const getOrderItemsForInvoice = (order = {}) =>
  calculateDocumentTotals(filterActiveInvoiceLines(order.items || order.order_items || []), order)
    .invoiceItems || [];

const getLineQuantity = (item = {}) =>
  getInvoiceLineQuantity(item);

const getLinePrice = (item = {}) =>
  Number(item.price ?? item.unit_price ?? item.unitPrice ?? 0);

const getLineVatRate = (item = {}) =>
  Number(item.vatRate ?? item.vat_rate ?? item.vatPercent ?? item.vat_percent ?? 0);

const getInvoiceProductCode = (item = {}) => getProductCodeFromInvoiceItem(item);

const getPrintableCompanyAddress = (address = "") =>
  String(address || "")
    .split(/\r?\n/)
    .filter((line) => !/registered in england and wales no/i.test(line))
    .join("\n");

function buildLegacyStandardInvoiceHtml(
  order = {},
  { documentType = "invoice", autoPrint = false, settings: settingsOverride = {} } = {}
) {
  const invoiceOrder = normalizeInvoiceOrder(order);
  const settings = getInvoiceSettings(settingsOverride);
  const totals = calculateDocumentTotals(invoiceOrder.items || [], invoiceOrder);
  const items = sortPrintItems(getOrderItemsForInvoice(invoiceOrder));
  const isDeliveryNote = documentType === "deliveryNote";
  const isOrderForm = documentType === "orderForm";
  const isServerManagerDocument = isServerManagerPriceMode(
    invoiceOrder.priceMode || invoiceOrder.price_mode
  );
  const showPrices = !isDeliveryNote;
  const title = isDeliveryNote
    ? "DELIVERY NOTE"
    : isOrderForm
    ? "ORDER FORM"
    : settings.invoiceTitle || "SALES INVOICE";
  const showHeaderFooter =
    isServerManagerDocument && (isDeliveryNote || isOrderForm)
      ? false
      : shouldShowInvoiceHeaderFooter(settings, invoiceOrder);
  const referenceLabel = isOrderForm || isDeliveryNote ? "Order Number" : "Invoice Number";
  const rawReference = getOrderReference(invoiceOrder) || "-";
  const reference =
    isOrderForm || isDeliveryNote
      ? formatDisplayOrderId(rawReference)
      : rawReference;
  const customerName = getCustomerName(invoiceOrder);
  const branchName = getBranchName(invoiceOrder);
  const deliveryAddress = getDeliveryAddress(invoiceOrder);
  const rows = items
    .map((item) => {
      const quantity = getLineQuantity(item);
      const unitPrice = getLinePrice(item);
      const netTotal = Number(item.net_total ?? item.netTotal ?? 0);
      const vatRate = getLineVatRate(item);
      const productCode = getInvoiceProductCode(item);

      return `
        <tr>
          <td>${escapeHtml(productCode)}</td>
          <td>${escapeHtml(item.name || item.productName || item.product_name || "")}</td>
          <td class="right">${escapeHtml(quantity)}</td>
          ${
            showPrices
              ? `
                <td class="right">${escapeHtml(formatCurrency(unitPrice))}</td>
                <td class="right">${escapeHtml(vatRate.toFixed(2))}</td>
                <td class="right">${escapeHtml(formatCurrency(netTotal))}</td>
              `
              : ""
          }
        </tr>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(title)} ${escapeHtml(reference)}</title>
        <style>
          @page { size: A4; margin: 10mm; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #000;
            font-family: Arial, sans-serif;
            font-size: 12px;
          }
          .page {
            width: 190mm;
            max-width: 190mm;
            margin: 0 auto;
            min-height: 277mm;
            display: flex;
            flex-direction: column;
          }
          .content {
            flex: 1 0 auto;
            padding-bottom: 8mm;
          }
          .top {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            border-bottom: 1px solid #000;
            padding-bottom: 9px;
          }
          .company {
            white-space: pre-line;
            line-height: 1.4;
            font-size: 12px;
          }
          .logo {
            height: 82px;
            max-width: 190px;
            object-fit: contain;
          }
          .title {
            font-size: 25px;
            font-weight: 900;
            text-align: center;
            margin: 0 0 12px;
          }
          .invoice-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 220px;
            gap: 22px;
            margin-top: 15px;
            page-break-inside: avoid;
          }
          .box-title {
            font-size: 12px;
            font-weight: 800;
            margin-bottom: 5px;
          }
          .invoice-to {
            font-size: 12px;
            line-height: 1.45;
          }
          .details-row {
            display: grid;
            grid-template-columns: 105px 1fr;
            gap: 6px;
            margin-bottom: 5px;
            font-size: 12px;
          }
          .details-row:last-child span {
            font-size: 13px;
            font-weight: 800;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 18px;
            font-size: 11.5px;
          }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
          th {
            background-color: #d9e2f3 !important;
            color: #000 !important;
            font-size: 11.5px;
            font-weight: 800;
            padding: 6px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          td {
            padding: 4px 5px;
            vertical-align: top;
            overflow-wrap: anywhere;
          }
          .right { text-align: right; }
          .summary-area {
            display: grid;
            grid-template-columns: 1fr 285px;
            gap: 22px;
            align-items: start;
            margin-top: 18px;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .qty-box {
            font-size: 13px;
            font-weight: 800;
            line-height: 1.8;
          }
          .summary-box {
            border: 1px solid #000;
            font-size: 12px;
          }
          .summary-row {
            display: grid;
            grid-template-columns: 1fr 115px;
            border-bottom: 1px solid #000;
          }
          .summary-row:last-child { border-bottom: none; }
          .summary-label,
          .summary-value {
            padding: 7px;
          }
          .summary-label { font-weight: 800; }
          .summary-value { text-align: right; }
          .grand {
            font-size: 16px;
            font-weight: 900;
          }
          .deliver {
            margin-top: 18px;
            line-height: 1.45;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          .notes {
            margin-top: 14px;
            line-height: 1.45;
            page-break-inside: avoid;
          }
          .footer {
            flex-shrink: 0;
            border-top: 1px solid #000;
            padding-top: 8px;
            margin-top: 10mm;
            font-size: 10.5px;
            line-height: 1.4;
          }
          @media print {
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html,
            body {
              width: 210mm;
              max-width: 210mm;
              overflow: visible;
            }
            .page {
              width: 190mm;
              max-width: 190mm;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <main class="content">
            ${
              showHeaderFooter
                ? `
                  <div class="top">
                    <div class="company">
                      <strong>${escapeHtml(settings.companyName)}</strong>
                      ${escapeHtml(settings.companyAddress)}
                      ${settings.vatNumber ? `VAT Number: ${escapeHtml(settings.vatNumber)}` : ""}
                      ${settings.telephone ? `Telephone: ${escapeHtml(settings.telephone)}` : ""}
                      ${settings.email ? `Email: ${escapeHtml(settings.email)}` : ""}
                    </div>
                    ${settings.companyLogo ? `<img src="${escapeHtml(settings.companyLogo)}" class="logo" />` : ""}
                  </div>
                `
                : ""
            }

            <section class="invoice-grid">
              <div class="invoice-to">
                <div class="box-title">${isDeliveryNote ? "Deliver To:" : "Invoice To:"}</div>
                <div>${escapeHtml(customerName)}</div>
                ${branchName ? `<div>${escapeHtml(branchName)}</div>` : ""}
                ${deliveryAddress ? `<div>${escapeHtml(deliveryAddress)}</div>` : ""}
              </div>
              <div>
                <div class="title">${escapeHtml(title)}</div>
                <div class="details-row"><strong>Date</strong><span>${escapeHtml(formatInvoiceDate(getOrderDate(invoiceOrder)))}</span></div>
                <div class="details-row"><strong>Due Date</strong><span>${escapeHtml(invoiceOrder.dueDate || invoiceOrder.due_date || "-")}</span></div>
                <div class="details-row"><strong>Customer Code</strong><span>${escapeHtml(invoiceOrder.customerCode || invoiceOrder.customer_code || customerName || "-")}</span></div>
                <div class="details-row"><strong>${escapeHtml(referenceLabel)}</strong><span>${escapeHtml(reference)}</span></div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  <th style="width:90px;">Code</th>
                  <th>Description</th>
                  <th style="width:58px;" class="right">Qty</th>
                  ${
                    showPrices
                      ? `
                        <th style="width:78px;" class="right">Price</th>
                        <th style="width:58px;" class="right">VAT %</th>
                        <th style="width:88px;" class="right">Net</th>
                      `
                      : ""
                  }
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="${showPrices ? 6 : 3}">No supplied items.</td></tr>`}
              </tbody>
            </table>

            <section class="summary-area">
              <div class="qty-box">
                <div>Total Quantity&nbsp;&nbsp;&nbsp; ${escapeHtml(totals.totalQuantity)}</div>
                <div>Total Lines&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ${escapeHtml(totals.totalLines)}</div>
              </div>
              ${
                showPrices
                  ? `
                    <div class="summary-box">
                      <div class="summary-row"><div class="summary-label">Total Net</div><div class="summary-value">${escapeHtml(formatCurrency(totals.netTotal))}</div></div>
                      <div class="summary-row"><div class="summary-label">Total VAT</div><div class="summary-value">${escapeHtml(formatCurrency(totals.vatTotal))}</div></div>
                      <div class="summary-row grand"><div class="summary-label">TOTAL</div><div class="summary-value">${escapeHtml(formatCurrency(totals.grandTotal))}</div></div>
                    </div>
                  `
                  : ""
              }
            </section>

            <section class="deliver">
              <div class="box-title">Deliver To:</div>
              <div>${escapeHtml(customerName)}</div>
              ${branchName ? `<div>${escapeHtml(branchName)}</div>` : ""}
              ${deliveryAddress ? `<div>${escapeHtml(deliveryAddress)}</div>` : ""}
            </section>

            ${(settings.defaultNotes || invoiceOrder.notes) ? `<section class="notes">${escapeHtml(invoiceOrder.notes || settings.defaultNotes)}</section>` : ""}
          </main>
          ${
            showHeaderFooter
              ? `
                <footer class="footer">
                  ${escapeHtml(settings.footerText)}<br />
                  ${escapeHtml(settings.paymentTerms)}
                </footer>
              `
              : ""
          }
        </div>
        ${autoPrint ? "<script>window.print();</script>" : ""}
      </body>
    </html>
  `;
}

export function buildStandardInvoiceHtml(
  order = {},
  { documentType = "invoice", autoPrint = false, settings: settingsOverride = {} } = {}
) {
  const invoiceOrder = normalizeInvoiceOrder(order);
  const printTemplate = getPrintTemplate(invoiceOrder.priceMode || invoiceOrder.price_mode);
  const resolvedDocumentType =
    documentType === "invoice" &&
    printTemplate === "orderForm"
      ? "orderForm"
      : documentType;
  const settings = getInvoiceSettings(settingsOverride);
  const totals = calculateDocumentTotals(invoiceOrder.items || [], invoiceOrder);
  const items = sortPrintItems(getOrderItemsForInvoice(invoiceOrder));
  const isDeliveryNote = resolvedDocumentType === "deliveryNote";
  const isOrderForm = resolvedDocumentType === "orderForm";
  const isServerManagerDocument = isServerManagerPriceMode(
    invoiceOrder.priceMode || invoiceOrder.price_mode
  );
  const showPrices = !isDeliveryNote;
  const title = isDeliveryNote
    ? "DELIVERY NOTE"
    : isOrderForm
    ? "ORDER FORM"
    : "SALES INVOICE";
  const showHeaderFooter = isDeliveryNote
    ? !isServerManagerDocument && shouldShowInvoiceHeaderFooter(settings, invoiceOrder)
    : !isOrderForm;
  const showInvoiceTotals = showPrices && !isOrderForm;
  const referenceLabel = isOrderForm || isDeliveryNote ? "Order Number" : "Invoice Number";
  const rawReference = getOrderReference(invoiceOrder) || "-";
  const reference =
    isOrderForm || isDeliveryNote
      ? formatDisplayOrderId(rawReference)
      : rawReference;
  const customerName = getCustomerName(invoiceOrder);
  const branchName = getBranchName(invoiceOrder);
  const billingAddress = getBillingAddress(invoiceOrder) || getDeliveryAddress(invoiceOrder);
  const deliveryAddress = getDeliveryAddress(invoiceOrder);
  const invoiceDate = formatInvoiceDate(getOrderDate(invoiceOrder));
  const dueDate = invoiceOrder.dueDate || invoiceOrder.due_date || "-";
  const paymentTerms =
    invoiceOrder.paymentTerms ||
    invoiceOrder.payment_terms ||
    settings.paymentTerms ||
    "-";
  const salesperson =
    invoiceOrder.salesperson ||
    invoiceOrder.sales_person ||
    invoiceOrder.salesRep ||
    invoiceOrder.sales_rep ||
    invoiceOrder.created_by_name ||
    invoiceOrder.confirmed_by ||
    "";
  const customerCode =
    invoiceOrder.customerCode ||
    invoiceOrder.customer_code ||
    invoiceOrder.customer_account_code ||
    invoiceOrder.account_code ||
    invoiceOrder.customer_account_id ||
    "-";
  const companyRegistrationNumber =
    settings.companyRegistrationNumber ||
    settings.company_registration_number ||
    "16350457";
  const companyAddress = getPrintableCompanyAddress(settings.companyAddress);
  const paymentStatus = getInvoicePaymentStatus(invoiceOrder, totals);
  const vatGroups = (totals.vatGroups || totals.vat_groups || []).filter(
    (group) => Number(group.net_total ?? group.netTotal ?? 0) || Number(group.vat_total ?? group.vatTotal ?? 0)
  );
  const vatSummaryRows = vatGroups.length
    ? vatGroups
    : [
        {
          vatRate: 0,
          vat_rate: 0,
          netTotal: totals.netTotal,
          net_total: totals.netTotal,
          vatTotal: totals.vatTotal,
          vat_total: totals.vatTotal,
        },
      ];
  const formatVatRate = (value) => {
    const rate = Number(value || 0);
    return Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
  };
  const rows = items
    .map((item) => {
      const quantity = getLineQuantity(item);
      const unitPrice = getLinePrice(item);
      const netTotal = Number(item.net_total ?? item.netTotal ?? 0);
      const vatRate = getLineVatRate(item);
      const productCode = getInvoiceProductCode(item);

      return `
        <tr>
          ${
            isOrderForm
              ? ""
              : `<td class="code">${escapeHtml(productCode)}</td>`
          }
          <td class="description">${escapeHtml(item.name || item.productName || item.product_name || "")}</td>
          <td class="right">${escapeHtml(quantity)}</td>
          ${
            showPrices
              ? `
                <td class="right">${escapeHtml(formatCurrency(unitPrice))}</td>
                ${
                  isOrderForm
                    ? ""
                    : `<td class="right">${escapeHtml(formatVatRate(vatRate))}</td>`
                }
                <td class="right">${escapeHtml(formatCurrency(netTotal))}</td>
              `
              : ""
          }
        </tr>
      `;
    })
    .join("");

  return `
    <html>
      <head>
        <title>${escapeHtml(title)} ${escapeHtml(reference)}</title>
        <style>
          @page {
            size: A4;
            margin: 11mm 10mm 13mm;
            @bottom-right {
              content: "Page " counter(page) " of " counter(pages);
              font-family: Arial, sans-serif;
              font-size: 9px;
              color: #64748b;
            }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            color: #0f172a;
            background: #fff;
            font-family: Arial, sans-serif;
            font-size: 11.5px;
            line-height: 1.35;
          }
          .page {
            width: 190mm;
            max-width: 190mm;
            min-height: 273mm;
            margin: 0 auto;
            display: flex;
            flex-direction: column;
            position: relative;
          }
          .content { flex: 1 0 auto; }
          .watermark {
            position: fixed;
            top: 43%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-28deg);
            color: rgba(239, 68, 68, 0.16);
            border: 4px solid rgba(239, 68, 68, 0.2);
            padding: 10mm 18mm;
            font-size: 46px;
            font-weight: 900;
            letter-spacing: 0;
            z-index: 5;
            pointer-events: none;
            background: transparent;
          }
          .watermark.paid {
            color: rgba(22, 163, 74, 0.12);
            border-color: rgba(22, 163, 74, 0.16);
          }
          .content,
          .footer {
            position: relative;
            z-index: 2;
          }
          .document-header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 170px;
            gap: 16px;
            align-items: start;
            padding-bottom: 12px;
            border-bottom: 1.5px solid #111827;
          }
          .company-name {
            color: #111827;
            font-size: 18px;
            font-weight: 900;
            margin-bottom: 5px;
          }
          .company-details {
            white-space: pre-line;
            color: #334155;
            font-size: 10.5px;
          }
          .brand-panel {
            text-align: right;
          }
          .logo {
            max-width: 155px;
            max-height: 74px;
            object-fit: contain;
          }
          .document-title {
            margin-top: 8px;
            color: #111827;
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 0;
          }
          .standalone-title {
            margin: 0 0 12px;
            text-align: right;
            border-bottom: 1.5px solid #111827;
            padding-bottom: 8px;
          }
          .panel-grid {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 78mm;
            gap: 12px;
            margin-top: 14px;
          }
          .panel {
            border: 1px solid #fed7aa;
            border-radius: 6px;
            overflow: hidden;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .panel-title {
            background: #fed7aa;
            color: #111827;
            font-size: 10px;
            font-weight: 900;
            letter-spacing: 0;
            padding: 6px 8px;
            text-transform: uppercase;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .panel-body {
            padding: 8px;
            background: #fff;
          }
          .customer-name {
            font-size: 13px;
            font-weight: 900;
            margin-bottom: 5px;
          }
          .address-block {
            color: #334155;
            margin-top: 4px;
          }
          .muted-label {
            color: #64748b;
            font-size: 9.5px;
            font-weight: 800;
            text-transform: uppercase;
          }
          .detail-row {
            display: grid;
            grid-template-columns: 31mm minmax(0, 1fr);
            gap: 7px;
            padding: 4px 0;
            border-bottom: 1px solid #e2e8f0;
          }
          .detail-row:last-child { border-bottom: 0; }
          .detail-label {
            color: #475569;
            font-weight: 800;
          }
          .detail-value {
            color: #0f172a;
            font-weight: 700;
            overflow-wrap: anywhere;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            margin-top: 14px;
            font-size: 10.8px;
          }
          thead { display: table-header-group; }
          th {
            background: #dbeafe !important;
            color: #111827 !important;
            padding: 7px 6px;
            font-size: 10px;
            font-weight: 900;
            text-transform: uppercase;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          td {
            padding: 6px;
            vertical-align: top;
            border: 1px solid #e5e7eb;
            overflow-wrap: anywhere;
            background: #fff;
          }
          .right { text-align: right; }
          .code {
            width: 32mm;
            max-width: 32mm;
            color: #334155;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .code-heading {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .description {
            font-weight: 700;
            font-size: 11.8px;
          }
          .summary-area {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 78mm;
            gap: 12px;
            align-items: start;
            margin-top: 14px;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .count-strip {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
          }
          .count-card {
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px;
            background: #fff;
          }
          .count-value {
            font-size: 18px;
            font-weight: 900;
            color: #0f172a;
          }
          .vat-summary {
            margin-top: 10px;
            border: 1px solid #fed7aa;
            border-radius: 6px;
            overflow: hidden;
          }
          .vat-summary table {
            margin: 0;
            font-size: 10px;
          }
          .vat-summary th {
            background: #fed7aa !important;
            color: #111827 !important;
          }
          .vat-summary td {
            background: #fff !important;
            padding: 5px 6px;
          }
          .totals-box {
            border: 1px solid #bfdbfe;
            border-radius: 6px;
            overflow: hidden;
          }
          .total-row {
            display: grid;
            grid-template-columns: 1fr 32mm;
            gap: 8px;
            padding: 7px 9px;
            border-bottom: 1px solid #dbeafe;
          }
          .total-row:last-child { border-bottom: 0; }
          .total-label {
            font-weight: 900;
            color: #334155;
          }
          .total-value {
            text-align: right;
            font-weight: 900;
          }
          .grand-total {
            background: #dbeafe !important;
            color: #111827 !important;
            font-size: 15px;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .grand-total .total-label,
          .grand-total .total-value {
            color: #111827 !important;
            font-weight: 900;
          }
          .notes {
            margin-top: 12px;
            color: #334155;
            border-top: 1px solid #e2e8f0;
            padding-top: 8px;
          }
          .footer {
            flex-shrink: 0;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 10px;
            align-items: end;
            border-top: 1.5px solid #111827;
            color: #475569;
            font-size: 9.5px;
            line-height: 1.45;
            margin-top: 12mm;
            padding-top: 7px;
          }
          .deliver-bottom {
            margin-top: 14px;
            border: 1px solid #cbd5e1;
            border-radius: 6px;
            padding: 8px;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .page-number::after {
            content: "Page " counter(page);
          }
          @media print {
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            html,
            body {
              width: 210mm;
              max-width: 210mm;
              overflow: visible;
            }
            .page {
              width: 190mm;
              max-width: 190mm;
            }
          }
        </style>
      </head>
      <body>
        <div class="page">
          ${!isOrderForm && !isDeliveryNote ? `<div class="watermark ${paymentStatus === "PAID" ? "paid" : ""}">${escapeHtml(paymentStatus)}</div>` : ""}
          <main class="content">
            ${
              showHeaderFooter
                ? `
                  <header class="document-header">
                    <div>
                      <div class="company-name">Fair Choice Cash and Carry</div>
                      <div class="company-details">
                        ${escapeHtml(companyAddress)}
                        ${settings.telephone ? `Telephone: ${escapeHtml(settings.telephone)}` : ""}
                        ${settings.email ? `Email: ${escapeHtml(settings.email)}` : ""}
                      </div>
                    </div>
                    <div class="brand-panel">
                      ${settings.companyLogo ? `<img src="${escapeHtml(settings.companyLogo)}" class="logo" />` : ""}
                      <div class="document-title">${escapeHtml(title)}</div>
                    </div>
                  </header>
                `
                : `<div class="document-title standalone-title">${escapeHtml(title)}</div>`
            }

            <section class="panel-grid">
              <div class="panel">
                <div class="panel-title">Customer</div>
                <div class="panel-body">
                  <div class="customer-name">${escapeHtml(customerName)}</div>
                  ${isOrderForm ? "" : `<div><span class="muted-label">Customer Code</span><br />${escapeHtml(customerCode)}</div>`}
                  ${billingAddress ? `<div class="address-block"><span class="muted-label">Billing Address</span><br />${escapeHtml(billingAddress)}</div>` : ""}
                </div>
              </div>
              <div class="panel">
                <div class="panel-title">${isOrderForm ? "Order Details" : "Invoice Details"}</div>
                <div class="panel-body">
                  <div class="detail-row"><div class="detail-label">${escapeHtml(referenceLabel)}</div><div class="detail-value">${escapeHtml(reference)}</div></div>
                  <div class="detail-row"><div class="detail-label">${isOrderForm ? "Order Date" : "Invoice Date"}</div><div class="detail-value">${escapeHtml(invoiceDate)}</div></div>
                  ${isOrderForm ? "" : `<div class="detail-row"><div class="detail-label">Due Date</div><div class="detail-value">${escapeHtml(dueDate)}</div></div>`}
                  ${isOrderForm ? "" : `<div class="detail-row"><div class="detail-label">Payment Terms</div><div class="detail-value">${escapeHtml(paymentTerms)}</div></div>`}
                  ${salesperson ? `<div class="detail-row"><div class="detail-label">Salesperson</div><div class="detail-value">${escapeHtml(salesperson)}</div></div>` : ""}
                </div>
              </div>
            </section>

            <table>
              <thead>
                <tr>
                  ${isOrderForm ? "" : `<th style="width:32mm;" class="code-heading">Product Code</th>`}
                  <th>Description</th>
                  <th style="width:15mm;" class="right">Quantity</th>
                  ${
                    showPrices
                      ? `
                        <th style="width:23mm;" class="right">Unit Price</th>
                        ${isOrderForm ? "" : `<th style="width:16mm;" class="right">VAT %</th>`}
                        <th style="width:25mm;" class="right">Net Amount</th>
                      `
                      : ""
                  }
                </tr>
              </thead>
              <tbody>
                ${rows || `<tr><td colspan="${isOrderForm ? 4 : showPrices ? 6 : 3}">No supplied items.</td></tr>`}
              </tbody>
            </table>

            <section class="summary-area">
              <div>
                <div class="count-strip">
                  <div class="count-card">
                    <div class="muted-label">Total Quantity</div>
                    <div class="count-value">${escapeHtml(totals.totalQuantity)}</div>
                  </div>
                  <div class="count-card">
                    <div class="muted-label">Total Lines</div>
                    <div class="count-value">${escapeHtml(totals.totalLines)}</div>
                  </div>
                </div>
                ${
                  showInvoiceTotals
                    ? `
                      <div class="vat-summary">
                        <table>
                          <thead>
                            <tr>
                              <th>VAT %</th>
                              <th class="right">Net</th>
                              <th class="right">VAT</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${vatSummaryRows
                              .map(
                                (group) => `
                                  <tr>
                                    <td>${escapeHtml(formatVatRate(group.vatRate ?? group.vat_rate))}</td>
                                    <td class="right">${escapeHtml(formatCurrency(group.netTotal ?? group.net_total ?? 0))}</td>
                                    <td class="right">${escapeHtml(formatCurrency(group.vatTotal ?? group.vat_total ?? 0))}</td>
                                  </tr>
                                `
                              )
                              .join("")}
                          </tbody>
                        </table>
                      </div>
                    `
                    : ""
                }
              </div>
              ${
                showPrices
                  ? `
                    <div class="totals-box">
                      ${isOrderForm ? "" : `
                        <div class="total-row">
                          <div class="total-label">Net Total</div>
                          <div class="total-value">${escapeHtml(formatCurrency(totals.netTotal))}</div>
                        </div>
                        <div class="total-row">
                          <div class="total-label">VAT Total</div>
                          <div class="total-value">${escapeHtml(formatCurrency(totals.vatTotal))}</div>
                        </div>
                      `}
                      <div class="total-row grand-total">
                        <div class="total-label">Grand Total</div>
                        <div class="total-value">${escapeHtml(formatCurrency(totals.grandTotal))}</div>
                      </div>
                    </div>
                  `
                  : ""
              }
            </section>

            ${
              `
                  <section class="deliver-bottom">
                    <div class="muted-label">Deliver To</div>
                    <div class="customer-name">${escapeHtml(customerName)}</div>
                    ${branchName ? `<div>${escapeHtml(branchName)}</div>` : ""}
                    <div>${escapeHtml(deliveryAddress)}</div>
                  </section>
                `
            }

            ${(settings.defaultNotes || invoiceOrder.notes) ? `<section class="notes">${escapeHtml(invoiceOrder.notes || settings.defaultNotes)}</section>` : ""}
          </main>
          ${
            showHeaderFooter
              ? `
                <footer class="footer">
                  <div>
                    <strong>${escapeHtml(settings.footerText)}</strong><br />
                    ${escapeHtml(paymentTerms)}<br />
                    Registered in England and Wales No. ${escapeHtml(companyRegistrationNumber)} | VAT Registration No. ${escapeHtml(settings.vatNumber || "-")}
                  </div>
                  <div class="page-number"></div>
                </footer>
              `
              : ""
          }
        </div>
        ${autoPrint ? "<script>window.print();</script>" : ""}
      </body>
    </html>
  `;
}

const openInvoiceHtml = (html, popupMessage = "Popup blocked. Please allow popups for invoices.") => {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    alert(popupMessage);
    return null;
  }
  win.document.write(html);
  win.document.close();
  return win;
};

export function previewInvoice(order = {}, options = {}) {
  return openInvoiceHtml(buildStandardInvoiceHtml(order, { ...options, autoPrint: false }));
}

export function printInvoice(order = {}, options = {}) {
  return openInvoiceHtml(buildStandardInvoiceHtml(order, { ...options, autoPrint: true }));
}

export function printOrderForm(order = {}, options = {}) {
  return printInvoice(order, { ...options, documentType: "orderForm" });
}

export function printDeliveryNote(order = {}, options = {}) {
  return openInvoiceHtml(
    buildLegacyStandardInvoiceHtml(order, { ...options, documentType: "deliveryNote", autoPrint: true })
  );
}

export function downloadInvoice(order = {}, options = {}) {
  return openInvoiceHtml(
    buildStandardInvoiceHtml(order, { ...options, autoPrint: true }),
    "Popup blocked. Please allow popups to download or save the invoice PDF."
  );
}

export async function createInvoice({ order, confirmedBy, currentUser } = {}) {
  return createOrUpdateInvoiceForDeliveredOrder({ order, confirmedBy, currentUser });
}

export async function createManualInvoice({
  order,
  companyName,
  customerAccountId,
  customerBranchId,
  branchName = "",
  deliveryAddress = "",
  deliveryPostcode = "",
  customerCountry = "",
  priceMode = "VAT",
  cart = [],
  confirmedBy,
  currentUser,
  notes = "Manual invoice",
} = {}) {
  if (order) return createInvoice({ order, confirmedBy, currentUser });
  if (!companyName) throw new Error("Customer is required");
  if (!cart.length) throw new Error("Add at least one product");

  const orderNumber = `ORD-${Date.now()}`;
  const calculatedTotals = calculateCartTotals(cart, { priceMode });
  const calculatedItems = calculateCartOrderItems(cart, { priceMode });

  const orderPayload = {
    order_number: orderNumber,
    customer_account_id: customerAccountId || null,
    customer_branch_id: customerBranchId || null,
    branch_id: customerBranchId || null,
    branch_name: branchName || "",
    company_name: companyName,
    delivery_branch_name: branchName || "",
    delivery_address: deliveryAddress || "",
    delivery_postcode: deliveryPostcode || "",
    customer_country: customerCountry || "",
    postcode: deliveryPostcode || "",
    price_mode: String(priceMode || "VAT").toUpperCase(),
    subtotal: calculatedTotals.netTotal.toFixed(2),
    net_total: calculatedTotals.netTotal.toFixed(2),
    vat_total: calculatedTotals.vatTotal.toFixed(2),
    order_total: calculatedTotals.grandTotal.toFixed(2),
    discount_percent: calculatedTotals.discountPercent || 0,
    discount_amount: calculatedTotals.discountAmount.toFixed(2),
    status: "Delivered",
    delivered_at: new Date().toISOString(),
    notes,
    invoice_type: "MANUAL",
    created_by: currentUser?.id || currentUser?.staff_id || null,
    created_by_name: currentUser?.name || currentUser?.staff_name || currentUser?.username || null,
  };

  let { data: savedOrder, error: orderError } = await supabase
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderError) {
    const fallback = { ...orderPayload };
    ["net_total", "subtotal", "delivered_at", "notes"].forEach((key) => delete fallback[key]);
    const retry = await supabase.from("orders").insert(fallback).select().single();
    savedOrder = retry.data;
    orderError = retry.error;
  }

  if (orderError) throw orderError;

  const orderItems = calculatedItems.map((item) => ({
    order_id: savedOrder.id,
    product_id: item.id || item.productId || item.product_id,
    product_code: getOrderItemProductCode(item),
    product_name: item.name || item.productName || item.product_name || "",
    brand: item.brand || "",
    series: item.series || "",
    flavour: item.flavour || "",
    carton_size: item.cartonSize || item.carton_size || "",
    qty: item.qty,
    picked_qty: item.qty,
    price: item.price.toFixed(2),
    line_total: item.line_total.toFixed(2),
    net_total: item.net_total.toFixed(2),
    gross_total: item.gross_total.toFixed(2),
    vat_total: item.vat_total.toFixed(2),
    vat_amount: item.vat_total.toFixed(2),
    vat_rate: item.vat_rate,
    vat_type: item.vat_type,
    source_status: "In Stock",
    include_in_picking: true,
  }));

  let { error: itemsError } = await supabase.from("order_items").insert(orderItems);
  if (itemsError) {
    const fallbackItems = orderItems.map((item) => {
      const next = { ...item };
      ["vat_type", "gross_total", "net_total", "vat_amount", "product_code"].forEach((key) => {
        if (String(itemsError.message || "").toLowerCase().includes(key)) delete next[key];
      });
      return next;
    });
    const retry = await supabase.from("order_items").insert(fallbackItems);
    itemsError = retry.error;
  }

  if (itemsError) throw itemsError;

  const invoiceOrder = {
    ...savedOrder,
    orderId: savedOrder.order_number,
    companyName: savedOrder.company_name,
    branchName: savedOrder.delivery_branch_name,
    deliveryAddress: savedOrder.delivery_address,
    priceMode: savedOrder.price_mode,
    items: calculatedItems,
  };

  const invoice = await createInvoice({
    order: invoiceOrder,
    confirmedBy: confirmedBy || currentUser?.name || currentUser?.username || "Manual Invoice",
    currentUser,
  });

  await allocateCustomerPaymentToInvoices({
    customerAccountId,
    customerName: companyName,
  });

  return { order: invoiceOrder, invoice };
}

export async function amendInvoice({
  order,
  reason = "",
  currentUser,
  previousTotal,
  newTotal,
  changedItems = [],
} = {}) {
  const oldTotal = previousTotal ?? getInvoiceTotal(order);
  const invoice = await createInvoice({ order, confirmedBy: currentUser?.name || currentUser?.username, currentUser });
  const latestTotal = newTotal ?? getInvoiceTotal(order);

  await recordInvoiceVersion({
    order,
    reason,
    previousTotal: oldTotal,
    newTotal: latestTotal,
    changedItems,
    currentUser,
  });

  return invoice;
}

export async function createReturnInvoice({ order, confirmedBy, currentUser } = {}) {
  const invoice = await createInvoice({ order, confirmedBy, currentUser });
  return {
    ...invoice,
    invoice_type: "RETURN",
    invoiceType: "RETURN",
  };
}

export async function recordInvoiceVersion({
  order,
  reason = "",
  previousTotal = 0,
  newTotal = 0,
  changedItems = [],
  currentUser,
} = {}) {
  const payload = {
    order_number: getOrderReference(order),
    invoice_number: getOrderReference(order),
    version_number: Date.now(),
    changed_by: currentUser?.name || currentUser?.username || null,
    changed_by_id: currentUser?.id || currentUser?.staff_id || null,
    changed_at: new Date().toISOString(),
    changed_date: new Date().toISOString(),
    reason,
    previous_total: roundMoney(previousTotal),
    new_total: roundMoney(newTotal),
    changed_items: changedItems,
  };

  let { data, error } = await supabase
    .from("invoice_version_history")
    .insert(payload)
    .select()
    .single();

  if (error && String(error.message || "").toLowerCase().includes("changed_items")) {
    const fallback = { ...payload };
    delete fallback.changed_items;
    const retry = await supabase
      .from("invoice_version_history")
      .insert(fallback)
      .select()
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.warn("Invoice version history unavailable:", error.message);
    return payload;
  }

  return data;
}

export function getInvoiceTotal(order = {}) {
  const invoiceOrder = normalizeInvoiceOrder(order);
  return calculateDocumentTotals(invoiceOrder.items || [], invoiceOrder).grandTotal;
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
  let unappliedCredit = 0;

  const allocateCreditToOldestInvoices = (amount) => {
    let remaining = roundMoney(amount);

    for (const invoice of invoiceRows) {
      if (remaining <= 0) break;

      const currentRemaining = roundMoney(invoice.remaining_amount);
      if (currentRemaining <= 0) continue;

      const appliedAmount = roundMoney(Math.min(currentRemaining, remaining));
      invoice.paid_amount = roundMoney(invoice.paid_amount + appliedAmount);
      invoice.paidAmount = invoice.paid_amount;
      invoice.remaining_amount = roundMoney(currentRemaining - appliedAmount);
      invoice.remainingAmount = invoice.remaining_amount;
      invoice.invoice_status = getInvoiceStatusFromAmounts(
        invoice.invoice_total,
        invoice.paid_amount
      );
      remaining = roundMoney(remaining - appliedAmount);
    }

    return remaining;
  };

  return (ledgerRows || []).map((row) => {
    const type = getLedgerType(row);

    if (type === "INVOICE") {
      const invoiceTotal = getInvoiceLedgerTotal(row);
      const invoiceRow = {
        ...row,
        invoice_total: invoiceTotal,
        invoiceTotal,
        paid_amount: 0,
        paidAmount: 0,
        remaining_amount: invoiceTotal,
        remainingAmount: invoiceTotal,
        invoice_status: getInvoiceStatusFromAmounts(invoiceTotal, 0),
      };

      invoiceRows.push(invoiceRow);

      if (unappliedCredit > 0) {
        unappliedCredit = allocateCreditToOldestInvoices(unappliedCredit);
      }

      return invoiceRow;
    }

    if (type !== "PAYMENT") return row;

    unappliedCredit = allocateCreditToOldestInvoices(
      roundMoney(unappliedCredit + getPaymentLedgerTotal(row))
    );

    return {
      ...row,
      unallocated_amount: unappliedCredit,
      unallocatedAmount: unappliedCredit,
    };
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
    .order("created_at", { ascending: true })
    .limit(1);

  if (existing.error) throw existing.error;

  const existingInvoice = Array.isArray(existing.data) ? existing.data[0] : existing.data;

  if (existingInvoice?.id) {
    const paidAmount = roundMoney(
      Number(existingInvoice.paid_amount || existingInvoice.paidAmount || 0)
    );
    payload.paid_amount = paidAmount;
    payload.remaining_amount = roundMoney(payload.invoice_total - paidAmount);
    payload.invoice_status = getInvoiceStatusFromAmounts(
      payload.invoice_total,
      paidAmount
    );
  }

  let query = existingInvoice?.id
    ? supabase.from("customer_ledger").update(payload).eq("id", existingInvoice.id)
    : supabase.from("customer_ledger").insert(payload);

  let { data, error } = await query.select().single();

  if (error) {
    const fallbackPayload = stripUnsupportedColumns(payload, error.message || error.details || "");
    query = existingInvoice?.id
      ? supabase.from("customer_ledger").update(fallbackPayload).eq("id", existingInvoice.id)
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

  const processingQueueOrders = await loadProcessingQueueOrders({
    customerAccountId,
    customerName,
  });
  const allocationSourceRows = mergeDeliveredOrderInvoicesIntoLedgerRows(
    data || [],
    processingQueueOrders
  );
  const allocatedRows = applyInvoicePaymentAllocations(allocationSourceRows);
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
  id: item.product_id || item.productId || item.id,
  productCode:
    item.product_code ||
    item.productCode ||
    item.sku ||
    item.code ||
    item.products?.product_code ||
    item.products?.code ||
    item.product?.product_code ||
    item.product?.code ||
    "",
  product_code:
    item.product_code ||
    item.productCode ||
    item.sku ||
    item.code ||
    item.products?.product_code ||
    item.products?.code ||
    item.product?.product_code ||
    item.product?.code ||
    "",
  name: item.product_name || item.productName || item.name,
  productName: item.product_name || item.productName || item.name,
  qty: Number(item.qty || item.quantity || item.pickedQty || item.picked_qty || 0),
  quantity: Number(item.quantity || item.qty || item.pickedQty || item.picked_qty || 0),
  price: Number(item.price || item.unit_price || item.selectedPrice || 0),
  unit_price: Number(item.unit_price || item.price || item.selectedPrice || 0),
  line_total: Number(item.line_total || item.lineTotal || 0),
  net_total: Number(item.net_total || item.netTotal || 0),
  gross_total: Number(item.gross_total || item.grossTotal || 0),
  vatRate: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
  vat_percent: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
  vat_total: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
});

const getProcessingQueueLineItems = (row = {}) => {
  const snapshot = row.transaction_snapshot || {};

  if (Array.isArray(row.line_items)) return row.line_items;
  if (Array.isArray(snapshot.order_items)) return snapshot.order_items;
  if (Array.isArray(snapshot.items)) return snapshot.items;
  return [];
};

export const mapProcessingQueueRowToOperationalOrder = (row = {}) => {
  const snapshot = row.transaction_snapshot || {};
  const confirmedAt =
    row.confirmed_at ||
    snapshot.confirmed_at ||
    snapshot.delivered_at ||
    snapshot.delivery_confirmed_at ||
    row.queued_at ||
    snapshot.updated_at ||
    snapshot.created_at ||
    row.created_at;
  const orderNumber = row.order_number || snapshot.order_number || snapshot.orderId || "";
  const customerAccountId = row.customer_account_id || snapshot.customer_account_id || "";
  const customerBranchId =
    row.customer_branch_id ||
    row.branch_id ||
    snapshot.customer_branch_id ||
    snapshot.branch_id ||
    "";
  const customerName = row.customer_name || snapshot.company_name || snapshot.customer_name || "";
  const branchName =
    row.branch_name ||
    snapshot.delivery_branch_name ||
    snapshot.branch_name ||
    snapshot.shop_name ||
    "";
  const priceMode = row.price_mode || snapshot.price_mode || "vat";
  const lineItems = getProcessingQueueLineItems(row);

  return {
    ...snapshot,
    id: row.order_id || snapshot.id || row.id,
    dbId: row.order_id || snapshot.id || row.id,
    processingQueueId: row.id,
    isProcessingQueueOrder: true,
    orderId: orderNumber,
    orderNumber,
    order_number: orderNumber,
    customerAccountId,
    customer_account_id: customerAccountId,
    customerBranchId,
    customer_branch_id: customerBranchId,
    branch_id: customerBranchId,
    customerName,
    companyName: customerName,
    company_name: customerName,
    branchName,
    branch_name: branchName,
    delivery_branch_name: branchName,
    deliveryAddress:
      snapshot.delivery_address || snapshot.delivery_postcode || snapshot.postcode || "",
    delivery_address: snapshot.delivery_address || "",
    delivery_postcode: snapshot.delivery_postcode || snapshot.postcode || "",
    priceMode,
    price_mode: priceMode,
    status: snapshot.status || "Delivered",
    queueStatus: row.queue_status,
    queue_status: row.queue_status,
    total: Number(row.grand_total || snapshot.order_total || snapshot.total || 0),
    orderTotal: Number(row.grand_total || snapshot.order_total || snapshot.total || 0),
    order_total: Number(row.grand_total || snapshot.order_total || snapshot.total || 0),
    totalAmount: Number(row.grand_total || snapshot.total_amount || 0),
    total_amount: Number(row.grand_total || snapshot.total_amount || 0),
    finalTotal: Number(row.grand_total || snapshot.final_total || snapshot.order_total || 0),
    final_total: Number(row.grand_total || snapshot.final_total || snapshot.order_total || 0),
    subtotal: Number(row.subtotal || snapshot.subtotal || 0),
    net_total: Number(row.net_total || snapshot.net_total || snapshot.subtotal || 0),
    vatTotal: Number(row.vat_total || snapshot.vat_total || snapshot.total_vat || 0),
    vat_total: Number(row.vat_total || snapshot.vat_total || snapshot.total_vat || 0),
    totalQuantity: Number(row.total_quantity || snapshot.total_quantity || 0),
    totalLines: Number(row.total_lines || lineItems.length || 0),
    createdAt: confirmedAt || row.created_at,
    created_at: confirmedAt || row.created_at,
    deliveredAt: confirmedAt,
    delivered_at: confirmedAt,
    confirmed_at: confirmedAt,
    queued_at: row.queued_at,
    order_items: lineItems,
    items: lineItems.map(mapOrderItemForLedgerFallback),
  };
};

export const mergeOperationalOrders = (normalOrders = [], processingQueueOrders = []) => {
  const seenReferences = new Set(
    (normalOrders || [])
      .map((order) => String(order.orderId || order.order_number || order.orderNumber || "").trim())
      .filter(Boolean)
  );

  const queueOnlyOrders = (processingQueueOrders || []).filter((order) => {
    const reference = String(order.orderId || order.order_number || order.orderNumber || "").trim();
    if (!reference || seenReferences.has(reference)) return false;
    seenReferences.add(reference);
    return true;
  });

  return [...(normalOrders || []), ...queueOnlyOrders];
};

export async function loadProcessingQueueOrders({
  customerAccountId,
  customerName,
} = {}) {
  const runQuery = async (buildQuery) => {
    let query = supabase
      .from("processing_queue")
      .select("*")
      .in("queue_status", activeProcessingQueueStatuses)
      .order("confirmed_at", { ascending: true, nullsFirst: false })
      .order("queued_at", { ascending: true });

    query = buildQuery ? buildQuery(query) : query;
    const { data, error } = await query;

    if (error) {
      console.warn("ProcessingQueue operational load skipped:", error.message);
      return [];
    }

    return data || [];
  };

  let rows = [];

  if (customerAccountId) {
    rows = await runQuery((query) => query.eq("customer_account_id", customerAccountId));
  }

  if ((!customerAccountId || !rows.length) && customerName) {
    rows = [
      ...rows,
      ...(await runQuery((query) => query.eq("customer_name", customerName))),
    ];
  }

  if (!customerAccountId && !customerName) {
    rows = await runQuery();
  }

  const seen = new Set();
  return rows
    .filter((row) => {
      const key = String(row.order_id || row.order_number || row.id || "").trim();
      if (!key || seen.has(key)) return false;
      if (!isServerManagerPriceMode(row.price_mode || row.transaction_snapshot?.price_mode)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map(mapProcessingQueueRowToOperationalOrder);
}

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
  items: filterActiveInvoiceLines(order.order_items || []).map(mapOrderItemForLedgerFallback),
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
      const activeItems = filterActiveInvoiceLines(order.items || []);
      const totals = calculateDocumentTotals(activeItems, { ...order, items: activeItems });
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

  const [{ data: balanceRow }, ledgerResult, ordersResult, processingQueueOrders] = await Promise.all([
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
    loadProcessingQueueOrders({ customerAccountId, customerName }),
  ]);

  if (ledgerResult.error) throw ledgerResult.error;
  if (ordersResult.error) throw ordersResult.error;

  const openingBalance = Number(balanceRow?.opening_balance || 0);
  const deliveredOrders = (ordersResult.data || [])
    .filter((order) => isDeliveredInvoiceStatus(order.status))
    .map(mapOrderForLedgerFallback);
  const operationalOrders = mergeOperationalOrders(deliveredOrders, processingQueueOrders);
  const ledgerRows = mergeDeliveredOrderInvoicesIntoLedgerRows(
    ledgerResult.data || [],
    operationalOrders
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
