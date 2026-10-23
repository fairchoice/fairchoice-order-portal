import {
  applyPromotionRulesToCart,
  promotionRuleAppliesToPriceMode,
  productMatchesPromotionSeriesRule,
  PROMOTION_RULE_KINDS,
} from "../../services/promotionRules";

export const resolvePromotionAudienceType = ({
  activeUser = {},
  normalizedRole = "",
  isSalesRep = false,
  salesRouteMode = false,
} = {}) => {
  if (salesRouteMode || isSalesRep) return "sales_rep";
  if (normalizedRole === "agent") return "agent";
  if (
    normalizedRole === "guest" ||
    (!activeUser?.id &&
      !activeUser?.staff_id &&
      !activeUser?.username &&
      !activeUser?.email)
  ) {
    return "guest";
  }
  return "all";
};

export const applyCustomerOrderPromotions = ({
  cartLines = [],
  promotionRules = [],
  products = [],
  priceMode = "vat",
  audienceType = "all",
} = {}) =>
  applyPromotionRulesToCart(cartLines, promotionRules, {
    products,
    priceMode,
    audienceType,
  });

export const productMatchesPromotionPosterSeries = ({
  product,
  promotionRules = [],
  series = "",
  priceMode = "vat",
} = {}) =>
  productMatchesPromotionSeriesRule({
    product,
    rules: promotionRules,
    series,
    priceMode,
  });

const normalizePromotionType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const getPromotionRuleProductId = (rule) =>
  rule?.product_id ??
  rule?.productId ??
  rule?.trigger_product_id ??
  rule?.triggerProductId ??
  rule?.selected_product_id ??
  rule?.selectedProductId ??
  rule?.product?.id ??
  rule?.selected_product?.id ??
  rule?.selectedProduct?.id ??
  rule?.promotion_product?.product_id ??
  rule?.promotionProduct?.productId ??
  rule?.rule_product?.product_id ??
  rule?.ruleProduct?.productId;

const getPromotionRuleProductIds = (rule) => {
  const directProductId = getPromotionRuleProductId(rule);
  const ids = directProductId != null ? [directProductId] : [];
  const relatedProducts =
    rule?.selected_products ??
    rule?.selectedProducts ??
    rule?.products ??
    rule?.rule_products ??
    rule?.ruleProducts ??
    rule?.promotion_products ??
    rule?.promotionProducts ??
    [];

  if (Array.isArray(relatedProducts)) {
    relatedProducts.forEach((item) => {
      const productId =
        item?.product_id ?? item?.productId ?? item?.id ?? item?.product?.id;
      if (productId != null) ids.push(productId);
    });
  }

  return ids;
};

export const getPromotionRulePrice = (rule) =>
  rule?.promotion_price ??
  rule?.promotionPrice ??
  rule?.offer_price ??
  rule?.offerPrice;

const isPromotionPriceRule = (rule) => {
  const type = normalizePromotionType(
    rule?.promotion_type ??
      rule?.promotionType ??
      rule?.promotion_type_name ??
      rule?.promotionTypeName
  );

  return (
    type === "promotion_price" ||
    type === "promotionprice" ||
    rule?.rule_kind === PROMOTION_RULE_KINDS.PROMOTION_PRICE
  );
};

export const findActivePromotionPriceRule = ({
  product,
  promotionRules = [],
  priceMode = "vat",
  audienceType = "all",
} = {}) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    promotionRules.find((rule) => {
      if (!promotionRuleAppliesToPriceMode(rule, priceMode)) return false;

      const startDate = rule?.start_date ? new Date(rule.start_date) : null;
      const endDate = rule?.end_date ? new Date(rule.end_date) : null;
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(23, 59, 59, 999);

      const productIds = getPromotionRuleProductIds(rule);
      const promotionPrice = getPromotionRulePrice(rule);
      const activeOk =
        rule?.active === true || String(rule?.active).toLowerCase() === "true";

      return (
        activeOk &&
        (!startDate || startDate <= today) &&
        (!endDate || endDate >= today) &&
        isPromotionPriceRule(rule) &&
        productIds.some((productId) => String(productId) === String(product?.id)) &&
        promotionPrice != null &&
        promotionPrice !== ""
      );
    }) || null
  );
};

export const getActivePromotionPrice = (options = {}) => {
  const rule = findActivePromotionPriceRule(options);
  if (!rule) return null;
  const price = Number(getPromotionRulePrice(rule));
  return Number.isFinite(price) ? price : null;
};

export const getPromotionDiscountAmount = (cart = []) =>
  (cart || []).reduce(
    (sum, item) => sum + Number(item?.promotionDiscountAmount || 0),
    0
  );
