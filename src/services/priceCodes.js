import { supabase } from "./supabase";

const normalizeBasePriceMode = (basePriceMode) => {
  const mode = String(basePriceMode || "").trim().toLowerCase();
  if (["server", "inc.vat", "inc vat", "incvat"].includes(mode)) return "inc vat";
  return "ex vat";
};

export const makePriceCodeMode = (priceCodeId, basePriceMode = "inc vat", overlayPriceCodeId = "") => {
  if (!priceCodeId) return "";
  const base = `code:${String(priceCodeId)}|${normalizeBasePriceMode(basePriceMode)}`;
  return overlayPriceCodeId ? `${base}|overlay:${String(overlayPriceCodeId)}` : base;
};

export const getPriceCodeModeParts = (priceMode) => {
  const value = String(priceMode || "").trim();
  if (!value.toLowerCase().startsWith("code:")) {
    return { priceCodeId: "", basePriceMode: "ex vat", overlayPriceCodeId: "" };
  }
  const parts = value.slice(5).split("|");
  const priceCodeId = parts[0] || "";
  const basePriceMode = normalizeBasePriceMode(parts[1] || "inc vat");
  const overlayPart = parts.find((part) => String(part).toLowerCase().startsWith("overlay:"));
  return {
    priceCodeId,
    basePriceMode,
    overlayPriceCodeId: overlayPart ? overlayPart.slice("overlay:".length) : "",
  };
};

export const getPriceCodeIdFromMode = (priceMode) => getPriceCodeModeParts(priceMode).priceCodeId;

export async function getCustomerPriceCodes({ includeInactive = false } = {}) {
  let query = supabase
    .from("customer_price_codes")
    .select("*")
    .order("code", { ascending: true });

  if (!includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createCustomerPriceCode({ code, discountPercent, codeType = "base", parentPriceCodeId = null, exactOnly = false }) {
  const cleanCode = String(code || "").trim();
  if (!cleanCode) throw new Error("Price code is required.");

  const { data, error } = await supabase
    .from("customer_price_codes")
    .insert({
      code: cleanCode,
      discount_percent: codeType === "sub" ? 0 : Number(discountPercent || 0),
      code_type: codeType === "sub" ? "sub" : "base",
      parent_price_code_id: codeType === "sub" ? parentPriceCodeId || null : null,
      exact_only: codeType === "sub" ? true : exactOnly === true,
      active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCustomerPriceCode(id, changes = {}) {
  const payload = {};
  if (Object.prototype.hasOwnProperty.call(changes, "code")) {
    const cleanCode = String(changes.code || "").trim();
    if (!cleanCode) throw new Error("Price code is required.");
    payload.code = cleanCode;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "discountPercent")) {
    payload.discount_percent = Number(changes.discountPercent || 0);
  }
  if (Object.prototype.hasOwnProperty.call(changes, "active")) {
    payload.active = changes.active === true;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "codeType")) {
    payload.code_type = changes.codeType === "sub" ? "sub" : "base";
  }
  if (Object.prototype.hasOwnProperty.call(changes, "parentPriceCodeId")) {
    payload.parent_price_code_id = changes.parentPriceCodeId || null;
  }
  if (Object.prototype.hasOwnProperty.call(changes, "exactOnly")) {
    payload.exact_only = changes.exactOnly === true;
  }
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("customer_price_codes")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getProductPriceCodeRows(productIds = []) {
  const ids = [...new Set((productIds || []).filter(Boolean))];
  if (!ids.length) return [];

  const rows = [];
  const chunkSize = 50;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from("product_price_code_prices")
      .select("id, product_id, price_code_id, price, active")
      .in("product_id", chunk)
      .eq("active", true);

    if (error) throw error;
    rows.push(...(data || []));
  }

  return rows;
}

export function buildProductPriceCodeMap(rows = []) {
  return (rows || []).reduce((result, row) => {
    const productId = String(row.product_id || "");
    const priceCodeId = String(row.price_code_id || "");
    if (!productId || !priceCodeId) return result;
    if (!result[productId]) result[productId] = {};
    result[productId][priceCodeId] = Number(row.price || 0);
    return result;
  }, {});
}


export async function upsertProductPriceCodePrice(productId, priceCodeId, price) {
  const cleanProductId = String(productId || "").trim();
  const cleanPriceCodeId = String(priceCodeId || "").trim();
  const cleanPrice = Number(price || 0);
  if (!cleanProductId) throw new Error("Product is required.");
  if (!cleanPriceCodeId) throw new Error("Customer price code is required.");
  if (!Number.isFinite(cleanPrice) || cleanPrice <= 0) throw new Error("Enter a valid exact code price.");
  const { data, error } = await supabase
    .from("product_price_code_prices")
    .upsert({ product_id: cleanProductId, price_code_id: cleanPriceCodeId, price: cleanPrice, active: true, updated_at: new Date().toISOString() }, { onConflict: "product_id,price_code_id" })
    .select("id, product_id, price_code_id, price, active")
    .single();
  if (error) throw error;
  return data;
}

export async function deleteProductPriceCodePrice(productId, priceCodeId) {
  const cleanProductId = String(productId || "").trim();
  const cleanPriceCodeId = String(priceCodeId || "").trim();
  if (!cleanProductId || !cleanPriceCodeId) return;
  const { error } = await supabase
    .from("product_price_code_prices")
    .delete()
    .eq("product_id", cleanProductId)
    .eq("price_code_id", cleanPriceCodeId);
  if (error) throw error;
}

export async function syncProductPriceCodePrices(productId, entries = []) {
  if (!productId) return [];

  const cleanedEntries = (entries || [])
    .map((entry) => ({
      price_code_id: String(entry.priceCodeId || entry.price_code_id || "").trim(),
      price: Number(entry.price || 0),
    }))
    .filter((entry) => entry.price_code_id && Number.isFinite(entry.price) && entry.price > 0);

  const { error: deleteError } = await supabase
    .from("product_price_code_prices")
    .delete()
    .eq("product_id", productId);

  if (deleteError) throw deleteError;
  if (!cleanedEntries.length) return [];

  const { data, error } = await supabase
    .from("product_price_code_prices")
    .insert(
      cleanedEntries.map((entry) => ({
        product_id: productId,
        price_code_id: entry.price_code_id,
        price: entry.price,
        active: true,
      }))
    )
    .select();

  if (error) throw error;
  return data || [];
}
