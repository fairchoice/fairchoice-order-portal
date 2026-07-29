import { supabase } from "./supabase.js";

export const HOMEPAGE_MESSAGE_TARGET_TYPES = [
  "main_category",
  "sub_category",
  "brand",
  "product",
];

export const HOMEPAGE_MESSAGE_STYLES = [
  "info",
  "warning",
  "success",
  "danger",
];

const dateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().slice(0, 10);
};

const normalizedText = (value) => String(value || "").trim().toLowerCase();

export function normalizeHomepageMessage(row = {}) {
  return {
    id: row.id,
    targetType: row.target_type || row.targetType || "main_category",
    targetValue: row.target_value || row.targetValue || "",
    message: row.message || "",
    messageStyle: row.message_style || row.messageStyle || "warning",
    active: row.active !== false,
    startDate: row.start_date || row.startDate || "",
    endDate: row.end_date || row.endDate || "",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
  };
}

export function isHomepageMessageActive(message = {}, now = new Date()) {
  const row = normalizeHomepageMessage(message);
  const today = dateKey(now);
  if (!row.active || !today) return false;
  if (row.startDate && today < row.startDate) return false;
  if (row.endDate && today > row.endDate) return false;
  return true;
}

export function getMatchingHomepageMessages(
  messages = [],
  {
    selectedCategory = "",
    selectedSubCategory = "",
    selectedBrand = "",
    selectedProductId = "",
    now = new Date(),
  } = {}
) {
  const selectedByType = {
    main_category: normalizedText(selectedCategory),
    sub_category: normalizedText(selectedSubCategory),
    brand: normalizedText(selectedBrand),
    product: normalizedText(selectedProductId),
  };

  return messages
    .map(normalizeHomepageMessage)
    .filter((message) => isHomepageMessageActive(message, now))
    .filter(
      (message) =>
        normalizedText(message.targetValue) &&
        normalizedText(message.targetValue) ===
          selectedByType[message.targetType]
    )
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        String(left.id || "").localeCompare(String(right.id || ""))
    );
}

export async function getAllHomepageMessages() {
  const { data, error } = await supabase
    .from("homepage_messages")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(normalizeHomepageMessage);
}

export async function getActiveHomepageMessages(now = new Date()) {
  const { data, error } = await supabase
    .from("homepage_messages")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || [])
    .map(normalizeHomepageMessage)
    .filter((message) => isHomepageMessageActive(message, now));
}

export async function saveHomepageMessage(message = {}) {
  const row = normalizeHomepageMessage(message);
  const payload = {
    target_type: row.targetType,
    target_value: row.targetValue.trim(),
    message: row.message.trim(),
    message_style: row.messageStyle,
    active: row.active,
    start_date: row.startDate || null,
    end_date: row.endDate || null,
    sort_order: row.sortOrder,
  };
  const query = row.id
    ? supabase
        .from("homepage_messages")
        .update(payload)
        .eq("id", row.id)
    : supabase.from("homepage_messages").insert(payload);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return normalizeHomepageMessage(data);
}

export async function deleteHomepageMessage(id) {
  const { error } = await supabase
    .from("homepage_messages")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
