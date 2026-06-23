import { supabase } from "./supabase";

export const PROMOTION_RULE_KINDS = {
  BULK_BUY_GET_FREE: "BULK_BUY_GET_FREE",
  PROMOTION_PRICE: "PROMOTION_PRICE",
  REDUCED_PRICE: "REDUCED_PRICE",
};

export const PROMOTION_LABELS = [
  { value: "", label: "No Label" },
  { value: "promotion", label: "Promotion" },
  { value: "recommended", label: "Recommended" },
  { value: "top_seller", label: "Top Seller" },
  { value: "new", label: "New" },
  { value: "coming_soon", label: "Coming Soon" },
  { value: "reduced", label: "Reduced" },
];

const labelPayload = (labelType = "") => ({
  is_promotion: labelType === "promotion",
  is_reduced: labelType === "reduced",
  is_new: labelType === "new",
  coming_soon: labelType === "coming_soon",
  recommended: labelType === "recommended",
  top_seller: labelType === "top_seller",
});

export async function ensureDefaultPromotionTypes() {
  const rows = [
    "Buy 1 Get 1 Free",
    "Buy 10 Get 1 Free",
    "Buy More Get Free Product",
    "Promotion Price",
    "Reduced Price",
  ].map((type_name) => ({ type_name, active: true }));

  const { error } = await supabase
    .from("promotion_types")
    .upsert(rows, { onConflict: "type_name" });

  if (error) throw error;
}

export async function getPromotionTypes() {
  const { data, error } = await supabase
    .from("promotion_types")
    .select("id, type_name, active, created_at")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function savePromotionType(typeName) {
  const cleanName = String(typeName || "").trim();
  if (!cleanName) return null;

  const { data, error } = await supabase
    .from("promotion_types")
    .insert({ type_name: cleanName, active: true })
    .select("id, type_name, active, created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function updatePromotionType(id, updates) {
  const { error } = await supabase
    .from("promotion_types")
    .update(updates)
    .eq("id", id);

  if (error) throw error;
}

export async function getPromotionRules() {
  const { data, error } = await supabase
    .from("promotion_rules")
    .select(
      [
        "id",
        "promotion_type_id",
        "promotion_name",
        "rule_kind",
        "active",
        "trigger_brand",
        "trigger_series",
        "trigger_product_id",
        "buy_qty",
        "free_series",
        "free_product_id",
        "free_qty",
        "offer_price",
        "label_type",
        "start_date",
        "end_date",
        "created_at",
      ].join(",")
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getActivePromotionRules() {
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("promotion_rules")
    .select("*")
    .eq("active", true)
    .or(`start_date.is.null,start_date.lte.${today}`)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function savePromotionRule(rule, productIdsToLabel = []) {
  const payload = {
    promotion_type_id: rule.promotion_type_id || null,
    promotion_name: String(rule.promotion_name || "").trim(),
    rule_kind: rule.rule_kind,
    active: rule.active !== false,
    trigger_brand: rule.trigger_brand || null,
    trigger_series: rule.trigger_series || null,
    trigger_product_id: rule.trigger_product_id || null,
    buy_qty: rule.buy_qty ? Number(rule.buy_qty) : null,
    free_brand: rule.free_brand || null,
    free_series: rule.free_series || null,
    free_product_id: rule.free_product_id || null,
    free_qty: rule.free_qty ? Number(rule.free_qty) : null,
    offer_price: rule.offer_price ? Number(rule.offer_price) : null,
    label_type: rule.label_type || "",
    start_date: rule.start_date || null,
    end_date: rule.end_date || null,
  };

  const query = rule.id
    ? supabase
        .from("promotion_rules")
        .update(payload)
        .eq("id", rule.id)
        .select()
        .single()
    : supabase
        .from("promotion_rules")
        .insert(payload)
        .select()
        .single();

  const { data, error } = await query;
  if (error) throw error;

  await updateProductPromotionLabels(productIdsToLabel, payload.label_type);

  return data;
}

export async function updateProductPromotionLabels(productIds = [], labelType = "") {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return;

  const { error } = await supabase
    .from("products")
    .update(labelPayload(labelType))
    .in("id", ids);

  if (error) throw error;
}

const isPromotionFreeLine = (line) =>
  line?.isPromotionFree === true || line?.promotionFreeItem === true;

const normalizeMatchValue = (value) =>
  String(value || "").trim().toLowerCase();

const normalizePromotionType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isVatPriceMode = (priceMode) => {
  const mode = normalizeMatchValue(priceMode);
  return mode === "vat" || mode === "ex vat" || mode === "ex. vat";
};

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

const getPromotionRulePrice = (rule) =>
  rule?.promotion_price ??
  rule?.promotionPrice ??
  rule?.offer_price ??
  rule?.offerPrice;

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
        item?.product_id ??
        item?.productId ??
        item?.id ??
        item?.product?.id;
      if (productId != null) ids.push(productId);
    });
  }

  return ids;
};

const findActivePromotionPriceRule = (productId, activePromotionRules = []) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return activePromotionRules.find((rule) => {
    const startDate = rule?.start_date ? new Date(rule.start_date) : null;
    const endDate = rule?.end_date ? new Date(rule.end_date) : null;

    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const startsOk = !startDate || startDate <= today;
    const endsOk = !endDate || endDate >= today;
    const promotionPrice = getPromotionRulePrice(rule);
    const productIds = getPromotionRuleProductIds(rule);

    return (
      rule?.active === true &&
      startsOk &&
      endsOk &&
      isPromotionPriceRule(rule) &&
      productIds.some((ruleProductId) => String(ruleProductId) === String(productId)) &&
      promotionPrice != null &&
      promotionPrice !== ""
    );
  }) || null;
};

const buildPromotionPriceDiscountLines = (
  paidLines = [],
  activePromotionRules = []
) =>
  paidLines
    .map((line) => {
    const rule = findActivePromotionPriceRule(line?.id, activePromotionRules);
    if (!rule) return null;

    const promotionPrice = Number(getPromotionRulePrice(rule));
    if (!Number.isFinite(promotionPrice)) return null;

    const normalSelectedPrice =
      line.normalSelectedPrice ??
      line.vatPrice ??
      line.exVatPrice ??
      line.selectedPrice ??
      0;
    const normalPrice = Number(normalSelectedPrice || 0);
    const unitDiscount = Math.max(0, normalPrice - promotionPrice);
    const qty = Number(line.qty || 0);
    const discountAmount = unitDiscount * qty;

    if (!discountAmount) return null;

    return {
      id: "promotion-price-discount-" + rule.id + "-" + line.id,
      name: rule.promotion_name || "Promotion",
      brand: line.brand || "",
      series: line.series || "",
      qty,
      selectedPrice: 0,
      price: 0,
      exVatPrice: 0,
      vatPrice: 0,
      sourceStatus: "Promotion",
      isPromotionFree: true,
      promotionFreeItem: true,
      promotionDiscountLine: true,
      promotionRuleId: rule.id,
      promotionName: rule.promotion_name,
      promotionDisplayLabel: rule.promotion_name || "Promotion",
      promotionDiscountAmount: discountAmount,
      promotionDiscountVatAmount: discountAmount * (getVatRate(line) / 100),
      discountedProductNames: line.name ? [line.name] : [],
      isPromotionPriceDiscount: true,
    };
  })
  .filter(Boolean);

const restorePromotionPriceLines = (paidLines = []) =>
  paidLines.map((line) => {
    if (!line?.isPromotionPrice) return line;

    return {
      ...line,
      selectedPrice: Number(
        line.normalSelectedPrice ?? line.vatPrice ?? line.selectedPrice ?? 0
      ),
      price: Number(line.normalPrice ?? line.price ?? 0),
      exVatPrice: Number(line.vatPrice ?? line.exVatPrice ?? 0),
      promotionRuleId: undefined,
      promotionName: undefined,
      promotionDisplayLabel: undefined,
      isPromotionPrice: false,
    };
  });

const lineMatchesSeries = (line, brand, series) =>
  (!brand || normalizeMatchValue(line?.brand) === normalizeMatchValue(brand)) &&
  (!series || normalizeMatchValue(line?.series) === normalizeMatchValue(series));

const restorePromotionFreeLines = (cartLines = []) => {
  const paidLines = [];

  cartLines.forEach((line) => {
    if (!isPromotionFreeLine(line)) {
      paidLines.push({
        ...line,
        isPromotionFree: false,
        promotionFreeItem: false,
        promotionDiscountLine: false,
      });
      return;
    }

    if (line?.promotionDiscountLine) return;

    const matchingPaidLine = paidLines.find(
      (paidLine) => String(paidLine.id) === String(line.id)
    );

    if (matchingPaidLine) {
      matchingPaidLine.qty = Number(matchingPaidLine.qty || 0) + Number(line.qty || 0);
      return;
    }

    paidLines.push({
      ...line,
      qty: Number(line.qty || 0),
      selectedPrice: Number(line.originalSelectedPrice || line.normalSelectedPrice || line.vatPrice || line.cashPrice || 0),
      price: Number(line.originalPrice || line.normalPrice || line.price || 0),
      sourceStatus: line.originalSourceStatus || "In Stock",
      isPromotionFree: false,
      promotionFreeItem: false,
      promotionDiscountLine: false,
      promotionRuleId: undefined,
      promotionName: undefined,
      promotionDisplayLabel: undefined,
      promotionDiscountAmount: undefined,
      promotionDiscountVatAmount: undefined,
    });
  });

  return paidLines.filter((line) => Number(line.qty || 0) > 0);
};

const getVatRate = (line) => {
  const cleaned = String(line?.vatRate || line?.vatType || "20")
    .replace("%", "")
    .trim();
  const rate = Number(cleaned);

  if (rate === 20) return 20;
  if (rate === 5) return 5;
  if (rate === 0) return 0;

  return 20;
};

const getRuleDisplayName = (rule) => {
  const savedName = String(rule?.promotion_name || "").trim();
  if (savedName) {
    return savedName.toLowerCase().startsWith("promotion")
      ? savedName
      : `Promotion ${savedName}`;
  }

  return rule?.buy_qty && rule?.free_qty
    ? `Promotion Buy ${rule.buy_qty} Get ${rule.free_qty} Free`
    : "Promotion Buy Get Free";
};

const buildPromotionDiscountLine = (rule, paidLines, freeQtyEarned) => {
  let remainingFreeQty = freeQtyEarned;
  let discountAmount = 0;
  let discountVatAmount = 0;
  let discountedQty = 0;
  const discountedNames = [];

  paidLines
    .filter((line) => lineMatchesSeries(line, null, rule.free_series))
    .forEach((line) => {
      if (remainingFreeQty <= 0) return;

      const lineQty = Number(line.qty || 0);
      const freeQty = Math.min(lineQty, remainingFreeQty);
      if (freeQty <= 0) return;

      const unitPrice = Number(line.exVatPrice || line.selectedPrice || line.vatPrice || 0);
      const vatRate = getVatRate(line);

      discountAmount += unitPrice * freeQty;
      discountVatAmount += unitPrice * (vatRate / 100) * freeQty;
      discountedQty += freeQty;
      remainingFreeQty -= freeQty;

      if (line.name && !discountedNames.includes(line.name)) {
        discountedNames.push(line.name);
      }
    });

  if (!discountedQty || !discountAmount) return null;

  return {
    id: "promotion-discount-" + rule.id,
    name: getRuleDisplayName(rule),
    brand: rule.trigger_brand || "",
    series: rule.free_series || "",
    qty: discountedQty,
    selectedPrice: 0,
    price: 0,
    exVatPrice: 0,
    vatPrice: 0,
    sourceStatus: "Promotion Free",
    isPromotionFree: true,
    promotionFreeItem: true,
    promotionDiscountLine: true,
    promotionRuleId: rule.id,
    promotionName: rule.promotion_name,
    promotionDisplayLabel: getRuleDisplayName(rule),
    promotionDiscountAmount: discountAmount,
    promotionDiscountVatAmount: discountVatAmount,
    discountedProductNames: discountedNames,
  };
};

export function applyPromotionRulesToCart(
  cartLines = [],
  activePromotionRules = [],
  productsOrOptions = [],
  maybePriceMode = "vat"
) {
  const options = Array.isArray(productsOrOptions)
    ? { products: productsOrOptions, priceMode: maybePriceMode }
    : productsOrOptions || {};

  const priceMode = String(options.priceMode || "vat").toLowerCase();
  let paidLines = restorePromotionFreeLines(cartLines);
  paidLines = restorePromotionPriceLines(paidLines);

  if (!isVatPriceMode(priceMode)) {
    return paidLines;
  }

  const promotionPriceDiscountLines = buildPromotionPriceDiscountLines(
    paidLines,
    activePromotionRules
  );

  const generatedDiscountLines = [...promotionPriceDiscountLines];

  activePromotionRules
    .filter((rule) => rule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE)
    .forEach((rule) => {
      const buyQty = Number(rule.buy_qty || 0);
      const freeQty = Number(rule.free_qty || 0);
      if (!buyQty || !freeQty || !rule.trigger_series || !rule.free_series) return;

      const buySeriesQty = paidLines
        .filter((line) =>
          lineMatchesSeries(line, rule.trigger_brand, rule.trigger_series)
        )
        .reduce((sum, line) => sum + Number(line.qty || 0), 0);

      const freeQtyEarned = Math.floor(buySeriesQty / buyQty) * freeQty;
      if (!freeQtyEarned) return;

      const discountLine = buildPromotionDiscountLine(
        rule,
        paidLines,
        freeQtyEarned
      );

      if (discountLine) {
        generatedDiscountLines.push(discountLine);
      }
    });

  return [...paidLines, ...generatedDiscountLines];
}
