import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  getCustomerAccounts,
  saveCustomerAccount,
  saveCustomerBranch,
} from "../../services/customerManagement";
import { supabase } from "../../services/supabase";
import CustomerForm from "./CustomerForm";
import { formatCurrency } from "../../utils/currency";
import { getCustomerStatusLabel } from "../../utils/customerStatus";
import { getPriceModeLabel } from "../../utils/pricing";

const inputClass =
  "h-9 rounded border border-slate-400 px-2 text-sm outline-none focus:border-green-700";
const buttonClass =
  "h-9 rounded-full border border-slate-500 bg-white px-4 text-sm font-bold hover:bg-slate-100";

const displayPriceMode = (mode) => {
  return getPriceModeLabel(mode);
};

const displayStatus = getCustomerStatusLabel;
const COUNTRY_VALUES = new Set(["wales", "england"]);
const DEFAULT_PRICE_MODES = new Set(["vat", "server"]);

const toBool = (value) => {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "y", "1", "active"].includes(text)) return true;
  if (["false", "no", "n", "0", "inactive"].includes(text)) return false;
  return null;
};

const toNumber = (value) => {
  if (value == null || value === "") return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const normalize = (value) => String(value || "").trim();
const normalizeKey = (value) => normalize(value).toLowerCase();
const getRowValue = (row, keys) => {
  const normalizedEntries = Object.entries(row || {}).reduce((entries, [key, value]) => {
    entries[normalizeKey(key)] = value;
    return entries;
  }, {});

  for (const key of keys) {
    const value = normalizedEntries[normalizeKey(key)];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
};
const normalizePriceMode = (value) => {
  const mode = normalize(value);
  if (mode.toLowerCase() === "ex. vat" || mode.toLowerCase() === "ex vat") return "VAT";
  if (mode.toLowerCase() === "inc.vat" || mode.toLowerCase() === "inc vat") return "Server";
  return mode || "VAT";
};

const parseAllowedModes = (value) => {
  const modes = normalize(value)
    .split(/[,|/]+/)
    .map((mode) => mode.trim().toLowerCase())
    .filter(Boolean);

  return {
    allow_vat: modes.length ? modes.includes("vat") || modes.includes("ex vat") || modes.includes("ex. vat") : true,
    allow_server: modes.includes("server") || modes.includes("inc.vat") || modes.includes("inc vat"),
    allow_manager: false,
    allow_super: false,
  };
};

const statusClass = (status) => {
  const currentStatus = displayStatus(status);

  if (currentStatus === "Active") {
    return "bg-green-100 text-green-800";
  }

  if (currentStatus === "On Hold") {
    return "bg-yellow-100 text-yellow-800";
  }

  return "bg-slate-200 text-slate-700";
};

const TRADE_APPLICATION_STATUSES = ["Pending", "Approved", "Rejected"];
const CUSTOMER_PORTAL_PERMISSIONS = { access_customer_portal: true };

const getCurrentReviewer = () => {
  try {
    const user = JSON.parse(localStorage.getItem("fairchoice_user") || "{}");
    return user.username || user.staff_name || user.role || "Admin";
  } catch {
    return "Admin";
  }
};

const makeLoginUsername = (application) =>
  normalize(application.email || application.business_name)
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9@._-]/g, "");

const makeTemporaryPassword = () =>
  `FC${Math.random().toString(36).slice(2, 8).toUpperCase()}${Math.floor(
    100 + Math.random() * 900
  )}`;

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("All");
  const [cityFilter, setCityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerImportPreview, setCustomerImportPreview] = useState(null);
  const [importingCustomers, setImportingCustomers] = useState(false);
  const [tradeApplications, setTradeApplications] = useState([]);
  const [tradeApplicationStatus, setTradeApplicationStatus] =
    useState("Pending");
  const [tradeApplicationsError, setTradeApplicationsError] = useState("");
  const [processingApplicationId, setProcessingApplicationId] = useState(null);

  const [page, setPage] = useState(1);
  const rowsPerPage = 10;

  useEffect(() => {
    loadCustomers();
    loadTradeApplications();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await getCustomerAccounts();
      setCustomers(data || []);
    } catch (error) {
      console.error("Customer load error:", error);
      alert("Could not load customers.");
    } finally {
      setLoading(false);
    }
  };

  const loadTradeApplications = async () => {
    setTradeApplicationsError("");

    const { data, error } = await supabase
      .from("trade_account_applications")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Trade applications load error:", error);
      setTradeApplications([]);
      setTradeApplicationsError(
        `Could not load trade applications. Run supabase/trade_account_applications.sql if the table is missing. ${error.message}`
      );
      return;
    }

    setTradeApplications(data || []);
  };

  const countries = useMemo(() => {
    return ["All", ...new Set(customers.map((c) => c.country).filter(Boolean))];
  }, [customers]);

  const cities = useMemo(() => {
    return [
      "All",
      ...new Set(customers.map((c) => c.town_city || c.city || "").filter(Boolean)),
    ];
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return customers.filter((c) => {
      const name = String(c.account_name || "").toLowerCase();
      const contact = String(c.contact_name || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const email = String(c.email || "").toLowerCase();
      const townCity = c.town_city || c.city || "";
      const status = displayStatus(c.status);

      return (
        (keyword === "" ||
          name.includes(keyword) ||
          contact.includes(keyword) ||
          phone.includes(keyword) ||
          email.includes(keyword)) &&
        (countryFilter === "All" || c.country === countryFilter) &&
        (cityFilter === "All" || townCity === cityFilter) &&
        (statusFilter === "All" || status === statusFilter)
      );
    });
  }, [customers, search, countryFilter, cityFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / rowsPerPage));

  const pagedCustomers = filteredCustomers.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  const filteredTradeApplications = useMemo(
    () =>
      tradeApplications.filter(
        (application) =>
          String(application.status || "Pending") === tradeApplicationStatus
      ),
    [tradeApplications, tradeApplicationStatus]
  );

  const tradeApplicationCounts = useMemo(() => {
    return TRADE_APPLICATION_STATUSES.reduce((counts, status) => {
      counts[status] = tradeApplications.filter(
        (application) => String(application.status || "Pending") === status
      ).length;
      return counts;
    }, {});
  }, [tradeApplications]);

  const resetFilters = () => {
    setSearch("");
    setCountryFilter("All");
    setCityFilter("All");
    setStatusFilter("All");
    setPage(1);
  };

  const exportCustomers = () => {
    const accountRows = customers.map((customer) => ({
      "Customer Account ID": customer.id,
      "Customer Name": customer.account_name,
      "Account Code": customer.account_code || "",
      "Contact Name": customer.contact_name || "",
      Phone: customer.phone || "",
      Email: customer.email || "",
      Address: customer.address || customer.address_line_1 || "",
      "City / Town": customer.town_city || customer.city || "",
      Postcode: customer.postcode || "",
      Country: customer.country || "",
      "Credit Limit": Number(customer.credit_limit || 0),
      "Default Price Mode": displayPriceMode(customer.default_price_mode),
      "Allowed Price Modes": [
        customer.allow_vat ? "Ex.VAT" : "",
        customer.allow_server ? "Inc.VAT" : "",
      ].filter(Boolean).join(", "),
      "Opening Balance": Number(customer.opening_balance || 0),
      Active: customer.active !== false,
    }));

    const branchRows = customers.flatMap((customer) =>
      (customer.customer_branches || []).map((branch) => ({
        "Branch ID": branch.id,
        "Customer Account ID": customer.id,
        "Customer Name": customer.account_name,
        "Branch Name": branch.branch_name,
        "Delivery Address": branch.delivery_address || "",
        Postcode: branch.postcode || "",
        Country: branch.country || "",
        Phone: branch.phone || "",
        Email: branch.email || "",
        Active: branch.active !== false,
      }))
    );

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(accountRows), "Customer Accounts");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(branchRows), "Customer Branches");
    XLSX.writeFile(workbook, `fairchoice-customers-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadCustomerTemplate = () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          "Customer Account ID": "",
          "Customer Name": "",
          "Account Code": "",
          "Contact Name": "",
          Phone: "",
          Email: "",
          Address: "",
          "City / Town": "",
          Postcode: "",
          Country: "Wales",
          "Credit Limit": 0,
          "Default Price Mode": "Ex.VAT",
          "Allowed Price Modes": "Ex.VAT, Inc.VAT",
          "Opening Balance": 0,
          Active: true,
        },
      ]),
      "Customer Accounts"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        {
          "Branch ID": "",
          "Customer Account ID": "",
          "Customer Name": "",
          "Branch Name": "",
          "Delivery Address": "",
          Postcode: "",
          Country: "Wales",
          Phone: "",
          Email: "",
          Active: true,
        },
      ]),
      "Customer Branches"
    );
    XLSX.writeFile(workbook, "fairchoice-customer-import-template.xlsx");
  };

  const parseCustomerAccountRow = (row, rowNumber) => {
    const errors = [];
    const country = normalize(row.Country || row.country);
    const creditLimit = toNumber(row["Credit Limit"] ?? row.credit_limit);
    const openingBalance = toNumber(row["Opening Balance"] ?? row.opening_balance);
    const active = toBool(row.Active ?? row.active ?? true);
    const defaultPriceMode = normalizePriceMode(
      row["Default Price Mode"] || row.default_price_mode
    );

    if (!normalize(row["Customer Name"] || row.account_name)) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Customer Name", message: "Customer Name is required" });
    }
    if (!COUNTRY_VALUES.has(country.toLowerCase())) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Country", message: "Country must be Wales or England" });
    }
    if (!DEFAULT_PRICE_MODES.has(defaultPriceMode.toLowerCase())) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Default Price Mode", message: "Default Price Mode must be Ex.VAT or Inc.VAT" });
    }
    if (creditLimit === null) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Credit Limit", message: "Credit Limit must be numeric" });
    }
    if (openingBalance === null) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Opening Balance", message: "Opening Balance must be numeric" });
    }
    if (active === null) {
      errors.push({ rowNumber, sheet: "Customer Accounts", field: "Active", message: "Active must be TRUE or FALSE" });
    }

    return {
      errors,
      row: {
        id: normalize(row["Customer Account ID"] || row.id),
        account_name: normalize(row["Customer Name"] || row.account_name),
        account_code: normalize(row["Account Code"] || row.account_code),
        contact_name: normalize(row["Contact Name"] || row.contact_name),
        phone: normalize(row.Phone || row.phone),
        email: normalize(row.Email || row.email),
        address: normalize(row.Address || row.address),
        address_line_1: normalize(row.Address || row.address),
        town_city: normalize(
          getRowValue(row, [
            "City / Town",
            "Town / City",
            "City",
            "Town",
            "town_city",
            "city",
          ])
        ),
        postcode: normalize(row.Postcode || row.postcode),
        country,
        credit_limit: creditLimit ?? 0,
        default_price_mode: defaultPriceMode,
        opening_balance: openingBalance ?? 0,
        active: active ?? true,
        ...parseAllowedModes(row["Allowed Price Modes"] || row.allowed_price_modes),
      },
    };
  };

  const parseCustomerBranchRow = (row, rowNumber) => {
    const errors = [];
    const country = normalize(row.Country || row.country);
    const active = toBool(row.Active ?? row.active ?? true);

    if (!normalize(row["Branch Name"] || row.branch_name)) {
      errors.push({ rowNumber, sheet: "Customer Branches", field: "Branch Name", message: "Branch Name is required" });
    }
    if (!COUNTRY_VALUES.has(country.toLowerCase())) {
      errors.push({ rowNumber, sheet: "Customer Branches", field: "Country", message: "Country must be Wales or England" });
    }
    if (active === null) {
      errors.push({ rowNumber, sheet: "Customer Branches", field: "Active", message: "Active must be TRUE or FALSE" });
    }

    return {
      errors,
      row: {
        id: normalize(row["Branch ID"] || row.id),
        customer_account_id: normalize(row["Customer Account ID"] || row.customer_account_id),
        customer_name: normalize(row["Customer Name"] || row.customer_name),
        branch_name: normalize(row["Branch Name"] || row.branch_name),
        delivery_address: normalize(row["Delivery Address"] || row.delivery_address),
        postcode: normalize(row.Postcode || row.postcode),
        country,
        phone: normalize(row.Phone || row.phone),
        email: normalize(row.Email || row.email),
        active: active ?? true,
      },
    };
  };

  const handleCustomerImportFile = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    setImportingCustomers(true);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const accountSheet = workbook.Sheets["Customer Accounts"] || workbook.Sheets[workbook.SheetNames[0]];
      const branchSheet = workbook.Sheets["Customer Branches"] || workbook.Sheets[workbook.SheetNames[1]];
      const accountRows = accountSheet ? XLSX.utils.sheet_to_json(accountSheet, { defval: "" }) : [];
      const branchRows = branchSheet ? XLSX.utils.sheet_to_json(branchSheet, { defval: "" }) : [];
      const errors = [];
      const accountCreates = [];
      const accountUpdates = [];
      const branchCreates = [];
      const branchUpdates = [];
      const existingAccountsById = new Map(customers.map((customer) => [String(customer.id), customer]));
      const existingAccountsByName = new Map(customers.map((customer) => [normalizeKey(customer.account_name), customer]));
      const existingBranchesById = new Map(
        customers.flatMap((customer) =>
          (customer.customer_branches || []).map((branch) => [String(branch.id), branch])
        )
      );

      accountRows.forEach((rawRow, index) => {
        const rowNumber = index + 2;
        const { row, errors: rowErrors } = parseCustomerAccountRow(rawRow, rowNumber);
        errors.push(...rowErrors);
        if (rowErrors.length) return;

        if (row.id) {
          const existing = existingAccountsById.get(String(row.id));
          if (!existing) {
            errors.push({ rowNumber, sheet: "Customer Accounts", field: "Customer Account ID", message: "Invalid Customer Account ID" });
            return;
          }
          accountUpdates.push(row);
          return;
        }

        accountCreates.push(row);
      });

      branchRows.forEach((rawRow, index) => {
        const rowNumber = index + 2;
        const { row, errors: rowErrors } = parseCustomerBranchRow(rawRow, rowNumber);
        errors.push(...rowErrors);
        if (rowErrors.length) return;

        if (row.id) {
          if (!existingBranchesById.has(String(row.id))) {
            errors.push({ rowNumber, sheet: "Customer Branches", field: "Branch ID", message: "Invalid Branch ID" });
            return;
          }
          branchUpdates.push(row);
          return;
        }

        const hasAccountId =
          row.customer_account_id &&
          (existingAccountsById.has(String(row.customer_account_id)) ||
            accountCreates.some((account) => normalizeKey(account.account_name) === normalizeKey(row.customer_name)));
        const hasCustomerName =
          row.customer_name &&
          (existingAccountsByName.has(normalizeKey(row.customer_name)) ||
            accountCreates.some((account) => normalizeKey(account.account_name) === normalizeKey(row.customer_name)));

        if (!hasAccountId && !hasCustomerName) {
          errors.push({ rowNumber, sheet: "Customer Branches", field: "Customer Account ID", message: "New branch needs Customer Account ID or exact Customer Name" });
          return;
        }

        branchCreates.push(row);
      });

      setCustomerImportPreview({
        customersChecked: accountRows.length,
        branchesChecked: branchRows.length,
        accountCreates,
        accountUpdates,
        branchCreates,
        branchUpdates,
        errors,
      });
    } catch (error) {
      alert("Customer import preview failed: " + error.message);
    }

    setImportingCustomers(false);
  };

  const saveImportedOpeningBalance = async (customerName, openingBalance) => {
    if (!customerName) return;

    const { data: existingBalance, error: lookupError } = await supabase
      .from("customer_opening_balances")
      .select("id")
      .eq("customer_name", customerName)
      .maybeSingle();

    if (lookupError) throw lookupError;

    if (existingBalance?.id) {
      const { error } = await supabase
        .from("customer_opening_balances")
        .update({ opening_balance: Number(openingBalance || 0) })
        .eq("id", existingBalance.id);

      if (error) throw error;
      return;
    }

    const { error } = await supabase.from("customer_opening_balances").insert({
      customer_name: customerName,
      opening_balance: Number(openingBalance || 0),
    });

    if (error) throw error;
  };

  const confirmCustomerImport = async () => {
    if (!customerImportPreview || customerImportPreview.errors.length) return;

    const ok = window.confirm(
      [
        `Customers checked: ${customerImportPreview.customersChecked}`,
        `Customers created: ${customerImportPreview.accountCreates.length}`,
        `Customers updated: ${customerImportPreview.accountUpdates.length}`,
        `Branches created: ${customerImportPreview.branchCreates.length}`,
        `Branches updated: ${customerImportPreview.branchUpdates.length}`,
        "Apply these changes now?",
      ].join("\n")
    );

    if (!ok) return;

    setImportingCustomers(true);

    try {
      const createdCustomerByName = new Map();

      for (const account of customerImportPreview.accountUpdates) {
        const { id, opening_balance, ...payload } = account;
        const { error } = await supabase.from("customer_accounts").update(payload).eq("id", id);
        if (error) throw error;
        await saveImportedOpeningBalance(account.account_name, opening_balance);
      }

      for (const account of customerImportPreview.accountCreates) {
        const { id, opening_balance, ...payload } = account;
        const { data, error } = await supabase
          .from("customer_accounts")
          .insert(payload)
          .select()
          .single();
        if (error) throw error;
        createdCustomerByName.set(normalizeKey(data.account_name), data);
        await saveImportedOpeningBalance(data.account_name, opening_balance);
      }

      for (const branch of customerImportPreview.branchUpdates) {
        const { id, customer_name, email, ...payload } = branch;
        const { error } = await supabase.from("customer_branches").update(payload).eq("id", id);
        if (error) throw error;
      }

      for (const branch of customerImportPreview.branchCreates) {
        const existingCustomer =
          customers.find((customer) => String(customer.id) === String(branch.customer_account_id)) ||
          customers.find((customer) => normalizeKey(customer.account_name) === normalizeKey(branch.customer_name)) ||
          createdCustomerByName.get(normalizeKey(branch.customer_name));

        const { id, customer_name, email, ...payload } = branch;
        const { error } = await supabase.from("customer_branches").insert({
          ...payload,
          customer_account_id: existingCustomer?.id || branch.customer_account_id,
        });
        if (error) throw error;
      }

      console.log("Customer import applied", customerImportPreview);
      alert("Customer import completed successfully.");
      setCustomerImportPreview(null);
      await loadCustomers();
    } catch (error) {
      alert("Customer import failed: " + error.message);
    }

    setImportingCustomers(false);
  };

  const approveTradeApplication = async (application) => {
    if (String(application.status || "Pending") !== "Pending") {
      alert("Only pending applications can be approved.");
      return;
    }

    const ok = window.confirm(
      `Approve trade account application for ${application.business_name}?`
    );

    if (!ok) return;

    const username = makeLoginUsername(application);
    const temporaryPassword = makeTemporaryPassword();

    setProcessingApplicationId(application.id);

    try {
      const { data: existingLogins, error: loginLookupError } = await supabase
        .from("login_users")
        .select("id")
        .eq("username", username)
        .limit(1);

      if (loginLookupError) throw loginLookupError;

      if (existingLogins?.length) {
        alert(
          `A login already exists for ${username}. Update the existing login or change the application email before approving.`
        );
        return;
      }

      const customerAccount = await saveCustomerAccount({
        account_name: application.business_name,
        contact_name: application.contact_name,
        phone: application.phone,
        mobile: application.phone,
        email: application.email,
        vat_number: application.vat_number,
        address_line_1: application.shop_address,
        address_line_2: "",
        town_city: "",
        postcode: application.postcode,
        country: application.country || "Wales",
        credit_limit: 0,
        payment_terms: "",
        default_price_mode: "VAT",
        status: "Active",
        active: true,
        allow_vat: true,
        allow_server: true,
        allow_manager: false,
        allow_super: false,
      });

      await saveCustomerBranch({
        customer_account_id: customerAccount.id,
        branch_name: application.business_name,
        delivery_address: application.shop_address,
        postcode: application.postcode,
        country: application.country || "Wales",
        phone: application.phone,
        active: true,
      });

      const { error: loginError } = await supabase.from("login_users").insert({
        staff_id: null,
        username,
        email: application.email || null,
        password: temporaryPassword,
        role: "Customer",
        customer_account_id: customerAccount.id,
        active: true,
        permissions: { ...CUSTOMER_PORTAL_PERMISSIONS },
      });

      if (loginError) throw loginError;

      const { error: updateError } = await supabase
        .from("trade_account_applications")
        .update({
          status: "Approved",
          reviewed_by: getCurrentReviewer(),
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", application.id);

      if (updateError) throw updateError;

      await Promise.all([loadCustomers(), loadTradeApplications()]);
      alert(
        [
          "Trade account approved.",
          "",
          `Customer login username: ${username}`,
          `Temporary password: ${temporaryPassword}`,
          "",
          "Give these login details to the customer after your normal checks.",
        ].join("\n")
      );
    } catch (error) {
      console.error("Trade application approval error:", error);
      alert(`Approval failed: ${error.message || error}`);
    } finally {
      setProcessingApplicationId(null);
    }
  };

  const rejectTradeApplication = async (application) => {
    if (String(application.status || "Pending") !== "Pending") {
      alert("Only pending applications can be rejected.");
      return;
    }

    const ok = window.confirm(
      `Reject trade account application for ${application.business_name}?`
    );

    if (!ok) return;

    setProcessingApplicationId(application.id);

    const { error } = await supabase
      .from("trade_account_applications")
      .update({
        status: "Rejected",
        reviewed_by: getCurrentReviewer(),
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", application.id);

    setProcessingApplicationId(null);

    if (error) {
      alert(`Reject failed: ${error.message}`);
      return;
    }

    await loadTradeApplications();
  };

  return (
    <div className="p-4">
      <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">Customer Management</h2>
            <p className="text-sm text-slate-600">
              Manage customer accounts, branches, pricing and payment setup.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCustomers}
              className="h-9 rounded-full bg-slate-700 px-4 text-sm font-bold text-white hover:bg-slate-800"
            >
              Export Customers
            </button>
            <button
              type="button"
              onClick={downloadCustomerTemplate}
              className="h-9 rounded-full bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800"
            >
              Download Import Template
            </button>
            <label className="flex h-9 cursor-pointer items-center rounded-full bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700">
              <input
                type="file"
                accept=".xlsx,.csv"
                onChange={handleCustomerImportFile}
                disabled={importingCustomers}
                className="hidden"
              />
              Import Customers
            </label>
            <button
              type="button"
              onClick={() => {
                setEditingCustomer(null);
                setShowCustomerForm(true);
              }}
              className="h-9 rounded-full bg-green-700 px-4 text-sm font-bold text-white hover:bg-green-800"
            >
              + New Customer
            </button>
          </div>
        </div>

        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-bold">Trade Applications</h3>
              <p className="text-sm text-slate-600">
                Review trade account requests before customer access is created.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {TRADE_APPLICATION_STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setTradeApplicationStatus(status)}
                  className={`h-8 rounded-full px-3 text-xs font-bold ${
                    tradeApplicationStatus === status
                      ? "bg-slate-800 text-white"
                      : "border border-slate-300 bg-white text-slate-700"
                  }`}
                >
                  {status} ({tradeApplicationCounts[status] || 0})
                </button>
              ))}
            </div>
          </div>

          {tradeApplicationsError ? (
            <div className="rounded-lg border border-red-200 bg-white p-3 text-sm font-bold text-red-700">
              {tradeApplicationsError}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-300 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-700 text-white">
                  <tr>
                    <th className="px-2 py-2 text-left">Business</th>
                    <th className="px-2 py-2 text-left">Contact</th>
                    <th className="px-2 py-2 text-left">Phone</th>
                    <th className="px-2 py-2 text-left">Email</th>
                    <th className="px-2 py-2 text-left">Country</th>
                    <th className="px-2 py-2 text-left">Type</th>
                    <th className="px-2 py-2 text-left">Submitted</th>
                    <th className="px-2 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTradeApplications.map((application) => {
                    const isProcessing =
                      processingApplicationId === application.id;
                    const isPending =
                      String(application.status || "Pending") === "Pending";

                    return (
                      <tr
                        key={application.id}
                        className="border-t border-slate-200 align-top"
                      >
                        <td className="px-2 py-2 font-bold">
                          <div>{application.business_name || "-"}</div>
                          <div className="text-xs font-normal text-slate-500">
                            {application.shop_address || "-"}{" "}
                            {application.postcode || ""}
                          </div>
                          {application.notes && (
                            <div className="mt-1 text-xs font-normal text-slate-600">
                              Notes: {application.notes}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {application.contact_name || "-"}
                        </td>
                        <td className="px-2 py-2">
                          {application.phone || "-"}
                        </td>
                        <td className="px-2 py-2">
                          {application.email || "-"}
                        </td>
                        <td className="px-2 py-2">
                          {application.country || "-"}
                        </td>
                        <td className="px-2 py-2">
                          <div>{application.business_type || "-"}</div>
                          {(application.vat_number ||
                            application.company_number) && (
                            <div className="text-xs text-slate-500">
                              VAT: {application.vat_number || "-"} | Co:{" "}
                              {application.company_number || "-"}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {application.created_at
                            ? new Date(application.created_at).toLocaleDateString(
                                "en-GB"
                              )
                            : "-"}
                          {application.reviewed_by && (
                            <div className="text-xs text-slate-500">
                              Reviewed by {application.reviewed_by}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {isPending ? (
                            <div className="flex justify-center gap-2">
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => approveTradeApplication(application)}
                                className="h-8 rounded bg-green-700 px-3 text-xs font-bold text-white disabled:bg-slate-300"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => rejectTradeApplication(application)}
                                className="h-8 rounded bg-red-700 px-3 text-xs font-bold text-white disabled:bg-slate-300"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">
                              {application.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTradeApplications.length === 0 && (
                    <tr>
                      <td
                        colSpan="8"
                        className="p-4 text-center text-sm text-slate-500"
                      >
                        No {tradeApplicationStatus.toLowerCase()} trade
                        applications.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {customerImportPreview && (
          <div className="mb-4 rounded-xl border border-slate-300 bg-slate-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
                <div><strong>Customers checked:</strong> {customerImportPreview.customersChecked}</div>
                <div><strong>Customers created:</strong> {customerImportPreview.accountCreates.length}</div>
                <div><strong>Customers updated:</strong> {customerImportPreview.accountUpdates.length}</div>
                <div><strong>Branches created:</strong> {customerImportPreview.branchCreates.length}</div>
                <div><strong>Branches updated:</strong> {customerImportPreview.branchUpdates.length}</div>
                <div><strong>Errors:</strong> {customerImportPreview.errors.length}</div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCustomerImportPreview(null)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmCustomerImport}
                  disabled={customerImportPreview.errors.length > 0 || importingCustomers}
                  className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:bg-slate-300"
                >
                  Confirm Import
                </button>
              </div>
            </div>

            {customerImportPreview.errors.length > 0 && (
              <div className="mt-3 max-h-64 overflow-auto rounded-lg border bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-red-50 text-red-700">
                    <tr>
                      <th className="p-2 text-left">Sheet</th>
                      <th className="p-2 text-left">Row</th>
                      <th className="p-2 text-left">Field</th>
                      <th className="p-2 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerImportPreview.errors.map((error, index) => (
                      <tr key={`${error.sheet}-${error.rowNumber}-${error.field}-${index}`} className="border-t">
                        <td className="p-2">{error.sheet}</td>
                        <td className="p-2">{error.rowNumber}</td>
                        <td className="p-2">{error.field}</td>
                        <td className="p-2">{error.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            placeholder="Search customer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} md:col-span-2`}
          />

          <select
            value={countryFilter}
            onChange={(e) => {
              setCountryFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            {countries.map((country) => (
              <option key={country} value={country}>
                {country === "All" ? "All Countries" : country}
              </option>
            ))}
          </select>

          <select
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            {cities.map((city) => (
              <option key={city} value={city}>
                {city === "All" ? "All Towns / Cities" : city}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="On Hold">On Hold</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>

        <button type="button" onClick={resetFilters} className={`${buttonClass} mb-3`}>
          Clear Filters
        </button>

        {loading ? (
          <div className="p-4 text-sm font-bold">Loading customers...</div>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-300">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="px-2 py-2 text-left">Account Name</th>
                  <th className="px-2 py-2 text-left">Contact</th>
                  <th className="px-2 py-2 text-left">Phone</th>
                  <th className="px-2 py-2 text-left">Town / City</th>
                  <th className="px-2 py-2 text-left">Country</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Credit Limit</th>
                  <th className="px-2 py-2 text-left">Price Mode</th>
                  <th className="px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                {pagedCustomers.map((customer) => (
                  <tr key={customer.id} className="border-t border-slate-300">
                    <td className="px-2 py-2 font-bold">{customer.account_name || "-"}</td>
                    <td className="px-2 py-2">{customer.contact_name || "-"}</td>
                    <td className="px-2 py-2">{customer.phone || "-"}</td>
                    <td className="px-2 py-2">
                      {customer.town_city || customer.city || "-"}
                    </td>
                    <td className="px-2 py-2">{customer.country || "-"}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusClass(
                          customer.status
                        )}`}
                      >
                        {displayStatus(customer.status)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-bold">
               {formatCurrency(customer.credit_limit)}
                    </td>
                    <td className="px-2 py-2">{displayPriceMode(customer.default_price_mode)}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCustomer(customer);
                          setShowCustomerForm(true);
                        }}
                        className="h-8 rounded bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {pagedCustomers.length === 0 && (
                  <tr>
                    <td colSpan="9" className="p-4 text-center text-sm text-slate-500">
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-sm">
          <div>
            Showing {pagedCustomers.length} of {filteredCustomers.length} records
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 rounded border border-slate-400 px-3 font-bold disabled:opacity-40"
            >
              Previous
            </button>

            <span className="font-bold">
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 rounded border border-slate-400 px-3 font-bold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showCustomerForm && (
        <CustomerForm
          editingCustomer={editingCustomer}
          onClose={() => {
            setShowCustomerForm(false);
            setEditingCustomer(null);
          }}
          onSaved={() => {
            loadCustomers();
            setShowCustomerForm(false);
            setEditingCustomer(null);
          }}
        />
      )}
    </div>
  );
}
