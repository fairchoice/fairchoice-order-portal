import { supabase } from "../../services/supabase";
import {
  applyPromotionRulesToCart,
  getActivePromotionRules,
} from "../../services/promotionRules";
import {
  calculateCartOrderItems,
  calculateCartTotals,
  getOrderItemProductCode,
  roundMoney,
} from "../../utils/orderTotals";

const RECEIVED_ORDER_STATUSES = new Set(["received", "in progress"]);

const text = (value) => String(value || "").trim();
const statusKey = (value) => text(value).toLowerCase();

const getOrderPriceMode = (order = {}) =>
  order.priceMode || order.price_mode || "vat";

const getOrderDiscountPercent = (order = {}) =>
  Number(order.discount_percent ?? order.discountPercent ?? 0);

const getItemProductId = (item = {}) =>
  item.productId || item.product_id || item.id || null;

const getItemDbId = (item = {}) =>
  item.dbId || item.order_item_id || item.orderItemId || null;

const getItemPrice = (item = {}) =>
  roundMoney(
    item.price ??
      item.selectedPrice ??
      item.selected_price ??
      item.unit_price ??
      item.unitPrice ??
      item.vatPrice ??
      item.cashPrice ??
      0
  );

export const normalizeReceivedOrderPromotionItem = (item = {}) => {
  const productId = getItemProductId(item);
  const price = getItemPrice(item);
  const qty = Number(item.qty ?? item.quantity ?? item.pickedQty ?? item.picked_qty ?? 0);

  return {
    ...item,
    id: productId,
    productId,
    product_id: productId,
    dbId: getItemDbId(item),
    name: item.name || item.productName || item.product_name || "",
    productName: item.productName || item.product_name || item.name || "",
    productCode: item.productCode || item.product_code || "",
    brand: item.brand || "",
    series: item.series || "",
    flavour: item.flavour || item.flavor || "",
    flavor: item.flavor || item.flavour || "",
    cartonSize: item.cartonSize || item.carton_size || "",
    qty,
    quantity: qty,
    pickedQty: Number(item.pickedQty ?? item.picked_qty ?? qty),
    picked_qty: Number(item.picked_qty ?? item.pickedQty ?? qty),
    price,
    selectedPrice: price,
    selected_price: price,
    unit_price: price,
    unitPrice: price,
    sourceStatus: item.sourceStatus || item.source_status || "In Stock",
    source_status: item.source_status || item.sourceStatus || "In Stock",
    includeInPicking: item.includeInPicking !== false && item.include_in_picking !== false,
    include_in_picking: item.include_in_picking !== false && item.includeInPicking !== false,
    isPromotionFree: false,
    promotionFreeItem: false,
    promotionDiscountLine: false,
  };
};

export const calculateReceivedOrderPromotionState = ({
  order = {},
  items = [],
  activePromotionRules = [],
} = {}) => {
  const priceMode = getOrderPriceMode(order);
  const discountPercent = getOrderDiscountPercent(order);
  const paidItems = (items || [])
    .map(normalizeReceivedOrderPromotionItem)
    .filter((item) => {
      const sourceStatus = statusKey(item.sourceStatus || item.source_status);
      return (
        item.includeInPicking !== false &&
        item.include_in_picking !== false &&
        sourceStatus !== "cannot supply" &&
        sourceStatus !== "removed"
      );
    });
  const promotedCart = applyPromotionRulesToCart(
    paidItems,
    activePromotionRules || [],
    { priceMode }
  );
  const calculatedItems = calculateCartOrderItems(promotedCart, {
    priceMode,
    discountPercent,
  });
  const totals = calculateCartTotals(promotedCart, {
    priceMode,
    discountPercent,
  });

  return {
    priceMode,
    discountPercent,
    promotedCart,
    promotionLines: promotedCart.filter((item) => item?.isPromotionFree),
    calculatedItems,
    totals,
  };
};

const buildOrderItemInsertPayload = ({ order, item, calculatedItem }) => ({
  order_id: order.dbId || order.id,
  product_id: getItemProductId(item),
  product_code: getOrderItemProductCode(item),
  product_name: item.name || item.productName || item.product_name || "",
  brand: item.brand || "",
  series: item.series || "",
  flavour: item.flavour || item.flavor || "",
  carton_size: item.cartonSize || item.carton_size || "",
  qty: Number(calculatedItem.qty || item.qty || 1),
  picked_qty: Number(item.pickedQty ?? item.picked_qty ?? item.qty ?? 1),
  price: roundMoney(calculatedItem.price).toFixed(2),
  line_total: roundMoney(calculatedItem.line_total).toFixed(2),
  net_total: roundMoney(calculatedItem.net_total).toFixed(2),
  gross_total: roundMoney(calculatedItem.gross_total).toFixed(2),
  vat_amount: roundMoney(calculatedItem.vat_total).toFixed(2),
  source_status: item.sourceStatus || item.source_status || "In Stock",
  include_in_picking: item.includeInPicking !== false && item.include_in_picking !== false,
});

const updateCalculatedOrderItem = async (item) => {
  const dbId = getItemDbId(item);
  if (!dbId) return;

  const { error } = await supabase
    .from("order_items")
    .update({
      line_total: roundMoney(item.line_total).toFixed(2),
      net_total: roundMoney(item.net_total).toFixed(2),
      gross_total: roundMoney(item.gross_total).toFixed(2),
      vat_amount: roundMoney(item.vat_total).toFixed(2),
    })
    .eq("id", dbId);

  if (error) throw error;
};

const updateReceivedOrderTotals = async (order, totals) => {
  const orderNumber = order.orderId || order.order_number || order.orderNumber;
  if (!orderNumber) throw new Error("Order number not found for promotion recalculation.");

  const { error } = await supabase
    .from("orders")
    .update({
      subtotal: roundMoney(totals.subtotal).toFixed(2),
      net_total: roundMoney(totals.netTotal).toFixed(2),
      order_total: roundMoney(totals.grandTotal).toFixed(2),
      grand_total: roundMoney(totals.grandTotal).toFixed(2),
      vat_total: roundMoney(totals.vatTotal).toFixed(2),
      discount_percent: totals.discountPercent,
      discount_amount: roundMoney(totals.discountAmount).toFixed(2),
      updated_at: new Date().toISOString(),
    })
    .eq("order_number", orderNumber);

  if (error) throw error;
};

export async function updateReceivedOrderItemWithPromotions({ order, itemId, updates = {} } = {}) {
  if (!order?.dbId && !order?.id) throw new Error("Order database ID not found.");
  if (!itemId) throw new Error("Order item is required.");
  const orderStatus = statusKey(order.status);
  if (orderStatus && !RECEIVED_ORDER_STATUSES.has(orderStatus)) throw new Error("Promotional item changes are only allowed on Received or In Progress orders.");
  const currentItem = (order.items || []).find((item) => String(getItemDbId(item) || getItemProductId(item)) === String(itemId));
  if (!currentItem) throw new Error("Order item not found.");
  const mergedItem = normalizeReceivedOrderPromotionItem({ ...currentItem, ...updates, qty: updates.qty ?? currentItem.qty ?? currentItem.quantity ?? 0, pickedQty: updates.pickedQty ?? updates.picked_qty ?? updates.qty ?? currentItem.pickedQty ?? currentItem.picked_qty ?? currentItem.qty ?? 0, sourceStatus: updates.sourceStatus ?? updates.source_status ?? currentItem.sourceStatus ?? currentItem.source_status, includeInPicking: updates.includeInPicking ?? updates.include_in_picking ?? currentItem.includeInPicking ?? currentItem.include_in_picking });
  const directUpdates = {};
  if (updates.qty !== undefined) directUpdates.qty = Number(updates.qty || 0);
  if (updates.pickedQty !== undefined || updates.picked_qty !== undefined || updates.qty !== undefined) directUpdates.picked_qty = Number(updates.pickedQty ?? updates.picked_qty ?? updates.qty ?? mergedItem.pickedQty ?? 0);
  if (updates.sourceStatus !== undefined || updates.source_status !== undefined) directUpdates.source_status = updates.sourceStatus ?? updates.source_status;
  if (updates.includeInPicking !== undefined || updates.include_in_picking !== undefined) directUpdates.include_in_picking = updates.includeInPicking ?? updates.include_in_picking;
  if (updates.price !== undefined || updates.selectedPrice !== undefined || updates.selected_price !== undefined || updates.unit_price !== undefined || updates.unitPrice !== undefined) directUpdates.price = getItemPrice(mergedItem).toFixed(2);
  if (Object.keys(directUpdates).length) { const { error } = await supabase.from("order_items").update(directUpdates).eq("id", getItemDbId(currentItem) || itemId); if (error) throw error; }
  const nextItems = (order.items || []).map((item) => String(getItemDbId(item) || getItemProductId(item)) === String(itemId) ? { ...item, ...mergedItem } : item);
  const activePromotionRules = await getActivePromotionRules();
  const state = calculateReceivedOrderPromotionState({ order, items: nextItems, activePromotionRules });
  for (const item of state.calculatedItems) await updateCalculatedOrderItem(item);
  await updateReceivedOrderTotals(order, state.totals);
  return { promotionApplied: state.promotionLines.length > 0, promotionLines: state.promotionLines, totals: state.totals };
}

export async function addReceivedOrderItemWithPromotions({
  order,
  newItem,
} = {}) {
  if (!order?.dbId && !order?.id) {
    throw new Error("Order database ID not found.");
  }
  if (!newItem) throw new Error("Product is required.");

  const orderStatus = statusKey(order.status);
  if (orderStatus && !RECEIVED_ORDER_STATUSES.has(orderStatus)) {
    throw new Error("Promotional item changes are only allowed on Received or In Progress orders.");
  }

  // Load the rules before writing the new row. If promotion rules cannot be
  // loaded, do not partially add an item with totals that cannot be reconciled.
  const activePromotionRules = await getActivePromotionRules();
  const tempKey = `received-order-add-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalizedNewItem = normalizeReceivedOrderPromotionItem({
    ...newItem,
    __receivedOrderTempKey: tempKey,
    qty: Number(newItem.qty || 1),
    pickedQty: Number(newItem.pickedQty ?? newItem.qty ?? 1),
  });
  const nextItems = [...(order.items || []), normalizedNewItem];
  const state = calculateReceivedOrderPromotionState({
    order,
    items: nextItems,
    activePromotionRules,
  });
  const calculatedNewItem = state.calculatedItems.find(
    (item) => item.__receivedOrderTempKey === tempKey
  );

  if (!calculatedNewItem) {
    throw new Error("Could not calculate the added order item.");
  }

  const insertPayload = buildOrderItemInsertPayload({
    order,
    item: normalizedNewItem,
    calculatedItem: calculatedNewItem,
  });

  let insertResult = await supabase
    .from("order_items")
    .insert(insertPayload)
    .select("id")
    .single();

  if (
    insertResult.error &&
    String(insertResult.error.message || insertResult.error.details || "")
      .toLowerCase()
      .includes("product_code")
  ) {
    const fallbackPayload = { ...insertPayload };
    delete fallbackPayload.product_code;
    insertResult = await supabase
      .from("order_items")
      .insert(fallbackPayload)
      .select("id")
      .single();
  }

  if (insertResult.error) throw insertResult.error;

  const insertedDbId = insertResult.data?.id;
  const calculatedItemsWithIds = state.calculatedItems.map((item) =>
    item.__receivedOrderTempKey === tempKey
      ? { ...item, dbId: insertedDbId, __receivedOrderTempKey: undefined }
      : item
  );

  // Recalculate every financial line from the same promotion engine used by a
  // normal customer order. This is what makes a Received-order edit preserve
  // the exact Buy/Get-Free and promotion-price outcome.
  for (const item of calculatedItemsWithIds) {
    await updateCalculatedOrderItem(item);
  }
  await updateReceivedOrderTotals(order, state.totals);

  return {
    ...insertResult.data,
    promotionApplied: state.promotionLines.length > 0,
    promotionLines: state.promotionLines,
    totals: state.totals,
  };
}
