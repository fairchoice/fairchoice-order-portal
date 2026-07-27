import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";

const emptySupplierForm = {
  supplier_name: "",
  contact_name: "",
  reference: "",
  email: "",
  mobile: "",
  telephone: "",
  address1: "",
  address2: "",
  town_city: "",
  county: "",
  postcode: "",
  country: "United Kingdom (GB)",
  account_default: "5000 - Cost of Sales - Goods",
  vat_registered: true,
  vat_number: "GB",
  import_agent: false,
  reverse_charge: false,
  set_credit_limit: false,
  credit_limit: "",
  set_credit_terms: false,
  credit_days: "30",
  credit_term_type: "days_after_invoice",
  account_on_hold: false,
  bank_account_name: "",
  sort_code: "",
  account_number: "",
  bic_swift: "",
  iban: "",
  notes: "",
};

function buildAddress(form) {
  return [
    form.address1,
    form.address2,
    form.town_city,
    form.county,
    form.postcode,
    form.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function buildPaymentTerms(form) {
  if (!form.set_credit_terms && !form.set_credit_limit && !form.account_on_hold) {
    return "";
  }

  const parts = [];

  if (form.set_credit_limit && form.credit_limit) {
    parts.push(`Credit limit: ${form.credit_limit}`);
  }

  if (form.set_credit_terms) {
    if (form.credit_term_type === "days_after_invoice") {
      parts.push(`${form.credit_days || 30} days after invoice date`);
    } else if (form.credit_term_type === "end_next_month") {
      parts.push("End of next month (Net monthly)");
    } else if (form.credit_term_type === "immediately") {
      parts.push("Immediately");
    }
  }

  if (form.account_on_hold) {
    parts.push("Account on hold");
  }

  return parts.join(" / ");
}

function buildNotes(form) {
  const details = [
    form.notes && `Notes: ${form.notes}`,
    form.reference && `Reference: ${form.reference}`,
    form.mobile && `Mobile: ${form.mobile}`,
    form.telephone && `Telephone: ${form.telephone}`,
    form.account_default && `Account default: ${form.account_default}`,
    form.vat_number && `VAT number: ${form.vat_number}`,
    form.import_agent && "Supplier is an import agent",
    form.reverse_charge && "VAT reverse charge enabled",
    form.bank_account_name && `Bank account name: ${form.bank_account_name}`,
    form.sort_code && `Sort code: ${form.sort_code}`,
    form.account_number && `Account number: ${form.account_number}`,
    form.bic_swift && `BIC/Swift: ${form.bic_swift}`,
    form.iban && `IBAN: ${form.iban}`,
  ];

  return details.filter(Boolean).join("\n");
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [activeTab, setActiveTab] = useState("account");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("active", true)
      .order("supplier_name");

    if (error) {
      alert(error.message);
      return;
    }

    setSuppliers(data || []);
  };

  const filteredSuppliers = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    if (!searchText) return suppliers;

    return suppliers.filter((supplier) =>
      `${supplier.supplier_name || ""} ${supplier.contact_name || ""} ${
        supplier.email || ""
      }`
        .toLowerCase()
        .includes(searchText)
    );
  }, [search, suppliers]);

  const updateForm = (field, value) => {
    setSupplierForm((current) => ({ ...current, [field]: value }));
  };

  const closeModal = () => {
    setShowSupplierModal(false);
    setActiveTab("account");
    setSupplierForm(emptySupplierForm);
    setSaving(false);
  };

  const saveSupplier = async (event) => {
    event.preventDefault();

    if (!supplierForm.supplier_name.trim()) {
      alert("Business Name is required.");
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("suppliers").insert({
      supplier_name: supplierForm.supplier_name.trim(),
      contact_name: supplierForm.contact_name.trim(),
      phone: supplierForm.telephone.trim() || supplierForm.mobile.trim(),
      contact_number: supplierForm.telephone.trim() || supplierForm.mobile.trim(),
      contact_person: supplierForm.contact_name.trim(),
      email: supplierForm.email.trim(),
      address: buildAddress(supplierForm),
      vat_number: supplierForm.vat_number.trim() || null,
      payment_terms: buildPaymentTerms(supplierForm),
      vat_registered: supplierForm.vat_registered,
      notes: buildNotes(supplierForm),
      active: true,
    });

    if (error) {
      alert(error.message);
      setSaving(false);
      return;
    }

    await fetchSuppliers();
    closeModal();
  };

  return (
    <div className="p-4 max-w-6xl mx-auto bg-slate-50 min-h-screen">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Suppliers</h2>
          <p className="mt-1 text-sm text-slate-600">
            Create and manage supplier contact, account, payment, and notes details.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowSupplierModal(true)}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-800"
        >
          Create Supplier
        </button>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          placeholder="Search suppliers..."
        />
      </div>

      <div className="space-y-3">
        {filteredSuppliers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
            No suppliers found.
          </div>
        ) : (
          filteredSuppliers.map((supplier) => (
            <article
              key={supplier.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Business Name
                  </div>
                  <div className="font-bold text-slate-900">
                    {supplier.supplier_name}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Contact
                  </div>
                  <div className="text-sm text-slate-700">
                    {supplier.contact_name || "-"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Email
                  </div>
                  <div className="text-sm text-slate-700">{supplier.email || "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Phone
                  </div>
                  <div className="text-sm text-slate-700">{supplier.phone || "-"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">VAT Number</div>
                  <div className="text-sm text-slate-700">{supplier.vat_number || "-"}</div>
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</div>
                  <div className="text-sm text-slate-700">{supplier.address || "-"}</div>
                </div>
              </div>
            </article>
          ))
        )}
      </div>

      {showSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close supplier form"
            onClick={closeModal}
          />

          <form
            onSubmit={saveSupplier}
            className="relative mx-auto flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-300 px-5 py-4">
              <h3 className="text-xl font-extrabold text-slate-950">
                Create a new supplier
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg px-3 py-2 text-2xl leading-none text-slate-700 hover:bg-slate-100"
                aria-label="Close"
              >
                x
              </button>
            </header>

            <div className="overflow-y-auto px-5 py-5">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-16">
                <div className="space-y-3">
                  <Field
                    label="Business Name*"
                    value={supplierForm.supplier_name}
                    onChange={(value) => updateForm("supplier_name", value)}
                    placeholder="Company or Person"
                  />
                  <Field
                    label="Contact Name"
                    value={supplierForm.contact_name}
                    onChange={(value) => updateForm("contact_name", value)}
                  />
                  <Field
                    label="Reference"
                    value={supplierForm.reference}
                    onChange={(value) => updateForm("reference", value)}
                    placeholder="e.g. Account Number"
                  />
                </div>

                <div className="space-y-3">
                  <Field
                    label="Email"
                    value={supplierForm.email}
                    onChange={(value) => updateForm("email", value)}
                  />
                  <Field
                    label="Mobile"
                    value={supplierForm.mobile}
                    onChange={(value) => updateForm("mobile", value)}
                  />
                  <Field
                    label="Telephone"
                    value={supplierForm.telephone}
                    onChange={(value) => updateForm("telephone", value)}
                  />
                </div>
              </div>

              <div className="mt-5 border-b border-slate-400">
                {[
                  ["account", "Account Details"],
                  ["payment", "Payment Details"],
                  ["notes", "Notes"],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={`mr-2 border-b-4 px-3 py-3 text-sm font-bold ${
                      activeTab === key
                        ? "border-black text-slate-950"
                        : "border-transparent text-slate-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="rounded-b-2xl bg-slate-100 p-4 sm:p-6">
                {activeTab === "account" && (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-12">
                    <div className="space-y-3">
                      <div className="mb-2 text-center text-sm font-bold text-slate-800">
                        UK & Ireland
                      </div>
                      <Field
                        label="Address 1"
                        value={supplierForm.address1}
                        onChange={(value) => updateForm("address1", value)}
                      />
                      <Field
                        label="Address 2"
                        value={supplierForm.address2}
                        onChange={(value) => updateForm("address2", value)}
                      />
                      <Field
                        label="Town / City"
                        value={supplierForm.town_city}
                        onChange={(value) => updateForm("town_city", value)}
                      />
                      <Field
                        label="County"
                        value={supplierForm.county}
                        onChange={(value) => updateForm("county", value)}
                      />
                      <Field
                        label="Postcode"
                        value={supplierForm.postcode}
                        onChange={(value) => updateForm("postcode", value)}
                      />
                      <SelectField
                        label="Country"
                        value={supplierForm.country}
                        onChange={(value) => updateForm("country", value)}
                        options={["United Kingdom (GB)", "Ireland (IE)"]}
                      />
                    </div>

                    <div className="space-y-3">
                      <SelectField
                        label="Account Default"
                        value={supplierForm.account_default}
                        onChange={(value) => updateForm("account_default", value)}
                        options={[
                          "5000 - Cost of Sales - Goods",
                          "5001 - Cost of Sales - Services",
                          "7000 - Overheads",
                        ]}
                      />
                      <CheckboxField
                        label="Not VAT registered"
                        checked={!supplierForm.vat_registered}
                        onChange={(checked) => updateForm("vat_registered", !checked)}
                      />
                      <Field
                        label="VAT Number"
                        value={supplierForm.vat_number}
                        onChange={(value) => updateForm("vat_number", value)}
                      />
                      <CheckboxField
                        label="This supplier is an import agent"
                        hint="Allows you to deal with VAT on imports."
                        checked={supplierForm.import_agent}
                        onChange={(checked) => updateForm("import_agent", checked)}
                      />
                      <CheckboxField
                        label="VAT Reverse Charge"
                        hint="Allows you to record reverse charge VAT on invoices."
                        checked={supplierForm.reverse_charge}
                        onChange={(checked) => updateForm("reverse_charge", checked)}
                      />
                    </div>
                  </div>
                )}

                {activeTab === "payment" && (
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 md:gap-x-12">
                    <div className="space-y-4">
                      <h4 className="text-center text-sm font-bold">Payment Terms</h4>
                      <CheckboxField
                        label="Set Credit Limit (GBP)"
                        checked={supplierForm.set_credit_limit}
                        onChange={(checked) => updateForm("set_credit_limit", checked)}
                      />
                      <input
                        value={supplierForm.credit_limit}
                        onChange={(event) => updateForm("credit_limit", event.target.value)}
                        disabled={!supplierForm.set_credit_limit}
                        className="ml-8 w-40 rounded-lg border border-slate-400 px-3 py-2 text-right text-sm disabled:bg-slate-200"
                        placeholder="0.00"
                      />
                      <CheckboxField
                        label="Set Credit Terms"
                        checked={supplierForm.set_credit_terms}
                        onChange={(checked) => updateForm("set_credit_terms", checked)}
                      />
                      <RadioField
                        disabled={!supplierForm.set_credit_terms}
                        checked={supplierForm.credit_term_type === "days_after_invoice"}
                        onChange={() => updateForm("credit_term_type", "days_after_invoice")}
                        label={
                          <span>
                            <input
                              value={supplierForm.credit_days}
                              disabled={!supplierForm.set_credit_terms}
                              onChange={(event) =>
                                updateForm("credit_days", event.target.value)
                              }
                              className="mx-2 w-16 rounded-lg border border-slate-300 px-2 py-1 text-right disabled:bg-slate-200"
                            />
                            days after invoice date
                          </span>
                        }
                      />
                      <RadioField
                        disabled={!supplierForm.set_credit_terms}
                        checked={supplierForm.credit_term_type === "end_next_month"}
                        onChange={() => updateForm("credit_term_type", "end_next_month")}
                        label="End of next month (Net monthly)"
                      />
                      <RadioField
                        disabled={!supplierForm.set_credit_terms}
                        checked={supplierForm.credit_term_type === "immediately"}
                        onChange={() => updateForm("credit_term_type", "immediately")}
                        label="Immediately"
                      />
                      <CheckboxField
                        label="Place account on hold"
                        checked={supplierForm.account_on_hold}
                        onChange={(checked) => updateForm("account_on_hold", checked)}
                      />
                    </div>

                    <div className="space-y-3">
                      <h4 className="text-center text-sm font-bold">Bank Details</h4>
                      <Field
                        label="Account Name"
                        value={supplierForm.bank_account_name}
                        onChange={(value) => updateForm("bank_account_name", value)}
                      />
                      <Field
                        label="Sort Code"
                        value={supplierForm.sort_code}
                        onChange={(value) => updateForm("sort_code", value)}
                      />
                      <Field
                        label="Account Number"
                        value={supplierForm.account_number}
                        onChange={(value) => updateForm("account_number", value)}
                      />
                      <Field
                        label="BIC/Swift"
                        value={supplierForm.bic_swift}
                        onChange={(value) => updateForm("bic_swift", value)}
                      />
                      <Field
                        label="IBAN"
                        value={supplierForm.iban}
                        onChange={(value) => updateForm("iban", value)}
                      />
                    </div>
                  </div>
                )}

                {activeTab === "notes" && (
                  <div>
                    <textarea
                      value={supplierForm.notes}
                      onChange={(event) => updateForm("notes", event.target.value)}
                      maxLength={4000}
                      className="h-60 w-full rounded-lg border border-slate-400 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      placeholder="Any additional information about this contact that you would like to store."
                    />
                    <p className="mt-1 text-right text-xs text-slate-600">
                      You have used {supplierForm.notes.length} of 4,000 characters
                    </p>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex justify-end px-5 pb-5">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-green-700 px-5 py-2 text-sm font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Save
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }) {
  return (
    <label className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900 sm:grid-cols-[110px_1fr] sm:items-center">
      <span className="sm:text-right">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-400 px-3 py-2 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900 sm:grid-cols-[110px_1fr] sm:items-center">
      <span className="sm:text-right">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-400 px-3 py-2 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({ label, checked, onChange, hint }) {
  return (
    <label className="flex items-start gap-2 text-sm font-bold text-slate-900">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        {label}
        {hint && <span className="block text-xs font-normal text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function RadioField({ checked, onChange, label, disabled }) {
  return (
    <label
      className={`ml-4 flex items-center gap-2 text-sm ${
        disabled ? "text-slate-400" : "text-slate-900"
      }`}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}
