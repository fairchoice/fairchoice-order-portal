import { supabase } from "./supabase";

export async function getOrders() {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;

  return data || [];
}

export async function createCustomerOrder({
  companyName,
  priceMode,
  cart,
  total,
}) {
  const orderNumber = "ORD-" + Date.now();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      order_number: orderNumber,
      customer_id: null,
      company_name: companyName.trim(),
      postcode: "",
      price_mode: priceMode.toUpperCase(),
      order_total: total.toFixed(2),
      status: "Received",
    })
    .select()
    .single();

  if (orderError) {
    console.error("ORDER ERROR:", orderError);
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