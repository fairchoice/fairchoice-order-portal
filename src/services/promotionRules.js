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

const lineMatchesSeries = (line, brand, series) =>
  (!brand || line?.brand === brand) && (!series || line?.series === series);

const restorePromotionFreeLines = (cartLines = []) => {
  const paidLines = [];

  cartLines.forEach((line) => {
    if (!isPromotionFreeLine(line)) {
      paidLines.push({
        ...line,
        isPromotionFree: false,
        promotionFreeItem: false,
      });
      return;
    }

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
      promotionRuleId: undefined,
      promotionName: undefined,
    });
  });

  return paidLines.filter((line) => Number(line.qty || 0) > 0);
};

const splitFreeQuantityFromPaidLines = (paidLines, rule, freeQtyEarned) => {
  let remainingFreeQty = freeQtyEarned;
  const nextPaidLines = [];
  const freeLines = [];

  paidLines.forEach((line) => {
    const lineQty = Number(line.qty || 0);
    const canConvert =
      remainingFreeQty > 0 &&
      lineQty > 0 &&
      lineMatchesSeries(line, null, rule.free_series);

    if (!canConvert) {
      nextPaidLines.push(line);
      return;
    }

    const freeQty = Math.min(lineQty, remainingFreeQty);
    const paidQty = lineQty - freeQty;
    remainingFreeQty -= freeQty;

    if (paidQty > 0) {
      nextPaidLines.push({
        ...line,
        qty: paidQty,
      });
    }

    freeLines.push({
      ...line,
      qty: freeQty,
      selectedPrice: 0,
      price: 0,
      originalSelectedPrice: Number(line.selectedPrice || 0),
      originalPrice: Number(line.price || line.selectedPrice || 0),
      originalSourceStatus: line.sourceStatus || "In Stock",
      sourceStatus: "Promotion Free",
      promotionDisplayLabel: "FREE PROMOTION ITEM",
      isPromotionFree: true,
      promotionFreeItem: true,
      promotionRuleId: rule.id,
      promotionName: rule.promotion_name,
    });
  });

  return {
    paidLines: nextPaidLines,
    freeLines,
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

  if (priceMode !== "vat") {
    return paidLines;
  }

  const generatedFreeLines = [];

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

      const splitCart = splitFreeQuantityFromPaidLines(
        paidLines,
        rule,
        freeQtyEarned
      );

      paidLines = splitCart.paidLines;
      generatedFreeLines.push(...splitCart.freeLines);
    });

  return [...paidLines, ...generatedFreeLines];
}
