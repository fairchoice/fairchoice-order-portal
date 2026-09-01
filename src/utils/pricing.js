export const toPennies = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100);

export const fromPennies = (pennies) =>
  Number((Number(pennies || 0) / 100).toFixed(2));

export const roundMoney = (value) => fromPennies(toPennies(value));

const truncateMoney = (value) =>
  Number((Math.floor((Number(value || 0) + Number.EPSILON) * 100) / 100).toFixed(2));

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

export const getPriceModeLabel = (priceMode) => {
  const mode = normalizePriceMode(priceMode);

  if (mode === "vat" || mode === "ex vat" || mode === "exvat") return "Ex.VAT";
  if (mode === "server") return "Inc.VAT";
  if (mode === "super" || mode === "admin" || mode === "admin offer") {
    return "Admin Offer";
  }
  if (mode === "manager" || mode === "manager offer") return "Manager Offer";

  return priceMode || "Ex.VAT";
};

export const isServerManagerPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return mode === "server" || mode === "manager";
};

export const isSpecialOfferPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return (
    mode === "server" ||
    mode === "manager" ||
    mode === "super" ||
    mode === "admin" ||
    mode === "admin offer"
  );
};

export const isVatPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return mode === "vat";
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

const validPositiveMoney = (value) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundMoney(parsed) : 0;
};

const getPricingPercent = (priceMode, pricingSettings = {}) => {
  const mode = normalizePriceMode(priceMode);

  if (mode === "server") {
    return Number(pricingSettings.server_pricing_percent ?? pricingSettings.server_discount_percent ?? 0);
  }

  if (mode === "manager") {
    return Number(pricingSettings.manager_pricing_percent ?? pricingSettings.manager_discount_percent ?? 0);
  }

  if (mode === "admin" || mode === "admin offer") {
    return Number(
      pricingSettings.admin_pricing_percent ??
        pricingSettings.admin_offer_discount_percent ??
        pricingSettings.super_discount_percent ??
        0
    );
  }

  if (mode === "super") {
    return Number(pricingSettings.super_pricing_percent ?? pricingSettings.super_discount_percent ?? 0);
  }

  return 0;
};

const getVatSellPrice = (product = {}) =>
  validPositiveMoney(product.vatSellPrice ?? product.vat_sell_price ?? product.vatPrice ?? product.vat_price);

const vatSellPriceIncludesVat = (product = {}) => {
  const explicit =
    product.vat_price_includes_vat ??
    product.vatPriceIncludesVat ??
    product.vat_sell_price_includes_vat ??
    product.vatSellPriceIncludesVat;

  if (explicit !== undefined && explicit !== null && explicit !== "") {
    return explicit === true || String(explicit).trim().toLowerCase() === "true";
  }

  return false;
};

const getExVatPrice = (product = {}, vatRate = getVatRate(product.vatType ?? product.vat_type)) => {
  const vatSellPrice = getVatSellPrice(product);
  if (!vatSellPriceIncludesVat(product)) return vatSellPrice;
  return roundMoney(vatSellPrice / (1 + vatRate / 100));
};

const getGrossPrice = (netPrice, vatRate) => roundMoney(Number(netPrice || 0) * (1 + Number(vatRate || 0) / 100));

// FairChoice margin rule: margin is always calculated from the Ex. VAT selling price.
export const calculateExVatMargin = (sellingExVat, costValue) => {
  const selling = Number(sellingExVat || 0);
  const cost = Number(costValue || 0);
  return selling > 0
    ? Number((((selling - cost) / selling) * 100).toFixed(2))
    : 0;
};

const getProductOnlySpecialPrice = (product = {}) =>
  validPositiveMoney(
    product.specialPrice ??
      product.special_price ??
      product.productSpecialPrice ??
      product.product_special_price ??
      product.cashPrice ??
      product.cash_price
  );

export const getProductSpecialPrice = (product = {}, country = "") => {
  const modeCountry = String(country || "").trim().toLowerCase();
  const specialPrice =
    modeCountry === "wales"
      ? validPositiveMoney(product.walesSpecialPrice ?? product.wales_special_price)
      : modeCountry === "england"
        ? validPositiveMoney(product.englandSpecialPrice ?? product.england_special_price)
        : 0;

  return specialPrice;
};

const applyPricingDiscount = (basePrice, percent) => {
  const discountPercent = Number(percent || 0);
  if (!discountPercent) return roundMoney(basePrice);
  return roundMoney(Number(basePrice || 0) * (1 - discountPercent / 100));
};

const getVatMultiplier = (vatRate) => {
  const rate = Number(vatRate || 0);
  if (!rate) return 1;
  return 1 + rate / 100;
};

const applyServerManagerPricing = (basePrice, percent) => {
  const pricingPercent = Number(percent || 0);
  const discountedPrice = pricingPercent
    ? Number(basePrice || 0) - (Number(basePrice || 0) * pricingPercent) / 100
    : Number(basePrice || 0);

  return roundToFairQuarter(discountedPrice);
};

export const calculateProductPrice = (input = {}, positionalPriceMode, positionalCountry, positionalPricingSettings) => {
  const options =
    input && Object.prototype.hasOwnProperty.call(input, "product")
      ? input
      : {
          product: input || {},
          priceMode: positionalPriceMode,
          country: positionalCountry,
          pricingSettings: positionalPricingSettings,
        };
  const {
    product = {},
    priceMode = "vat",
    country = "",
    customer,
    branch,
    pricingSettings = {},
  } = options;
  const mode = normalizePriceMode(priceMode);
  const vatRate = getVatRate(product.vatType ?? product.vat_type);
  const resolvedCountry =
    country ||
    branch?.country ||
    branch?.branch_country ||
    customer?.country ||
    customer?.customer_country ||
    "";
  const exVatPrice = getExVatPrice(product, vatRate);
  const vatSellPrice = getVatSellPrice(product);
  const productSpecialPrice = getProductOnlySpecialPrice(product);
  const countrySpecialPrice = getProductSpecialPrice(product, resolvedCountry);
  const pricingPercent = getPricingPercent(mode, pricingSettings);
  const discountedNetPrice = applyPricingDiscount(exVatPrice, pricingPercent);
  const serverManagerBasePrice = roundMoney(vatSellPrice * getVatMultiplier(vatRate));
  const serverManagerPrice = applyServerManagerPricing(serverManagerBasePrice, pricingPercent);

  let unitPrice = exVatPrice;
  let grossPrice = exVatPrice;
  let vatAmount = 0;
  let appliedRule = "ex_vat_price";
  let appliedSpecialPriceType = "";

  if (mode === "vat" || mode === "normal" || mode === "sales invoice") {
    unitPrice = vatSellPrice;
    grossPrice = getGrossPrice(unitPrice, vatRate);
    vatAmount = roundMoney(grossPrice - unitPrice);
    appliedRule = "vat_sell_price";
  } else if (mode === "ex vat" || mode === "exvat") {
    unitPrice = exVatPrice;
    grossPrice = unitPrice;
    appliedRule = "ex_vat_price";
  } else if (mode === "server") {
    if (countrySpecialPrice > 0) {
      unitPrice = countrySpecialPrice;
      appliedRule = "country_special_price";
      appliedSpecialPriceType = String(resolvedCountry || "country").toLowerCase();
    } else {
      unitPrice = serverManagerPrice;
      appliedRule = "server_pricing_percent";
    }
    grossPrice = unitPrice;
  } else if (mode === "manager") {
    if (productSpecialPrice > 0) {
      unitPrice = productSpecialPrice;
      appliedRule = "product_special_price";
      appliedSpecialPriceType = "product";
    } else if (countrySpecialPrice > 0) {
      unitPrice = countrySpecialPrice;
      appliedRule = "country_special_price";
      appliedSpecialPriceType = String(resolvedCountry || "country").toLowerCase();
    } else {
      unitPrice = serverManagerPrice;
      appliedRule = "manager_pricing_percent";
    }
    grossPrice = unitPrice;
  } else if (mode === "admin" || mode === "admin offer" || mode === "super") {
    unitPrice = truncateMoney(Number(vatSellPrice || 0) * (1 - pricingPercent / 100));
    grossPrice = unitPrice;
    vatAmount = roundMoney(unitPrice * (vatRate / 100));
    appliedRule = "admin_pricing_percent_vat_sell";
  }

  unitPrice = roundMoney(unitPrice);
  grossPrice = roundMoney(grossPrice);
  vatAmount = roundMoney(vatAmount);

  return {
    unitPrice,
    price: unitPrice,
    finalPrice: unitPrice,
    exVatPrice,
    vatRate,
    vatAmount,
    grossPrice,
    normalPrice: vatSellPrice,
    vatSellPrice,
    specialPrice: appliedSpecialPriceType
      ? appliedSpecialPriceType === "product"
        ? productSpecialPrice
        : countrySpecialPrice
      : 0,
    usesSpecialPrice: Boolean(appliedSpecialPriceType),
    appliedRule,
    appliedSpecialPriceType,
    specialPriceSource: appliedSpecialPriceType
      ? `${appliedSpecialPriceType} special price`
      : "",
  };
};

// Single FairChoice price source of truth.
// Returns the final unit price that every page should save/display.
export const getProductPriceDetailsForMode = (
  product = {},
  priceMode = "vat",
  country = "",
  pricingSettings = {}
) => calculateProductPrice({ product, priceMode, country, pricingSettings });

export const getProductPriceForMode = (
  product = {},
  priceMode = "vat",
  country = "",
  pricingSettings = {}
) => {
  return getProductPriceDetailsForMode(
    product,
    priceMode,
    country,
    pricingSettings
  ).price;
};

export const getHomepagePriceForMode = (
  homePrice = 0,
  priceMode = "vat",
  pricingSettings = {}
) => {
  return calculateProductPrice({
    product: { vatPrice: homePrice, vat_price: homePrice, vatType: 0, vat_type: 0 },
    priceMode,
    pricingSettings,
  }).unitPrice;
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
    const exVat = getProductPriceForMode(
        product,
        "ex vat",
        country,
        pricingSettings
    );
    const exVatMargin = calculateExVatMargin(exVat, cost);

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
        exVat,
        exVatMargin,

        // Legacy mode margins are retained for compatibility. New margin UI must use exVatMargin.
        vatMargin: calculateExVatMargin(vat, cost),
        serverMargin: calcMargin(server),
        managerMargin: calcMargin(manager),
        adminMargin: calcMargin(admin),
    };
};


// Backwards-compatible name used by older files.
export const getOrderItemPrice = getProductPriceForMode;
