import { supabase } from "./supabase";

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
      vat_percent: item.vat_percent,
      vat_amount: item.vat_amount,
    })),
  }));
}

export async function createCustomerOrder({
  companyName,
  priceMode,
  cart,
  total,

  discount_percent = 0,
  discount_amount = 0,
  discount_applied_by = null,
  discount_applied_by_name = "",

  customer_account_id = null,
  customer_branch_id = null,
  delivery_branch_name = "",
  delivery_address = "",
  delivery_postcode = "",
  customer_country = "",
  credit_limit = 0,
}) {
  const orderNumber = "ORD-" + Date.now();

  const { data: order, error: orderError } = await supabase
    .from("orders")
   .insert({
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
  order_total: total.toFixed(2),
  

  discount_percent: Number(discount_percent || 0),
  discount_amount: Number(discount_amount || 0),
  discount_applied_by: discount_applied_by || null,
  discount_applied_by_name: discount_applied_by_name || "",

  status: "Received",
})
    .select()
    .single();

  if (orderError) {
    console.error("ORDER ERROR FULL:", JSON.stringify(orderError, null, 2));

alert(
  `Order Error:\n\n${orderError.message}\n\n${orderError.details || ""}\n\n${orderError.hint || ""}`
);
    throw orderError;
  }

  const orderItems = cart.map((item) => ({
    order_id: order.id,
    product_id: item.id,
    product_name: item.name,
    brand: item.brand || "",
    series: item.series || "",
    flavour: item.flavour || "",
    carton_size: item.cartonSize,
    qty: item.qty,
    price: item.selectedPrice.toFixed(2),
    line_total: (item.selectedPrice * item.qty).toFixed(2),
    stock_before: item.stock,
    stock_after: Math.max(0, item.stock - item.qty),
    source_status: item.sourceStatus || "In Stock",
    picked_qty: item.pickedQty ?? item.qty,
    include_in_picking: item.includeInPicking !== false,
  }));

  const { error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItems);

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