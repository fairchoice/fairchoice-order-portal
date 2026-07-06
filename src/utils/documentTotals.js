import { isVatPriceMode } from "./pricing";

const money2 = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const hasMoneyValue = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

const getQuantity = (item = {}) =>
  Number(item.pickedQty ?? item.picked_qty ?? item.qty ?? item.quantity ?? 0);

const getSavedVatRate = (item = {}) => {
  const rawRate =
    item.vat_percent ??
    item.vatPercent ??
    item.vatRate ??
    item.vat_type ??
    item.vatType;

  if (rawRate === null || rawRate === undefined || rawRate === "") return null;

  const rate = Number(String(rawRate).replace("%", "").trim());
  if (!Number.isFinite(rate)) return null;
  if (rate === 0.2) return 20;
  if (rate === 0.05) return 5;

  return rate;
};

const getDocumentItemTotals = (item = {}, { includeVat = true } = {}) => {
  const savedNet = item.net_total ?? item.netTotal;
  const savedPrice = item.price ?? item.unit_price ?? item.unitPrice;
  const vatRate = includeVat ? getSavedVatRate(item) : 0;
  const qty = getQuantity(item);

  if (!includeVat && hasMoneyValue(savedPrice) && qty > 0) {
    const netTotal = money2(Number(savedPrice) * qty);
    return {
      netTotal,
      grossTotal: netTotal,
      vatRate: 0,
    };
  }

  if (
    hasMoneyValue(savedNet) &&
    Number(savedNet) > 0
  ) {
    const netTotal = money2(savedNet);
    return {
      netTotal,
      grossTotal: netTotal,
      vatRate: vatRate ?? 0,
    };
  }

  if (hasMoneyValue(savedPrice) && qty > 0 && vatRate !== null) {
    const netTotal = money2(Number(savedPrice) * qty);
    return {
      netTotal,
      grossTotal: netTotal,
      vatRate,
    };
  }

  const savedLineTotal = item.line_total ?? item.lineTotal;

  if (hasMoneyValue(savedLineTotal) && vatRate !== null) {
    const netTotal = money2(savedLineTotal);
    return {
      netTotal,
      grossTotal: netTotal,
      vatRate,
    };
  }

  return {
    netTotal: 0,
    grossTotal: 0,
    vatRate: vatRate ?? 0,
  };
};

const buildVatGroups = (items = [], includeVat = true) => {
  const groupsByRate = new Map();

  (items || []).forEach((item) => {
    const vatRate = includeVat ? Number(item.vat_rate ?? item.vatRate ?? 0) : 0;
    const key = String(vatRate);
    const currentGroup = groupsByRate.get(key) || {
      vatRate,
      vat_rate: vatRate,
      netTotal: 0,
      net_total: 0,
      vatTotal: 0,
      vat_total: 0,
    };

    currentGroup.netTotal = money2(
      currentGroup.netTotal + Number(item.net_total || 0)
    );
    currentGroup.net_total = currentGroup.netTotal;
    groupsByRate.set(key, currentGroup);
  });

  return [...groupsByRate.values()]
    .map((group) => {
      const vatTotal = includeVat ? money2(group.netTotal * (group.vatRate / 100)) : 0;

      return {
        ...group,
        vatTotal,
        vat_total: vatTotal,
      };
    })
    .sort((a, b) => a.vatRate - b.vatRate);
};

export const getCustomerDocumentType = (priceMode = "") => {
  const mode = String(priceMode || "").trim().toLowerCase();

  const isOrderForm =
    mode === "server" ||
    mode === "manager" ||
    mode.includes("server") ||
    mode.includes("manager");

  return isOrderForm ? "order_form" : "invoice";
};

export function calculateDocumentTotals(items = [], order = {}) {
  const includeVat = isVatPriceMode(order.priceMode || order.price_mode);
  const printableItems = (items || [])
    .filter((item) => item.includeInPicking !== false)
    .map((item) => {
      const itemTotals = getDocumentItemTotals(item, { includeVat });

      return {
        ...item,
        netTotal: itemTotals.netTotal,
        net_total: itemTotals.netTotal,
        vatRate: itemTotals.vatRate,
        vat_rate: itemTotals.vatRate,
        vatTotal: 0,
        vat_total: 0,
        grossTotal: itemTotals.grossTotal,
        gross_total: itemTotals.grossTotal,
      };
    });

  const totalLines = printableItems.length;

  const totalQuantity = printableItems.reduce(
    (sum, item) =>
      sum + getQuantity(item),
    0
  );

  const itemNetTotal = money2(
    printableItems.reduce((sum, item) => sum + Number(item.net_total || 0), 0)
  );

  const vatGroups = buildVatGroups(printableItems, includeVat);
  const itemVatTotal = money2(
    vatGroups.reduce((sum, group) => sum + Number(group.vat_total || 0), 0)
  );
  const recalculatedGrandTotal = money2(itemNetTotal + itemVatTotal);
  const grossTotal = recalculatedGrandTotal;
  const savedGrandTotal = money2(
    order.order_total ?? order.orderTotal ?? order.totalAmount ?? order.total ?? grossTotal
  );
  const savedOrderVat = order.vat_total ?? order.vatTotal;
  const savedVatTotal = includeVat && hasMoneyValue(savedOrderVat) ? money2(savedOrderVat) : 0;
  const savedVatReconciles =
    includeVat &&
    savedVatTotal > 0 &&
    (!itemVatTotal || Math.abs(savedVatTotal - itemVatTotal) <= 0.05);
  const vatTotal = savedVatReconciles ? savedVatTotal : itemVatTotal;

  const savedOrderNet = order.net_total ?? order.netTotal ?? order.subtotal;
  const savedNetTotal = hasMoneyValue(savedOrderNet) ? money2(savedOrderNet) : 0;
  const savedGrandTotalReconciles =
    savedGrandTotal > 0 &&
    (!recalculatedGrandTotal ||
      Math.abs(savedGrandTotal - recalculatedGrandTotal) <= 0.05);
  const grandTotal = savedGrandTotalReconciles
    ? savedGrandTotal
    : recalculatedGrandTotal || savedGrandTotal;

  const savedNetReconciles =
    savedNetTotal > 0 &&
    !(vatTotal > 0 && grandTotal > 0 && savedNetTotal > grandTotal) &&
    (!grandTotal || !vatTotal || Math.abs(savedNetTotal + vatTotal - grandTotal) <= 0.05);
  const netTotal = savedNetReconciles
    ? savedNetTotal
    : itemNetTotal || (grandTotal && vatTotal ? money2(grandTotal - vatTotal) : 0);
  const discountAmount = money2(order.discount_amount ?? order.discountAmount ?? 0);
  const discountPercent = Number(order.discount_percent ?? order.discountPercent ?? 0);

  return {
    invoiceItems: printableItems,
    totalLines,
    totalQty: totalQuantity,
    totalQuantity,
    netTotal,
    vatTotal,
    vatGroups,
    vat_groups: vatGroups,
    grossTotal,
    grandTotal,
    totalAmount: grandTotal,
    discountAmount,
    discountPercent,
  };
}
