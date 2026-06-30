import { supabase } from "./supabase";
import { calculateCartTotals, calculateCartOrderItems } from "../utils/orderTotals";

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

  return (data || []).map((order) => ({
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
      vat_total: item.vat_total,
      vat_rate: item.vat_rate,
      vat_type: item.vat_type,
      
    })),
  }));
}

export async function createCustomerOrder({
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
  const orderNumber = "ORD-" + Date.now();
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

  let { data: order, error: orderError } = await supabase
    .from("orders")
   .insert(orderPayload)
    .select()
    .single();

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

alert(
  `Order Error:\n\n${orderError.message}\n\n${orderError.details || ""}\n\n${orderError.hint || ""}`
);
    throw orderError;
  }

const orderItems = calculatedOrderItems.map((item) => ({
  order_id: order.id,
  product_id: item.id,
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
  vat_total: item.vat_total.toFixed(2),
  vat_rate: item.vat_rate,
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
  const { data, error } = await supabase
    .from("orders")
    .update({ status })
    .eq("order_number", orderNumber)
    .select()
    .single();

  if (error) throw error;

  return data;
}

export async function updateOrderFields(orderNumber, updates) {
  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("order_number", orderNumber)
    .select()
    .single();

  if (error) throw error;

  return data;
}
