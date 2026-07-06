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

const getProductOnlySpecialPrice = (product = {}) =>
  validPositiveMoney(
    product.specialPrice ??
      product.special_price ??
      product.productSpecialPrice ??
      product.product_special_price
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

export const calculateProductPrice = ({
  product = {},
  priceMode = "vat",
  country = "",
  customer,
  branch,
  pricingSettings = {},
} = {}) => {
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
  const percentNetPrice =
    pricingPercent > 0 ? roundMoney(exVatPrice * (pricingPercent / 100)) : exVatPrice;

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
      unitPrice = percentNetPrice;
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
      unitPrice = percentNetPrice;
      appliedRule = "manager_pricing_percent";
    }
    grossPrice = unitPrice;
  } else if (mode === "admin" || mode === "admin offer") {
    const adminNet = percentNetPrice;
    unitPrice = getGrossPrice(adminNet, vatRate);
    grossPrice = unitPrice;
    vatAmount = roundMoney(unitPrice - adminNet);
    appliedRule = "admin_pricing_percent_gross";
  } else if (mode === "super") {
    unitPrice = percentNetPrice;
    grossPrice = unitPrice;
    appliedRule = "super_pricing_percent";
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
    specialPrice:
      appliedSpecialPriceType === "product" ? productSpecialPrice : countrySpecialPrice,
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
