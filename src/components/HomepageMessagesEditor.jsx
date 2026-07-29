import { useMemo, useState } from "react";

import {
  deleteHomepageMessage,
  saveHomepageMessage,
} from "../services/homepageMessages";

const blankMessage = () => ({
  id: null,
  isDraft: true,
  targetType: "main_category",
  targetValue: "",
  message: "",
  messageStyle: "warning",
  active: true,
  startDate: "",
  endDate: "",
  sortOrder: 0,
});

const targetChoices = (options, targetType) => {
  if (targetType === "main_category") return options.mainCategories || [];
  if (targetType === "sub_category") return options.subCategories || [];
  if (targetType === "brand") return options.brands || [];
  return [];
};

const newClientId = () =>
  globalThis.crypto?.randomUUID?.() ||
  `homepage-message-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function HomepageMessageRow({ initialMessage, options, onSaved, onDeleted }) {
  const [form, setForm] = useState(() => ({ ...initialMessage }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const setField = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));
  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return options.products || [];
    return (options.products || []).filter((product) =>
      `${product.name} ${product.code}`.toLowerCase().includes(query)
    );
  }, [options.products, productSearch]);

  const save = async () => {
    if (!String(form.targetValue || "").trim()) {
      setError("Choose a target.");
      return;
    }
    if (!String(form.message || "").trim()) {
      setError("Enter a message.");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setError("End date must be on or after the start date.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await saveHomepageMessage({
        ...form,
        id: form.isDraft ? null : form.id,
      });
      setForm(saved);
      await onSaved(saved, form.isDraft);
    } catch (saveError) {
      setError(saveError.message || "Message could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        form.isDraft
          ? "Discard this unsaved notice?"
          : "Delete this customer product notice?"
      )
    ) {
      return;
    }
    if (form.isDraft) {
      onDeleted(form);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await deleteHomepageMessage(form.id);
      await onDeleted(form);
    } catch (deleteError) {
      setError(deleteError.message || "Message could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm font-bold text-slate-700">
          Target type
          <select
            value={form.targetType}
            onChange={(event) => {
              setField("targetType", event.target.value);
              setField("targetValue", "");
              setProductSearch("");
            }}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          >
            <option value="main_category">Main category</option>
            <option value="sub_category">Sub category</option>
            <option value="brand">Brand</option>
            <option value="product">Product</option>
          </select>
        </label>
        {form.targetType === "product" ? (
          <div className="text-sm font-bold text-slate-700">
            Product
            <input
              type="search"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
              placeholder="Search by product name or code"
              aria-label="Search products"
              className="mt-1 w-full rounded-t-xl border p-3 font-normal"
            />
            <select
              value={form.targetValue}
              onChange={(event) => setField("targetValue", event.target.value)}
              aria-label="Choose product"
              className="w-full rounded-b-xl border border-t-0 bg-white p-3 font-normal"
            >
              <option value="">Choose a product…</option>
              {filteredProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name} {product.code ? `— ${product.code}` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <label className="text-sm font-bold text-slate-700">
            Target
            <select
              value={form.targetValue}
              onChange={(event) => setField("targetValue", event.target.value)}
              className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
            >
              <option value="">Choose…</option>
              {targetChoices(options, form.targetType).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm font-bold text-slate-700">
          Style
          <select
            value={form.messageStyle}
            onChange={(event) => setField("messageStyle", event.target.value)}
            className="mt-1 w-full rounded-xl border bg-white p-3 font-normal"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="success">Success</option>
            <option value="danger">Danger</option>
          </select>
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
        <label className="text-sm font-bold text-slate-700 md:col-span-2 xl:col-span-4">
          Message
          <textarea
            value={form.message}
            onChange={(event) => setField("message", event.target.value)}
            rows={3}
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          Start date (optional)
          <input
            type="date"
            value={form.startDate}
            onChange={(event) => setField("startDate", event.target.value)}
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold text-slate-700">
          End date (optional)
          <input
            type="date"
            value={form.endDate}
            onChange={(event) => setField("endDate", event.target.value)}
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
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
            onClick={save}
            disabled={busy}
            className="min-h-11 rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy
              ? "Saving…"
              : form.isDraft
                ? "Publish Notice"
                : "Update Notice"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="min-h-11 rounded-xl border border-red-300 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-40"
          >
            Delete
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

export default function HomepageMessagesEditor({
  messages,
  options,
  onReload,
}) {
  const [drafts, setDrafts] = useState([]);
  const [successMessage, setSuccessMessage] = useState("");
  const addMessage = () => {
    setSuccessMessage("");
    setDrafts((current) => [
      ...current,
      { ...blankMessage(), clientId: newClientId() },
    ]);
  };
  const removeDraft = (message) => {
    setDrafts((current) =>
      current.filter((draft) => draft.clientId !== message.clientId)
    );
  };

  return (
    <section className="space-y-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">
            Customer Product Notices
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Publish an important notice for a category, subcategory, brand, or
            product.
          </p>
        </div>
        <button
          type="button"
          onClick={addMessage}
          className="min-h-11 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white"
        >
          + Publish New Notice
        </button>
      </div>

      {successMessage && (
        <p
          className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-bold text-green-800"
          role="status"
          aria-live="polite"
        >
          {successMessage}
        </p>
      )}

      {[...drafts, ...messages].map((message) => (
        <HomepageMessageRow
          key={message.id || message.clientId}
          initialMessage={message}
          options={options}
          onSaved={async (saved) => {
            if (message.clientId) removeDraft(message);
            await onReload(saved);
            setSuccessMessage("Notice published successfully.");
          }}
          onDeleted={async (deleted) => {
            if (deleted.clientId || deleted.isDraft) removeDraft(deleted);
            else await onReload();
          }}
        />
      ))}

      {messages.length === 0 && drafts.length === 0 && (
        <div className="rounded-2xl border border-dashed bg-white p-5 text-slate-600">
          No customer product notices are configured.
        </div>
      )}
    </section>
  );
}
