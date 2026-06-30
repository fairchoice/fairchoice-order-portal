export const toPennies = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100);

export const fromPennies = (pennies) =>
  Number((Number(pennies || 0) / 100).toFixed(2));

export const roundMoney = (value) => fromPennies(toPennies(value));


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

export const normalizePriceMode = (priceMode) =>
  String(priceMode || "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

export const isServerManagerPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return mode === "server" || mode === "manager";
};

export const isVatPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return ["vat", "ex vat", "super", "admin", "admin offer"].includes(mode);
};

export const getVatRate = (vatType) => {
  const raw = String(vatType ?? "20").replace("%", "").trim();
  const numeric = Number(raw);

  if (numeric === 0.2) return 20;
  if (numeric === 0.05) return 5;
  if (numeric === 5) return 5;
  if (numeric === 0) return 0;
  return 20;
};

export const getPricingDiscountPercent = (priceMode, pricingSettings = {}) => {
  const mode = normalizePriceMode(priceMode);

  if (mode === "server") return Number(pricingSettings.server_discount_percent || 0);
  if (mode === "manager") return Number(pricingSettings.manager_discount_percent || 0);
  if (mode === "super" || mode === "admin" || mode === "admin offer") {
    return Number(pricingSettings.super_discount_percent || 0);
  }

  return 0;
};

export const getProductBaseNetPrice = (product = {}, country = "") => {
  const modeCountry = String(country || "").trim().toLowerCase();

  const specialPrice =
    modeCountry === "wales"
      ? Number(product.walesSpecialPrice ?? product.wales_special_price ?? 0)
      : modeCountry === "england"
        ? Number(product.englandSpecialPrice ?? product.england_special_price ?? 0)
        : 0;

  if (specialPrice > 0) return roundMoney(specialPrice);

return roundMoney(
    Number(product.vat_price || 0)
);
};

// Single FairChoice price source of truth.
// Returns the final unit price that every page should save/display.
export const getProductPriceForMode = (
  product = {},
  priceMode = "vat",
  country = "",
  pricingSettings = {}
) => {
  const mode = normalizePriceMode(priceMode);
  const baseNetPrice = getProductBaseNetPrice(product, country);
  const vatRate = getVatRate(product.vatType ?? product.vat_type);
  const discountPercent = getPricingDiscountPercent(mode, pricingSettings);
  const discountMultiplier = 1 - discountPercent / 100;

  if (mode === "server" || mode === "manager") {
    const grossPrice = baseNetPrice * (1 + vatRate / 100);
    return roundMoney(roundToFairQuarter(grossPrice * discountMultiplier));
  }

  // VAT / Ex VAT / Super/Admin Offer: apply configured discount before VAT.
  // VAT itself is added only by calculateOrderTotals when the mode requires it.
  return roundMoney(baseNetPrice * discountMultiplier);
};

export const getProductPricePreview = (
    product = {},
    country = "",
    pricingSettings = {}
) => {
    const vat = getProductPriceForMode(
        product,
        "vat",
        country,
        pricingSettings
    );

    const server = getProductPriceForMode(
        product,
        "server",
        country,
        pricingSettings
    );

    const manager = getProductPriceForMode(
        product,
        "manager",
        country,
        pricingSettings
    );

    const admin = getProductPriceForMode(
        product,
        "admin offer",
        country,
        pricingSettings
    );

     const cost = Number(product.cost_price || 0);

    const calcMargin = (selling) =>
        selling > 0
            ? Number((((selling - cost) / selling) * 100).toFixed(2))
            : 0;

    return {
        cost,
        vat,
        server,
        manager,
        admin,

        vatMargin: calcMargin(vat),
        serverMargin: calcMargin(server),
        managerMargin: calcMargin(manager),
        adminMargin: calcMargin(admin),
    };
};

// Backwards-compatible name used by older files.
export const getOrderItemPrice = getProductPriceForMode;
