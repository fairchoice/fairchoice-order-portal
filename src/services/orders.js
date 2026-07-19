import { supabase } from "./supabase";
import {
  calculateCartTotals,
  calculateCartOrderItems,
  getOrderItemProductCode,
} from "../utils/orderTotals";
import { isServerManagerPriceMode } from "../utils/pricing";
import {
  loadProcessingQueueOrders,
  mergeOperationalOrders,
} from "./centralInvoiceEngine";

const getProcessingQueueTotal = (order = {}, ...fields) => {
  for (const field of fields) {
    if (order[field] !== null && order[field] !== undefined && order[field] !== "") {
      return Number(order[field] || 0);
    }
  }

  return 0;
};

const getProcessingQueueLineQty = (item = {}) =>
  Number(item.picked_qty ?? item.pickedQty ?? item.qty ?? item.quantity ?? 0);

const isConfirmedStatusForProcessingQueue = (status) =>
  [
    "delivered",
    "confirmed",
    "delivery confirmed",
    "cash confirmed",
    "payment confirmed",
  ].includes(String(status || "").trim().toLowerCase());

const isCashConfirmationUpdate = (updates = {}) => {
  const paymentCollected =
    updates.payment_collected ??
    updates.paymentCollected ??
    updates.payment_received ??
    updates.paymentReceived;
  const paymentAmount = Number(
    updates.payment_amount ?? updates.paymentAmount ?? updates.amount_paid ?? 0
  );
  const paymentType = String(updates.payment_type ?? updates.paymentType ?? "").trim();
  const hasCashCollectionFields = [
    "payment_type",
    "paymentType",
    "payment_amount",
    "paymentAmount",
    "payment_collected",
    "paymentCollected",
    "paid_by",
    "paidBy",
    "received_by",
    "receivedBy",
  ].some((field) => Object.prototype.hasOwnProperty.call(updates, field));

  return (
    String(paymentCollected || "").trim().toLowerCase() === "yes" ||
    paymentCollected === true ||
    paymentAmount > 0 ||
    Boolean(paymentType) ||
    hasCashCollectionFields
  );
};

async function loadOrderForProcessingQueue(orderNumber, fallbackOrder = {}) {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("order_number", orderNumber)
    .order("created_at", { foreignTable: "order_items", ascending: true });

  if (error) {
    console.warn("ProcessingQueue order load skipped:", error.message);
    return {
      ...fallbackOrder,
      order_items: fallbackOrder.order_items || [],
    };
  }

  const order = Array.isArray(data) ? data[0] : data;
  return {
    ...fallbackOrder,
    ...(order || {}),
    price_mode: order?.price_mode ?? fallbackOrder.price_mode ?? fallbackOrder.priceMode,
    priceMode: order?.price_mode ?? fallbackOrder.priceMode ?? fallbackOrder.price_mode,
    order_items: order?.order_items || fallbackOrder.order_items || [],
    items: fallbackOrder.items || order?.items || [],
  };
}

async function findExistingProcessingQueueRow({ orderId, orderNumber } = {}) {
  if (orderId) {
    const byOrderId = await supabase
      .from("processing_queue")
      .select("id")
      .eq("order_id", orderId)
      .limit(1);

    if (!byOrderId.error && byOrderId.data?.[0]?.id) return byOrderId.data[0];
    if (byOrderId.error) console.warn("ProcessingQueue lookup by order_id skipped:", byOrderId.error.message);
  }

  if (orderNumber) {
    const byOrderNumber = await supabase
      .from("processing_queue")
      .select("id")
      .eq("order_number", orderNumber)
      .limit(1);

    if (!byOrderNumber.error && byOrderNumber.data?.[0]?.id) return byOrderNumber.data[0];
    if (byOrderNumber.error) console.warn("ProcessingQueue lookup by order_number skipped:", byOrderNumber.error.message);
  }

  return null;
}

export async function saveConfirmedServerManagerOrderToProcessingQueue({
  orderNumber,
  confirmedAt,
  fallbackOrder = {},
} = {}) {
  if (!orderNumber) return null;

  try {
    const order = await loadOrderForProcessingQueue(orderNumber, fallbackOrder);
    const priceMode = order.price_mode || order.priceMode || "";

    console.log("[ProcessingQueue] loaded order for queue save", {
      table: "public.processing_queue",
      orderId: order.id || order.dbId || null,
      orderNumber,
      loadedOrderNumber: order.order_number || order.orderId,
      priceMode,
      status: order.status || null,
      itemsLength: (order.items || []).length,
      itemCount: (order.order_items || order.items || []).length,
      hasCustomerAccountId: Boolean(order.customer_account_id || order.customerAccountId),
      hasCustomerBranchId: Boolean(order.customer_branch_id || order.customerBranchId),
    });

    if (!isServerManagerPriceMode(priceMode)) {
      console.log("[ProcessingQueue] skipped non Server/Manager order", {
        orderNumber,
        priceMode,
      });
      return null;
    }

    const lineItems = order.order_items || order.items || [];
    const orderId = order.id || order.dbId || null;
    const existing = await findExistingProcessingQueueRow({
      orderId,
      orderNumber: order.order_number || orderNumber,
    });
    const confirmedTimestamp =
      confirmedAt ||
      order.delivered_at ||
      order.delivery_confirmed_at ||
      order.confirmed_at ||
      new Date().toISOString();
    const subtotal = getProcessingQueueTotal(order, "subtotal", "net_total");
    const netTotal = getProcessingQueueTotal(order, "net_total", "subtotal");
    const vatTotal = getProcessingQueueTotal(order, "vat_total", "total_vat", "vat");
    const grandTotal = getProcessingQueueTotal(
      order,
      "order_total",
      "total_amount",
      "final_total",
      "total"
    );
    const totalQuantity = lineItems.reduce(
      (sum, item) => sum + getProcessingQueueLineQty(item),
      0
    );

    const payload = {
      order_id: orderId,
      order_number: order.order_number || orderNumber,
      customer_account_id: order.customer_account_id || null,
      customer_branch_id: order.customer_branch_id || null,
      branch_id: order.branch_id || order.customer_branch_id || null,
      branch_name:
        order.branch_name ||
        order.delivery_branch_name ||
        order.shop_name ||
        null,
      customer_name: order.company_name || order.customer_name || null,
      price_mode: String(priceMode || "").toUpperCase(),
      queue_status: "queued",
      queue_source: "order_confirmation",
      subtotal,
      net_total: netTotal,
      vat_total: vatTotal,
      grand_total: grandTotal,
      total_quantity: totalQuantity,
      total_lines: lineItems.length,
      transaction_snapshot: order,
      line_items: lineItems,
      confirmed_at: confirmedTimestamp,
      queued_at: new Date().toISOString(),
    };

    console.log("[ProcessingQueue] saving confirmed Server/Manager order", {
      orderNumber: payload.order_number,
      orderId: payload.order_id,
      priceMode: payload.price_mode,
      existingId: existing?.id || null,
      queueSource: payload.queue_source,
      confirmedAt: payload.confirmed_at,
      totalLines: payload.total_lines,
    });

    const result = existing?.id
      ? await supabase.from("processing_queue").update(payload).eq("id", existing.id).select().single()
      : await supabase.from("processing_queue").insert(payload).select().single();

    console.log("[ProcessingQueue] save response", {
      orderNumber: payload.order_number,
      action: existing?.id ? "update" : "insert",
      data: result.data,
      error: result.error,
    });

    if (result.error) {
      console.warn("ProcessingQueue save skipped:", result.error.message);
      return null;
    }

    return result.data;
  } catch (error) {
    console.warn("ProcessingQueue save skipped:", error.message || error);
    return null;
  }
}

export async function getOrders() {

  const { data, error } = await supabase
    .from("orders")
    .select(`
      *,
      order_items(*),
      customer_accounts(*),
      customer_branches(*)
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  const mappedOrders = (data || []).map((order) => ({
    ...order,

    orderId: order.order_number,
    orderNumber: order.order_number,

    companyName: order.company_name || "",
    branchName:
  order.delivery_branch_name ||
  order.customer_branches?.branch_name ||
  order.customer_branches?.shop_name ||
  "",
    deliveryAddress:
      order.delivery_address ||
      order.customer_branches?.delivery_address ||
      order.customer_accounts?.address ||
      "",

    postcode:
      order.delivery_postcode ||
      order.postcode ||
      order.customer_branches?.postcode ||
      order.customer_accounts?.postcode ||
      "",
   

    priceMode: order.price_mode || "",
    total: Number(order.order_total || order.total || order.final_total || 0),

    createdAt: order.created_at,

    driverName: order.driver_name || "",

    items: (order.order_items || []).map((item) => ({
      ...item,

      dbId: item.id,
      id: item.product_id,

      productId: item.product_id,
      productCode: item.product_code || "",
      name: item.product_name || "",

      qty: Number(item.qty || 0),
      pickedQty: Number(item.picked_qty ?? item.qty ?? 0),

      price: Number(item.price || 0),
      lineTotal: Number(item.line_total || 0),

      sourceStatus: item.source_status || "In Stock",
      includeInPicking: item.include_in_picking !== false,

      net_total: item.net_total,
      gross_total: item.gross_total,
      vat_amount: item.vat_total ?? item.vat_amount ?? 0,
      vat_type: item.vat_type,
      
    })),
  }));

  const processingQueueOrders = await loadProcessingQueueOrders();
  return mergeOperationalOrders(mappedOrders, processingQueueOrders);
}

export async function createCustomerOrder({
  orderNumber: requestedOrderNumber = "",
  companyName,
  priceMode,
  cart,

  discount_percent = 0,
  discount_applied_by = null,
  discount_applied_by_name = "",

  customer_account_id = null,
  customer_branch_id = null,
  delivery_branch_name = "",
  delivery_address = "",
  delivery_postcode = "",
  customer_country = "",
}) {
  const orderNumber = requestedOrderNumber || "ORD-" + Date.now();
 const calculatedTotals = calculateCartTotals(cart || [], {
  priceMode,
  discountPercent: discount_percent,
});
const calculatedOrderItems = calculateCartOrderItems(cart || [], {
  priceMode,
  discountPercent: discount_percent,
});

const orderPayload = {
  order_number: orderNumber,
  customer_id: null,
  customer_account_id: customer_account_id || null,
  customer_branch_id: customer_branch_id || null,

  company_name: companyName.trim(),

  delivery_branch_name: delivery_branch_name || "",
  delivery_address: delivery_address || "",
  delivery_postcode: delivery_postcode || "",
  customer_country: customer_country || "",

  postcode: delivery_postcode || "",
  price_mode: priceMode.toUpperCase(),
  subtotal: calculatedTotals.netTotal.toFixed(2),
  net_total: calculatedTotals.netTotal.toFixed(2),
  vat_total: calculatedTotals.vatTotal.toFixed(2),
  order_total: calculatedTotals.grandTotal.toFixed(2),
  

  discount_percent: calculatedTotals.discountPercent,
  discount_amount: calculatedTotals.discountAmount.toFixed(2),
  discount_applied_by: discount_applied_by || null,
  discount_applied_by_name: discount_applied_by_name || "",

  status: "Received",
};

  let order = null;
  let orderError = null;

  if (requestedOrderNumber) {
    const existingOrder = await supabase
      .from("orders")
      .select("*")
      .eq("order_number", orderNumber)
      .maybeSingle();

    if (existingOrder.error) throw existingOrder.error;
    order = existingOrder.data;

    if (order) {
      const existingItems = await supabase
        .from("order_items")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id);

      if (existingItems.error) throw existingItems.error;
      if (Number(existingItems.count || 0) > 0) {
        return { orderNumber, order, alreadyCreated: true };
      }
    }
  }

  if (!order) {
    const insertedOrder = await supabase
      .from("orders")
      .insert(orderPayload)
      .select()
      .single();

    order = insertedOrder.data;
    orderError = insertedOrder.error;
  }

  if (
    orderError &&
    String(orderError.message || orderError.details || "")
      .toLowerCase()
      .includes("net_total")
  ) {
    const fallbackOrderPayload = { ...orderPayload };
    delete fallbackOrderPayload.net_total;

    const retry = await supabase
      .from("orders")
      .insert(fallbackOrderPayload)
      .select()
      .single();

    order = retry.data;
    orderError = retry.error;
  }

  if (
    orderError &&
    String(orderError.message || orderError.details || "")
      .toLowerCase()
      .includes("subtotal")
  ) {
    const fallbackOrderPayload = { ...orderPayload };
    delete fallbackOrderPayload.net_total;
    delete fallbackOrderPayload.subtotal;

    const retry = await supabase
      .from("orders")
      .insert(fallbackOrderPayload)
      .select()
      .single();

    order = retry.data;
    orderError = retry.error;
  }

  if (orderError) {
    console.error("ORDER ERROR FULL:", JSON.stringify(orderError, null, 2));
    throw orderError;
  }

const orderItems = calculatedOrderItems.map((item) => ({
  order_id: order.id,
  product_id: item.id,
  product_code: getOrderItemProductCode(item),
  product_name: item.name,
  brand: item.brand || "",
  series: item.series || "",
  flavour: item.flavour || "",
  carton_size: item.cartonSize,
  qty: item.qty,
  price: item.price.toFixed(2),
  line_total: item.line_total.toFixed(2),
  net_total: item.net_total.toFixed(2),
  gross_total: item.gross_total.toFixed(2),
  vat_amount: item.vat_total.toFixed(2),
  vat_type: item.vat_type,
  stock_before: item.stock,
  stock_after: Math.max(0, item.stock - item.qty),
  source_status: item.sourceStatus || "In Stock",
  picked_qty: item.pickedQty ?? item.qty,
  include_in_picking: item.includeInPicking !== false,
}));

  let orderItemsForInsert = orderItems;
  let { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItemsForInsert);

  if (
    itemsError &&
    String(itemsError.message || itemsError.details || "")
      .toLowerCase()
      .includes("product_code")
  ) {
    orderItemsForInsert = orderItemsForInsert.map((item) => {
      const nextItem = { ...item };
      delete nextItem.product_code;
      return nextItem;
    });
    const retry = await supabase
      .from("order_items")
      .insert(orderItemsForInsert);

    itemsError = retry.error;
  }

  if (
    itemsError &&
    String(itemsError.message || itemsError.details || "")
      .toLowerCase()
      .includes("vat_rate")
  ) {
    orderItemsForInsert = orderItemsForInsert.map((item) => {
      const nextItem = { ...item };
      delete nextItem.vat_rate;
      return nextItem;
    });
    const retry = await supabase
      .from("order_items")
      .insert(orderItemsForInsert);

    itemsError = retry.error;
  }

  if (
    itemsError &&
    String(itemsError.message || itemsError.details || "")
      .toLowerCase()
      .includes("vat_type")
  ) {
    orderItemsForInsert = orderItemsForInsert.map((item) => {
      const nextItem = { ...item };
      delete nextItem.vat_type;
      return nextItem;
    });
    const retry = await supabase
      .from("order_items")
      .insert(orderItemsForInsert);

    itemsError = retry.error;
  }

  if (
    itemsError &&
    String(itemsError.message || itemsError.details || "")
      .toLowerCase()
      .includes("vat_total")
  ) {
    orderItemsForInsert = orderItemsForInsert.map((item) => {
      const nextItem = { ...item };
      delete nextItem.vat_total;
      return nextItem;
    });
    const retry = await supabase
      .from("order_items")
      .insert(orderItemsForInsert);

    itemsError = retry.error;
  }

  if (itemsError) {
    console.error("ITEMS ERROR:", itemsError);
    throw itemsError;
  }

  for (const item of cart) {
    const stockAfter = Math.max(0, item.stock - item.qty);

    await supabase
      .from("products")
      .update({ stock: stockAfter })
      .eq("id", item.id);

    await supabase.from("stock_movements").insert({
      product_id: item.id,
      movement_type: "SALE",
      qty: -Math.abs(item.qty),
      stock_before: item.stock,
      stock_after: stockAfter,
      note: orderNumber,
    });
  }

  return {
    orderNumber,
    order,
  };
}

export async function updateOrderStatus(orderNumber, status) {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const isDeliveredStatus = isConfirmedStatusForProcessingQueue(normalizedStatus);
  const payload = isDeliveredStatus
    ? { status, delivered_at: new Date().toISOString() }
    : { status };

  let { data, error } = await supabase
    .from("orders")
    .update(payload)
    .eq("order_number", orderNumber)
    .select()
    .single();

  if (error && isDeliveredStatus) {
    const retry = await supabase
      .from("orders")
      .update({ status })
      .eq("order_number", orderNumber)
      .select()
      .single();

    data = retry.data;
    error = retry.error;
  }

  if (error) throw error;

  if (isDeliveredStatus) {
    await saveConfirmedServerManagerOrderToProcessingQueue({
      orderNumber,
      confirmedAt: payload.delivered_at || data?.delivered_at || data?.updated_at,
      fallbackOrder: data || {},
    });
  }

  return data;
}

export async function updateOrderFields(orderNumber, updates) {
  console.log("[Orders] updateOrderFields input", { orderNumber, updates });

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("order_number", orderNumber)
    .select()
    .single();

  if (error) throw error;

  const shouldQueueCashConfirmation = isCashConfirmationUpdate(updates);
  console.log("[Orders] updateOrderFields cash/payment detection", {
    orderNumber,
    shouldQueueCashConfirmation,
    returnedPriceMode: data?.price_mode || data?.priceMode || null,
    returnedOrderNumber: data?.order_number || null,
  });

  if (shouldQueueCashConfirmation) {
    console.log("[Orders] calling saveConfirmedServerManagerOrderToProcessingQueue", {
      orderNumber,
    });
    await saveConfirmedServerManagerOrderToProcessingQueue({
      orderNumber,
      confirmedAt:
        data?.delivered_at ||
        data?.delivery_confirmed_at ||
        data?.confirmed_at ||
        data?.updated_at ||
        new Date().toISOString(),
      fallbackOrder: data || {},
    });
  }

  return data;
}
