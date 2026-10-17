import { getProductPriceForMode, getVatRate, isVatPriceMode, roundMoney } from "./pricing.js";

export const activePriceOrderStages = (stage = "both") => {
  if (stage === "both") return ["Received", "Warehouse Packing"];
  if (["Received", "Warehouse Packing"].includes(stage)) return [stage];
  throw new Error("Select Received orders, Warehouse, or both.");
};

export function buildPriceOrderPreview(orders = [], products = [], productIds = [], settings = {}) {
  const selected = new Set(productIds.map(String));
  const byId = new Map(products.map(product => [String(product.id || product.product_id), product]));
  const rows = [];
  for (const order of orders) {
    if (!activePriceOrderStages().includes(order.status) || order.financial_voided_at ||
        ["VOID", "VOIDED"].includes(String(order.financial_status || "").toUpperCase())) continue;
    for (const item of order.order_items || []) {
      const product = byId.get(String(item.product_id));
      if (!product || !selected.has(String(item.product_id))) continue;
      if (["free", "promotion free"].includes(String(item.source_status || item.sourceStatus || item.status || "").trim().toLowerCase())) continue;
      // Warehouse displays the saved ordered quantity; a default picked_qty=0
      // must not erase the value of an unpicked Received/Warehouse line.
      const qty = Number(item.qty ?? item.quantity ?? item.picked_qty ?? 0);
      const priceMode = order.price_mode || "vat";
      const price = getProductPriceForMode(product, priceMode, order.customer_country || "", settings);
      const vatRate = getVatRate(product.vat_type ?? product.vatType);
      const net = roundMoney(qty * price);
      const vat = isVatPriceMode(priceMode) ? roundMoney(net * vatRate / 100) : 0;
      if (![qty, price, net, vat].every(Number.isFinite) || qty < 0 || price < 0) throw new Error("An order line has an invalid quantity or price.");
      rows.push({ itemId: item.id, orderId: order.id, orderNumber: order.order_number || order.id,
        orderStatus: order.status, productId: String(item.product_id), productName: item.product_name || product.product_name || product.name || "",
        qty, oldPrice: Number(item.price ?? item.unit_price ?? 0), newPrice: price,
        lineTotal: net, netTotal: net, grossTotal: roundMoney(net + vat),
        expectedUpdatedAt: item.updated_at || null, expectedPriceMode: order.price_mode || "", expectedCountry: order.customer_country || "",
        expectedVatPrice: Number(product.vat_price || 0), vatRate, addVat: isVatPriceMode(priceMode),
      });
    }
  }
  return rows;
}

export function sameReviewedPriceRows(reviewed = [], current = []) {
  const byId = new Map(current.map(row => [row.itemId, row]));
  const fields = ["orderId", "orderStatus", "productId", "qty", "oldPrice", "newPrice", "netTotal", "grossTotal",
    "expectedUpdatedAt", "expectedPriceMode", "expectedCountry", "expectedVatPrice", "vatRate", "addVat"];
  return reviewed.every(row => {
    const latest = byId.get(row.itemId);
    return latest && fields.every(field => row[field] === latest[field]);
  });
}
