import { supabase } from "./supabase";

export function normalizeHomepageItem(row = {}) {
  return {
    id: row.id,
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
    description: item.description || "",
    sub_description: item.subDescription || "",
    image_url: item.image || "",
    category_type: item.categoryType || "main_category",
    target_value: item.targetValue || "",
    sort_order: Number(item.sortOrder || 0),
    active: item.active !== false,
  };

  const query = item.id
    ? supabase.from("homepage_items").update(payload).eq("id", item.id)
    : supabase.from("homepage_items").insert(payload);

  const { error } = await query;
  if (error) throw error;
}

export async function deleteHomepageItem(id) {
  const { error } = await supabase.from("homepage_items").delete().eq("id", id);
  if (error) throw error;
}