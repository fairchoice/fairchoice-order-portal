import { supabase } from "./supabase.js";

const uniqueSorted = (values = []) =>
  [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }));

export function normalizeHomepageItem(row = {}) {
  return {
    id: row.id,
    title: row.description || "",
    description: row.description || "",
    subDescription: row.sub_description || "",
    image: row.image_url || "",
    categoryType: row.category_type || "main_category",
    targetValue: row.target_value || "",
    sortOrder: Number(row.sort_order || 0),
    active: row.active !== false,
  };
}

export async function getHomepageItems() {
  const { data, error } = await supabase
    .from("homepage_items")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map(normalizeHomepageItem);
}

export async function getAllHomepageItems() {
  const { data, error } = await supabase
    .from("homepage_items")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data || []).map(normalizeHomepageItem);
}

export async function saveHomepageItem(item = {}) {
  const payload = {
    description: item.title ?? item.description ?? "",
    sub_description: item.subDescription || "",
    image_url: item.image || "",
    category_type: item.categoryType || "main_category",
    target_value: item.targetValue || "",
    sort_order: Number(item.sortOrder || 0),
    active: item.active !== false,
  };

  const query = item.id
    ? supabase
        .from("homepage_items")
        .update(payload)
        .eq("id", item.id)
        .select()
        .single()
    : supabase.from("homepage_items").insert(payload);

  const { data, error } = item.id
    ? await query
    : await query.select().single();
  if (error) throw error;
  return normalizeHomepageItem(data || payload);
}

export async function deleteHomepageItem(id) {
  const { error } = await supabase.from("homepage_items").delete().eq("id", id);
  if (error) throw error;
}

export async function getHomepageTargetOptions() {
  const [optionResult, productResult] = await Promise.all([
    supabase
      .from("product_options")
      .select("option_type, option_name")
      .in("option_type", ["main_category", "sub_category", "brand", "series"])
      .eq("active", true),
    supabase
      .from("products")
      .select(
        "id, product_code, product_name, main_category, sub_category, brand, series, status"
      ),
  ]);

  if (optionResult.error && productResult.error) {
    throw optionResult.error;
  }

  const optionRows = optionResult.data || [];
  const productRows = productResult.data || [];
  const activeProductRows = productRows.filter(
    (row) => String(row.status || "Active").trim().toLowerCase() !== "inactive"
  );
  const valuesFor = (optionType, productField) =>
    uniqueSorted([
      ...optionRows
        .filter((row) => row.option_type === optionType)
        .map((row) => row.option_name),
      ...activeProductRows.map((row) => row[productField]),
    ]);

  return {
    mainCategories: valuesFor("main_category", "main_category"),
    subCategories: valuesFor("sub_category", "sub_category"),
    brands: valuesFor("brand", "brand"),
    series: valuesFor("series", "series"),
    products: activeProductRows
      .filter((row) => row.id)
      .map((row) => ({
        id: String(row.id),
        name: String(row.product_name || "").trim() || "Unnamed product",
        code: String(row.product_code || "").trim(),
      }))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name, undefined, {
            numeric: true,
            sensitivity: "base",
          }) || left.code.localeCompare(right.code)
      ),
  };
}
