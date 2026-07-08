import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { hasPermission, requirePermission } from "../../utils/permissions";
import { logAction } from "../../utils/auditLog";

const SUPER_ADMIN_PASSWORD = "CHANGE_THIS_PASSWORD";

export default function Pricing() {
  const [form, setForm] = useState({
    vat_percent: 20,
    server_discount_percent: 0,
    manager_discount_percent: 0,
    admin_offer_discount_percent: 0,
  });

  const [saving, setSaving] = useState(false);
  const [pricingUnlocked, setPricingUnlocked] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");

  useEffect(() => {
    loadPricing();
  }, []);

  async function loadPricing() {
    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (!error && data) {
      setForm({
        vat_percent: Number(data.vat_percent ?? 20),
        server_discount_percent: Number(data.server_discount_percent ?? 0),
        manager_discount_percent: Number(data.manager_discount_percent ?? 0),
        admin_offer_discount_percent: Number(
          data.admin_offer_discount_percent ?? data.super_discount_percent ?? 0
        ),
      });
    }
  }

  function updateField(field, value) {
    if (!pricingUnlocked) return;

    setForm((old) => ({
      ...old,
      [field]: value,
    }));
  }

  function unlockPricing() {
    if (
      !requirePermission(
        loggedInUser,
        "can_edit_pricing",
        "You cannot edit pricing."
      )
    ) {
      setShowPasswordPrompt(false);
      setSuperAdminPassword("");
      return;
    }

    if (superAdminPassword !== SUPER_ADMIN_PASSWORD) {
      alert("Incorrect Super Admin password");
      return;
    }

    setPricingUnlocked(true);
    setShowPasswordPrompt(false);
    setSuperAdminPassword("");
  }

  function cancelUnlockPricing() {
    setShowPasswordPrompt(false);
    setSuperAdminPassword("");
  }

  async function savePricing() {
    if (!pricingUnlocked) return;
    if (
      !requirePermission(
        loggedInUser,
        "can_edit_pricing",
        "You cannot edit pricing."
      )
    ) {
      return;
    }

    if (!window.confirm("Save pricing settings?")) return;

    setSaving(true);

    const payload = {
      id: 1,
      vat_percent: Number(form.vat_percent || 0),
      server_discount_percent: Number(form.server_discount_percent || 0),
      manager_discount_percent: Number(form.manager_discount_percent || 0),
      admin_offer_discount_percent: Number(
        form.admin_offer_discount_percent || 0
      ),
      super_discount_percent: Number(form.admin_offer_discount_percent || 0),
    };

    const { error } = await supabase
      .from("pricing_settings")
      .upsert(payload, { onConflict: "id" });

    setSaving(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Pricing settings saved.");

    await logAction({
      user: loggedInUser,
      action_type: "Pricing changed",
      page_module: "Pricing",
      old_value: null,
      new_value: payload,
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Pricing</h1>
      <p className="text-sm text-slate-600 mb-6">
        Manage VAT, Server, Manager Offer and Admin Offer percentage rules.
      </p>

      <div className="bg-white rounded-2xl border p-5 max-w-3xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PriceInput
            label="Ex. VAT / VAT %"
            help="Default VAT calculation. Example: GBP 10 + 20% = GBP 12"
            value={form.vat_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("vat_percent", v)}
          />

          <PriceInput
            label="Server Discount %"
            help="Applied after VAT, then fair-quarter rounded. Example: GBP 10 + 20% VAT = GBP 12, then 2% off = GBP 11.76"
            value={form.server_discount_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("server_discount_percent", v)}
          />

          <PriceInput
            label="Manager Discount %"
            help="Applied after VAT, then fair-quarter rounded, same as Server."
            value={form.manager_discount_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("manager_discount_percent", v)}
          />

          <PriceInput
            label="Admin Offer %"
            help="Applied before VAT, then VAT is added after."
            value={form.admin_offer_discount_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("admin_offer_discount_percent", v)}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setShowPasswordPrompt(true)}
            disabled={pricingUnlocked || !hasPermission(loggedInUser, "can_edit_pricing")}
            className="bg-slate-700 text-white font-bold px-6 py-3 rounded-xl disabled:bg-slate-400"
          >
            {pricingUnlocked ? "Pricing Unlocked" : "Edit Pricing"}
          </button>

          <button
            onClick={savePricing}
            disabled={saving || !pricingUnlocked}
            className="bg-blue-700 text-white font-bold px-6 py-3 rounded-xl disabled:bg-slate-400"
          >
            {saving ? "Saving..." : "Save Pricing"}
          </button>
        </div>
      </div>

      {showPasswordPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border p-5 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Super Admin Password</h2>

            <input
              type="password"
              className="border rounded-xl p-3 w-full font-bold"
              value={superAdminPassword}
              onChange={(e) => setSuperAdminPassword(e.target.value)}
              autoFocus
            />

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancelUnlockPricing}
                className="bg-slate-200 text-slate-800 font-bold px-5 py-3 rounded-xl"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={unlockPricing}
                className="bg-blue-700 text-white font-bold px-5 py-3 rounded-xl"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceInput({ label, help, value, onChange, disabled }) {
  return (
    <div className="border rounded-xl p-4">
      <label className="font-bold text-sm block mb-2">{label}</label>

      <div className="flex items-center gap-2">
        <input
          type="number"
          step="0.01"
          className="border rounded-xl p-3 w-full font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="font-bold">%</span>
      </div>

      <p className="text-xs text-slate-500 mt-2">{help}</p>
    </div>
  );
}
