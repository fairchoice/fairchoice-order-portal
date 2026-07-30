import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canManageSupplierSetup,
  filterSuppliers,
  loadSupplierSetup,
  saveSupplier,
  setSupplierActive,
  SUPPLIER_PAYMENT_METHODS,
  validateSupplier,
} from "../../services/suppliers";

const emptySupplierForm = {
  supplier_name: "",
  contact_name: "",
  company_legal_name: "",
  vat_number: "",
  vat_registered: true,
  address_line_1: "",
  address_line_2: "",
  city: "",
  postcode: "",
  country: "United Kingdom",
  phone: "",
  email: "",
  payment_terms: "",
  default_payment_method: "",
  bank_payment_reference: "",
  notes: "",
};

function supplierToForm(supplier) {
  return {
    ...emptySupplierForm,
    ...Object.fromEntries(
      Object.keys(emptySupplierForm).map((field) => [
        field,
        supplier?.[field] ?? "",
      ]),
    ),
    address_line_1:
      supplier?.address_line_1 || supplier?.address || "",
  };
}

function displayAddress(supplier) {
  const structured = [
    supplier.address_line_1,
    supplier.address_line_2,
    supplier.city,
    supplier.postcode,
    supplier.country,
  ]
    .filter(Boolean)
    .join(", ");
  return structured || supplier.address || "—";
}

export default function Suppliers({ user }) {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(undefined);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formErrors, setFormErrors] = useState({});

  const allowed = canManageSupplierSetup(user);

  const refreshSuppliers = useCallback(async (preferredId = null) => {
    setPageError("");
    try {
      const rows = await loadSupplierSetup(user, { includeInactive: true });
      setSuppliers(rows);
      if (preferredId && rows.some((supplier) => supplier.id === preferredId)) {
        setSelectedId(preferredId);
      } else {
        setSelectedId(rows[0]?.id || null);
      }
    } catch (error) {
      setPageError(error.message || "Suppliers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!allowed) return undefined;
    const refreshTimer = window.setTimeout(() => {
      void refreshSuppliers();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [allowed, refreshSuppliers]);

  const visibleSuppliers = useMemo(
    () => filterSuppliers(suppliers, search, status),
    [search, status, suppliers],
  );
  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedId) || null;

  function openCreate() {
    setEditingSupplier(null);
    setSupplierForm(emptySupplierForm);
    setFormErrors({});
  }

  function openEdit(supplier) {
    setEditingSupplier(supplier);
    setSupplierForm(supplierToForm(supplier));
    setFormErrors({});
  }

  function closeForm() {
    setEditingSupplier(undefined);
    setSupplierForm(emptySupplierForm);
    setFormErrors({});
  }

  function updateField(field, value) {
    setSupplierForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSave(event) {
    event.preventDefault();
    const validation = validateSupplier(supplierForm);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }
    if (!allowed) {
      setPageError("You do not have permission to manage Supplier Setup.");
      return;
    }

    setSaving(true);
    setPageError("");
    try {
      const saved = await saveSupplier(
        supplierForm,
        user,
        editingSupplier?.id || null,
      );
      closeForm();
      await refreshSuppliers(saved?.id || editingSupplier?.id);
    } catch (error) {
      setFormErrors(error.validationErrors || {});
      setPageError(error.message || "The supplier could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(supplier) {
    if (!allowed) {
      setPageError("You do not have permission to manage Supplier Setup.");
      return;
    }

    setSaving(true);
    setPageError("");
    try {
      await setSupplierActive(supplier.id, supplier.active === false, user);
      await refreshSuppliers(supplier.id);
    } catch (error) {
      setPageError(error.message || "Supplier status could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900">Supplier Setup</h2>
        <p className="mt-2 text-sm text-slate-600">
          You do not have permission to access Supplier Setup.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Supplier Setup</h2>
          <p className="mt-1 text-sm text-slate-600">
            Maintain supplier contact, address, payment, and active-status details.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Create supplier
        </button>
      </header>

      {pageError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {pageError}
        </div>
      )}

      <section className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_180px]">
        <label className="text-sm font-semibold text-slate-800">
          Search
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, company, VAT, postcode, phone, email…"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-slate-800">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
          >
            <option value="all">All suppliers</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </label>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
            {visibleSuppliers.length} supplier
            {visibleSuppliers.length === 1 ? "" : "s"}
          </div>
          {loading ? (
            <p className="p-4 text-sm text-slate-600">Loading suppliers…</p>
          ) : visibleSuppliers.length === 0 ? (
            <p className="p-4 text-sm text-slate-600">No suppliers found.</p>
          ) : (
            <ul className="divide-y divide-slate-200">
              {visibleSuppliers.map((supplier) => (
                <li key={supplier.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(supplier.id)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
                      supplier.id === selectedId ? "bg-blue-50" : ""
                    }`}
                  >
                    <span>
                      <span className="block font-semibold text-slate-900">
                        {supplier.supplier_name}
                      </span>
                      <span className="block text-sm text-slate-600">
                        {supplier.company_legal_name ||
                          supplier.email ||
                          supplier.phone ||
                          "No additional details"}
                      </span>
                    </span>
                    <StatusBadge active={supplier.active !== false} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <SupplierDetail
          supplier={selectedSupplier}
          saving={saving}
          onEdit={openEdit}
          onToggleActive={toggleActive}
        />
      </div>

      {editingSupplier !== undefined && (
        <SupplierForm
          form={supplierForm}
          errors={formErrors}
          editing={Boolean(editingSupplier)}
          saving={saving}
          onChange={updateField}
          onClose={closeForm}
          onSubmit={handleSave}
        />
      )}
    </div>
  );
}

function SupplierDetail({ supplier, saving, onEdit, onToggleActive }) {
  if (!supplier) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Select a supplier to view its details.
      </aside>
    );
  }

  const details = [
    ["Company / legal name", supplier.company_legal_name],
    ["Contact name", supplier.contact_name],
    ["VAT number", supplier.vat_number],
    ["VAT registered", supplier.vat_registered === false ? "No" : "Yes"],
    ["Address", displayAddress(supplier)],
    ["Phone", supplier.phone],
    ["Email", supplier.email],
    ["Payment terms", supplier.payment_terms],
    ["Default payment method", supplier.default_payment_method],
    ["Bank / payment reference", supplier.bank_payment_reference],
    ["Notes", supplier.notes],
  ];

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            {supplier.supplier_name}
          </h3>
          <StatusBadge active={supplier.active !== false} />
        </div>
        <button
          type="button"
          onClick={() => onEdit(supplier)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Edit
        </button>
      </div>

      <dl className="mt-4 space-y-3">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </dt>
            <dd className="whitespace-pre-wrap text-sm text-slate-800">
              {value || "—"}
            </dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        disabled={saving}
        onClick={() => onToggleActive(supplier)}
        className="mt-5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        {supplier.active === false ? "Activate supplier" : "Deactivate supplier"}
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Deactivation preserves historical references and removes the supplier from
        new-selection lists.
      </p>
    </aside>
  );
}

function SupplierForm({
  form,
  errors,
  editing,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close supplier form"
        className="absolute inset-0"
        onClick={onClose}
      />
      <form
        onSubmit={onSubmit}
        className="relative mx-auto max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl"
      >
        <header className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-slate-900">
              {editing ? "Edit supplier" : "Create supplier"}
            </h3>
            <p className="text-sm text-slate-600">Fields marked * are required.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            Close
          </button>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <InputField
            label="Supplier name *"
            value={form.supplier_name}
            error={errors.supplier_name}
            onChange={(value) => onChange("supplier_name", value)}
          />
          <InputField
            label="Company / legal name"
            value={form.company_legal_name}
            onChange={(value) => onChange("company_legal_name", value)}
          />
          <InputField
            label="Contact name"
            value={form.contact_name}
            onChange={(value) => onChange("contact_name", value)}
          />
          <InputField
            label="VAT number"
            value={form.vat_number}
            onChange={(value) => onChange("vat_number", value)}
          />
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <input
              type="checkbox"
              checked={form.vat_registered}
              onChange={(event) =>
                onChange("vat_registered", event.target.checked)
              }
            />
            VAT registered
          </label>
          <InputField
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={(value) => onChange("phone", value)}
          />
          <InputField
            label="Email"
            type="email"
            value={form.email}
            error={errors.email}
            onChange={(value) => onChange("email", value)}
          />
          <InputField
            label="Address line 1"
            value={form.address_line_1}
            onChange={(value) => onChange("address_line_1", value)}
          />
          <InputField
            label="Address line 2"
            value={form.address_line_2}
            onChange={(value) => onChange("address_line_2", value)}
          />
          <InputField
            label="City"
            value={form.city}
            onChange={(value) => onChange("city", value)}
          />
          <InputField
            label="Postcode"
            value={form.postcode}
            onChange={(value) => onChange("postcode", value)}
          />
          <InputField
            label="Country"
            value={form.country}
            onChange={(value) => onChange("country", value)}
          />
          <InputField
            label="Payment terms"
            value={form.payment_terms}
            onChange={(value) => onChange("payment_terms", value)}
          />
          <label className="text-sm font-semibold text-slate-800">
            Default payment method
            <select
              value={form.default_payment_method}
              onChange={(event) =>
                onChange("default_payment_method", event.target.value)
              }
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            >
              <option value="">No default</option>
              {SUPPLIER_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <FieldError message={errors.default_payment_method} />
          </label>
          <InputField
            label="Bank / payment reference"
            value={form.bank_payment_reference}
            onChange={(value) => onChange("bank_payment_reference", value)}
          />
          <label className="text-sm font-semibold text-slate-800 md:col-span-2">
            Notes
            <textarea
              value={form.notes}
              maxLength={4000}
              onChange={(event) => onChange("notes", event.target.value)}
              className="mt-1 min-h-28 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal"
            />
            <span className="mt-1 flex justify-between text-xs font-normal text-slate-500">
              <FieldError message={errors.notes} />
              <span>{form.notes.length}/4000</span>
            </span>
          </label>
        </div>

        <footer className="mt-5 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save supplier"}
          </button>
        </footer>
      </form>
    </div>
  );
}

function InputField({ label, value, onChange, error, type = "text" }) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={`mt-1 w-full rounded-lg border px-3 py-2 font-normal ${
          error ? "border-red-500" : "border-slate-300"
        }`}
      />
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }) {
  return message ? (
    <span className="mt-1 block text-xs font-normal text-red-700">{message}</span>
  ) : null;
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
        active
          ? "bg-emerald-50 text-emerald-800"
          : "bg-slate-200 text-slate-700"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}
