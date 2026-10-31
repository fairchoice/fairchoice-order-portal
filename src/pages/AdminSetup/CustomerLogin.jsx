import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { getFcSessionState, readStoredFcProfile } from "../../services/fcSession";

const EMPTY = {
  customer_account_id: "",
  account_name: "",
  account_active: true,
  login_id: "",
  username: "",
  login_enabled: false,
  last_login_at: null,
  new_password: "",
};

export default function CustomerLogin() {
  const currentUser = useMemo(() => readStoredFcProfile(), []);
  const session = useMemo(() => getFcSessionState(currentUser), [currentUser]);
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(EMPTY);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(session.valid);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(session.valid ? "" : "Your secure staff session has expired. Sign in again.");

  const load = useCallback(async () => {
    if (!session.valid) return;
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("fc_customer_login_snapshot_v1", {
      p_username: session.username,
      p_session_token: session.token,
    });
    setLoading(false);
    if (rpcError) return setError(rpcError.message || "Customer logins could not be loaded.");
    const nextRows = Array.isArray(data?.customers) ? data.customers : [];
    setRows(nextRows);
    setSelected((current) => {
      if (!current.customer_account_id) return current;
      const refreshed = nextRows.find((row) => String(row.customer_account_id) === String(current.customer_account_id));
      return refreshed ? { ...EMPTY, ...refreshed } : current;
    });
  }, [session.token, session.username, session.valid]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = row.login_id && row.login_enabled !== false ? "active" : row.login_id ? "disabled" : "not_configured";
      return (!needle || `${row.account_name || ""} ${row.username || ""}`.toLowerCase().includes(needle)) && (!statusFilter || status === statusFilter);
    });
  }, [rows, search, statusFilter]);

  const setField = (key, value) => setSelected((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!selected.customer_account_id || saving) return;
    const username = String(selected.username || "").trim().toLowerCase();
    if (!username) return setError("Username is required.");
    if (!selected.login_id && String(selected.new_password || "").length < 8) return setError("A password of at least 8 characters is required for a new customer login.");
    if (selected.new_password && selected.new_password.length < 8) return setError("The new password must be at least 8 characters.");
    if (!window.confirm(`Save customer portal login changes for ${selected.account_name || username}?`)) return;

    setSaving(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("fc_save_customer_login_v1", {
      p_username: session.username,
      p_session_token: session.token,
      p_customer_account_id: selected.customer_account_id,
      p_login_id: selected.login_id || null,
      p_target_username: username,
      p_new_password: selected.new_password || null,
      p_login_enabled: selected.login_enabled !== false,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message || "Customer login changes could not be saved.");
    await load();
    alert("Customer login saved successfully.");
  }

  function offboardPortal() {
    if (!selected.login_id) return;
    if (!window.confirm(`Disable portal access for ${selected.account_name}? Orders, invoices, credit history and customer records will be kept.`)) return;
    setSelected((current) => ({ ...current, login_enabled: false }));
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mb-4"><h2 className="text-2xl font-extrabold text-slate-950">Customer Login / Onboarding</h2><p className="text-sm text-slate-600">Manage customer portal access while preserving all existing customer accounts and login history.</p></div>
      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Existing customer usernames, passwords and active status are not changed unless you explicitly edit that customer and save.</div>
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 font-semibold text-red-800">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer or username" className="w-full rounded-xl border p-3" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">All login status</option><option value="active">Active login</option><option value="disabled">Disabled login</option><option value="not_configured">No login</option></select>
          <div className="mt-3 max-h-[65vh] space-y-2 overflow-y-auto">
            {loading && <div className="p-3 text-sm text-slate-500">Loading customers...</div>}
            {!loading && filtered.map((row) => <button key={row.customer_account_id} type="button" onClick={() => setSelected({ ...EMPTY, ...row })} className={`w-full rounded-xl border p-3 text-left ${selected.customer_account_id === row.customer_account_id ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><div className="font-bold">{row.account_name || "Unnamed customer"}</div><div className="text-xs text-slate-600">{row.login_id ? `${row.username || "No username"} · ${row.login_enabled === false ? "Disabled" : "Active"}` : "Portal login not configured"}</div></button>)}
          </div>
        </aside>
        <main className="rounded-2xl border bg-white p-4 shadow-sm">
          {!selected.customer_account_id ? <div className="p-8 text-center text-slate-500">Select a customer account.</div> : <>
            <div className="grid gap-3 md:grid-cols-2">
              <Info label="Customer" value={selected.account_name} />
              <Info label="Customer account" value={selected.account_active === false ? "Inactive" : "Active"} />
              <Info label="Last login" value={selected.last_login_at ? new Date(selected.last_login_at).toLocaleString("en-GB") : "Not available"} />
              <Info label="Login record" value={selected.login_id ? "Existing Login" : "Not configured"} />
              <label className="text-sm font-bold">Username<input value={selected.username || ""} onChange={(e) => setField("username", e.target.value)} className="mt-1 w-full rounded-xl border p-2 font-normal" placeholder="Customer portal username" /></label>
              <Toggle label="Portal login enabled" checked={selected.login_enabled !== false} disabled={!selected.login_id && !selected.username} onChange={(v) => setField("login_enabled", v)} />
            </div>
            <label className="mt-4 block max-w-md text-sm font-bold">Set new password<input type="password" autoComplete="new-password" value={selected.new_password || ""} onChange={(e) => setField("new_password", e.target.value)} placeholder={selected.login_id ? "Leave blank to keep current password" : "Minimum 8 characters"} className="mt-1 w-full rounded-xl border p-2 font-normal" /></label>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" disabled={saving || selected.account_active === false} onClick={save} className="rounded-xl bg-green-700 px-5 py-3 font-bold text-white disabled:bg-slate-300">{saving ? "Saving..." : selected.login_id ? "Update Login" : "Onboard Customer Login"}</button>
              <button type="button" disabled={!selected.login_id} onClick={offboardPortal} className="rounded-xl border border-red-700 px-5 py-3 font-bold text-red-700 disabled:border-slate-300 disabled:text-slate-300">Offboard Portal Access</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Offboarding disables portal login only. The customer account, branches, orders, invoices, credit and payment history remain unchanged.</p>
          </>}
        </main>
      </div>
    </div>
  );
}

function Info({ label, value }) { return <div><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-bold text-slate-950">{value || "-"}</div></div>; }
function Toggle({ label, checked, disabled, onChange }) { return <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>; }
