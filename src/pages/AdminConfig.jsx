import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";
import * as XLSX from "xlsx";
import { formatCurrency } from "../utils/currency";
import { getPriceModeLabel } from "../utils/pricing";

import ProductSetupOptions from "../components/ProductSetupOptions";

import {
  getCustomerAccounts,
  saveCustomerAccount,
  saveCustomerBranch,
  getStaffUsers,
  saveStaffUser,
  toggleCustomerActive,
  toggleBranchActive,
  toggleStaffActive,
} from "../services/customerManagement";

export default function AdminConfig() {
  const [activeConfigTab, setActiveConfigTab] = useState("product");
  const [staffSearch, setStaffSearch] = useState("");

  const [showDriverForm, setShowDriverForm] = useState(false);
  const [drivers, setDrivers] = useState([]);
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");

  const [customerImportRows, setCustomerImportRows] = useState([]);
const [customerImportFileName, setCustomerImportFileName] = useState("");

  const [productOptions, setProductOptions] = useState([]);

  const [customerMode, setCustomerMode] = useState("add");
const [customerSearch, setCustomerSearch] = useState("");

const [loginUsers, setLoginUsers] = useState([]);
const [loginForm, setLoginForm] = useState({
  id: null,
  staff_id: "",
  username: "",
  password: "",
  role: "Sales Rep",
  customer_account_id: "",
  active: true,
});

const normaliseImportKey = (value) => String(value || "").trim().toLowerCase();
const getImportValue = (row, keys) => {
  const valuesByKey = Object.entries(row || {}).reduce((values, [key, value]) => {
    values[normaliseImportKey(key)] = value;
    return values;
  }, {});

  for (const key of keys) {
    const value = valuesByKey[normaliseImportKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
};
const getImportBool = (row, keys, fallback = true) => {
  const value = getImportValue(row, keys);
  if (value === "") return fallback;
  if (value === true || value === false) return value;

  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(text)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(text)) return false;

  return fallback;
};

  const [suppliers, setSuppliers] = useState([]);
  const [supplierForm, setSupplierForm] = useState({
    supplier_name: "",
    contact_name: "",
    phone: "",
    email: "",
    address: "",
    payment_terms: "",
    vat_registered: true,
    notes: "",
  });

  const [customers, setCustomers] = useState([]);
  const [staffUsers, setStaffUsers] = useState([]);

  const emptyCustomerForm = {
    account_name: "",
    contact_name: "",
    phone: "",
    email: "",
    address: "",
    country: "Wales",
    credit_limit: 0,
    default_price_mode: "VAT",
    active: true,
    allow_vat: true,
    allow_server: false,
    allow_manager: false,
    allow_super: false,
  };

  const emptyBranchForm = {
    customer_account_id: "",
    branch_name: "",
    delivery_address: "",
    postcode: "",
    country: "Wales",
    phone: "",
    active: true,
  };

 const emptyStaffForm = {
  staff_name: "",
  phone: "",
  email: "",
  active: true,
};

  const [customerForm, setCustomerForm] = useState(emptyCustomerForm);
  const [branchForm, setBranchForm] = useState(emptyBranchForm);
  const [staffForm, setStaffForm] = useState(emptyStaffForm);

  const [pricingSettings, setPricingSettings] = useState({
    server_discount_percent: 2,
    manager_discount_percent: 2.5,
    super_discount_percent: 3.5,
    show_manager_offer: true,
    show_super_offer: true,
  });

useEffect(() => {
  fetchProductOptions();
  fetchPricingSettings();
  fetchSuppliers();
  fetchDrivers();
  loadCustomers();
  loadStaff();
  loadLoginUsers();
}, []);

async function loadLoginUsers() {
  const { data: users, error } = await supabase
    .from("login_users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Load login users error:", error);
    alert("Could not load existing logins: " + error.message);
    return;
  }

  const usersWithCustomerName = (users || []).map((user) => {
    const customer = customers.find(
      (c) => c.id === user.customer_account_id
    );

    return {
      ...user,
      customer_account_name: customer?.account_name || "-",
    };
  });

  setLoginUsers(usersWithCustomerName);
}

  async function loadCustomers() {
    const data = await getCustomerAccounts();
    setCustomers(data || []);
  }

  async function loadStaff() {
    const data = await getStaffUsers();
    setStaffUsers(data || []);
  }

  function editLoginUser(user) {
  setLoginForm({
    id: user.id,
    staff_id: user.staff_id || "",
    username: user.username || "",
    password: user.password || "",
    role: user.role || "Sales Rep",
    customer_account_id: user.customer_account_id || "",
    active: user.active ?? true,
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

  async function saveLoginUser() {
  if (!loginForm.username.trim()) {
    alert("Username is required");
    return;
  }

    if (loginForm.role !== "Customer") {
    if (!loginForm.staff_id) {
      alert("Please select a staff member");
      return;
    }

    const { data: staffCheck, error: staffCheckError } = await supabase
      .from("staff_users")
      .select("id, staff_name, active")
      .eq("id", loginForm.staff_id)
      .eq("active", true)
      .limit(1);

    if (staffCheckError || !staffCheck || staffCheck.length === 0) {
      alert("Selected staff member is not active.");
      return;
    }
  }

  if (!loginForm.password.trim()) {
    alert("Password is required");
    return;
  }

  if (!loginForm.role) {
    alert("Role is required");
    return;
  }

  if (loginForm.role === "Customer" && !loginForm.customer_account_id) {
    alert("Customer Account is required for Customer login");
    return;
  }


const payload = {
  staff_id: loginForm.role === "Customer" ? null : loginForm.staff_id,
  username: loginForm.username.trim(),
  password: loginForm.password.trim(),
  role: loginForm.role,
  customer_account_id:
    loginForm.role === "Customer" ? loginForm.customer_account_id : null,
  active: loginForm.active,
};

  let result;

  if (loginForm.id) {
    result = await supabase
      .from("login_users")
      .update(payload)
      .eq("id", loginForm.id);
  } else {
    result = await supabase.from("login_users").insert([payload]);
  }

if (result.error) {
  console.error("Save login user error:", result.error);
  alert("Could not save login user: " + result.error.message);
  return;
}

setLoginForm({
  id: null,
  staff_id: "",
  username: "",
  password: "",
  role: "Sales Rep",
  customer_account_id: "",
  active: true,
});

  loadLoginUsers();
}

  const fetchProductOptions = async () => {
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("active", true)
      .order("option_type")
      .order("option_name");

    if (!error) setProductOptions(data || []);
  };

  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("active", true)
      .order("supplier_name");

    if (!error) setSuppliers(data || []);
  };

  const fetchDrivers = async () => {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .eq("active", true)
      .order("name");

    if (!error) setDrivers(data || []);
  };

  const fetchPricingSettings = async () => {
    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (!error && data) setPricingSettings(data);
  };

  async function handleSaveCustomer() {
    if (!customerForm.account_name) {
      alert("Customer account name required");
      return;
    }

    await saveCustomerAccount(customerForm);
    setCustomerForm(emptyCustomerForm);
    loadCustomers();
  }

  async function handleSaveBranch() {
    if (!branchForm.customer_account_id || !branchForm.branch_name) {
      alert("Select customer and enter branch name");
      return;
    }

    await saveCustomerBranch(branchForm);
    setBranchForm(emptyBranchForm);
    loadCustomers();
  }

async function handleSaveStaff() {
  if (!staffForm.staff_name.trim()) {
    alert("Staff name required");
    return;
  }

  try {
    await saveStaffUser(staffForm);

    alert("Staff saved successfully");

    setStaffForm(emptyStaffForm);
    loadStaff();
  } catch (error) {
    console.error("Save staff error:", error);
    alert(
      "Could not save staff: " +
      (error.message || JSON.stringify(error))
    );
  }
}

  const savePricingSettings = async () => {
    const { error } = await supabase
      .from("pricing_settings")
      .update({
        server_discount_percent: Number(
          pricingSettings.server_discount_percent || 0
        ),
        manager_discount_percent: Number(
          pricingSettings.manager_discount_percent || 0
        ),
        super_discount_percent: Number(
          pricingSettings.super_discount_percent || 0
        ),
        show_manager_offer: pricingSettings.show_manager_offer,
        show_super_offer: pricingSettings.show_super_offer,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (error) {
      alert("Save failed: " + error.message);
      return;
    }

    alert("Pricing settings saved");
  };

  const addSupplier = async (e) => {
    e.preventDefault();

    if (!supplierForm.supplier_name.trim()) {
      alert("Enter supplier name.");
      return;
    }

    const { error } = await supabase.from("suppliers").insert({
      supplier_name: supplierForm.supplier_name.trim(),
      contact_name: supplierForm.contact_name.trim(),
      phone: supplierForm.phone.trim(),
      email: supplierForm.email.trim(),
      address: supplierForm.address.trim(),
      payment_terms: supplierForm.payment_terms.trim(),
      vat_registered: supplierForm.vat_registered,
      notes: supplierForm.notes.trim(),
      active: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setSupplierForm({
      supplier_name: "",
      contact_name: "",
      phone: "",
      email: "",
      address: "",
      payment_terms: "",
      vat_registered: true,
      notes: "",
    });

    fetchSuppliers();
  };

  const productSetupTypeMap = {
    mainCategories: "main_category",
    subCategories: "sub_category",
    brands: "brand",
    series: "series",
  };

  const saveProductOption = async (type, name) => {
    if (!name.trim()) {
      alert("Enter option name.");
      return;
    }

    const { error } = await supabase.from("product_options").insert({
      option_type: type,
      option_name: name.trim(),
      active: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    fetchProductOptions();
  };

  const addProductSetupOption = async (typeKey, value) => {
    const mappedType = productSetupTypeMap[typeKey];
    if (!mappedType) return;

    await saveProductOption(mappedType, value);
  };

  const deleteProductOption = async (id) => {
    const { error } = await supabase
      .from("product_options")
      .update({ active: false })
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    fetchProductOptions();
  };

  const deleteProductSetupOption = async (_typeKey, option) => {
    if (!option?.id) return;

    await deleteProductOption(option.id);
  };

  const addDriver = async (e) => {
    e.preventDefault();

    if (!driverName.trim()) {
      alert("Please enter driver name.");
      return;
    }

    const { error } = await supabase.from("drivers").insert({
      name: driverName.trim(),
      phone: driverPhone.trim(),
      active: true,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setDriverName("");
    setDriverPhone("");
    setShowDriverForm(false);
    fetchDrivers();
  };

  const handleCustomerImport = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setCustomerImportFileName(file.name);

  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const workbook = XLSX.read(event.target.result, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet);

      setCustomerImportRows(rows || []);
    } catch (error) {
      console.error("Customer import file read error:", error);
      alert("Could not read customer Excel file.");
    }
  };

  reader.readAsArrayBuffer(file);
};

const processCustomerImport = async () => {
  if (!customerImportRows.length) {
    alert("Please choose a customer Excel file first.");
    return;
  }

  let importedCustomers = 0;
  let importedBranches = 0;

  try {
    for (const row of customerImportRows) {
      const accountName = String(
        getImportValue(row, ["Customer Name", "account_name"])
      ).trim();
      if (!accountName) continue;

      const customer = await saveCustomerAccount({
        id: getImportValue(row, ["Customer Account ID", "id"]),
        account_name: accountName,
        contact_name: getImportValue(row, ["Contact Name", "contact_name"]),
        phone: getImportValue(row, ["Phone", "phone"]),
        email: getImportValue(row, ["Email", "email"]),
        address: getImportValue(row, ["Address", "address"]),
        address_line_1: getImportValue(row, ["Address", "address"]),
        town_city: getImportValue(row, [
          "City / Town",
          "Town / City",
          "City",
          "Town",
          "town_city",
          "city",
        ]),
        postcode: getImportValue(row, ["Postcode", "postcode"]),
        country: getImportValue(row, ["Country", "country"]) || "Wales",
        credit_limit: Number(getImportValue(row, ["Credit Limit", "credit_limit"]) || 0),
        default_price_mode:
          getImportValue(row, ["Default Price Mode", "default_price_mode"]) || "VAT",
        active: getImportBool(row, ["Active", "active"], true),
        allow_vat: true,
        allow_server: ["server", "inc.vat", "inc vat"].some((label) =>
          String(
            getImportValue(row, ["Allowed Price Modes", "allowed_price_modes"])
          )
            .toLowerCase()
            .includes(label)
        ),
        allow_manager: false,
        allow_super: false,
      });

      importedCustomers++;

      if (row.branch_name) {
        await saveCustomerBranch({
          customer_account_id: customer.id,
          branch_name: row.branch_name,
          delivery_address: row.delivery_address || "",
          postcode: row.postcode || "",
          country: row.branch_country || row.country || "Wales",
          phone: row.branch_phone || "",
          active: true,
        });

        importedBranches++;
      }
    }

    await loadCustomers();

    setCustomerImportRows([]);
    setCustomerImportFileName("");

    alert(
      `Customer import complete.\n\nCustomers processed: ${importedCustomers}\nBranches processed: ${importedBranches}`
    );
  } catch (error) {
    console.error("Customer import error:", error);
    alert("Customer import failed: " + error.message);
  }
};
  const groupedOptions = {
    main_category: productOptions.filter(
      (o) => o.option_type === "main_category"
    ),
    sub_category: productOptions.filter(
      (o) => o.option_type === "sub_category"
    ),
    brand: productOptions.filter((o) => o.option_type === "brand"),
    series: productOptions.filter((o) => o.option_type === "series"),
  };

  const productSetupOptionsByType = {
    mainCategories: groupedOptions.main_category,
    subCategories: groupedOptions.sub_category,
    brands: groupedOptions.brand,
    series: groupedOptions.series,
  };

  const inputClass = "w-full border rounded-xl px-3 py-3 text-sm";
  const cardClass = "bg-white border rounded-2xl p-4 mb-4";

  const searchedCustomers = customers.filter((customer) =>
  String(customer.account_name || "")
    .toLowerCase()
    .includes(customerSearch.toLowerCase())
);

const filteredStaff = staffUsers.filter((staff) =>
  `${staff.staff_name || ""} ${staff.email || ""}`
    .toLowerCase()
    .includes(staffSearch.toLowerCase())
);

  return (
    <div className="p-4 max-w-6xl mx-auto bg-slate-50 min-h-screen">
      <div className="mb-4">
        <h2 className="text-2xl font-bold">Admin Config</h2>
        <p className="text-sm text-slate-500">
          Manage product setup, suppliers, drivers, customers, staff and pricing
          settings.
        </p>
      </div>

      <div className="bg-white border rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-sm mb-4">Customise</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            [
              "product",
              "Product Setup",
              "Manage categories, sub-categories, brands and series.",
            ],
            [
              "pricing",
              "Pricing Settings",
              "Manage Inc.VAT, Manager and Super Offer discounts.",
            ],
            ["drivers", "Drivers", "Manage delivery drivers."],
            [
              "suppliers",
              "Suppliers",
              "Manage supplier details for stock receipts.",
            ],
            [
              "customers",
              "Customer Setup",
              "Manage customer accounts, branches and credit limits.",
            ],
            [
              "staff",
              "Staff Setup",
              "Manage staff roles and access control.",
            ],

            [
                "login",
                "Login Setup",
                "Create user logins and assign roles.",
              ],

          ].map(([key, title, desc]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveConfigTab(key)}
              className="text-left"
            >
              <div
                className={`font-bold underline ${
                  activeConfigTab === key
                    ? "text-blue-700"
                    : "text-green-700"
                }`}
              >
                {title}
              </div>
              <p className="text-xs text-slate-600 mt-1">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      {activeConfigTab === "pricing" && (
        <div className={cardClass}>
          <h3 className="text-xl font-bold mb-4">Pricing Settings</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              ["server_discount_percent", "Inc.VAT Discount %"],
              ["manager_discount_percent", "Manager Discount %"],
              ["super_discount_percent", "Super Offer Discount %"],
            ].map(([field, label]) => (
              <div key={field}>

                <label className="font-bold text-sm block mb-1">{label}</label>
                <input
                  type="number"
                  step="0.1"
                  className={inputClass}
                  value={pricingSettings[field]}
                  onChange={(e) =>
                    setPricingSettings({
                      ...pricingSettings,
                      [field]: e.target.value,
                    })
                  }
                />
                </div>
               ))}
               </div>

                 <div className="flex flex-col md:flex-row gap-4 mt-4">
                  <label className="flex items-center gap-2 font-semibold text-sm">
                 <input
                type="checkbox"
                checked={pricingSettings.show_manager_offer === true}
                onChange={(e) =>
                  setPricingSettings({
                    ...pricingSettings,
                    show_manager_offer: e.target.checked,
                  })
                }
              />
              Show Manager Offer
            </label>

            <label className="flex items-center gap-2 font-semibold text-sm">
              <input
                type="checkbox"
                checked={pricingSettings.show_super_offer === true}
                onChange={(e) =>
                  setPricingSettings({
                    ...pricingSettings,
                    show_super_offer: e.target.checked,
                  })
                }
              />
              Show Super Offer
            </label>
          </div>

          <button
            onClick={savePricingSettings}
            className="mt-5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold"
          >
            Save Pricing Settings
          </button>
        </div>
      )}

      {activeConfigTab === "customers" && (
  <div>
    <div className="flex items-center gap-3 mb-5">
      <h2 className="text-2xl font-bold">Customers</h2>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <button
        onClick={() => {
          setCustomerMode("add");
          setCustomerForm(emptyCustomerForm);
          setBranchForm(emptyBranchForm);
        }}
        className={
          customerMode === "add"
            ? "bg-blue-600 text-white px-4 py-3 rounded-xl font-bold"
            : "border px-4 py-3 rounded-xl font-bold"
        }
      >
        Add Customer
      </button>

      <button
        onClick={() => {
          setCustomerMode("edit");
          setCustomerForm(emptyCustomerForm);
          setBranchForm(emptyBranchForm);
        }}
        className={
          customerMode === "edit"
            ? "bg-blue-600 text-white px-4 py-3 rounded-xl font-bold"
            : "border px-4 py-3 rounded-xl font-bold"
        }
      >
        Edit Customer
      </button>

      <label className="border px-4 py-3 rounded-xl font-bold text-center cursor-pointer">
  Choose Excel File
  <input
    type="file"
    accept=".xlsx,.xls"
    onChange={handleCustomerImport}
    className="hidden"
  />
</label>
    </div>

    {customerMode === "edit" && (
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
        <h3 className="text-xl font-bold mb-4">Search Customer</h3>

        <input
          className={inputClass}
          placeholder="Search customer name..."
          value={customerSearch}
          onChange={(e) => setCustomerSearch(e.target.value)}
        />

        {customerSearch && (
          <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
            {searchedCustomers.map((customer) => (
              <button
                key={customer.id}
                onClick={() => {
                  setCustomerForm(customer);

                  const firstBranch =
                    (customer.customer_branches || [])[0] || emptyBranchForm;

                  if (firstBranch?.id) {
                    setBranchForm({
                      ...firstBranch,
                      customer_account_id: customer.id,
                    });
                  } else {
                    setBranchForm({
                      ...emptyBranchForm,
                      customer_account_id: customer.id,
                    });
                  }

                  setCustomerSearch("");
                }}
                className="w-full text-left border rounded-xl p-3 hover:bg-slate-100"
              >
                <strong>{customer.account_name}</strong>
                <div className="text-xs text-slate-500">
                  {customer.country} | {getPriceModeLabel(customer.default_price_mode)} | Credit {formatCurrency(customer.credit_limit)}
                </div>
              </button>
            ))}

            {searchedCustomers.length === 0 && (
              <p className="text-sm text-slate-500">No customer found.</p>
            )}
          </div>
        )}
      </div>
    )}

    <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
      <h3 className="text-xl font-bold mb-4">
        {customerForm.id ? "Update Customer" : "Add Customer"}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <input
          className={inputClass}
          placeholder="Account Name"
          value={customerForm.account_name}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, account_name: e.target.value })
          }
        />

        <input
          className={inputClass}
          placeholder="Contact Name"
          value={customerForm.contact_name}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, contact_name: e.target.value })
          }
        />

        <input
          className={inputClass}
          placeholder="Phone"
          value={customerForm.phone}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, phone: e.target.value })
          }
        />

        <input
          className={inputClass}
          placeholder="Email"
          value={customerForm.email}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, email: e.target.value })
          }
        />

        <textarea
          className={`${inputClass} md:col-span-2`}
          placeholder="Main Address"
          value={customerForm.address}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, address: e.target.value })
          }
        />

        <select
          className={inputClass}
          value={customerForm.country}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, country: e.target.value })
          }
        >
          <option value="Wales">Wales</option>
          <option value="England">England</option>
        </select>

        <select
          className={inputClass}
          value={customerForm.default_price_mode}
          onChange={(e) =>
            setCustomerForm({
              ...customerForm,
              default_price_mode: e.target.value,
            })
          }
        >
          <option value="VAT">Ex.VAT</option>
          <option value="Server">Inc.VAT</option>
          <option value="Manager">Manager Offer</option>
          <option value="Super">Super Offer</option>
        </select>

        <div className="md:col-span-4 border rounded-2xl p-3 bg-slate-50">
  <div className="font-bold text-sm mb-2">Allowed Price Modes</div>

  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <label className="flex items-center gap-2 font-semibold text-sm">
      <input
        type="checkbox"
        checked={customerForm.allow_vat === true}
        onChange={(e) =>
          setCustomerForm({
            ...customerForm,
            allow_vat: e.target.checked,
          })
        }
      />
      Ex.VAT
    </label>

    <label className="flex items-center gap-2 font-semibold text-sm">
      <input
        type="checkbox"
        checked={customerForm.allow_server === true}
        onChange={(e) =>
          setCustomerForm({
            ...customerForm,
            allow_server: e.target.checked,
          })
        }
      />
      Inc.VAT
    </label>

    <label className="flex items-center gap-2 font-semibold text-sm">
      <input
        type="checkbox"
        checked={customerForm.allow_manager === true}
        onChange={(e) =>
          setCustomerForm({
            ...customerForm,
            allow_manager: e.target.checked,
          })
        }
      />
      Manager Offer
    </label>

    <label className="flex items-center gap-2 font-semibold text-sm">
      <input
        type="checkbox"
        checked={customerForm.allow_super === true}
        onChange={(e) =>
          setCustomerForm({
            ...customerForm,
            allow_super: e.target.checked,
          })
        }
      />
      Super Offer
    </label>
  </div>
</div>

        <input
          className={inputClass}
          type="number"
          placeholder="Credit Limit"
          value={customerForm.credit_limit}
          onChange={(e) =>
            setCustomerForm({ ...customerForm, credit_limit: e.target.value })
          }
        />

        <div className="md:col-span-3 flex justify-end gap-3">
          {customerForm.id && (
            <button
              onClick={() => {
                setCustomerForm(emptyCustomerForm);
                setBranchForm(emptyBranchForm);
              }}
              className="bg-slate-500 text-white px-5 py-3 rounded-xl font-bold"
            >
              Cancel
            </button>
          )}

          <button
            onClick={handleSaveCustomer}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold"
          >
            {customerForm.id ? "Update Customer" : "Save Customer"}
          </button>
        </div>
      </div>
    </div>

    <div className="bg-white rounded-2xl shadow-sm p-5 mb-5">
      <h3 className="text-xl font-bold mb-4">
        {branchForm.id ? "Update Branch / Shop" : "Add Branch / Shop"}
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <select
          className={inputClass}
          value={branchForm.customer_account_id}
          onChange={(e) =>
            setBranchForm({
              ...branchForm,
              customer_account_id: e.target.value,
            })
          }
        >
          <option value="">Select Customer Account</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.account_name}
            </option>
          ))}
        </select>

        <input
          className={inputClass}
          placeholder="Branch / Shop Name"
          value={branchForm.branch_name}
          onChange={(e) =>
            setBranchForm({ ...branchForm, branch_name: e.target.value })
          }
        />

        <input
          className={inputClass}
          placeholder="Postcode"
          value={branchForm.postcode}
          onChange={(e) =>
            setBranchForm({ ...branchForm, postcode: e.target.value })
          }
        />

        <select
          className={inputClass}
          value={branchForm.country}
          onChange={(e) =>
            setBranchForm({ ...branchForm, country: e.target.value })
          }
        >
          <option value="Wales">Wales</option>
          <option value="England">England</option>
        </select>

        <textarea
          className={`${inputClass} md:col-span-2`}
          placeholder="Delivery Address"
          value={branchForm.delivery_address}
          onChange={(e) =>
            setBranchForm({
              ...branchForm,
              delivery_address: e.target.value,
            })
          }
        />

        <input
          className={inputClass}
          placeholder="Branch Phone"
          value={branchForm.phone}
          onChange={(e) =>
            setBranchForm({ ...branchForm, phone: e.target.value })
          }
        />

        <div className="flex justify-end gap-3">
          {branchForm.id && (
            <button
              onClick={() => setBranchForm(emptyBranchForm)}
              className="bg-slate-500 text-white px-5 py-3 rounded-xl font-bold"
            >
              Cancel
            </button>
          )}

          <button
            onClick={handleSaveBranch}
            className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold"
          >
            {branchForm.id ? "Update Branch" : "Save Branch"}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

  {activeConfigTab === "staff" && (
  <div className={cardClass}>
    <h3 className="text-xl font-bold mb-4">Staff Setup</h3>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
      <input
        className={inputClass}
        placeholder="Staff Name"
        value={staffForm.staff_name}
        onChange={(e) =>
          setStaffForm({ ...staffForm, staff_name: e.target.value })
        }
      />

      <input
        className={inputClass}
        placeholder="Phone Number"
        value={staffForm.phone || ""}
        onChange={(e) =>
          setStaffForm({ ...staffForm, phone: e.target.value })
        }
      />

      <input
        className={inputClass}
        placeholder="Email Address"
        value={staffForm.email}
        onChange={(e) =>
          setStaffForm({ ...staffForm, email: e.target.value })
        }
      />

      <div className="flex gap-2">
        <button
          onClick={handleSaveStaff}
          className="bg-blue-600 text-white px-4 py-3 rounded-xl text-sm font-bold"
        >
          {staffForm.id ? "Update Staff" : "Save Staff"}
        </button>

        {staffForm.id && (
          <button
            onClick={() => setStaffForm(emptyStaffForm)}
            className="bg-slate-500 text-white px-4 py-3 rounded-xl text-sm font-bold"
          >
            Cancel Edit
          </button>
        )}
      </div>
    </div>

    <input
      className={`${inputClass} mb-3`}
      placeholder="Search Staff..."
      value={staffSearch}
      onChange={(e) => setStaffSearch(e.target.value)}
    />

    <h3 className="text-lg font-bold mb-3">Staff List</h3>

    <div className="space-y-2">
      {filteredStaff.map((staff) => (
        <div
          key={staff.id}
          className="flex flex-col md:flex-row md:justify-between gap-3 border rounded-xl p-3 text-sm"
        >
          <div>
            <strong>{staff.staff_name}</strong>
            <p>Phone: {staff.phone || "-"}</p>
            <p>Email: {staff.email || "-"}</p>
            <p>
              Status:{" "}
              <span
                className={
                  staff.active ? "text-green-600" : "text-red-600"
                }
              >
                {staff.active ? "Active" : "Inactive"}
              </span>
            </p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setStaffForm(staff)}
              className="bg-blue-600 text-white px-3 py-2 rounded-lg"
            >
              Edit Staff
            </button>

            <button
              onClick={async () => {
                await toggleStaffActive(staff.id, !staff.active);
                loadStaff();
              }}
              className="bg-slate-700 text-white px-3 py-2 rounded-lg"
            >
              {staff.active ? "Make Inactive" : "Make Active"}
            </button>
          </div>
        </div>
      ))}
    </div>
  </div>
)}

      {activeConfigTab === "login" && (
  <div>
    <div className={cardClass}>
      <h3 className="text-xl font-bold mb-4">Login Setup</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <select
  className={inputClass}
  value={loginForm.staff_id || ""}
  onChange={(e) => {
    const selectedStaff = staffUsers.find(
      (s) => String(s.id) === String(e.target.value)
    );

  setLoginForm({
  ...loginForm,
  staff_id: selectedStaff?.id || "",
  username: loginForm.username || "",
});
  }}
>
  <option value="">Select Staff User</option>
  {staffUsers
    .filter((staff) => staff.active)
    .map((staff) => (
     <option key={staff.id} value={staff.id}>
  {staff.staff_name} - {staff.email || "No email"}
</option>
    ))}
</select>

        <input
          className={inputClass}
          placeholder="Username"
          value={loginForm.username}
          onChange={(e) =>
            setLoginForm({ ...loginForm, username: e.target.value })
          }
        />

        <input
          className={inputClass}
          placeholder="Password"
          value={loginForm.password}
          onChange={(e) =>
            setLoginForm({ ...loginForm, password: e.target.value })
          }
        />

        <select
          className={inputClass}
          value={loginForm.role}
          onChange={(e) =>
            setLoginForm({
              ...loginForm,
              role: e.target.value,
              customer_account_id:
                e.target.value === "Customer"
                  ? loginForm.customer_account_id
                  : "",
            })
          }
        >
          <option value="Admin">Admin</option>
          <option value="Sales Rep">Sales Rep</option>
          <option value="Warehouse">Warehouse</option>
          <option value="Driver">Driver</option>
          <option value="Customer">Customer</option>
        </select>

        {loginForm.role === "Customer" && (
          <select
            className={inputClass}
            value={loginForm.customer_account_id}
            onChange={(e) =>
              setLoginForm({
                ...loginForm,
                customer_account_id: e.target.value,
              })
            }
          >
            <option value="">Select Customer Account</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.account_name}
              </option>
            ))}
          </select>
        )}

        <label className="flex items-center gap-2 border rounded-xl px-3 py-3 text-sm font-bold">
          <input
            type="checkbox"
            checked={loginForm.active === true}
            onChange={(e) =>
              setLoginForm({ ...loginForm, active: e.target.checked })
            }
          />
          Active
        </label>

        <div className="flex gap-2">
          <button
            onClick={saveLoginUser}
            className="bg-blue-600 text-white px-5 py-3 rounded-xl text-sm font-bold w-full"
          >
            {loginForm.id ? "Update Login" : "Create Login"}
          </button>

          {loginForm.id && (
            <button
              onClick={() =>
                setLoginForm({
                  id: null,
                  username: "",
                  password: "",
                  role: "Sales Rep",
                  customer_account_id: "",
                  active: true,
                })
              }
              className="bg-slate-500 text-white px-5 py-3 rounded-xl text-sm font-bold"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>

    <div className={cardClass}>
      <h3 className="text-lg font-bold mb-3">Existing Logins</h3>

      {loginUsers.length === 0 ? (
        <p className="text-sm text-slate-500">No logins created yet.</p>
      ) : (
        <div className="space-y-2">
          {loginUsers.map((user) => (
            <div
              key={user.id}
              className="border rounded-xl p-3 grid grid-cols-1 md:grid-cols-5 gap-3 text-sm items-center"
            >
              <div>
                <div className="text-xs text-slate-500">Username</div>
                <div className="font-bold">{user.username}</div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Role</div>
                <div>{user.role}</div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Customer Account</div>
                <div>{user.customer_account_name || "-"}</div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Active</div>
                <div
                  className={
                    user.active ? "text-green-600 font-bold" : "text-red-600 font-bold"
                  }
                >
                  {user.active ? "Yes" : "No"}
                </div>
              </div>

              <button
                onClick={() => editLoginUser(user)}
                className="bg-blue-600 text-white px-4 py-3 rounded-xl font-bold"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}

      {activeConfigTab === "product" && (
        <div className="mb-4">
          <ProductSetupOptions
            optionsByType={productSetupOptionsByType}
            onAddOption={addProductSetupOption}
            onDeleteOption={deleteProductSetupOption}
          />
        </div>
      )}


      {activeConfigTab === "drivers" && (
        <>
          <div className={cardClass}>
            <button
              onClick={() => setShowDriverForm(!showDriverForm)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[130px]"
            >
              Add New Driver
            </button>

            {showDriverForm && (
              <form onSubmit={addDriver} className="mt-4 space-y-3">
                <input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className={inputClass}
                  placeholder="Driver name"
                />

                <input
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  className={inputClass}
                  placeholder="Driver phone"
                />

                <button
                  type="submit"
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold"
                >
                  Save Driver
                </button>
              </form>
            )}
          </div>

          <div className={cardClass}>
            <h3 className="font-bold mb-3">Drivers</h3>

            {drivers.length === 0 ? (
              <p className="text-sm text-slate-500">No drivers added yet.</p>
            ) : (
              <div className="space-y-2">
                {drivers.map((driver) => (
                  <div
                    key={driver.id}
                    className="flex justify-between border rounded-xl p-3 text-sm"
                  >
                    <div>
                      <div className="font-bold">{driver.name}</div>
                      <div className="text-xs text-slate-500">
                        {driver.phone || "No phone"}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-green-600">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}


      
      {activeConfigTab === "suppliers" && (
        <div className={cardClass}>
          <h3 className="font-bold mb-3">Suppliers</h3>

          <form
            onSubmit={addSupplier}
            className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5"
          >
            <input
              value={supplierForm.supplier_name}
              onChange={(e) =>
                setSupplierForm({
                  ...supplierForm,
                  supplier_name: e.target.value,
                })
              }
              className={inputClass}
              placeholder="Supplier name"
            />

            <input
              value={supplierForm.contact_name}
              onChange={(e) =>
                setSupplierForm({
                  ...supplierForm,
                  contact_name: e.target.value,
                })
              }
              className={inputClass}
              placeholder="Contact name"
            />

            <input
              value={supplierForm.phone}
              onChange={(e) =>
                setSupplierForm({ ...supplierForm, phone: e.target.value })
              }
              className={inputClass}
              placeholder="Phone"
            />

            <input
              value={supplierForm.email}
              onChange={(e) =>
                setSupplierForm({ ...supplierForm, email: e.target.value })
              }
              className={inputClass}
              placeholder="Email"
            />

            <input
              value={supplierForm.payment_terms}
              onChange={(e) =>
                setSupplierForm({
                  ...supplierForm,
                  payment_terms: e.target.value,
                })
              }
              className={inputClass}
              placeholder="Payment terms e.g. 7 days / 30 days / Cash"
            />

            <label className="flex items-center gap-2 font-semibold text-sm">
              <input
                type="checkbox"
                checked={supplierForm.vat_registered}
                onChange={(e) =>
                  setSupplierForm({
                    ...supplierForm,
                    vat_registered: e.target.checked,
                  })
                }
              />
              VAT Registered
            </label>

            <textarea
              value={supplierForm.address}
              onChange={(e) =>
                setSupplierForm({ ...supplierForm, address: e.target.value })
              }
              className="md:col-span-2 w-full border rounded-xl px-3 py-3 text-sm"
              placeholder="Address"
              rows="2"
            />

            <textarea
              value={supplierForm.notes}
              onChange={(e) =>
                setSupplierForm({ ...supplierForm, notes: e.target.value })
              }
              className="md:col-span-2 w-full border rounded-xl px-3 py-3 text-sm"
              placeholder="Notes"
              rows="2"
            />

            <button
              type="submit"
              className="md:col-span-2 bg-blue-600 text-white px-4 py-3 rounded-lg text-sm font-bold"
            >
              Add Supplier
            </button>
          </form>

          {customerImportRows.length > 0 && (
  <div className="bg-white border rounded-2xl p-4 mb-5">
    <h3 className="font-bold mb-2">Customer Import Preview</h3>

    <p className="text-sm">
      File: <strong>{customerImportFileName}</strong>
    </p>

    <p className="text-sm">
      Rows found: <strong>{customerImportRows.length}</strong>
    </p>

    <button
      onClick={processCustomerImport}
      className="mt-3 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold"
    >
      Import Customers
    </button>
  </div>
)}

{customerImportRows.length > 0 && (
  <div className="bg-white border rounded-2xl p-4 mb-5">
    <h3 className="font-bold mb-2">Customer Import Preview</h3>

    <p className="text-sm">
      File: <strong>{customerImportFileName}</strong>
    </p>

    <p className="text-sm">
      Rows found: <strong>{customerImportRows.length}</strong>
    </p>

    <button
      onClick={processCustomerImport}
      className="mt-3 bg-blue-600 text-white px-5 py-3 rounded-xl font-bold"
    >
      Import Customers
    </button>
  </div>
)}

          <div className="space-y-2">
            {suppliers.length === 0 && (
              <p className="text-sm text-slate-500">No suppliers added yet.</p>
            )}

            {suppliers.map((supplier) => (
              <div key={supplier.id} className="border rounded-xl p-3 text-sm">
                <div className="font-bold">{supplier.supplier_name}</div>
                <div className="text-xs text-slate-500">
                  Contact: {supplier.contact_name || "-"} / Phone:{" "}
                  {supplier.phone || "-"}
                </div>
                <div className="text-xs text-slate-500">
                  Email: {supplier.email || "-"} / Terms:{" "}
                  {supplier.payment_terms || "-"}
                </div>
                <div className="text-xs text-slate-500">
                  VAT:{" "}
                  {supplier.vat_registered ? "Registered" : "Not Registered"}
                </div>
                {supplier.address && (
                  <div className="text-xs text-slate-500">
                    Address: {supplier.address}
                  </div>
                )}
                {supplier.notes && (
                  <div className="text-xs text-slate-500">
                    Notes: {supplier.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
