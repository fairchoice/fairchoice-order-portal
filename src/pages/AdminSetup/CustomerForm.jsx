import { useEffect, useState } from "react";
import {
  saveCustomerAccount,
  getCustomerBranches,
  saveCustomerBranch,
} from "../../services/customerManagement";
import {
  getCustomerStatusLabel,
  getStoredCustomerStatus,
} from "../../utils/customerStatus";
import { getPriceModeLabel } from "../../utils/pricing";

const inputClass =
  "h-9 w-full rounded border border-slate-400 px-2 text-sm outline-none focus:border-green-700";
const labelClass = "mb-1 block text-sm font-bold text-slate-700";
const tabClass =
  "h-9 min-w-[130px] rounded border border-slate-500 px-3 text-sm font-bold";
const primaryButtonClass =
  "h-9 rounded-full bg-green-700 px-4 text-sm font-bold text-white hover:bg-green-800";
const secondaryButtonClass =
  "h-9 rounded-full border border-slate-500 bg-white px-4 text-sm font-bold hover:bg-slate-100";

const normalisePriceMode = (mode) => {
  const normalizedMode = String(mode || "VAT").trim().toLowerCase();
  if (["server", "inc.vat", "inc vat"].includes(normalizedMode)) return "Server";
  if (["super", "admin", "admin offer"].includes(normalizedMode)) return "Admin Offer";
  return "VAT";
};

export default function CustomerForm({
  editingCustomer,
  onClose,
  onSaved,
}) {
  const [form, setForm] = useState({
    id: editingCustomer?.id,
    account_name: editingCustomer?.account_name || "",
    contact_name: editingCustomer?.contact_name || "",
    phone: editingCustomer?.phone || "",
    mobile: editingCustomer?.mobile || "",
    email: editingCustomer?.email || "",
    vat_number: editingCustomer?.vat_number || "",
    status: getCustomerStatusLabel(editingCustomer?.status),

    address_line_1: editingCustomer?.address_line_1 || "",
    address_line_2: editingCustomer?.address_line_2 || "",
    town_city: editingCustomer?.town_city || "",
    postcode: editingCustomer?.postcode || "",
    country: editingCustomer?.country || "Wales",

    credit_limit: editingCustomer?.credit_limit || 0,
    payment_terms: editingCustomer?.payment_terms || "",
    default_price_mode: normalisePriceMode(editingCustomer?.default_price_mode),

    allow_vat: editingCustomer?.allow_vat ?? true,
    allow_server: editingCustomer?.allow_server ?? false,
    allow_manager: false,
    allow_super: false,
  });

  const [activeTab, setActiveTab] = useState("customer");
  const [branches, setBranches] = useState([]);
  const [editingBranch, setEditingBranch] = useState(null);
  const [saving, setSaving] = useState(false);

  const [branchForm, setBranchForm] = useState({
    branch_name: "",
    delivery_address: "",
    postcode: "",
    country: "Wales",
    phone: "",
    active: true,
  });

  useEffect(() => {
    if (editingCustomer?.id) {
      loadBranches();
    }
  }, [editingCustomer]);

  useEffect(() => {
    if (!editingCustomer) return;

    const scrollY = window.scrollY;

    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";

    return () => {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [editingCustomer]);

  const updateField = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const updateBranchField = (field, value) => {
    setBranchForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const resetBranchForm = () => {
    setEditingBranch(null);
    setBranchForm({
      branch_name: "",
      delivery_address: "",
      postcode: "",
      country: "Wales",
      phone: "",
      active: true,
    });
  };

  const editBranch = (branch) => {
    setEditingBranch(branch);
    setBranchForm({
      branch_name: branch.branch_name || "",
      delivery_address: branch.delivery_address || "",
      postcode: branch.postcode || "",
      country: branch.country || "Wales",
      phone: branch.phone || "",
      active: branch.active ?? true,
    });
  };

  const loadBranches = async () => {
    try {
      const data = await getCustomerBranches(editingCustomer.id);
      setBranches(data || []);
    } catch (error) {
      console.error("Branch load error:", error);
      alert("Could not load branches.");
    }
  };

  const handleSave = async () => {
    if (!form.account_name.trim()) {
      alert("Account name is required.");
      return;
    }

    const previousStatus = getCustomerStatusLabel(editingCustomer?.status);
    const nextStatus = getCustomerStatusLabel(form.status);
    if (
      previousStatus !== "Inactive" &&
      nextStatus === "Inactive" &&
      !window.confirm(
        "Mark this customer as inactive? They will no longer appear in customer selection, but their history will remain available."
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      await saveCustomerAccount({
        ...form,
        status: getStoredCustomerStatus(form.status),
        active: nextStatus !== "Inactive",
        default_price_mode: normalisePriceMode(form.default_price_mode),
        allow_manager: false,
        allow_super: false,
      });
      alert("Customer saved successfully.");
      onSaved?.();
    } catch (error) {
      console.error("Customer save error:", error);
      alert(`Could not save customer.\n\n${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBranch = async () => {
    if (!editingCustomer?.id) {
      alert("Save customer first before adding branches.");
      return;
    }

    if (!branchForm.branch_name.trim()) {
      alert("Branch name is required.");
      return;
    }

    await saveCustomerBranch({
      ...branchForm,
      id: editingBranch?.id,
      customer_account_id: editingCustomer.id,
    });

    resetBranchForm();
    loadBranches();
  };

  const handleToggleBranch = async (branch) => {
    if (!window.confirm(`${branch.active ? "Deactivate" : "Activate"} branch?`)) {
      return;
    }

    await saveCustomerBranch({
      ...branch,
      active: !branch.active,
    });

    loadBranches();
  };

  return (
    <div className="customer-edit-overlay fixed inset-0 z-[9999] flex items-start justify-center overflow-hidden bg-black/50 p-3">
      <div className="customer-edit-modal flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="shrink-0 border-b border-slate-300 p-4">
          <h2 className="text-lg font-bold leading-tight">
            {editingCustomer ? "Edit Customer" : "New Customer"}
          </h2>
        </div>

        <div
          className="customer-edit-modal-body min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-32 text-sm"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {[
              ["customer", "Customer Information"],
              ["address", "Invoice Address"],
              ["branches", "Branches"],
              ["payment", "Payment Details"],
              ["price", "Price Setup"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`${tabClass} ${
                  activeTab === key ? "bg-slate-700 text-white" : "bg-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "customer" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={labelClass}>Account Name</label>
                <input
                  className={inputClass}
                  value={form.account_name}
                  onChange={(e) => updateField("account_name", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Contact Name</label>
                <input
                  className={inputClass}
                  value={form.contact_name}
                  onChange={(e) => updateField("contact_name", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Phone</label>
                <input
                  className={inputClass}
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Mobile</label>
                <input
                  className={inputClass}
                  value={form.mobile}
                  onChange={(e) => updateField("mobile", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input
                  className={inputClass}
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>VAT Number</label>
                <input
                  className={inputClass}
                  value={form.vat_number}
                  onChange={(e) => updateField("vat_number", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Customer Status</label>
                <select
                  className={inputClass}
                  value={form.status}
                  onChange={(e) => updateField("status", e.target.value)}
                >
                  <option value="Active">Active</option>
                  <option value="On Hold">On Hold</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === "address" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={labelClass}>Address Line 1</label>
                <input
                  className={inputClass}
                  value={form.address_line_1}
                  onChange={(e) => updateField("address_line_1", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Address Line 2</label>
                <input
                  className={inputClass}
                  value={form.address_line_2}
                  onChange={(e) => updateField("address_line_2", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Town / City</label>
                <input
                  className={inputClass}
                  value={form.town_city}
                  onChange={(e) => updateField("town_city", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Postcode</label>
                <input
                  className={inputClass}
                  value={form.postcode}
                  onChange={(e) => updateField("postcode", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Country</label>
                <select
                  className={inputClass}
                  value={form.country}
                  onChange={(e) => updateField("country", e.target.value)}
                >
                  <option value="Wales">Wales</option>
                  <option value="England">England</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === "branches" && (
            <div>
              {!editingCustomer?.id && (
                <div className="mb-3 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm font-bold">
                  Save customer first before adding branches.
                </div>
              )}

              {editingCustomer?.id && (
                <>
                  <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label className={labelClass}>Branch Name</label>
                      <input
                        className={inputClass}
                        value={branchForm.branch_name}
                        onChange={(e) => updateBranchField("branch_name", e.target.value)}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Phone</label>
                      <input
                        className={inputClass}
                        value={branchForm.phone}
                        onChange={(e) => updateBranchField("phone", e.target.value)}
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className={labelClass}>Delivery Address</label>
                      <input
                        className={inputClass}
                        value={branchForm.delivery_address}
                        onChange={(e) =>
                          updateBranchField("delivery_address", e.target.value)
                        }
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Postcode</label>
                      <input
                        className={inputClass}
                        value={branchForm.postcode}
                        onChange={(e) => updateBranchField("postcode", e.target.value)}
                      />
                    </div>

                    <div>
                      <label className={labelClass}>Country</label>
                      <select
                        className={inputClass}
                        value={branchForm.country}
                        onChange={(e) => updateBranchField("country", e.target.value)}
                      >
                        <option value="Wales">Wales</option>
                        <option value="England">England</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleSaveBranch}
                      className={primaryButtonClass}
                    >
                      {editingBranch ? "Update Branch" : "+ Add Branch"}
                    </button>

                    <button
                      type="button"
                      onClick={resetBranchForm}
                      className={secondaryButtonClass}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="overflow-hidden rounded border border-slate-400">
                    <div className="grid grid-cols-[1fr_150px] bg-slate-700 px-3 py-2 text-sm font-bold text-white">
                      <div>Branch</div>
                      <div className="text-right">Actions</div>
                    </div>

                    {branches.map((branch) => (
                      <div
                        key={branch.id}
                        className="grid grid-cols-[1fr_150px] items-center border-t border-slate-300 px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="flex items-center gap-2 font-bold">
                            {branch.branch_name}

                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${
                                branch.active
                                  ? "bg-green-100 text-green-800"
                                  : "bg-slate-200 text-slate-700"
                              }`}
                            >
                              {branch.active ? "Active" : "Inactive"}
                            </span>
                          </div>

                          <div className="text-xs text-slate-600">
                            {branch.delivery_address}
                          </div>

                          <div className="text-xs text-slate-600">
                            {branch.postcode} - {branch.country}
                          </div>
                        </div>

                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => editBranch(branch)}
                            className="h-8 rounded bg-blue-700 px-3 text-sm font-bold text-white"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleBranch(branch)}
                            className={`h-8 rounded px-3 text-sm font-bold text-white ${
                              branch.active ? "bg-red-700" : "bg-green-700"
                            }`}
                          >
                            {branch.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    ))}

                    {branches.length === 0 && (
                      <div className="border-t border-slate-300 px-3 py-3 text-sm text-slate-500">
                        No branches added yet.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "payment" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={labelClass}>Payment Terms</label>
                <input
                  className={inputClass}
                  placeholder="Example: 7 days, 14 days, COD"
                  value={form.payment_terms}
                  onChange={(e) => updateField("payment_terms", e.target.value)}
                />
              </div>

              <div>
                <label className={labelClass}>Credit Limit</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={inputClass}
                  value={form.credit_limit}
                  onChange={(e) => updateField("credit_limit", e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === "price" && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className={labelClass}>Default Price Mode</label>
                <select
                  className={inputClass}
                  value={form.default_price_mode}
                  onChange={(e) => updateField("default_price_mode", e.target.value)}
                >
                  <option value="VAT">{getPriceModeLabel("VAT")}</option>
                  <option value="Server">{getPriceModeLabel("Server")}</option>
                </select>
              </div>

              <div className="rounded border border-slate-400 px-3 py-2">
                <div className="mb-2 text-sm font-bold">Customer Price Access</div>

                <label className="mb-1 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.allow_vat}
                    onChange={(e) => updateField("allow_vat", e.target.checked)}
                  />
                  Ex.VAT
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.allow_server}
                    onChange={(e) => updateField("allow_server", e.target.checked)}
                  />
                  Inc.VAT
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-none justify-end gap-2 border-t border-slate-300 px-5 py-3">
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`${primaryButtonClass} disabled:opacity-50`}
          >
            {saving ? "Saving..." : "Save Customer"}
          </button>
        </div>
      </div>
    </div>
  );
}
