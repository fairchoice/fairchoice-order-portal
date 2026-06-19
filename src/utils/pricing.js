export const roundToFairQuarter = (price) => {
  const value = Number(price || 0);
  const pounds = Math.floor(value);
  const cents = Math.round((value - pounds) * 100);

  if (cents <= 15) return pounds;
  if (cents <= 35) return pounds + 0.25;
  if (cents <= 65) return pounds + 0.5;
  if (cents <= 85) return pounds + 0.75;

  return pounds + 1;
};

export const getVatRate = (vatType) => {
  const rate = Number(String(vatType || "20").replace("%", "").trim());
  if (rate === 5) return 5;
  if (rate === 0) return 0;
  return 20;
};

export const getOrderItemPrice = (
  product,
  priceMode = "vat",
  pricingSettings = {}
) => {
  const mode = String(priceMode || "").toLowerCase();

  const cashPrice = Number(product.cashPrice || product.cash_price || 0);

  if ((mode === "server" || mode === "manager") && cashPrice > 0) {
    return cashPrice;
  }

  const exVatPrice = Number(product.vatPrice || product.vat_price || 0);
  const vatRate = getVatRate(product.vatType || product.vat_type);
  const incVatPrice = exVatPrice + exVatPrice * (vatRate / 100);

  if (mode === "vat") {
    return exVatPrice;
  }

  const discounts = {
    server: pricingSettings.server_discount_percent,
    manager: pricingSettings.manager_discount_percent,
    super: pricingSettings.super_discount_percent,
  };

  const discount = Number(discounts[mode] || 0);
  const discountedPrice = incVatPrice * (1 - discount / 100);

  return roundToFairQuarter(discountedPrice);
};