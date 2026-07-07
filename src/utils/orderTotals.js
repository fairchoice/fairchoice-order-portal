import {
  getVatRate,
  isVatPriceMode,
  roundMoney,
  toPennies,
  fromPennies,
} from "./pricing";

export { toPennies, fromPennies, roundMoney, isVatPriceMode, getVatRate };

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

export const getOrderItemQty = (item = {}) =>
  Number(item.pickedQty ?? item.picked_qty ?? item.qty ?? item.quantity ?? 0);

export const getOrderItemUnitPrice = (item = {}) =>
  roundMoney(
    item.price ??
      item.unit_price ??
      item.unitPrice ??
      item.selectedPrice ??
      item.selected_price ??
      item.vat_price ??
      item.vatPrice ??
      item.cash_price ??
      item.cashPrice ??
      0
  );

export const getOrderItemVatRate = (item = {}) =>
  getVatRate(
    item.vat_percent ??
      item.vatPercent ??
      item.vatRate ??
      item.vat_type ??
      item.vatType
  );

export const getOrderItemVatType = (item = {}) =>
  item.vat_type ??
  item.vatType ??
  item.vat_percent ??
  item.vatPercent ??
  item.vatRate ??
  "20";

export const getOrderItemProductCode = (item = {}) =>
  item.product_code ||
  item.productCode ||
  item.code ||
  item.sku ||
  item.SKU ||
  item.product?.product_code ||
  item.product?.code ||
  item.product?.sku ||
  item.products?.product_code ||
  item.products?.code ||
  item.products?.sku ||
  "";

const buildVatGroups = (items = [], includeVat = true) => {
  const groupsByRate = new Map();

  (items || []).forEach((item) => {
    const vatRate = includeVat ? getOrderItemVatRate(item) : 0;
    const key = String(vatRate);
    const currentGroup = groupsByRate.get(key) || {
      vatRate,
      vat_rate: vatRate,
      netTotal: 0,
      net_total: 0,
      vatTotal: 0,
      vat_total: 0,
    };

    currentGroup.netTotal = roundMoney(
      currentGroup.netTotal + Number(item.net_total ?? item.netTotal ?? 0)
    );
    currentGroup.net_total = currentGroup.netTotal;
    groupsByRate.set(key, currentGroup);
  });

  return [...groupsByRate.values()]
    .map((group) => {
      const vatTotal = includeVat
        ? roundMoney(group.netTotal * (group.vatRate / 100))
        : 0;

      return {
        ...group,
        vatTotal,
        vat_total: vatTotal,
      };
    })
    .sort((a, b) => a.vatRate - b.vatRate);
};

const allocatePennies = (total, weights = []) => {
  const totalPennies = toPennies(total);
  const weightPennies = weights.map(toPennies);
  const weightTotal = weightPennies.reduce((sum, value) => sum + value, 0);

  if (!totalPennies || !weightTotal) {
    return weights.map(() => 0);
  }

  const allocations = weightPennies.map((weight, index) => {
    const raw = (totalPennies * weight) / weightTotal;
    const pennies = Math.floor(raw);

    return {
      index,
      pennies,
      remainder: raw - pennies,
    };
  });

  let allocated = allocations.reduce((sum, item) => sum + item.pennies, 0);
  allocations
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((item) => {
      if (allocated >= totalPennies) return;
      item.pennies += 1;
      allocated += 1;
    });

  return allocations
    .sort((a, b) => a.index - b.index)
    .map((item) => fromPennies(item.pennies));
};

export const calculateCartOrderItems = (cart = [], options = {}) => {
  const discountPercent = Number(
    options.discountPercent ?? options.discount_percent ?? 0
  );
  const paidItems = (cart || []).filter((item) => !item.isPromotionFree);
  const lineTotals = paidItems.map((item) => {
    const qty = Number(item.qty ?? item.quantity ?? 0);
    const price = getOrderItemUnitPrice(item);
    return roundMoney(price * qty);
  });

  const subtotal = roundMoney(
    lineTotals.reduce((sum, lineTotal) => sum + Number(lineTotal || 0), 0)
  );

  const promotionDiscountAmount = roundMoney(
    (cart || []).reduce(
      (sum, item) => sum + Number(item.promotionDiscountAmount || 0),
      Number(options.promotionDiscountAmount || 0)
    )
  );

  const promotionAllocations = allocatePennies(
    Math.min(subtotal, promotionDiscountAmount),
    lineTotals
  );
  const netBeforeCheckoutDiscounts = lineTotals.map((lineTotal, index) =>
    roundMoney(Math.max(0, lineTotal - promotionAllocations[index]))
  );
  const netBeforeCheckoutDiscount = roundMoney(
    netBeforeCheckoutDiscounts.reduce((sum, value) => sum + value, 0)
  );
  const checkoutDiscountAmount = roundMoney(
    netBeforeCheckoutDiscount * (discountPercent / 100)
  );
  const checkoutDiscountAllocations = allocatePennies(
    Math.min(netBeforeCheckoutDiscount, checkoutDiscountAmount),
    netBeforeCheckoutDiscounts
  );

  return paidItems.map((item, index) => {
    const qty = Number(item.qty ?? item.quantity ?? 0);
    const price = getOrderItemUnitPrice(item);
    const lineTotalBeforeDiscount = lineTotals[index];
    const promotionDiscountTotal = roundMoney(promotionAllocations[index]);
    const discountAmount = roundMoney(checkoutDiscountAllocations[index]);
    const vatRate = getOrderItemVatRate(item);
    const vatType = getOrderItemVatType(item);
    const productCode = getOrderItemProductCode(item);
    const netTotal = roundMoney(
      Math.max(0, lineTotalBeforeDiscount - promotionDiscountTotal - discountAmount)
    );

    return {
      ...item,
      productCode,
      product_code: productCode,
      code: item.code || productCode,
      qty,
      quantity: qty,
      price,
      lineTotal: lineTotalBeforeDiscount,
      line_total: lineTotalBeforeDiscount,
      promotionDiscountTotal,
      promotion_discount_total: promotionDiscountTotal,
      discountAmount,
      discount_amount: discountAmount,
      netTotal,
      net_total: netTotal,
      vatRate,
      vat_rate: vatRate,
      vatType,
      vat_type: vatType,
      vatTotal: 0,
      vat_total: 0,
      grossTotal: netTotal,
      gross_total: netTotal,
    };
  });
};

export const getOrderItemNetTotal = (item = {}) => {
  const calculated = calculateCartOrderItems([item], {
    priceMode: item.priceMode || item.price_mode || "vat",
  })[0];

  return roundMoney(calculated?.net_total || 0);
};

export const getOrderItemVatTotal = (item = {}, options = {}) => {
  const totals = calculateCartTotals([item], {
    priceMode:
      options.priceMode ??
      options.price_mode ??
      item.priceMode ??
      item.price_mode ??
      "vat",
  });

  return roundMoney(totals.vatTotal || 0);
};

export const calculateCartTotals = (cart = [], options = {}) => {
  const priceMode = options.priceMode || options.price_mode || "vat";
  const discountPercent = Number(
    options.discountPercent ?? options.discount_percent ?? 0
  );
  const paidItems = calculateCartOrderItems(cart, {
    priceMode,
    discountPercent,
    promotionDiscountAmount: options.promotionDiscountAmount,
  });

  const totalQty = paidItems.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const totalLines = paidItems.length;

  const subtotal = roundMoney(
    paidItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0)
  );

  const promotionDiscountAmount = roundMoney(
    (cart || []).reduce(
      (sum, item) => sum + Number(item.promotionDiscountAmount || 0),
      Number(options.promotionDiscountAmount || 0)
    )
  );

  const netBeforeDiscount = roundMoney(
    Math.max(0, subtotal - promotionDiscountAmount)
  );
  const discountAmount = roundMoney(netBeforeDiscount * (discountPercent / 100));
  const netTotal = roundMoney(
    paidItems.reduce((sum, item) => sum + Number(item.net_total || 0), 0)
  );
  const vatGroups = buildVatGroups(paidItems, isVatPriceMode(priceMode));
  const vatTotal = roundMoney(
    vatGroups.reduce((sum, group) => sum + Number(group.vat_total || 0), 0)
  );
  const totalAmount = roundMoney(netTotal + vatTotal);

  return {
    invoiceItems: paidItems,
    suppliedItems: paidItems,
    totalQty,
    totalQuantity: totalQty,
    totalLines,
    subtotal,
    promotionDiscountAmount,
    discountPercent,
    discountAmount,
    netBeforeDiscount,
    netTotal,
    vatTotal,
    vatGroups,
    vat_groups: vatGroups,
    totalAmount,
    grandTotal: totalAmount,
  };
};

export const calculateOrderTotals = (items = [], options = {}) => {
  const priceMode = options.priceMode || options.price_mode || "vat";
  const invoiceItems = (items || []).filter(isSuppliedOrderItem);

  return calculateCartTotals(invoiceItems, {
    priceMode,
    discountPercent: options.discountPercent ?? options.discount_percent,
    promotionDiscountAmount: options.promotionDiscountAmount || 0,
  });
};

export const getOrderPayableTotal = (order = {}) =>
  calculateOrderTotals(order.items || order.order_items || [], {
    priceMode: order.priceMode || order.price_mode,
    discountPercent: order.discount_percent,
  }).totalAmount;
