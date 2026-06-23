import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { logAction } from "../../utils/auditLog";

const ACCESS_LEVELS = ["Super Admin", "Admin", "Staff"];
const TABS = [
  "Search Staff",
  "Existing Login",
  "Login Setup",
  "Staff Access Default",
  "Customer Login Setup",
];
const PAGE_SIZE = 5;
const CUSTOMER_PORTAL_PERMISSIONS = { access_customer_portal: true };

const PERMISSION_GROUPS = [
  {
    title: "Page Access",
    permissions: [
      ["access_received_orders", "Received Orders"],
      ["access_warehouse", "Warehouse"],
      ["access_driver", "Driver"],
      ["access_sales_rep", "Sales Rep"],
      ["access_customer_portal", "Customer Portal"],
      ["access_customer_setup", "Customer Setup"],
      ["access_product_setup", "Product Setup"],
      ["access_accounts", "Accounts"],
      ["access_reports", "Reports"],
    ],
  },
  {
    title: "Order / Operation Permissions",
    permissions: [
      ["can_receive_order", "Receive Order"],
      ["can_change_order_status_in_progress", "Change Order Status To In Progress"],
      ["can_add_product_to_order", "Add Product To Order"],
      ["can_move_to_warehouse", "Move To Warehouse"],
      ["can_print", "Print"],
      ["can_cancel_order", "Cancel Order"],
      ["can_archive_order", "Archive Order"],
    ],
  },
];

const STAFF_SUMMARY_KEYS = [
  ["access_received_orders", "Received Orders"],
  ["access_warehouse", "Warehouse"],
  ["access_driver", "Driver"],
  ["access_sales_rep", "Sales Rep"],
  ["access_customer_setup", "Customer Setup"],
  ["access_product_setup", "Product Setup"],
  ["access_accounts", "Accounts"],
  ["access_reports", "Reports"],
  ["can_receive_order", "Can Receive Order"],
  ["can_add_product_to_order", "Can Add Product"],
  ["can_move_to_warehouse", "Can Move To Warehouse"],
  ["can_print", "Can Print"],
  ["can_cancel_order", "Can Cancel Order"],
  ["can_archive_order", "Can Archive Order"],
];

const ALL_PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map(([key]) => key)
);

const EMPTY_PERMISSIONS = Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, false]));
const ALL_PERMISSIONS = Object.fromEntries(ALL_PERMISSION_KEYS.map((key) => [key, true]));

const DEFAULT_PERMISSIONS = {
  "Super Admin": ALL_PERMISSIONS,
  Admin: ALL_PERMISSIONS,
  Warehouse: {
    access_received_orders: true,
    access_warehouse: true,
    can_receive_order: true,
    can_change_order_status_in_progress: true,
    can_add_product_to_order: true,
    can_move_to_warehouse: true,
    can_print: true,
    can_cancel_order: false,
    can_archive_order: false,
  },
  "Sales Rep": {
    access_sales_rep: true,
  },
  Driver: {
    access_driver: true,
  },
  Customer: CUSTOMER_PORTAL_PERMISSIONS,
};

const emptyLoginForm = {
  id: null,
  staff_id: "",
  username: "",
  password: "",
  role: "Staff",
  customer_account_id: "",
  active: true,
  permissions: {
    ...EMPTY_PERMISSIONS,
    ...DEFAULT_PERMISSIONS.Warehouse,
  },
};

const emptyCustomerLoginForm = {
  id: null,
  customer_account_id: "",
  username: "",
  password: "",
  active: true,
};

function getDefaultPermissions(role) {
  if (role === "Super Admin" || role === "Admin") {
    return { ...ALL_PERMISSIONS };
  }

  if (role === "Customer") {
    return { ...CUSTOMER_PORTAL_PERMISSIONS };
  }

  return {
    ...EMPTY_PERMISSIONS,
    ...DEFAULT_PERMISSIONS.Warehouse,
  };
}

function normalizeAccessLevel(role) {
  if (["Super Admin", "Admin", "Customer", "Staff"].includes(role)) return role;
  return "Staff";
}

function normalizePermissions(role, permissions = {}) {
  if (role === "Super Admin") return { ...ALL_PERMISSIONS };
  if (role === "Customer") return { ...CUSTOMER_PORTAL_PERMISSIONS };

  return {
    ...EMPTY_PERMISSIONS,
    ...permissions,
  };
}

function getDisplayStaffName(staff) {
  return staff?.staff_name || "Unnamed Staff";
}

function getCustomerName(customer) {
  return customer?.account_name || `Customer ${customer?.id || ""}`;
}

function getPermissionSummary(permissions = {}) {
  const labels = [];

  if (permissions.access_warehouse) labels.push("Warehouse");
  if (permissions.access_sales_rep) labels.push("Sales Rep");
  if (permissions.access_driver) labels.push("Driver");
  if (permissions.access_received_orders) labels.push("Received Orders");
  if (permissions.access_accounts) labels.push("Accounts");
  if (permissions.access_reports) labels.push("Reports");
  if (permissions.access_product_setup) labels.push("Product Setup");
  if (permissions.access_customer_setup) labels.push("Customer Setup");
  if (permissions.access_customer_portal) labels.push("Customer Portal");

  return labels.length ? labels.join(", ") : "No access";
}

function permissionsChanged(oldPermissions = {}, newPermissions = {}) {
  return ALL_PERMISSION_KEYS.some((key) => {
    const oldEnabled = oldPermissions?.[key] === true;
    const newEnabled = newPermissions?.[key] === true;
    return oldEnabled !== newEnabled;
  });
}

export default function LoginConfig() {
  const currentUser = JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );
  const currentIsSuperAdmin =
    currentUser?.role === "Super Admin" || currentUser?.access_level === "Super Admin";
  const [activeTab, setActiveTab] = useState("Search Staff");
  const [staffUsers, setStaffUsers] = useState([]);
  const [loginUsers, setLoginUsers] = useState([]);
  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [staffSearchTerm, setStaffSearchTerm] = useState("");
  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [existingLoginSearchTerm, setExistingLoginSearchTerm] = useState("");
  const [loginForm, setLoginForm] = useState(emptyLoginForm);
  const [customerLoginForm, setCustomerLoginForm] = useState(emptyCustomerLoginForm);
  const [loading, setLoading] = useState(false);
  const [savingLogin, setSavingLogin] = useState(false);
  const [savingCustomerLogin, setSavingCustomerLogin] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const isSuperAdmin = loginForm.role === "Super Admin";
  const isStaff = loginForm.role === "Staff";
  const isCustomer = loginForm.role === "Customer";
  const permissionsLocked = isSuperAdmin || isCustomer;

  const activeStaffUsers = useMemo(
    () => staffUsers.filter((staff) => staff.active !== false),
    [staffUsers]
  );

  const filteredStaffUsers = useMemo(() => {
    const search = staffSearchTerm.trim().toLowerCase();
    const source = activeTab === "Search Staff" ? staffUsers : activeStaffUsers;
    if (!search) return source;

    return source.filter((staff) =>
      [staff.staff_name, staff.email, staff.phone].some((value) =>
        String(value || "").toLowerCase().includes(search)
      )
    );
  }, [activeStaffUsers, activeTab, staffSearchTerm, staffUsers]);

  const filteredCustomerAccounts = useMemo(() => {
    const search = customerSearchTerm.trim().toLowerCase();
    if (!search) return customerAccounts;

    return customerAccounts.filter((customer) =>
      String(customer.account_name || "").toLowerCase().includes(search)
    );
  }, [customerAccounts, customerSearchTerm]);

  const filteredLoginUsers = useMemo(() => {
    const search = existingLoginSearchTerm.trim().toLowerCase();
    if (!search) return loginUsers;

    return loginUsers.filter((loginUser) => {
      const staff = staffUsers.find((item) => String(item.id) === String(loginUser.staff_id));
      const customer = customerAccounts.find(
        (item) => String(item.id) === String(loginUser.customer_account_id)
      );
      const statusText = loginUser.active !== false ? "active" : "inactive";

      return [
        loginUser.username,
        loginUser.role,
        staff?.staff_name,
        customer?.account_name,
        statusText,
      ].some((value) => String(value || "").toLowerCase().includes(search));
    });
  }, [customerAccounts, existingLoginSearchTerm, loginUsers, staffUsers]);

  const pagedLoginUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLoginUsers.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredLoginUsers]);

  const totalPages = Math.max(1, Math.ceil(filteredLoginUsers.length / PAGE_SIZE));
  const selectedStaff = staffUsers.find((staff) => String(staff.id) === String(selectedStaffId));
  const selectedStaffLogin = loginUsers.find(
    (loginUser) => String(loginUser.staff_id) === String(selectedStaffId)
  );
  const selectedStaffPermissions = selectedStaffLogin
    ? normalizePermissions(normalizeAccessLevel(selectedStaffLogin.role), selectedStaffLogin.permissions)
    : {};
  const selectedCustomer = customerAccounts.find(
    (customer) => String(customer.id) === String(customerLoginForm.customer_account_id)
  );
  const selectedCustomerInactive = selectedCustomer?.active === false;

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  useEffect(() => {
    setCurrentPage(1);
  }, [existingLoginSearchTerm]);

  async function loadData() {
    setLoading(true);

    const [staffResult, loginResult, customerResult] = await Promise.all([
      supabase.from("staff_users").select("id, staff_name, active, email, phone").order("staff_name"),
      supabase.from("login_users").select("*").order("username"),
      supabase.from("customer_accounts").select("id, account_name, active").order("account_name"),
    ]);

    setLoading(false);

    if (staffResult.error) {
      alert(staffResult.error.message);
      return;
    }

    if (loginResult.error) {
      alert(loginResult.error.message);
      return;
    }

    if (customerResult.error) {
      alert(customerResult.error.message);
      return;
    }

    setStaffUsers(staffResult.data || []);
    setLoginUsers(loginResult.data || []);
    setCustomerAccounts(customerResult.data || []);
  }

  function updateLoginField(field, value) {
    setLoginForm((old) => {
      const next = {
        ...old,
        [field]: value,
      };

      if (field === "role") {
        next.permissions = getDefaultPermissions(value);

        if (value === "Customer") {
          next.staff_id = "";
        } else {
          next.customer_account_id = "";
        }

        if (value === "Super Admin" || value === "Admin") {
          next.staff_id = "";
          next.customer_account_id = "";
        }
      }

      return next;
    });
  }

  function selectSetupStaff(staffId) {
    setLoginForm((old) => ({
      ...old,
      staff_id: staffId,
      role: "Staff",
      customer_account_id: "",
    }));
  }

  function togglePermission(permissionKey, checked) {
    if (isSuperAdmin) return;
    if (isCustomer && permissionKey !== "access_customer_portal") return;

    setLoginForm((old) => ({
      ...old,
      permissions: normalizePermissions(old.role, {
        ...old.permissions,
        [permissionKey]: checked,
      }),
    }));
  }

  function applyStaffDefault(roleName) {
    if (roleName === "Customer") {
      setActiveTab("Customer Login Setup");
      return;
    }

    setLoginForm((old) => ({
      ...old,
      role: roleName === "Admin" || roleName === "Super Admin" ? roleName : "Staff",
      customer_account_id: "",
      staff_id: roleName === "Admin" || roleName === "Super Admin" ? "" : old.staff_id,
      permissions: normalizePermissions(roleName, DEFAULT_PERMISSIONS[roleName] || {}),
    }));
    setActiveTab("Login Setup");
  }

  function editLogin(loginUser) {
    if (loginUser.role === "Customer") {
      selectCustomerLogin(loginUser.customer_account_id);
      setActiveTab("Customer Login Setup");
      return;
    }

    const role = normalizeAccessLevel(loginUser.role);
    const legacyDefaultPermissions =
      role === "Staff" && loginUser.role !== "Staff"
        ? DEFAULT_PERMISSIONS[loginUser.role] || {}
        : {};

    setLoginForm({
      id: loginUser.id,
      staff_id: loginUser.staff_id || "",
      username: loginUser.username || "",
      password: loginUser.password || "",
      role,
      customer_account_id: loginUser.customer_account_id || "",
      active: loginUser.active !== false,
      permissions: normalizePermissions(role, {
        ...legacyDefaultPermissions,
        ...(loginUser.permissions || {}),
      }),
    });
    setCurrentPage(1);
    setActiveTab("Login Setup");
  }

  function resetLoginForm() {
    setLoginForm({
      ...emptyLoginForm,
      permissions: { ...emptyLoginForm.permissions },
    });
    setCurrentPage(1);
  }

  function validateLoginForm() {
    const username = loginForm.username.trim().toLowerCase();
    const password = loginForm.password.trim();

    if (loginForm.role === "Super Admin" && !currentIsSuperAdmin) {
      alert("Only Super Admin can create or update Super Admin access.");
      return null;
    }

    if (!username || !password) {
      alert("Username and password are required.");
      return null;
    }

    if (isCustomer && !loginForm.customer_account_id) {
      alert("Customer login must be linked to a customer account.");
      return null;
    }

    if (isStaff) {
      if (!loginForm.staff_id) {
        alert("Staff login must be linked to an active staff record.");
        return null;
      }

      const staff = activeStaffUsers.find((item) => String(item.id) === String(loginForm.staff_id));

      if (!staff) {
        alert("Staff login must be linked to an active staff record.");
        return null;
      }
    }

    return {
      username,
      password,
      role: loginForm.role,
      staff_id: isStaff ? loginForm.staff_id : null,
      customer_account_id: isCustomer ? loginForm.customer_account_id : null,
      active: loginForm.active,
      permissions: normalizePermissions(loginForm.role, loginForm.permissions),
    };
  }

  async function logSecurityAction(actionType, oldValue, newValue) {
    await logAction({
      user: currentUser,
      action_type: actionType,
      page_module: "Login Setup",
      old_value: oldValue,
      new_value: newValue,
    });
  }

  async function saveLogin() {
    const payload = validateLoginForm();
    if (!payload) return;

    const existingLogin = loginForm.id
      ? loginUsers.find((user) => String(user.id) === String(loginForm.id))
      : null;
    const oldPermissions = normalizePermissions(
      normalizeAccessLevel(existingLogin?.role),
      existingLogin?.permissions || {}
    );

    setSavingLogin(true);

    const result = loginForm.id
      ? await supabase.from("login_users").update(payload).eq("id", loginForm.id).select().single()
      : await supabase.from("login_users").insert([payload]).select().single();

    setSavingLogin(false);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    const savedLogin = result.data || { ...payload, id: loginForm.id };
    const actionSnapshot = {
      user_id: savedLogin.id,
      username: payload.username,
      staff_id: payload.staff_id,
      customer_account_id: payload.customer_account_id,
      role_access_level: payload.role,
      active: payload.active,
      permissions: payload.permissions,
    };

    if (existingLogin) {
      await logSecurityAction("update login", {
        user_id: existingLogin.id,
        username: existingLogin.username,
        staff_id: existingLogin.staff_id,
        customer_account_id: existingLogin.customer_account_id,
        role_access_level: existingLogin.role,
        active: existingLogin.active !== false,
        permissions: oldPermissions,
      }, actionSnapshot);

      if ((existingLogin.active !== false) !== payload.active) {
        await logSecurityAction("change active/inactive", existingLogin.active !== false, payload.active);
      }

      if (existingLogin.role !== payload.role) {
        await logSecurityAction("change role/access level", existingLogin.role, payload.role);
      }

      if (permissionsChanged(oldPermissions, payload.permissions)) {
        await logSecurityAction("change permissions", oldPermissions, payload.permissions);
      }
    } else {
      await logSecurityAction("create login", null, actionSnapshot);
    }

    await loadData();
    alert(loginForm.id ? "Login updated." : "Login created.");
    resetLoginForm();
  }

  function selectCustomerLogin(customerId) {
    const customer = customerAccounts.find((item) => String(item.id) === String(customerId));
    const existingLogin = loginUsers.find(
      (user) => user.role === "Customer" && String(user.customer_account_id) === String(customerId)
    );

    setCustomerLoginForm({
      id: existingLogin?.id || null,
      customer_account_id: customerId,
      username: existingLogin?.username || "",
      password: existingLogin?.password || "",
      active: customer?.active === false ? false : existingLogin?.active !== false,
    });
  }

  function updateCustomerLoginField(field, value) {
    setCustomerLoginForm((old) => ({
      ...old,
      [field]: field === "active" && selectedCustomerInactive ? false : value,
    }));
  }

  function validateCustomerLoginForm() {
    const username = customerLoginForm.username.trim().toLowerCase();
    const password = customerLoginForm.password.trim();

    if (!customerLoginForm.customer_account_id) {
      alert("Customer account is required.");
      return null;
    }

    if (selectedCustomerInactive) {
      alert("Customer is inactive. Login cannot be used until customer is active.");
      return null;
    }

    if (!username || !password) {
      alert("Username and password are required.");
      return null;
    }

    return {
      staff_id: null,
      username,
      password,
      role: "Customer",
      customer_account_id: customerLoginForm.customer_account_id,
      active: customerLoginForm.active,
      permissions: { ...CUSTOMER_PORTAL_PERMISSIONS },
    };
  }

  async function saveCustomerLogin() {
    const payload = validateCustomerLoginForm();
    if (!payload) return;

    const existingLogin = customerLoginForm.id
      ? loginUsers.find((user) => String(user.id) === String(customerLoginForm.id))
      : null;

    setSavingCustomerLogin(true);

    const result = customerLoginForm.id
      ? await supabase.from("login_users").update(payload).eq("id", customerLoginForm.id).select().single()
      : await supabase.from("login_users").insert([payload]).select().single();

    setSavingCustomerLogin(false);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    const savedLogin = result.data || { ...payload, id: customerLoginForm.id };
    await logSecurityAction(customerLoginForm.id ? "UPDATE_CUSTOMER_LOGIN" : "CREATE_CUSTOMER_LOGIN", existingLogin, {
      user_id: savedLogin.id,
      username: payload.username,
      customer_account_id: payload.customer_account_id,
      role_access_level: "Customer",
      active: payload.active,
      permissions: payload.permissions,
    });

    await loadData();
    setCustomerLoginForm((old) => ({ ...old, id: savedLogin.id }));
    alert(customerLoginForm.id ? "Customer login updated." : "Customer login created.");
  }

  async function resetCustomerPassword() {
    if (!customerLoginForm.id) {
      alert("Select an existing customer login first.");
      return;
    }

    const newPassword = window.prompt("Enter new password");
    if (!newPassword) return;

    setSavingCustomerLogin(true);
    const result = await supabase
      .from("login_users")
      .update({ password: newPassword })
      .eq("id", customerLoginForm.id);
    setSavingCustomerLogin(false);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    await logSecurityAction("RESET_CUSTOMER_PASSWORD", { user_id: customerLoginForm.id }, {
      user_id: customerLoginForm.id,
      username: customerLoginForm.username,
      customer_account_id: customerLoginForm.customer_account_id,
    });
    await loadData();
    setCustomerLoginForm((old) => ({ ...old, password: newPassword }));
    alert("Customer password reset.");
  }

  async function deleteCustomerLogin() {
    if (!customerLoginForm.id) {
      alert("Select an existing customer login first.");
      return;
    }

    if (!window.confirm("Are you sure you want to delete this customer login?")) return;

    const oldValue = { ...customerLoginForm, role: "Customer" };
    setSavingCustomerLogin(true);
    const result = await supabase.from("login_users").delete().eq("id", customerLoginForm.id);
    setSavingCustomerLogin(false);

    if (result.error) {
      alert(result.error.message);
      return;
    }

    await logSecurityAction("DELETE_CUSTOMER_LOGIN", oldValue, null);
    await loadData();
    setCustomerLoginForm({
      ...emptyCustomerLoginForm,
      customer_account_id: customerLoginForm.customer_account_id,
      active: selectedCustomerInactive ? false : true,
    });
    alert("Customer login deleted.");
  }

  const selectedAccountValue = isCustomer ? loginForm.customer_account_id : loginForm.staff_id;

  return (
    <div className="p-5 space-y-5">
      <div>
        <h2 className="text-2xl font-bold">Login Setup</h2>
        <p className="text-sm text-slate-500">
          Manage staff login access, customer portal access and role permissions.
        </p>
      </div>

      {loading && (
        <div className="bg-slate-50 border rounded-2xl p-4 text-sm">
          Loading login configuration...
        </div>
      )}

      {!loading && (
        <div className="bg-white border rounded-2xl">
          <div className="flex flex-wrap gap-4 border-b px-4">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`py-3 text-sm font-bold border-b-2 ${
                  activeTab === tab
                    ? "border-blue-700 text-blue-700"
                    : "border-transparent text-slate-500"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="p-4">
            {activeTab === "Search Staff" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Search Staff"
                    value={staffSearchTerm}
                    onChange={setStaffSearchTerm}
                    placeholder="Search staff..."
                  />
                  <Field label="Select Staff Member">
                    <select
                      value={selectedStaffId}
                      onChange={(event) => setSelectedStaffId(event.target.value)}
                      className="border rounded-xl p-3 w-full"
                    >
                      <option value="">Select staff member</option>
                      {filteredStaffUsers.map((staff) => (
                        <option key={staff.id} value={staff.id}>
                          {getDisplayStaffName(staff)} {staff.active === false ? "(Inactive)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {selectedStaff && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <SummaryCard label="Staff Name" value={getDisplayStaffName(selectedStaff)} />
                      <SummaryCard
                        label="Active Status"
                        value={selectedStaff.active === false ? "Inactive" : "Active"}
                      />
                      <SummaryCard
                        label="Linked Login Username"
                        value={selectedStaffLogin?.username || "No login linked"}
                      />
                    </div>

                    <div className="border rounded-xl p-3">
                      <h3 className="font-bold mb-3">Access Summary</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {STAFF_SUMMARY_KEYS.map(([key, label]) => (
                          <PermissionPill
                            key={key}
                            label={label}
                            enabled={selectedStaffPermissions[key] === true}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "Existing Login" && (
              <ExistingLoginsTable
                currentPage={currentPage}
                customerAccounts={customerAccounts}
                currentIsSuperAdmin={currentIsSuperAdmin}
                editLogin={editLogin}
                loginUsers={pagedLoginUsers}
                searchTerm={existingLoginSearchTerm}
                setCurrentPage={setCurrentPage}
                setSearchTerm={setExistingLoginSearchTerm}
                staffUsers={staffUsers}
                totalPages={totalPages}
              />
            )}

            {activeTab === "Login Setup" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Search Staff"
                    value={staffSearchTerm}
                    onChange={setStaffSearchTerm}
                    placeholder="Search staff..."
                  />
                  <Field label={isCustomer ? "Customer Account" : "Select Staff"}>
                    <select
                      value={selectedAccountValue}
                      disabled={!isStaff && !isCustomer}
                      onChange={(event) => {
                        if (isCustomer) {
                          updateLoginField("customer_account_id", event.target.value);
                        } else {
                          selectSetupStaff(event.target.value);
                        }
                      }}
                      className="border rounded-xl p-3 w-full disabled:bg-slate-100 disabled:text-slate-500"
                    >
                      <option value="">
                        {isCustomer
                          ? "Select Customer Account"
                          : isStaff
                            ? "Select Active Staff"
                            : "Not required for this access level"}
                      </option>
                      {isStaff &&
                        filteredStaffUsers.map((staff) => (
                          <option key={staff.id} value={staff.id}>
                            {getDisplayStaffName(staff)}
                          </option>
                        ))}
                      {isCustomer &&
                        customerAccounts.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {getCustomerName(customer)} {customer.active === false ? "(Inactive)" : ""}
                          </option>
                        ))}
                    </select>
                  </Field>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => updateLoginField("active", !loginForm.active)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold ${
                      loginForm.active ? "bg-green-600 text-white" : "bg-slate-500 text-white"
                    }`}
                  >
                    {loginForm.active ? "Active" : "Inactive"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    label="Username"
                    value={loginForm.username}
                    onChange={(value) => updateLoginField("username", value)}
                  />
                  <Input
                    label="Password"
                    value={loginForm.password}
                    onChange={(value) => updateLoginField("password", value)}
                  />
                  <Field label="Access Level">
                    <select
                      value={loginForm.role}
                      onChange={(event) => updateLoginField("role", event.target.value)}
                      className="border rounded-xl p-3 w-full"
                    >
                      {ACCESS_LEVELS.map((role) => (
                        <option
                          key={role}
                          value={role}
                          disabled={role === "Super Admin" && !currentIsSuperAdmin}
                        >
                          {role}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {isStaff && (
                  <div className="border rounded-xl p-3 bg-slate-50">
                    <div className="font-bold text-sm mb-2">Staff Access Defaults</div>
                    <div className="flex flex-wrap gap-2">
                      {["Warehouse", "Sales Rep", "Driver"].map((roleName) => (
                        <button
                          key={roleName}
                          type="button"
                          onClick={() => applyStaffDefault(roleName)}
                          className="bg-white border px-3 py-2 rounded-lg text-sm font-bold"
                        >
                          Add {roleName}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <PermissionCheckboxes
                  isCustomer={isCustomer}
                  permissions={loginForm.permissions}
                  permissionsLocked={permissionsLocked}
                  togglePermission={togglePermission}
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveLogin}
                    disabled={savingLogin || Boolean(loginForm.id)}
                    className="bg-blue-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
                  >
                    {savingLogin ? "Saving..." : "Save Login"}
                  </button>
                  <button
                    type="button"
                    onClick={saveLogin}
                    disabled={savingLogin || !loginForm.id}
                    className="bg-green-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
                  >
                    {savingLogin ? "Saving..." : "Update Login"}
                  </button>
                  <button
                    type="button"
                    onClick={resetLoginForm}
                    className="bg-slate-600 text-white font-bold px-5 py-3 rounded-xl"
                  >
                    New Login
                  </button>
                </div>
              </div>
            )}

            {activeTab === "Staff Access Default" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold">Default Permission Templates</h3>
                  <p className="text-sm text-slate-500">
                    Admin can view/edit defaults later. For now these templates auto-fill permission checkboxes.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {["Super Admin", "Admin", "Warehouse", "Sales Rep", "Driver", "Customer"].map((roleName) => (
                    <div key={roleName} className="border rounded-xl p-3 bg-slate-50">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <h4 className="font-bold">{roleName}</h4>
                        <button
                          type="button"
                          onClick={() => applyStaffDefault(roleName)}
                          className="bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          Use
                        </button>
                      </div>
                      <div className="text-sm text-slate-600">
                        {getPermissionSummary(normalizePermissions(roleName, DEFAULT_PERMISSIONS[roleName]))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "Customer Login Setup" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Search Customer"
                    value={customerSearchTerm}
                    onChange={setCustomerSearchTerm}
                    placeholder="Search customer..."
                  />
                  <Field label="Customer">
                    <select
                      value={customerLoginForm.customer_account_id}
                      onChange={(event) => selectCustomerLogin(event.target.value)}
                      className="border rounded-xl p-3 w-full"
                    >
                      <option value="">Select customer account</option>
                      {filteredCustomerAccounts.map((customer) => (
                        <option
                          key={customer.id}
                          value={customer.id}
                          className={customer.active === false ? "text-slate-400" : ""}
                        >
                          {getCustomerName(customer)} {customer.active === false ? "(Inactive)" : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                {selectedCustomerInactive && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm font-bold">
                    Customer is inactive. Login cannot be used until customer is active.
                  </div>
                )}

                <div className={`border rounded-xl p-3 ${selectedCustomerInactive ? "bg-slate-50" : ""}`}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <SummaryCard
                      label="Selected Customer Account"
                      value={selectedCustomer ? getCustomerName(selectedCustomer) : "None selected"}
                    />
                    <SummaryCard
                      label="Customer Status"
                      value={selectedCustomerInactive ? "Inactive" : selectedCustomer ? "Active" : "-"}
                    />
                    <SummaryCard label="Role" value="Customer" />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => updateCustomerLoginField("active", !customerLoginForm.active)}
                    disabled={selectedCustomerInactive}
                    className={`px-4 py-2 rounded-xl text-sm font-bold disabled:bg-slate-300 disabled:text-slate-500 ${
                      customerLoginForm.active ? "bg-green-600 text-white" : "bg-slate-500 text-white"
                    }`}
                  >
                    {customerLoginForm.active ? "Active" : "Inactive"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    label="Username"
                    value={customerLoginForm.username}
                    onChange={(value) => updateCustomerLoginField("username", value)}
                  />
                  <Input
                    label="Password"
                    value={customerLoginForm.password}
                    onChange={(value) => updateCustomerLoginField("password", value)}
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveCustomerLogin}
                    disabled={savingCustomerLogin || selectedCustomerInactive}
                    className="bg-blue-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
                  >
                    {savingCustomerLogin ? "Saving..." : customerLoginForm.id ? "Update Login" : "Create Login"}
                  </button>
                  <button
                    type="button"
                    onClick={resetCustomerPassword}
                    disabled={savingCustomerLogin || !customerLoginForm.id}
                    className="bg-slate-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
                  >
                    Reset Password
                  </button>
                  <button
                    type="button"
                    onClick={deleteCustomerLogin}
                    disabled={savingCustomerLogin || !customerLoginForm.id}
                    className="bg-red-700 text-white font-bold px-5 py-3 rounded-xl disabled:bg-slate-400"
                  >
                    Delete Login
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ExistingLoginsTable({
  currentIsSuperAdmin,
  currentPage,
  customerAccounts,
  editLogin,
  loginUsers,
  searchTerm,
  setCurrentPage,
  setSearchTerm,
  staffUsers,
  totalPages,
}) {
  return (
    <div>
      <h3 className="text-xl font-bold mb-4">Existing Login Users</h3>

      <div className="mb-4">
        <Input
          label="Search Existing Logins"
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search username, role, staff, customer or status..."
        />
      </div>

      <div className="overflow-x-auto border rounded-2xl">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b">
              <th className="p-3 text-left">Username</th>
              <th className="p-3 text-left">Access Level / Role</th>
              <th className="p-3 text-left">Staff</th>
              <th className="p-3 text-left">Customer Account</th>
              <th className="p-3 text-left">Permission Summary</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-center">Edit</th>
            </tr>
          </thead>

          <tbody>
            {loginUsers.map((loginUser) => {
              const staff = staffUsers.find((item) => String(item.id) === String(loginUser.staff_id));
              const customer = customerAccounts.find(
                (item) => String(item.id) === String(loginUser.customer_account_id)
              );
              const role = normalizeAccessLevel(loginUser.role);
              const legacyDefaultPermissions =
                role === "Staff" && loginUser.role !== "Staff"
                  ? DEFAULT_PERMISSIONS[loginUser.role] || {}
                  : {};
              const permissions = normalizePermissions(role, {
                ...legacyDefaultPermissions,
                ...(loginUser.permissions || {}),
              });
              const protectedSuperAdmin = loginUser.role === "Super Admin" && !currentIsSuperAdmin;

              return (
                <tr key={loginUser.id} className="border-b">
                  <td className="p-3 font-bold">{loginUser.username}</td>
                  <td className="p-3">{loginUser.role}</td>
                  <td className="p-3">{staff ? getDisplayStaffName(staff) : "-"}</td>
                  <td className="p-3">{customer ? getCustomerName(customer) : "-"}</td>
                  <td className="p-3">{getPermissionSummary(permissions)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded-lg text-xs font-bold ${
                      loginUser.active !== false
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-200 text-slate-700"
                    }`}>
                      {loginUser.active !== false ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => editLogin(loginUser)}
                      disabled={protectedSuperAdmin}
                      className={`px-3 py-2 rounded-lg text-xs font-bold ${
                        protectedSuperAdmin
                          ? "bg-slate-300 text-slate-600"
                          : "bg-blue-600 text-white"
                      }`}
                    >
                      {protectedSuperAdmin ? "Protected" : "Edit"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => setCurrentPage(page)}
              className={`px-3 py-2 rounded-lg text-sm font-bold border ${
                currentPage === page
                  ? "bg-blue-700 text-white border-blue-700"
                  : "bg-white text-slate-700"
              }`}
            >
              {page}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionCheckboxes({ isCustomer, permissions, permissionsLocked, togglePermission }) {
  return (
    <div className="space-y-4">
      {PERMISSION_GROUPS.map((group) => (
        <div key={group.title} className="border rounded-xl p-3">
          <h4 className="font-bold mb-3">{group.title}</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {group.permissions.map(([key, label]) => {
              const customerRestricted = isCustomer && key !== "access_customer_portal";
              const disabled = permissionsLocked || customerRestricted;

              return (
                <label
                  key={key}
                  className={`flex items-center gap-2 text-sm ${
                    disabled ? "text-slate-400" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={permissions[key] === true}
                    disabled={disabled}
                    onChange={(event) => togglePermission(key, event.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PermissionPill({ label, enabled }) {
  return (
    <div className={`rounded-xl border p-3 text-sm ${enabled ? "bg-green-50" : "bg-slate-50"}`}>
      <div className="font-bold">{label}</div>
      <div className={enabled ? "text-green-700" : "text-slate-500"}>
        {enabled ? "Allowed" : "No access"}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="font-bold text-sm block mb-1">{label}</span>
      {children}
    </label>
  );
}

function Input({ label, value, onChange, type = "text", placeholder = "" }) {
  return (
    <Field label={label}>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="border rounded-xl p-3 w-full"
      />
    </Field>
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="border rounded-2xl p-4 bg-slate-50">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}




