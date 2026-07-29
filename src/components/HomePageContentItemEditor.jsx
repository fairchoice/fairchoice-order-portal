import { useEffect, useId, useRef, useState } from "react";

import { saveHomepageItem } from "../services/homepageItems";
import { supabase } from "../services/supabase";
import { PRODUCT_PLACEHOLDER_IMAGE } from "../utils/productImages";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const getImageFilename = (imageUrl) => {
  try {
    const pathname = new URL(imageUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "homepage-image");
  } catch {
    return imageUrl ? "homepage-image" : "No image assigned";
  }
};

const optionsForType = (targetOptions, targetType) => {
  if (targetType === "main_category") return targetOptions.mainCategories || [];
  if (targetType === "sub_category") return targetOptions.subCategories || [];
  if (targetType === "brand") return targetOptions.brands || [];
  return [];
};

export default function HomePageContentItemEditor({
  item,
  targetOptions,
  onSaved,
  onDelete,
}) {
  const inputPrefix = useId();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState(() => ({
    ...item,
    title: item.title || item.description || "",
    subDescription: item.subDescription || "",
    categoryType: item.categoryType || "main_category",
    targetValue: item.targetValue || "",
    sortOrder: Number(item.sortOrder || 0),
    active: item.active !== false,
  }));
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const clearSelectedFile = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const chooseFile = (selectedFile) => {
    setMessage("");
    if (!selectedFile) {
      clearSelectedFile();
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(selectedFile.type)) {
      clearSelectedFile();
      setMessage("Choose a JPG, PNG or WEBP image.");
      return;
    }
    if (selectedFile.size > MAX_IMAGE_BYTES) {
      clearSelectedFile();
      setMessage("Image must be 5 MB or smaller.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const uploadImage = async (pendingItem) => {
    if (!file) return pendingItem;
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const uploadId =
      pendingItem.id ||
      globalThis.crypto?.randomUUID?.() ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const safeId = String(uploadId).replace(/[^a-z0-9-]/gi, "");
    const storageName = `homepage-${safeId}-${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(storageName, file, { cacheControl: "3600", upsert: false });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(storageName);
    if (!data?.publicUrl) {
      throw new Error("The uploaded image URL was not returned.");
    }
    return { ...pendingItem, image: data.publicUrl };
  };

  const saveChanges = async () => {
    const title = String(form.title || "").trim();
    const targetValue = String(form.targetValue || "").trim();
    if (!title) {
      setMessage("Enter a title.");
      return;
    }
    if (!targetValue) {
      setMessage(
        form.categoryType === "custom_link"
          ? "Enter a link."
          : "Choose a target."
      );
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const pendingItem = {
        ...form,
        id: item.isDraft ? null : form.id,
        title,
        targetValue,
      };
      const itemWithImage = await uploadImage(pendingItem);
      const completedItem = await saveHomepageItem(itemWithImage);
      clearSelectedFile();
      setForm(completedItem);
      setMessage("Home item saved.");
      await onSaved(completedItem);
    } catch (error) {
      console.error("Homepage item save failed:", error);
      setMessage(`Item was not saved. ${error.message || "Please try again."}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadImage = async () => {
    if (!form.image) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(form.image);
      if (!response.ok) throw new Error("The current image could not be downloaded.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = getImageFilename(form.image);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      setMessage(error.message || "The current image could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  const targetChoices = optionsForType(targetOptions, form.categoryType);
  const isCustomLink = form.categoryType === "custom_link";
  const isLegacyPromotion = form.categoryType === "promotion";

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="aspect-[4/3] overflow-hidden rounded-2xl border bg-slate-50 p-2">
            <img
              src={previewUrl || form.image || PRODUCT_PLACEHOLDER_IMAGE}
              alt={`${form.title || "Homepage item"} preview`}
              className="h-full w-full object-contain"
              onError={(event) => {
                event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE;
              }}
            />
          </div>
          <p className="mt-2 break-all text-xs text-slate-500">
            Current source: {getImageFilename(form.image)}
          </p>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <label className="text-sm font-bold text-slate-700">
            Title
            <input
              value={form.title}
              onChange={(event) => setField("title", event.target.value)}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>
          <label className="text-sm font-bold text-slate-700">
            Target type
            <select
              value={form.categoryType}
              onChange={(event) => {
                setField("categoryType", event.target.value);
                setField("targetValue", "");
              }}
              className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
            >
              <option value="main_category">Main category</option>
              <option value="sub_category">Sub category</option>
              <option value="brand">Brand</option>
              <option value="custom_link">Custom link</option>
              {isLegacyPromotion && (
                <option value="promotion">Legacy promotion</option>
              )}
            </select>
          </label>

          <label className="text-sm font-bold text-slate-700 md:col-span-2">
            Description
            <textarea
              value={form.subDescription}
              onChange={(event) => setField("subDescription", event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label className="text-sm font-bold text-slate-700">
            {isCustomLink ? "Link" : "Target value"}
            {isCustomLink || isLegacyPromotion ? (
              <input
                value={form.targetValue}
                onChange={(event) => setField("targetValue", event.target.value)}
                placeholder={isCustomLink ? "https://… or #page" : "Promotion target"}
                className="mt-1 w-full rounded-xl border p-3 font-normal"
              />
            ) : (
              <select
                value={form.targetValue}
                onChange={(event) => setField("targetValue", event.target.value)}
                className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
              >
                <option value="">Choose…</option>
                {targetChoices.map((choice) => (
                  <option key={choice} value={choice}>
                    {choice}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className="text-sm font-bold text-slate-700">
            Sort order
            <input
              type="number"
              value={form.sortOrder}
              onChange={(event) => setField("sortOrder", Number(event.target.value))}
              className="mt-1 w-full rounded-xl border p-3 font-normal"
            />
          </label>

          <label
            htmlFor={`${inputPrefix}-image`}
            className="text-sm font-bold text-slate-700 md:col-span-2"
          >
            Upload or replace image
            <input
              ref={fileInputRef}
              id={`${inputPrefix}-image`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => chooseFile(event.target.files?.[0] || null)}
              className="mt-1 block w-full font-normal"
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              JPG, PNG or WEBP. Maximum 5 MB.
            </span>
          </label>

          <label className="flex min-h-11 items-center gap-3 rounded-xl border bg-slate-50 px-3 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setField("active", event.target.checked)}
              className="h-5 w-5"
            />
            Active
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={saveChanges}
              disabled={busy}
              className="min-h-11 rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={downloadImage}
              disabled={busy || !form.image}
              className="min-h-11 rounded-xl border border-blue-300 px-4 py-2 text-sm font-bold text-blue-800 disabled:opacity-40"
            >
              Download Current Image
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              disabled={busy}
              className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40"
            >
              Delete Item
            </button>
          </div>

          {message && (
            <p
              className="rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700 md:col-span-2"
              role="status"
              aria-live="polite"
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
