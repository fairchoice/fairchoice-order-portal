import { useEffect, useRef, useState } from "react";
import { supabase } from "../../services/supabase";
import { getAllHomepageItems, saveHomepageItem } from "../../services/homepageItems";
import { PRODUCT_PLACEHOLDER_IMAGE } from "../../utils/productImages";
import { hasPermission } from "../../utils/permissions";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const getImageFilename = (item) => {
  try {
    const pathname = new URL(item.image).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "homepage-image");
  } catch {
    return item.image ? "homepage-image" : "No image assigned";
  }
};

function CategoryImageUploadRow({ item, onSaved }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);
  const inputId = `home-image-${item.id}`;

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const clearSelection = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setMessage("");
  };

  const selectFile = (selectedFile) => {
    setMessage("");
    if (!selectedFile) {
      clearSelection();
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.has(selectedFile.type)) {
      clearSelection();
      setMessage("Choose a JPG, PNG or WEBP image.");
      return;
    }
    if (selectedFile.size > MAX_IMAGE_BYTES) {
      clearSelection();
      setMessage("Image must be 5 MB or smaller.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
  };

  const saveReplacement = async () => {
    if (!file) {
      setMessage("Choose an image before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const safeId = String(item.id || "homepage").replace(/[^a-z0-9-]/gi, "");
      const storageName = `homepage-${safeId}-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("product-images")
        .upload(storageName, file, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("product-images").getPublicUrl(storageName);
      if (!data?.publicUrl) throw new Error("The uploaded image URL was not returned.");

      await saveHomepageItem({ ...item, image: data.publicUrl });
      clearSelection();
      setMessage("Home image saved successfully.");
      await onSaved();
    } catch (error) {
      console.error("Homepage image save failed:", error);
      setMessage(`Image was not changed. ${error.message || "Please try again."}`);
    } finally {
      setBusy(false);
    }
  };

  const removeImage = async () => {
    if (!item.image || !window.confirm(`Remove the home image for ${item.description}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      await saveHomepageItem({ ...item, image: "" });
      clearSelection();
      setMessage("Image removed. The safe placeholder will be used.");
      await onSaved();
    } catch (error) {
      console.error("Homepage image removal failed:", error);
      setMessage(`Image was not removed. ${error.message || "Please try again."}`);
    } finally {
      setBusy(false);
    }
  };

  const downloadImage = async () => {
    if (!item.image) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(item.image);
      if (!response.ok) throw new Error("The current image could not be downloaded.");
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = getImageFilename(item);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Homepage image download failed:", error);
      setMessage(error.message || "The current image could not be downloaded.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="aspect-[4/3] overflow-hidden rounded-2xl border bg-slate-50 p-2">
          <img src={previewUrl || item.image || PRODUCT_PLACEHOLDER_IMAGE} alt={`${item.description} home preview`} className="h-full w-full object-contain" onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} />
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-extrabold text-slate-900">{item.description}</h3>
          <p className="mt-1 break-all text-xs text-slate-500">Current source: {getImageFilename(item)}</p>
          {file && <p className="mt-2 text-sm font-bold text-orange-700">Previewing: {file.name}</p>}

          <label htmlFor={inputId} className="mt-3 block text-sm font-bold text-slate-700">Upload replacement image</label>
          <input ref={fileInputRef} id={inputId} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => selectFile(event.target.files?.[0] || null)} className="mt-1 block w-full text-sm" />

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={saveReplacement} disabled={busy || !file} className="min-h-11 rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy ? "Working…" : "Save Changes"}</button>
            {file && <button type="button" onClick={clearSelection} disabled={busy} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-bold">Cancel Preview</button>}
            <button type="button" onClick={downloadImage} disabled={busy || !item.image} className="min-h-11 rounded-xl border border-blue-300 px-4 py-2 text-sm font-bold text-blue-800 disabled:opacity-40">Download Current Image</button>
            <button type="button" onClick={removeImage} disabled={busy || !item.image} className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40">Remove Image</button>
          </div>
          {message && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700" role="status" aria-live="polite">{message}</p>}
        </div>
      </div>
    </article>
  );
}

export default function HomePageImages({ currentUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const allowed = hasPermission(currentUser, "access_product_setup");

  const loadItems = async () => {
    setError("");
    try {
      setItems(await getAllHomepageItems());
    } catch (loadError) {
      console.error("Homepage images loading failed:", loadError);
      setError("Home page images could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return undefined;
    let current = true;
    const loadInitialItems = async () => {
      try {
        const rows = await getAllHomepageItems();
        if (current) setItems(rows);
      } catch (loadError) {
        console.error("Homepage images loading failed:", loadError);
        if (current) setError("Home page images could not be loaded.");
      } finally {
        if (current) setLoading(false);
      }
    };
    loadInitialItems();
    return () => { current = false; };
  }, [allowed]);

  if (!allowed) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800">You do not have permission to manage home page images.</div>;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-extrabold text-slate-900">Home Page Images</h2>
        <p className="mt-1 text-sm text-slate-600">Preview and replace the existing category images. Accepted: JPG, PNG and WEBP up to 5 MB.</p>
      </div>
      {loading && <div role="status" className="rounded-2xl border bg-white p-5">Loading home page images…</div>}
      {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 font-bold text-red-800">{error}</div>}
      {!loading && !error && items.map((item) => <CategoryImageUploadRow key={item.id} item={item} onSaved={loadItems} />)}
      {!loading && !error && items.length === 0 && <div className="rounded-2xl border bg-white p-5 text-slate-600">No home categories are configured.</div>}
    </section>
  );
}
