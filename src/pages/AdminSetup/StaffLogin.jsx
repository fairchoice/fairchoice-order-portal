import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { getFcSessionState, readStoredFcProfile } from "../../services/fcSession";
import { MASTER_ADMIN_USERNAME, STAFF_ROLES, isMasterAdmin } from "../../security/accessControlRegistry";

const EMPTY = {
  staff_id: "",
  login_id: "",
  staff_name: "",
  username: "",
  role: "Admin",
  staff_active: true,
  login_enabled: true,
  last_login_at: null,
  new_password: "",
};

export default function StaffLogin({ initialStaffId = "", onOpenAccessControl = () => {} }) {
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
    const { data, error: rpcError } = await supabase.rpc("fc_staff_login_snapshot_v1", {
      p_username: session.username,
      p_session_token: session.token,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message || "Staff login details could not be loaded.");
      return;
    }
    const nextRows = Array.isArray(data?.staff) ? data.staff : [];
    setRows(nextRows);
    setSelected((current) => {
      const wanted = current.staff_id || initialStaffId;
      if (!wanted) return current;
      const refreshed = nextRows.find((row) => String(row.staff_id) === String(wanted));
      return refreshed ? { ...EMPTY, ...refreshed } : current;
    });
  }, [initialStaffId, session.token, session.username, session.valid]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      const status = row.staff_active !== false && row.login_enabled !== false ? "active" : "inactive";
      return (!needle || `${row.staff_name || ""} ${row.username || ""} ${row.role || ""}`.toLowerCase().includes(needle)) &&
        (!statusFilter || status === statusFilter);
    });
  }, [rows, search, statusFilter]);

  const protectedMaster = String(selected.username || "").trim().toLowerCase() === MASTER_ADMIN_USERNAME;
  const setField = (key, value) => setSelected((current) => ({ ...current, [key]: value }));

  async function save() {
    if (!selected.staff_id || saving || protectedMaster) return;
    const username = String(selected.username || "").trim().toLowerCase();
    if (!username) return setError("Username is required.");
    if (!selected.login_id && String(selected.new_password || "").length < 8) {
      return setError("A password of at least 8 characters is required for a new login.");
    }
    if (selected.new_password && selected.new_password.length < 8) {
      return setError("The new password must be at least 8 characters.");
    }
    if (!window.confirm(`Save staff login changes for ${selected.staff_name || username}?`)) return;

    setSaving(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("fc_save_staff_login_v1", {
      p_username: session.username,
      p_session_token: session.token,
      p_target_staff_id: selected.staff_id,
      p_target_login_id: selected.login_id || null,
      p_target_username: username,
      p_new_password: selected.new_password || null,
      p_role: selected.role,
      p_staff_active: selected.staff_active !== false,
      p_login_enabled: selected.login_enabled !== false,
    });
    setSaving(false);
    if (rpcError) return setError(rpcError.message || "Staff login changes could not be saved.");
    await load();
    alert("Staff login saved successfully.");
  }

  function offboard() {
    if (!selected.staff_id || protectedMaster) return;
    if (!window.confirm(`Offboard ${selected.staff_name || selected.username}? This disables the staff record and login but keeps historical records.`)) return;
    setSelected((current) => ({ ...current, staff_active: false, login_enabled: false }));
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mb-4"><h2 className="text-2xl font-extrabold text-slate-950">Staff Login / Onboarding</h2><p className="text-sm text-slate-600">Create, enable, disable and reset staff logins without deleting staff history.</p></div>
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 font-semibold text-red-800">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search staff, username or role" className="w-full rounded-xl border p-3" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="mt-2 w-full rounded-xl border p-3"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive / Offboarded</option></select>
          <div className="mt-3 max-h-[65vh] space-y-2 overflow-y-auto">
            {loading && <div className="p-3 text-sm text-slate-500">Loading staff...</div>}
            {!loading && filtered.map((row) => <button key={row.staff_id} type="button" onClick={() => setSelected({ ...EMPTY, ...row })} className={`w-full rounded-xl border p-3 text-left ${selected.staff_id === row.staff_id ? "border-blue-600 bg-blue-50" : "border-slate-200"}`}><div className="font-bold">{row.staff_name || "Unnamed staff"}</div><div className="text-xs text-slate-600">{row.username || "Login not configured"} · {row.role || "Staff"}</div></button>)}
          </div>
        </aside>
        <main className="rounded-2xl border bg-white p-4 shadow-sm">
          {!selected.staff_id ? <div className="p-8 text-center text-slate-500">Select a staff member.</div> : <>
            <div className="grid gap-3 md:grid-cols-2">
              <Info label="Staff" value={selected.staff_name} />
              <Info label="Last login" value={selected.last_login_at ? new Date(selected.last_login_at).toLocaleString("en-GB") : "Not available"} />
              <label className="text-sm font-bold">Username<input disabled={protectedMaster} value={selected.username || ""} onChange={(e) => setField("username", e.target.value)} className="mt-1 w-full rounded-xl border p-2 font-normal" /></label>
              <label className="text-sm font-bold">Role<select disabled={protectedMaster} value={selected.role || "Admin"} onChange={(e) => setField("role", e.target.value)} className="mt-1 w-full rounded-xl border p-2 font-normal">{STAFF_ROLES.map((role) => <option key={role} disabled={role === "Super Admin" && !isMasterAdmin(currentUser)}>{role}</option>)}</select></label>
              <Toggle label="Staff active" checked={selected.staff_active !== false} disabled={protectedMaster} onChange={(v) => setField("staff_active", v)} />
              <Toggle label="Login enabled" checked={selected.login_enabled !== false} disabled={protectedMaster} onChange={(v) => setField("login_enabled", v)} />
            </div>
            {!protectedMaster && <label className="mt-4 block max-w-md text-sm font-bold">Set new password<input type="password" autoComplete="new-password" value={selected.new_password || ""} onChange={(e) => setField("new_password", e.target.value)} placeholder={selected.login_id ? "Leave blank to keep current password" : "Minimum 8 characters"} className="mt-1 w-full rounded-xl border p-2 font-normal" /></label>}
            {protectedMaster && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-900">Nisstaj_admin is protected and cannot be disabled or offboarded here.</div>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" disabled={protectedMaster || saving} onClick={save} className="rounded-xl bg-green-700 px-5 py-3 font-bold text-white disabled:bg-slate-300">{saving ? "Saving..." : selected.login_id ? "Update Login" : "Create Login"}</button>
              <button type="button" onClick={() => onOpenAccessControl(selected.staff_id)} className="rounded-xl border border-blue-700 px-5 py-3 font-bold text-blue-700">Access Control</button>
              <button type="button" disabled={protectedMaster} onClick={offboard} className="rounded-xl border border-red-700 px-5 py-3 font-bold text-red-700 disabled:border-slate-300 disabled:text-slate-300">Offboard Staff</button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Existing passwords are never displayed. Entering a new password changes it only after Save.</p>
          </>}
        </main>
      </div>
    </div>
  );
}

function Info({ label, value }) { return <div><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-bold text-slate-950">{value || "-"}</div></div>; }
function Toggle({ label, checked, disabled, onChange }) { return <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />{label}</label>; }
