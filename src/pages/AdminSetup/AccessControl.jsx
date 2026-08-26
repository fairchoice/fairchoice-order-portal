import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { getFcSessionState, readStoredFcProfile } from "../../services/fcSession";
import {
  ALL_REGISTERED_PERMISSION_KEYS,
  MASTER_ADMIN_USERNAME,
  PAGE_ACCESS_SECTIONS,
  STAFF_ROLES,
  getRoleDefaultPermissionKeys,
  groupImportantFunctionPermissions,
  isMasterAdmin,
} from "../../security/accessControlRegistry";

const emptySelection = {
  staff_id: "",
  login_id: "",
  staff_name: "",
  username: "",
  role: "Admin",
  staff_active: true,
  login_enabled: true,
  last_login_at: null,
  permission_keys: [],
  new_password: "",
  brand_access: "",
};

const flattenItems = (items = []) => items.flatMap((item) => item.children || [item]);

const BRAND_REPORT_OPTIONS = [
  { value: "", label: "No brand report" },
  { value: "Lost Mary", label: "Lost Mary" },
  { value: "IVG", label: "IVG (future)" },
  { value: "OTHER", label: "Other / future brand" },
];

export default function AccessControl({ initialStaffId = "" }) {
  const currentUser = useMemo(() => readStoredFcProfile(), []);
  const session = useMemo(() => getFcSessionState(currentUser), [currentUser]);
  const [staff, setStaff] = useState([]);
  const [selected, setSelected] = useState(emptySelection);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(session.valid);
  const [saving, setSaving] = useState(false);
  const [brandTeam, setBrandTeam] = useState([]);
  const [brandTeamLoading, setBrandTeamLoading] = useState(false);
  const [error, setError] = useState(session.valid ? "" : "Your secure staff session has expired. Sign in again.");

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: rpcError } = await supabase.rpc("fc_access_control_snapshot_v1", {
      p_username: session.username,
      p_session_token: session.token,
    });
    setLoading(false);
    if (rpcError) {
      setError(rpcError.message || "Access Control could not be loaded.");
      return;
    }
    const rows = Array.isArray(data?.staff) ? data.staff : [];
    setStaff(rows);
    setSelected((current) => {
      const selectedStaffId = current.staff_id || initialStaffId;
      if (!selectedStaffId) return current;
      const refreshed = rows.find((row) => row.staff_id === selectedStaffId);
      return refreshed ? { ...emptySelection, ...refreshed } : current;
    });
  }, [initialStaffId, session.token, session.username]);

  useEffect(() => {
    if (!session.valid) return undefined;
    const timer = window.setTimeout(() => void loadAccess(), 0);
    return () => window.clearTimeout(timer);
  }, [loadAccess, session.valid]);

  const filteredStaff = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return staff.filter((row) => {
      const matchesSearch = !needle || `${row.staff_name || ""} ${row.username || ""}`.toLowerCase().includes(needle);
      const matchesRole = !roleFilter || row.role === roleFilter;
      const status = row.staff_active !== false && row.login_enabled !== false ? "active" : "inactive";
      return matchesSearch && matchesRole && (!statusFilter || status === statusFilter);
    });
  }, [roleFilter, search, staff, statusFilter]);

  const selectedKeys = useMemo(() => new Set(selected.permission_keys || []), [selected.permission_keys]);
  const protectedMaster = String(selected.username || "").trim().toLowerCase() === MASTER_ADMIN_USERNAME;

  const chooseStaff = (row) => setSelected({ ...emptySelection, ...row, permission_keys: [...(row.permission_keys || [])] });
  const updateSelected = (field, value) => setSelected((current) => ({ ...current, [field]: value }));

  const togglePermission = (key) => {
    if (protectedMaster) return;
    setSelected((current) => ({
      ...current,
      permission_keys: current.permission_keys.includes(key)
        ? current.permission_keys.filter((item) => item !== key)
        : [...current.permission_keys, key],
    }));
  };

  const applyRoleDefaults = () => {
    if (protectedMaster) return;
    const defaults = getRoleDefaultPermissionKeys(selected.role);
    if (!window.confirm(`Replace this staff member's individual permissions with the ${selected.role} role defaults?`)) return;
    updateSelected("permission_keys", defaults);
  };

  const selectAll = () => {
    if (protectedMaster || !window.confirm("Grant every registered page and important function permission to this staff member?")) return;
    updateSelected("permission_keys", [...ALL_REGISTERED_PERMISSION_KEYS]);
  };

  const clearOptional = () => {
    if (protectedMaster || !window.confirm("Clear optional permissions and keep only this role's defaults?")) return;
    updateSelected("permission_keys", getRoleDefaultPermissionKeys(selected.role));
  };

  const save = async () => {
    if (!selected.staff_id || protectedMaster || saving) return;
    if (!window.confirm(`Save page and important-function access for ${selected.staff_name || selected.username}?`)) return;
    setSaving(true);
    setError("");
    const { error: rpcError } = await supabase.rpc("fc_save_staff_permissions_v1", {
      p_username: session.username,
      p_session_token: session.token,
      p_target_staff_id: selected.staff_id,
      p_permission_keys: selected.permission_keys,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message || "Access changes could not be saved.");
      return;
    }
    if (selected.role === "Brand Partner") {
      const { error: brandError } = await supabase.rpc("fc_save_brand_partner_access_v1", {
        p_username: session.username,
        p_session_token: session.token,
        p_target_staff_id: selected.staff_id,
        p_brand: selected.brand_access || null,
      });
      if (brandError && !String(brandError.message || "").toLowerCase().includes("could not find the function")) {
        setError(brandError.message || "Brand report access could not be saved.");
        return;
      }
      if (selected.brand_access && selected.brand_access !== "OTHER") {
        const { error: teamError } = await supabase.rpc("fc_save_brand_partner_staff_assignments_v1", {
          p_username: session.username,
          p_session_token: session.token,
          p_brand: selected.brand_access,
          p_staff_ids: brandTeam.filter((row) => row.assigned).map((row) => row.staff_id),
        });
        if (teamError) {
          setError(teamError.message || "Brand team assignments could not be saved.");
          return;
        }
      }
    }
    await loadAccess();
    alert("Access Control saved. The staff member will receive the new access on their next login.");
  };

  const loadBrandTeam = useCallback(async (brand) => {
    const cleanBrand = String(brand || "").trim();
    if (!session.valid || !cleanBrand || cleanBrand === "OTHER") {
      setBrandTeam([]);
      return;
    }
    setBrandTeamLoading(true);
    const { data, error: teamError } = await supabase.rpc("fc_brand_partner_staff_snapshot_v1", {
      p_username: session.username,
      p_session_token: session.token,
      p_brand: cleanBrand,
    });
    setBrandTeamLoading(false);
    if (teamError) {
      setError(teamError.message || "Brand team could not be loaded.");
      return;
    }
    setBrandTeam(Array.isArray(data?.staff) ? data.staff : []);
  }, [session.token, session.username, session.valid]);

  useEffect(() => {
    if (selected.role !== "Brand Partner") {
      setBrandTeam([]);
      return;
    }
    void loadBrandTeam(selected.brand_access);
  }, [loadBrandTeam, selected.brand_access, selected.role, selected.staff_id]);

  const toggleBrandTeamMember = (staffId) => {
    setBrandTeam((rows) => rows.map((row) => row.staff_id === staffId ? { ...row, assigned: !row.assigned } : row));
  };

  const functionGroups = groupImportantFunctionPermissions();

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mb-4">
        <h2 className="text-2xl font-extrabold text-slate-950">Access Control</h2>
        <p className="text-sm text-slate-600">Page access and important business functions are granted separately.</p>
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 font-semibold text-red-800">{error}</div>}
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <aside className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="grid gap-2">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff or username" className="rounded-xl border p-3" />
            <div className="grid grid-cols-2 gap-2">
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-xl border p-3"><option value="">All roles</option>{STAFF_ROLES.map((role) => <option key={role}>{role}</option>)}</select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border p-3"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            </div>
          </div>
          <div className="mt-3 max-h-[65vh] space-y-2 overflow-y-auto">
            {loading && <div className="p-3 text-sm text-slate-500">Loading staff access...</div>}
            {!loading && filteredStaff.map((row) => (
              <button key={row.staff_id} type="button" onClick={() => chooseStaff(row)} className={`w-full rounded-xl border p-3 text-left ${selected.staff_id === row.staff_id ? "border-blue-600 bg-blue-50" : "border-slate-200 hover:bg-slate-50"}`}>
                <div className="font-bold text-slate-950">{row.staff_name || "Unnamed staff"}</div>
                <div className="text-xs text-slate-600">{row.username || "Login not configured"} · {row.role || "Staff"}</div>
              </button>
            ))}
          </div>
        </aside>

        <main className="rounded-2xl border bg-white p-4 shadow-sm">
          {!selected.staff_id ? <div className="p-8 text-center text-slate-500">Select a staff member to review access.</div> : (
            <>
              <div className="grid gap-3 border-b pb-4 md:grid-cols-3">
                <Info label="Staff" value={selected.staff_name} />
                <Info label="Username" value={selected.username || "Login not configured"} />
                <Info label="Role" value={selected.role || "-"} />
              </div>
              <div className="mt-2 text-xs text-slate-500">Login and onboarding details are managed separately under Login → Staff Login.</div>
              {selected.role === "Brand Partner" && (
                <div className="my-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <label className="block text-sm font-extrabold text-slate-900">Brand Report Access</label>
                  <p className="mb-2 text-xs text-slate-600">Choose the single brand this partner can view. Brand Partner access is read-only.</p>
                  <select
                    value={selected.brand_access || ""}
                    disabled={protectedMaster}
                    onChange={(event) => updateSelected("brand_access", event.target.value)}
                    className="w-full max-w-md rounded-xl border border-indigo-300 bg-white p-3"
                  >
                    {BRAND_REPORT_OPTIONS.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}
                  </select>
                  {selected.brand_access && <div className="mt-2 text-xs font-bold text-indigo-800">Only {selected.brand_access === "OTHER" ? "the assigned future brand" : selected.brand_access} Brand Performance will be visible.</div>}
                  {selected.brand_access && selected.brand_access !== "OTHER" && (
                    <div className="mt-4 border-t border-indigo-200 pt-4">
                      <div className="text-sm font-extrabold text-slate-900">Assigned FairChoice Team</div>
                      <p className="mb-2 text-xs text-slate-600">Select the staff whose brand activity should be attributed to {selected.brand_access}. Brand Performance totals still include all {selected.brand_access} product activity.</p>
                      {brandTeamLoading ? <div className="text-sm text-slate-500">Loading staff...</div> : (
                        <div className="grid max-h-56 gap-2 overflow-y-auto md:grid-cols-2">
                          {brandTeam.map((row) => (
                            <label key={row.staff_id} className="flex items-center gap-2 rounded-lg border bg-white p-2">
                              <input type="checkbox" checked={Boolean(row.assigned)} onChange={() => toggleBrandTeamMember(row.staff_id)} />
                              <span><span className="block text-sm font-bold">{row.staff_name}</span><span className="block text-xs text-slate-500">{row.username || row.role} · {row.role}</span></span>
                            </label>
                          ))}
                          {!brandTeam.length && <div className="text-sm text-slate-500">No active staff available.</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {protectedMaster && <div className="my-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-900">Nisstaj_admin is the protected master Admin. Every current and future registered permission is granted automatically.</div>}
              <div className="my-4 flex flex-wrap gap-2">
                <button type="button" disabled={protectedMaster} onClick={applyRoleDefaults} className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:bg-slate-300">Apply Role Defaults</button>
                <button type="button" disabled={protectedMaster || !isMasterAdmin(currentUser)} onClick={selectAll} className="rounded-xl border px-4 py-2 font-bold disabled:text-slate-300">Select All</button>
                <button type="button" disabled={protectedMaster} onClick={clearOptional} className="rounded-xl border px-4 py-2 font-bold disabled:text-slate-300">Clear Optional</button>
              </div>
              <PermissionArea title="PAGE ACCESS" description="Controls navigation and direct page access.">
                {PAGE_ACCESS_SECTIONS.map((section) => <PermissionGroup key={section.title} title={section.title} items={flattenItems(section.items)} selectedKeys={selectedKeys} disabled={protectedMaster} onToggle={togglePermission} />)}
              </PermissionArea>
              <PermissionArea title="IMPORTANT FUNCTION ACCESS" description="Controls sensitive amount, status, stock, financial and administrative actions.">
                {Object.entries(functionGroups).map(([title, items]) => <PermissionGroup key={title} title={title} items={items} selectedKeys={selectedKeys} disabled={protectedMaster} onToggle={togglePermission} />)}
              </PermissionArea>
              <div className="sticky bottom-0 mt-4 flex justify-end border-t bg-white py-4"><button type="button" disabled={protectedMaster || saving} onClick={save} className="rounded-xl bg-green-700 px-6 py-3 font-extrabold text-white disabled:bg-slate-300">{saving ? "Saving..." : "Save Access Control"}</button></div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Info({ label, value }) { return <div><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className="mt-1 font-bold text-slate-950">{value || "-"}</div></div>; }
function PermissionArea({ title, description, children }) { return <section className="mt-5"><h3 className="text-lg font-extrabold text-slate-950">{title}</h3><p className="mb-3 text-sm text-slate-600">{description}</p><div className="space-y-2">{children}</div></section>; }
function PermissionGroup({ title, items, selectedKeys, disabled, onToggle }) { return <details className="rounded-xl border" open={title === "Order" || title === "Orders"}><summary className="cursor-pointer p-3 font-bold">{title}</summary><div className="grid gap-2 border-t p-3 md:grid-cols-2">{items.map((item) => <label key={item.key} className="flex items-start gap-2 rounded-lg p-2 hover:bg-slate-50"><input type="checkbox" className="mt-1" checked={disabled || selectedKeys.has(item.key)} disabled={disabled} onChange={() => onToggle(item.key)} /><span><span className="block text-sm font-semibold">{item.label}</span><span className="block font-mono text-[11px] text-slate-500">{item.key}</span></span></label>)}</div></details>; }
