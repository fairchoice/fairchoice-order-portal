export const normalizeOrderItemStatus = (item = {}) =>
  String(item.status || item.sourceStatus || item.source_status || "")
    .trim()
    .toLowerCase();

export const isSuppliedOrderItem = (item = {}) => {
  if (item.includeInPicking === false || item.include_in_picking === false) {
    return false;
  }

  const status = normalizeOrderItemStatus(item);

  if (!status) return true;

  return (
    status === "in stock" ||
    status === "available" ||
    status === "supplied" ||
    status === "pre-order" ||
    status === "pre order"
  );
};

export const toPennies = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100);

export const fromPennies = (pennies) =>
  Number((Number(pennies || 0) / 100).toFixed(2));

export const roundMoney = (value) => fromPennies(toPennies(value));

export const getOrderItemQty = (item = {}) =>
  Number(item.pickedQty ?? item.picked_qty ?? item.quantity ?? item.qty ?? 0);

export const getOrderItemUnitPrice = (item = {}) =>
  Number(
    item.unit_price ??
      item.unitPrice ??
      item.price ??
      item.selectedPrice ??
      item.vat_price ??
      item.vatPrice ??
      item.cash_price ??
      item.cashPrice ??
      0
  );

export const getOrderItemNetTotal = (item = {}) => {
  const savedLineTotal = Number(item.line_total ?? item.lineTotal ?? 0);

  if (savedLineTotal > 0) return roundMoney(savedLineTotal);

  return roundMoney(getOrderItemQty(item) * getOrderItemUnitPrice(item));
};

export const getOrderItemVatTotal = (item = {}) => {
  const savedVatTotal = item.vat_total ?? item.vatTotal ?? item.vat_amount ?? item.vatAmount;

  if (savedVatTotal != null && Number(savedVatTotal) > 0) {
    return roundMoney(savedVatTotal || 0);
  }

  const vatRate = Number(item.vat_percent ?? item.vatPercent ?? item.vatRate ?? 20);
  return roundMoney(getOrderItemNetTotal(item) * (vatRate / 100));
};

export const calculateOrderTotals = (items = [], options = {}) => {
  const mode = String(options.priceMode || options.price_mode || "").toLowerCase();
  const includeVat = mode === "vat" || mode === "ex. vat" || mode === "ex vat";
  const invoiceItems = (items || []).filter(isSuppliedOrderItem);
  const totalQty = invoiceItems.reduce((sum, item) => sum + getOrderItemQty(item), 0);
  const totalLines = invoiceItems.length;
  const netTotal = roundMoney(
    invoiceItems.reduce((sum, item) => sum + getOrderItemNetTotal(item), 0)
  );
  const vatTotal = includeVat
    ? roundMoney(invoiceItems.reduce((sum, item) => sum + getOrderItemVatTotal(item), 0))
    : 0;
  const totalAmount = roundMoney(includeVat ? netTotal + vatTotal : netTotal);

  return {
    invoiceItems,
    suppliedItems: invoiceItems,
    totalQty,
    totalQuantity: totalQty,
    totalLines,
    netTotal,
    vatTotal,
    totalAmount,
    grandTotal: totalAmount,
  };
};

const getSavedOrderTotalValue = (order = {}) => {
  const candidates = [
    order.final_total,
    order.finalTotal,
    order.total_amount,
    order.totalAmount,
    order.order_total,
    order.orderTotal,
    order.total,
  ];

  for (const value of candidates) {
    if (value == null || value === "") continue;

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) return roundMoney(numericValue);
  }

  return null;
};

export const getOrderPayableTotal = (order = {}) => {
  const savedTotal = getSavedOrderTotalValue(order);

  if (savedTotal != null) return savedTotal;

  return roundMoney(
    calculateOrderTotals(order.items || order.order_items || [], {
      priceMode: order.priceMode || order.price_mode,
    }).totalAmount
  );
};
