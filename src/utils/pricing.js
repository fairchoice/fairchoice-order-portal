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

export const normalizePriceMode = (priceMode) => {
  const raw = String(priceMode || "").trim().toLowerCase();
  // Customer price-code modes contain UUIDs; do not normalize their hyphens.
  if (raw.startsWith("code:")) return raw;
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
};

const getPriceCodeModeParts = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  if (!mode.startsWith("code:")) {
    return { priceCodeId: "", basePriceMode: "ex vat" };
  }
  const payload = mode.slice(5);
  const separatorIndex = payload.indexOf("|");
  if (separatorIndex < 0) {
    return { priceCodeId: payload, basePriceMode: "inc vat" };
  }
  const base = payload.slice(separatorIndex + 1);
  return {
    priceCodeId: payload.slice(0, separatorIndex),
    basePriceMode: ["inc vat", "inc.vat", "incvat", "server"].includes(base) ? "inc vat" : "ex vat",
  };
};

export const getPriceModeLabel = (priceMode, pricingSettings = {}) => {
  const mode = normalizePriceMode(priceMode);
  if (mode.startsWith("code:")) {
    const { priceCodeId } = getPriceCodeModeParts(mode);
    const priceCode = (pricingSettings.price_codes || pricingSettings.priceCodes || []).find(
      (item) => String(item.id) === String(priceCodeId)
    );
    return priceCode?.code || "Customer Price Code";
  }

  if (["royalty", "server", "inc vat"].includes(mode)) return "Inc.VAT";
  if (["owner offer", "manager", "manager offer"].includes(mode)) return "Inc.VAT";
  if (["admin", "admin offer", "long customer", "long customers", "super", "vat"].includes(mode)) return "Ex.VAT";
  if (["ex vat", "exvat"].includes(mode)) return "Ex.VAT";

  return priceMode || "Ex.VAT";
};

export const isServerManagerPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return mode.startsWith("code:") || ["royalty", "server", "inc vat", "owner offer", "manager", "manager offer"].includes(mode);
};

export const isSpecialOfferPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  if (mode.startsWith("code:")) return true;
  return [
    "royalty", "server", "inc vat",
    "owner offer", "manager", "manager offer",
    "admin", "admin offer",
    "long customer", "long customers", "super"
  ].includes(mode);
};

// Legacy helper: VAT/normal mode is still an Ex.VAT unit price with VAT added at totals.
export const isVatPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  return mode === "vat";
};

export const shouldAddVatForPriceMode = (priceMode) => {
  const mode = normalizePriceMode(priceMode);
  if (mode.startsWith("code:")) {
    return getPriceCodeModeParts(mode).basePriceMode === "ex vat";
  }
  return (
    mode === "vat" ||
    mode === "admin" ||
    mode === "admin offer" ||
    mode === "long customer" ||
    mode === "long customers" ||
    mode === "super"
  );
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

  if (mode.startsWith("code:")) {
    const { priceCodeId } = getPriceCodeModeParts(mode);
    const priceCode = (pricingSettings.price_codes || pricingSettings.priceCodes || []).find(
      (item) => String(item.id) === String(priceCodeId) && item.active !== false
    );
    return Number(priceCode?.discount_percent ?? priceCode?.discountPercent ?? 0);
  }

  if (["royalty", "server", "inc vat"].includes(mode)) {
    return Number(pricingSettings.server_discount_percent || 0);
  }
  if (["owner offer", "manager", "manager offer"].includes(mode)) {
    return Number(pricingSettings.manager_discount_percent || 0);
  }
  if (["admin", "admin offer"].includes(mode)) {
    return Number(pricingSettings.admin_offer_discount_percent || 0);
  }
  if (["long customer", "long customers", "super", "vat"].includes(mode)) {
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

  if (mode.startsWith("code:")) {
    const { priceCodeId } = getPriceCodeModeParts(mode);
    const priceCode = (pricingSettings.price_codes || pricingSettings.priceCodes || []).find(
      (item) => String(item.id) === String(priceCodeId) && item.active !== false
    );
    return Number(priceCode?.discount_percent ?? priceCode?.discountPercent ?? 0);
  }

  if (["royalty", "server", "inc vat"].includes(mode)) {
    return Number(pricingSettings.server_pricing_percent ?? pricingSettings.server_discount_percent ?? 0);
  }

  if (["owner offer", "manager", "manager offer"].includes(mode)) {
    return Number(pricingSettings.manager_pricing_percent ?? pricingSettings.manager_discount_percent ?? 0);
  }

  if (["admin", "admin offer"].includes(mode)) {
    return Number(
      pricingSettings.admin_pricing_percent ??
        pricingSettings.admin_offer_discount_percent ??
        0
    );
  }

  if (["long customer", "long customers", "super", "vat"].includes(mode)) {
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

const applyPricingDiscount = (basePrice, percent) => {
  const discountPercent = Number(percent || 0);
  if (!discountPercent) return roundMoney(basePrice);
  return roundMoney(Number(basePrice || 0) * (1 - discountPercent / 100));
};

// Customer code prices follow the customer base mode.
// Ex.VAT code calculations keep the two-decimal FairChoice truncation rule.
const applyCustomerCodeDiscount = (basePrice, percent) => {
  const discountPercent = Number(percent || 0);
  if (!discountPercent) return truncateMoney(basePrice);
  return truncateMoney(Number(basePrice || 0) * (1 - discountPercent / 100));
};

// All calculated Inc.VAT prices use FairChoice quarter rounding.
// Examples: GBP 10.18 -> GBP 10.25, GBP 10.38 -> GBP 10.50.
const applyIncVatQuarterDiscount = (basePrice, percent) => {
  const discountPercent = Number(percent || 0);
  const calculated = discountPercent
    ? Number(basePrice || 0) * (1 - discountPercent / 100)
    : Number(basePrice || 0);
  return roundToFairQuarter(calculated);
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
  const pricingPercent = getPricingPercent(mode, pricingSettings);
  const incVatBasePrice = getGrossPrice(exVatPrice, vatRate);
  const royaltyMode = ["royalty", "server", "inc vat"].includes(mode);
  const ownerOfferMode = ["owner offer", "manager", "manager offer"].includes(mode);
  const adminMode = ["admin", "admin offer"].includes(mode);
  const longCustomerMode = ["long customer", "long customers", "super"].includes(mode);
  const { priceCodeId, basePriceMode: codeBasePriceMode } = getPriceCodeModeParts(mode);
  const codeMode = Boolean(priceCodeId);
  const productPriceCodeMap = product.priceCodePrices || product.price_code_prices || {};
  const productCodeOverride = priceCodeId
    ? validPositiveMoney(productPriceCodeMap[priceCodeId])
    : 0;

  let unitPrice = exVatPrice;
  let grossPrice = getGrossPrice(exVatPrice, vatRate);
  let vatAmount = roundMoney(grossPrice - exVatPrice);
  let appliedRule = "ex_vat_price";
  let appliedSpecialPriceType = "";

  if (codeMode) {
    if (productCodeOverride > 0) {
      if (codeBasePriceMode === "inc vat") {
        unitPrice = productCodeOverride;
        grossPrice = productCodeOverride;
        vatAmount = 0;
        appliedRule = "product_price_code_override_inc_vat";
      } else {
        unitPrice = productCodeOverride;
        grossPrice = getGrossPrice(unitPrice, vatRate);
        vatAmount = roundMoney(grossPrice - unitPrice);
        appliedRule = "product_price_code_override_ex_vat";
      }
      appliedSpecialPriceType = "price_code";
    } else if (codeBasePriceMode === "inc vat") {
      unitPrice = applyIncVatQuarterDiscount(incVatBasePrice, pricingPercent);
      grossPrice = unitPrice;
      vatAmount = 0;
      appliedRule = "customer_price_code_percent_inc_vat";
    } else {
      unitPrice = applyCustomerCodeDiscount(exVatPrice, pricingPercent);
      grossPrice = getGrossPrice(unitPrice, vatRate);
      vatAmount = roundMoney(grossPrice - unitPrice);
      appliedRule = "customer_price_code_percent_ex_vat";
    }
  } else if (mode === "vat" || mode === "normal" || mode === "sales invoice") {
    // Normal Ex.VAT pricing: never apply legacy Super/Long Customer discount.
    unitPrice = exVatPrice;
    grossPrice = getGrossPrice(unitPrice, vatRate);
    vatAmount = roundMoney(grossPrice - unitPrice);
    appliedRule = "normal_ex_vat_price";
  } else if (mode === "ex vat" || mode === "exvat") {
    unitPrice = exVatPrice;
    grossPrice = unitPrice;
    vatAmount = 0;
    appliedRule = "ex_vat_price";
  } else if (royaltyMode) {
    // Royalty percentage is calculated from the VAT-inclusive selling price.
    unitPrice = applyIncVatQuarterDiscount(incVatBasePrice, pricingPercent);
    grossPrice = unitPrice;
    vatAmount = 0;
    appliedRule = "royalty_pricing_percent_inc_vat_quarter";
  } else if (ownerOfferMode) {
    // Owner Offer percentage is calculated from the VAT-inclusive selling price.
    unitPrice = applyIncVatQuarterDiscount(incVatBasePrice, pricingPercent);
    grossPrice = unitPrice;
    vatAmount = 0;
    appliedRule = "owner_offer_pricing_percent_inc_vat_quarter";
  } else if (adminMode) {
    // Admin percentage is calculated from Ex.VAT, then VAT is added by totals.
    unitPrice = applyPricingDiscount(exVatPrice, pricingPercent);
    grossPrice = getGrossPrice(unitPrice, vatRate);
    vatAmount = roundMoney(grossPrice - unitPrice);
    appliedRule = "admin_pricing_percent_ex_vat";
  } else if (longCustomerMode) {
    // Long Customer percentage is calculated from Ex.VAT, then VAT is added by totals.
    unitPrice = applyPricingDiscount(exVatPrice, pricingPercent);
    grossPrice = getGrossPrice(unitPrice, vatRate);
    vatAmount = roundMoney(grossPrice - unitPrice);
    appliedRule = "long_customer_pricing_percent_ex_vat";
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
    specialPrice: appliedSpecialPriceType === "price_code" ? productCodeOverride : 0,
    usesSpecialPrice: Boolean(appliedSpecialPriceType),
    appliedRule,
    appliedSpecialPriceType,
    specialPriceSource: appliedSpecialPriceType
      ? `${appliedSpecialPriceType} price`
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
