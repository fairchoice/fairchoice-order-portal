import { calculateCartTotals } from "./orderTotals.js";
import { calculateDocumentTotals } from "./documentTotals.js";
import { normalizePriceMode, roundMoney } from "./pricing.js";

// Keep the document's saved net amount (which can include a negotiated reduction)
// when merely opening/saving an existing line. An edited qty/price recalculates.
export function captureInvoiceLinePricing(item = {}, priceMode = "VAT") {
  const qty = Number(item.qty ?? item.quantity ?? item.pickedQty ?? item.picked_qty ?? 0);
  const price = roundMoney(item.price ?? item.unit_price ?? item.unitPrice ?? 0);
  const source = String(item.source_status || item.sourceStatus || item.status || "").trim().toLowerCase();
  const free = ["free", "promotion free"].includes(source) || item.isPromotionFree === true;
  const rawRate = item.vat_percent ?? item.vatPercent ?? item.vatRate ?? item.vat_rate ?? item.vat_type ?? item.vatType;
  let vatRate = rawRate == null || rawRate === "" ? 0 : Number(String(rawRate).replace("%", ""));
  if (vatRate === 0.2) vatRate = 20;
  if (vatRate === 0.05) vatRate = 5;
  return {
    vatRate: Number.isFinite(vatRate) ? vatRate : 0,
    isPromotionFree: false, // Keep saved free rows in the amendment write, with zero value.
    promotionDiscountAmount: 0,
    _invoiceSavedPricing: {
      qty, price, free, vatRate: Number.isFinite(vatRate) ? vatRate : 0, priceMode: normalizePriceMode(priceMode),
      netTotal: free ? 0 : calculateDocumentTotals([item], { price_mode: priceMode, order_total: 0 }).netTotal,
    },
  };
}

export function invoicePricingIsUnchanged(lines, order = {}) {
  const original = order.items || order.order_items || [];
  return original.length === lines.length && lines.every((line) => {
    const saved = line._invoiceSavedPricing;
    return saved && Number(saved.qty) === Number(line.qty ?? line.quantity ?? 0) &&
      Number(saved.price) === roundMoney(line.price ?? line.unit_price ?? 0) &&
      Number(saved.vatRate) === Number(line.vatRate ?? line.vat_rate ?? 0) &&
      saved.priceMode === normalizePriceMode(order.priceMode || order.price_mode || "VAT");
  });
}

export function calculateInvoiceAmendmentTotals(lines, order = {}) {
  const totals = calculateCartTotals(lines, { priceMode: order.priceMode || order.price_mode || "VAT", preserveSavedLineTotals: true });
  if (!invoicePricingIsUnchanged(lines, order)) return totals;
  const saved = calculateDocumentTotals(totals.invoiceItems, order);
  return { ...totals, netTotal: saved.netTotal, vatTotal: saved.vatTotal, vatGroups: saved.vatGroups,
    vat_groups: saved.vatGroups, grandTotal: saved.grandTotal, totalAmount: saved.grandTotal };
}
