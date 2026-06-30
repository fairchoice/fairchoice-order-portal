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

export const toPennies = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100);

export const fromPennies = (pennies) =>
  Number((Number(pennies || 0) / 100).toFixed(2));

export const roundMoney = (value) => fromPennies(toPennies(value));

export const getOrderItemQty = (item = {}) =>
  Number(item.pickedQty ?? item.picked_qty ?? item.qty ?? item.quantity ?? 0);

export const getOrderItemUnitPrice = (item = {}) =>
  roundMoney(
    item.selectedPrice ??
      item.selected_price ??
      item.price ??
      item.unit_price ??
      item.unitPrice ??
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

<<<<<<< HEAD
  if (savedLineTotal > 0) return roundMoney(savedLineTotal);

  return roundMoney(getOrderItemQty(item) * getOrderItemUnitPrice(item));
=======
export const getOrderItemVatType = (item = {}) =>
  item.vat_type ?? item.vatType ?? item.vat_percent ?? item.vatPercent ?? item.vatRate ?? "20";

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
>>>>>>> 1e39b21 (Prepare FairChoice stable version for live)
};

const allocatePennies = (total, weights = []) => {
  const totalPennies = toPennies(total);
  const weightPennies = weights.map(toPennies);
  const weightTotal = weightPennies.reduce((sum, value) => sum + value, 0);

<<<<<<< HEAD
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
=======
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
      const netTotal = roundMoney(
        Math.max(0, lineTotalBeforeDiscount - promotionDiscountTotal - discountAmount)
      );

      return {
        ...item,
        qty,
        price,
        lineTotal: lineTotalBeforeDiscount,
        line_total: lineTotalBeforeDiscount,
        promotionDiscountTotal,
        promotion_discount_total: promotionDiscountTotal,
        discountAmount,
        discount_amount: discountAmount,
        quantity: qty,
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
  const calculated = calculateCartOrderItems([item], {
    priceMode:
      options.priceMode ??
      options.price_mode ??
      item.priceMode ??
      item.price_mode ??
      "vat",
  })[0];

  return roundMoney(calculated?.vat_total || 0);
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
>>>>>>> 1e39b21 (Prepare FairChoice stable version for live)

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

<<<<<<< HEAD
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
=======
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
>>>>>>> 1e39b21 (Prepare FairChoice stable version for live)
