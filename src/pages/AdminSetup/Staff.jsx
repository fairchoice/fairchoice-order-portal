import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { MASTER_ADMIN_USERNAME, STAFF_ROLES, canPerform } from "../../security/accessControlRegistry";

const emptyStaffForm = {
  first_name: "",
  middle_name: "",
  last_name: "",
  staff_name: "",
  username: "",
  email: "",
  mobile: "",
  telephone: "",
  address: "",
  onboard_date: "",
  active: true,
  emergency_contact: "",
  next_of_kin: "",
  job_position: "",
  job_role: "",
  job_access: "",
  portal_access: "",
  notes: "",
};

function buildDisplayName(form) {
  return [form.first_name, form.middle_name, form.last_name]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export default function Staff({ currentUser, onOpenAccessControl = () => {} }) {
  const [staff, setStaff] = useState([]);
  const [loginUsers, setLoginUsers] = useState([]);
  const [form, setForm] = useState(emptyStaffForm);
  const [showModal, setShowModal] = useState(false);
  const [activeTab, setActiveTab] = useState("personal");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState(null);
  const [roleError, setRoleError] = useState("");
  const canManageStaff = canPerform(currentUser, "staff.manage");
  const canOpenAccessControl = canPerform(currentUser, "page.login.access_control");

  useEffect(() => {
    fetchStaff();
  }, []);

  async function fetchStaff() {
    const [staffResult, loginResult] = await Promise.all([
      supabase.from("staff_users").select("*").order("staff_name"),
      supabase.from("login_users").select("id, staff_id, username, role, active").neq("role", "Customer"),
    ]);

    if (staffResult.error || loginResult.error) {
      alert(staffResult.error?.message || loginResult.error?.message);
      return;
    }

    setStaff(staffResult.data || []);
    setLoginUsers(loginResult.data || []);
  }

  const filteredStaff = useMemo(() => {
    const searchText = search.trim().toLowerCase();
    return staff.filter((row) => {
      const login = loginUsers.find((item) => String(item.staff_id) === String(row.id));
      const role = login?.role || row.role || row.job_role || "";
      const matchesSearch = !searchText || `${row.staff_name || ""} ${login?.username || row.username || ""} ${row.email || ""} ${role}`.toLowerCase().includes(searchText);
      const matchesRole = !roleFilter || role === roleFilter;
      const status = row.active !== false && login?.active !== false ? "active" : "inactive";
      return matchesSearch && matchesRole && (!statusFilter || status === statusFilter);
    });
  }, [loginUsers, roleFilter, search, staff, statusFilter]);

  function updateField(field, value) {
    if (field === "job_role" && value.trim()) {
      setRoleError("");
    }

    setForm((current) => {
      const next = { ...current, [field]: value };

      if (["first_name", "middle_name", "last_name"].includes(field)) {
        next.staff_name = buildDisplayName(next);
      }

      return next;
    });
  }

  function openNewStaffModal() {
    if (!canManageStaff) return;
    setEditingStaffId(null);
    setForm(emptyStaffForm);
    setRoleError("");
    setActiveTab("personal");
    setShowModal(true);
  }

  function openEditStaffModal(row) {
    if (!canManageStaff) return;
    setEditingStaffId(row.id);
    setRoleError("");
    setForm({
      first_name: row.first_name || "",
      middle_name: row.middle_name || "",
      last_name: row.last_name || "",
      staff_name: row.staff_name || "",
      username: row.username || "",
      email: row.email || "",
      mobile: row.mobile || "",
      telephone: row.telephone || "",
      address: row.address || "",
      onboard_date: row.onboard_date || "",
      active: row.active !== false,
      emergency_contact: row.emergency_contact || "",
      next_of_kin: row.next_of_kin || "",
      job_position: row.job_position || "",
      job_role: row.job_role || row.role || "",
      job_access: row.job_access || "",
      portal_access: row.portal_access || "",
      notes: row.notes || "",
    });
    setActiveTab("personal");
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setActiveTab("personal");
    setForm(emptyStaffForm);
    setRoleError("");
    setEditingStaffId(null);
    setSaving(false);
  }

  async function saveStaff(event) {
    event.preventDefault();
    if (!canManageStaff) {
      alert("You do not have permission to change staff records.");
      return;
    }

    const displayName = buildDisplayName(form) || form.staff_name.trim();
    if (!displayName) {
      alert("First name or staff display name is required.");
      return;
    }

    const role = form.job_role.trim();
    if (!role) {
      setRoleError("Role is required.");
      setActiveTab("full");
      return;
    }

    const existingLogin = loginUsers.find((item) => String(item.staff_id) === String(editingStaffId));
    const protectedMaster = String(existingLogin?.username || form.username || "").trim().toLowerCase() === MASTER_ADMIN_USERNAME;
    if (protectedMaster && form.active === false) {
      alert("Nisstaj_admin is the protected master Admin and cannot be deactivated.");
      return;
    }

    setSaving(true);

    const payload = {
      first_name: form.first_name.trim(),
      middle_name: form.middle_name.trim(),
      last_name: form.last_name.trim(),
      staff_name: displayName,
      username: form.username.trim(),
      email: form.email.trim(),
      mobile: form.mobile.trim(),
      telephone: form.telephone.trim(),
      address: form.address.trim(),
      onboard_date: form.onboard_date || null,
      active: form.active,
      emergency_contact: form.emergency_contact.trim(),
      next_of_kin: form.next_of_kin.trim(),
      job_position: form.job_position.trim(),
      role,
      job_role: role,
      job_access: form.job_access.trim(),
      portal_access: form.portal_access.trim(),
      notes: form.notes.trim(),
    };

    let result;

    if (editingStaffId) {
      result = await supabase
        .from("staff_users")
        .update(payload)
        .eq("id", editingStaffId);
    } else {
      result = await supabase.from("staff_users").insert([payload]);
    }

    if (result.error) {
      alert(result.error.message);
      setSaving(false);
      return;
    }

    await fetchStaff();
    closeModal();
  }

  return (
    <div className="p-4 bg-slate-50 min-h-screen">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Staff Setup</h2>
          <p className="text-sm text-slate-600">
            Create, view and manage staff access and contact details.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewStaffModal}
          disabled={!canManageStaff}
          className="rounded-full bg-green-700 px-5 py-3 text-sm font-bold text-white hover:bg-green-800 disabled:bg-slate-300"
        >
          New Staff
        </button>
      </div>

      <div className="mb-4 grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_220px_180px]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          placeholder="Search staff..."
        />
        <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm"><option value="">All roles</option>{STAFF_ROLES.map((role) => <option key={role}>{role}</option>)}</select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-3 text-sm"><option value="">All status</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="p-3 text-left">Staff Name</th>
              <th className="p-3 text-left">Username</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Login</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStaff.length === 0 ? (
              <tr>
                <td className="p-4 text-slate-600" colSpan={6}>
                  No staff found.
                </td>
              </tr>
            ) : (
              filteredStaff.map((row) => {
                const login = loginUsers.find((item) => String(item.staff_id) === String(row.id));
                return <tr key={row.id} className="border-b border-slate-100">
                  <td className="p-3 font-semibold text-slate-900">
                    {row.staff_name || "-"}
                  </td>
                  <td className="p-3">{login?.username || row.username || "-"}</td>
                  <td className="p-3">{login?.role || row.job_role || row.role || "-"}</td>
                  <td className="p-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        row.active === false
                          ? "bg-red-100 text-red-700"
                          : "bg-green-100 text-green-700"
                      }`}
                    >
                      {row.active === false ? "Inactive" : "Active"}
                    </span>
                  </td>
                  <td className="p-3">{login ? (login.active === false ? "Disabled" : "Enabled") : "Not configured"}</td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => openEditStaffModal(row)}
                      disabled={!canManageStaff}
                      className="rounded-lg border border-green-700 px-3 py-2 text-sm font-bold text-green-700 hover:bg-green-50 disabled:border-slate-300 disabled:text-slate-300"
                    >
                      Edit
                    </button>
                    {canOpenAccessControl && <button type="button" onClick={() => onOpenAccessControl(row.id)} className="ml-2 rounded-lg border border-blue-700 px-3 py-2 text-sm font-bold text-blue-700 hover:bg-blue-50">Access Control</button>}
                  </td>
                </tr>;
              })
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close staff form"
            onClick={closeModal}
          />

          <form
            onSubmit={saveStaff}
            className="relative mx-auto flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
          >
            <header className="flex items-center justify-between border-b border-slate-300 px-5 py-4">
              <div>
                <h3 className="text-xl font-extrabold text-slate-950">
                  {editingStaffId ? "Edit staff member" : "Create a new staff member"}
                </h3>
                <p className="text-sm text-slate-600">
                  {form.staff_name || "Staff details"}
                </p>
              </div>
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
              <div className="border-b border-slate-300">
                {[
                  ["personal", "Personal Details"],
                  ["emergency", "Emergency Details"],
                  ["full", "Full Information"],
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
                {activeTab === "personal" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-x-10">
                    <Field
                      label="First Name"
                      value={form.first_name}
                      onChange={(value) => updateField("first_name", value)}
                    />
                    <Field
                      label="Middle Name"
                      value={form.middle_name}
                      onChange={(value) => updateField("middle_name", value)}
                    />
                    <Field
                      label="Last Name"
                      value={form.last_name}
                      onChange={(value) => updateField("last_name", value)}
                    />
                    <Field
                      label="Display Name"
                      value={form.staff_name}
                      onChange={(value) => updateField("staff_name", value)}
                    />
                    <TextAreaField
                      label="Address"
                      value={form.address}
                      onChange={(value) => updateField("address", value)}
                    />
                    <div className="space-y-4">
                      <Field
                        label="Email"
                        value={form.email}
                        onChange={(value) => updateField("email", value)}
                      />
                      <Field
                        label="Mobile"
                        value={form.mobile}
                        onChange={(value) => updateField("mobile", value)}
                      />
                      <Field
                        label="Telephone"
                        value={form.telephone}
                        onChange={(value) => updateField("telephone", value)}
                      />
                      <Field
                        label="On Board Date"
                        type="date"
                        value={form.onboard_date}
                        onChange={(value) => updateField("onboard_date", value)}
                      />
                      <div className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900 sm:grid-cols-[130px_1fr] sm:items-center">
                        <span className="sm:text-right">Status</span>
                        <button
                          type="button"
                          onClick={() => updateField("active", !form.active)}
                          className={`w-fit rounded-full px-4 py-2 text-sm font-bold ${
                            form.active
                              ? "bg-green-700 text-white"
                              : "bg-red-700 text-white"
                          }`}
                        >
                          {form.active ? "Active" : "Inactive"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "emergency" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <TextAreaField
                      label="Emergency Contact"
                      value={form.emergency_contact}
                      onChange={(value) => updateField("emergency_contact", value)}
                    />
                    <TextAreaField
                      label="Next of Kin"
                      value={form.next_of_kin}
                      onChange={(value) => updateField("next_of_kin", value)}
                    />
                  </div>
                )}

                {activeTab === "full" && (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field
                      label="Username"
                      value={form.username}
                      onChange={(value) => updateField("username", value)}
                    />
                    <label className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900 sm:grid-cols-[130px_1fr] sm:items-center">
                      <span className="sm:text-right">Role *</span>
                      <span>
                        <select value={form.job_role} onChange={(event) => updateField("job_role", event.target.value)} required className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
                          <option value="">Select role</option>
                          {form.job_role && !STAFF_ROLES.includes(form.job_role) && <option value={form.job_role}>{form.job_role} (legacy)</option>}
                          {STAFF_ROLES.map((role) => <option key={role}>{role}</option>)}
                        </select>
                        {roleError && <span className="mt-1 block text-xs font-semibold text-red-700">{roleError}</span>}
                      </span>
                    </label>
                    <Field
                      label="Job Access"
                      value={form.job_access}
                      onChange={(value) => updateField("job_access", value)}
                    />
                    <Field
                      label="Portal Access"
                      value={form.portal_access}
                      onChange={(value) => updateField("portal_access", value)}
                    />
                    <Field
                      label="Job Position"
                      value={form.job_position}
                      onChange={(value) => updateField("job_position", value)}
                    />
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Notes Preview
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                        {form.notes || "-"}
                      </p>
                    </div>
                  </div>
                )}

                {activeTab === "notes" && (
                  <div>
                    <textarea
                      value={form.notes}
                      onChange={(event) => updateField("notes", event.target.value)}
                      maxLength={4000}
                      className="h-72 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
                      placeholder="Any additional information about this staff member."
                    />
                    <p className="mt-1 text-right text-xs text-slate-600">
                      You have used {form.notes.length} of 4,000 characters
                    </p>
                  </div>
                )}
              </div>
            </div>

            <footer className="flex justify-end px-5 pb-5">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-green-700 px-6 py-2 text-sm font-bold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required = false, error = "" }) {
  return (
    <label className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900 sm:grid-cols-[130px_1fr] sm:items-center">
      <span className="sm:text-right">
        {label}
        {required ? " *" : ""}
      </span>
      <span>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          aria-invalid={Boolean(error)}
          className={`w-full rounded-xl border px-3 py-3 text-sm font-normal outline-none focus:ring-2 ${
            error
              ? "border-red-600 focus:border-red-600 focus:ring-red-100"
              : "border-slate-300 focus:border-blue-600 focus:ring-blue-100"
          }`}
        />
        {error && <span className="mt-1 block text-xs font-semibold text-red-700">{error}</span>}
      </span>
    </label>
  );
}

function TextAreaField({ label, value, onChange }) {
  return (
    <label className="grid grid-cols-1 gap-2 text-sm font-bold text-slate-900">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-32 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
