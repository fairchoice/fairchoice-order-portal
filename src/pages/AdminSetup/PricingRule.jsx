import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import {
  createCustomerPriceCode,
  getCustomerPriceCodes,
  updateCustomerPriceCode,
} from "../../services/priceCodes";
import { hasPermission, requirePermission } from "../../utils/permissions";
import { logAction } from "../../utils/auditLog";
import { normalizeRole } from "../../security/accessControlRegistry";

const PRICING_PASSWORD_SETTING_KEY = "pricing_super_admin_password";
const CODE_PAGE_SIZE = 15;

export default function Pricing() {
  const [form, setForm] = useState({ vat_percent: 20, server_discount_percent: 0 });
  const [priceCodes, setPriceCodes] = useState([]);
  const [codePage, setCodePage] = useState(1);
  const [showNewCode, setShowNewCode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newCodePercent, setNewCodePercent] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [pricingUnlocked, setPricingUnlocked] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [superAdminPassword, setSuperAdminPassword] = useState("");
  const [showResetPasswordPrompt, setShowResetPasswordPrompt] = useState(false);
  const [newPricingPassword, setNewPricingPassword] = useState("");
  const [confirmPricingPassword, setConfirmPricingPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
  const isSuperAdmin = normalizeRole(loggedInUser?.role || loggedInUser?.access_level) === "Super Admin";

  useEffect(() => {
    void loadPricing();
    void loadPriceCodes();
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
      });
    }
  }

  async function loadPriceCodes() {
    try {
      const rows = await getCustomerPriceCodes({ includeInactive: true });
      setPriceCodes(rows || []);
    } catch (error) {
      console.error("Customer price codes load error:", error);
      setPriceCodes([]);
    }
  }

  function updateField(field, value) {
    if (!pricingUnlocked) return;
    setForm((old) => ({ ...old, [field]: value }));
  }

  async function unlockPricing() {
    if (!requirePermission(loggedInUser, "can_edit_pricing", "You cannot edit pricing.")) {
      setShowPasswordPrompt(false);
      setSuperAdminPassword("");
      return;
    }
    const enteredPassword = superAdminPassword;
    if (!enteredPassword) return alert("Enter Super Admin password");
    setUnlocking(true);
    const { data, error } = await supabase
      .from("app_security_settings")
      .select("value")
      .eq("key", PRICING_PASSWORD_SETTING_KEY)
      .eq("active", true)
      .maybeSingle();
    setUnlocking(false);
    if (error || !data?.value) {
      setSuperAdminPassword("");
      return alert("Pricing unlock password is not configured.");
    }
    if (enteredPassword !== data.value) {
      setSuperAdminPassword("");
      return alert("Incorrect Super Admin password");
    }
    setPricingUnlocked(true);
    setShowPasswordPrompt(false);
    setSuperAdminPassword("");
  }

  function cancelUnlockPricing() {
    setShowPasswordPrompt(false);
    setSuperAdminPassword("");
  }

  function cancelResetPricingPassword() {
    setShowResetPasswordPrompt(false);
    setNewPricingPassword("");
    setConfirmPricingPassword("");
  }

  async function resetPricingPassword() {
    if (!isSuperAdmin) return alert("Only Super Admin can reset the Pricing password.");
    if (!requirePermission(loggedInUser, "can_edit_pricing", "You cannot edit pricing.")) {
      cancelResetPricingPassword();
      return;
    }
    const nextPassword = newPricingPassword.trim();
    if (nextPassword.length < 6) return alert("Use at least 6 characters for the new Pricing password.");
    if (nextPassword !== confirmPricingPassword.trim()) return alert("New password and confirmation do not match.");
    if (!window.confirm("Reset the Pricing edit password?")) return;
    setResettingPassword(true);
    const { error } = await supabase
      .from("app_security_settings")
      .upsert({ key: PRICING_PASSWORD_SETTING_KEY, value: nextPassword, active: true }, { onConflict: "key" });
    setResettingPassword(false);
    if (error) return alert("Pricing password reset failed: " + error.message);
    await logAction({
      user: loggedInUser,
      action_type: "Pricing password reset",
      page_module: "Pricing",
      old_value: null,
      new_value: { key: PRICING_PASSWORD_SETTING_KEY },
    });
    setPricingUnlocked(true);
    cancelResetPricingPassword();
    alert("Pricing password reset. Pricing is now unlocked.");
  }

  async function savePricing() {
    if (!pricingUnlocked) return;
    if (!requirePermission(loggedInUser, "can_edit_pricing", "You cannot edit pricing.")) return;
    if (!window.confirm("Save Ex.VAT / Inc.VAT pricing settings?")) return;
    setSaving(true);
    const payload = {
      id: 1,
      vat_percent: Number(form.vat_percent || 0),
      server_discount_percent: Number(form.server_discount_percent || 0),
    };
    const { error } = await supabase.from("pricing_settings").upsert(payload, { onConflict: "id" });
    setSaving(false);
    if (error) return alert(error.message);
    alert("Pricing settings saved.");
    await logAction({
      user: loggedInUser,
      action_type: "Pricing changed",
      page_module: "Pricing",
      old_value: null,
      new_value: payload,
    });
  }

  async function addPriceCode() {
    if (!pricingUnlocked) return alert("Unlock Pricing first.");
    const code = newCode.trim();
    const percent = Number(newCodePercent || 0);
    if (!code) return alert("Enter a customer price code.");
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return alert("Enter a percentage from 0 to 100.");
    setSavingCode(true);
    try {
      const created = await createCustomerPriceCode({ code, discountPercent: percent });
      await logAction({
        user: loggedInUser,
        action_type: "Customer price code created",
        page_module: "Pricing",
        old_value: null,
        new_value: created,
      });
      setNewCode("");
      setNewCodePercent("");
      setShowNewCode(false);
      await loadPriceCodes();
    } catch (error) {
      alert("Could not create price code: " + (error.message || error));
    } finally {
      setSavingCode(false);
    }
  }

  async function renamePriceCode(priceCode) {
    if (!pricingUnlocked) return alert("Unlock Pricing first.");
    const nextCode = window.prompt("Rename customer price code", priceCode.code || "");
    if (nextCode === null) return;
    const cleanCode = nextCode.trim();
    if (!cleanCode || cleanCode === priceCode.code) return;
    try {
      await updateCustomerPriceCode(priceCode.id, { code: cleanCode });
      await loadPriceCodes();
    } catch (error) {
      alert("Rename failed: " + (error.message || error));
    }
  }

  async function editPriceCodePercent(priceCode) {
    if (!pricingUnlocked) return alert("Unlock Pricing first.");
    const nextPercent = window.prompt("Customer code discount %", String(priceCode.discount_percent ?? 0));
    if (nextPercent === null) return;
    const percent = Number(nextPercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) return alert("Enter a percentage from 0 to 100.");
    try {
      await updateCustomerPriceCode(priceCode.id, { discountPercent: percent });
      await loadPriceCodes();
    } catch (error) {
      alert("Percentage update failed: " + (error.message || error));
    }
  }

  async function togglePriceCode(priceCode) {
    if (!pricingUnlocked) return alert("Unlock Pricing first.");
    const nextActive = priceCode.active === false;
    if (!window.confirm(`${nextActive ? "Activate" : "Make inactive"} code ${priceCode.code}?`)) return;
    try {
      await updateCustomerPriceCode(priceCode.id, { active: nextActive });
      await loadPriceCodes();
    } catch (error) {
      alert("Status update failed: " + (error.message || error));
    }
  }

  const pageCount = Math.max(1, Math.ceil(priceCodes.length / CODE_PAGE_SIZE));
  const safePage = Math.min(codePage, pageCount);
  const visibleCodes = useMemo(
    () => priceCodes.slice((safePage - 1) * CODE_PAGE_SIZE, safePage * CODE_PAGE_SIZE),
    [priceCodes, safePage]
  );

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Pricing</h1>
      <p className="text-sm text-slate-600 mb-6">
        Keep normal Ex.VAT and Inc.VAT pricing, then manage customer-specific percentage codes.
      </p>

      <div className="bg-white rounded-2xl border p-5 max-w-4xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PriceInput
            label="Ex.VAT / VAT %"
            help="VAT rate added to normal Ex.VAT customer pricing."
            value={form.vat_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("vat_percent", v)}
          />
          <PriceInput
            label="Inc.VAT Discount %"
            help="Normal Inc.VAT percentage rule. Customer codes use their own percentage."
            value={form.server_discount_percent}
            disabled={!pricingUnlocked}
            onChange={(v) => updateField("server_discount_percent", v)}
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

      <div className="mt-6 bg-white rounded-2xl border p-5 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-xl font-bold">Customer Price Codes</h2>
            <p className="text-sm text-slate-600">
              Code percentage is calculated from the Inc.VAT product price unless that product has an exact code price.
            </p>
          </div>
          <button
            type="button"
            disabled={!pricingUnlocked}
            onClick={() => setShowNewCode((old) => !old)}
            className="bg-green-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
          >
            + New Code
          </button>
        </div>

        {showNewCode && (
          <div className="mb-4 grid grid-cols-1 md:grid-cols-[1fr_180px_auto] gap-3 rounded-xl border bg-slate-50 p-4">
            <input
              className="border rounded-xl p-3 font-bold"
              placeholder="Customer price code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <input
                className="border rounded-xl p-3 w-full font-bold"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="Percentage"
                value={newCodePercent}
                onChange={(e) => setNewCodePercent(e.target.value)}
              />
              <span className="font-bold">%</span>
            </div>
            <button
              type="button"
              onClick={addPriceCode}
              disabled={savingCode}
              className="bg-blue-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
            >
              {savingCode ? "Adding..." : "Add Code"}
            </button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="p-3">Code</th>
                <th className="p-3">Percentage</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleCodes.map((priceCode) => (
                <tr key={priceCode.id} className="border-t">
                  <td className="p-3 font-bold">{priceCode.code}</td>
                  <td className="p-3">{Number(priceCode.discount_percent || 0)}%</td>
                  <td className="p-3">{priceCode.active === false ? "Inactive" : "Active"}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={!pricingUnlocked} onClick={() => renamePriceCode(priceCode)} className="border rounded-lg px-3 py-2 font-bold disabled:opacity-40">Rename</button>
                      <button type="button" disabled={!pricingUnlocked} onClick={() => editPriceCodePercent(priceCode)} className="border rounded-lg px-3 py-2 font-bold disabled:opacity-40">Edit %</button>
                      <button type="button" disabled={!pricingUnlocked} onClick={() => togglePriceCode(priceCode)} className="border rounded-lg px-3 py-2 font-bold disabled:opacity-40">
                        {priceCode.active === false ? "Activate" : "Inactive"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {visibleCodes.length === 0 && (
                <tr><td colSpan="4" className="p-6 text-center text-slate-500">No customer price codes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pageCount > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button type="button" disabled={safePage <= 1} onClick={() => setCodePage((p) => Math.max(1, p - 1))} className="border rounded-lg px-4 py-2 font-bold disabled:opacity-40">Previous</button>
            <span className="text-sm font-bold">Page {safePage} of {pageCount}</span>
            <button type="button" disabled={safePage >= pageCount} onClick={() => setCodePage((p) => Math.min(pageCount, p + 1))} className="border rounded-lg px-4 py-2 font-bold disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      {showPasswordPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border p-5 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Super Admin Password</h2>
            <input type="password" className="border rounded-xl p-3 w-full font-bold" value={superAdminPassword} onChange={(e) => setSuperAdminPassword(e.target.value)} autoFocus />
            {isSuperAdmin && <button type="button" onClick={() => { setShowPasswordPrompt(false); setSuperAdminPassword(""); setShowResetPasswordPrompt(true); }} className="mt-4 text-sm font-bold text-blue-700 underline">Forgot password / Reset</button>}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={cancelUnlockPricing} className="bg-slate-200 text-slate-800 font-bold px-5 py-3 rounded-xl">Cancel</button>
              <button type="button" onClick={unlockPricing} disabled={unlocking} className="bg-blue-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400">{unlocking ? "Checking..." : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}

      {showResetPasswordPrompt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl border p-5 w-full max-w-md">
            <h2 className="text-xl font-bold mb-2">Reset Pricing Password</h2>
            <p className="text-sm text-slate-600 mb-4">Super Admin only. Set a new password to unlock Pricing.</p>
            <div className="space-y-3">
              <input type="password" className="border rounded-xl p-3 w-full font-bold" placeholder="New password" value={newPricingPassword} onChange={(e) => setNewPricingPassword(e.target.value)} autoFocus />
              <input type="password" className="border rounded-xl p-3 w-full font-bold" placeholder="Confirm new password" value={confirmPricingPassword} onChange={(e) => setConfirmPricingPassword(e.target.value)} />
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={cancelResetPricingPassword} className="bg-slate-200 text-slate-800 font-bold px-5 py-3 rounded-xl">Cancel</button>
              <button type="button" onClick={resetPricingPassword} disabled={resettingPassword} className="bg-red-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400">{resettingPassword ? "Resetting..." : "Reset Password"}</button>
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
        <input type="number" step="0.01" className="border rounded-xl p-3 w-full font-bold disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <span className="font-bold">%</span>
      </div>
      <p className="text-xs text-slate-500 mt-2">{help}</p>
    </div>
  );
}
