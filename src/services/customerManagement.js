import { supabase } from "./supabase";
import { getStoredCustomerStatus } from "../utils/customerStatus";
import { isTestAccount } from "../utils/testAccountFiltering";

import { requirePerformanceGroup } from "../utils/performanceGroups.js";

const normaliseStatus = getStoredCustomerStatus;
const normalisePriceMode = (mode) => {
  const normalizedMode = String(mode || "VAT").trim().toLowerCase();
  if (["server", "inc.vat", "inc vat", "royalty", "owner offer", "manager", "manager offer"].includes(normalizedMode)) return "Server";
  return "VAT";
};

export async function getCustomerAccounts({ operationalOnly = false } = {}) {
  let query = supabase
    .from("customer_accounts")
    .select(`
      *,
      customer_branches (*)
    `);

  if (operationalOnly) {
    query = query
      .eq("active", true)
      .or("status.is.null,status.ilike.Active");
  }

  const { data, error } = await query.order("account_name", { ascending: true });

  if (error) throw error;
  return operationalOnly ? (data || []).filter((row) => !isTestAccount(row)) : data || [];
}

export async function getStaffUsers() {
  const { data, error } = await supabase
    .from("staff_users")
    .select("*")
    .order("staff_name", { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function saveStaffUser(staff) {
  const payload = {
    staff_name: staff.staff_name,
    phone: staff.phone || "",
    email: staff.email || "",
    role: staff.role || "Staff",
    active: staff.active ?? true,
  };

  if (staff.id) {
    const { data, error } = await supabase
      .from("staff_users")
      .update(payload)
      .eq("id", staff.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("staff_users")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function toggleCustomerActive(id, active) {
  const { data, error } = await supabase
    .from("customer_accounts")
    .update({ active })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveCustomerAccount(account) {
  const addressLine1 = account.address_line_1 || account.address || "";
  const fullAddress = [
    addressLine1,
    account.address_line_2,
    account.town_city,
    account.postcode,
  ]
    .filter(Boolean)
    .join(", ");

  const defaultPriceMode = normalisePriceMode(account.default_price_mode);

  const payload = {
    account_name: account.account_name,
    performance_group: requirePerformanceGroup(account.performance_group),
    contact_name: account.contact_name || "",
    phone: account.phone || "",
    mobile: account.mobile || "",
    email: account.email || "",
    vat_number: account.vat_number || "",

    address_line_1: addressLine1,
    address_line_2: account.address_line_2 || "",
    town_city: account.town_city || "",
    postcode: account.postcode || "",
    address: fullAddress || account.address || "",
    country: account.country || "Wales",

    payment_terms: account.payment_terms || "",
    credit_limit: Number(account.credit_limit || 0),
    default_price_mode: defaultPriceMode,
    customer_price_code_id: account.customer_price_code_id || null,

    status: normaliseStatus(account.status),
    active: account.active ?? true,

    // Legacy flags remain compatible with the two normal base modes.
    allow_vat: defaultPriceMode === "VAT",
    allow_server: defaultPriceMode === "Server",
    allow_manager: false,
    allow_super: false,
  };

  if (account.id) {
    const { data, error } = await supabase
      .from("customer_accounts")
      .update(payload)
      .eq("id", account.id)
      .select()
      .single();

    if (error) throw error;
    // Customer edits are defaults for future orders; existing order snapshots stay unchanged.
    return data;
  }

  const { data, error } = await supabase
    .from("customer_accounts")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveCustomerBranch(branch) {
  const payload = {
    customer_account_id: branch.customer_account_id,
    branch_name: branch.branch_name,
    delivery_address: branch.delivery_address || "",
    postcode: branch.postcode || "",
    country: branch.country || "Wales",
    phone: branch.phone || "",
    active: branch.active ?? true,
  };

  if (branch.id) {
    const { data, error } = await supabase
      .from("customer_branches")
      .update(payload)
      .eq("id", branch.id)
      .select()
      .single();

    if (error) throw error;
    // Branch edits apply when a new order is created.
    return data;
  }

  const { data, error } = await supabase
    .from("customer_branches")
    .insert(payload)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function toggleBranchActive(id, active) {
  const { data, error } = await supabase
    .from("customer_branches")
    .update({ active })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function toggleStaffActive(id, active) {
  const { data, error } = await supabase
    .from("staff_users")
    .update({ active })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getCustomerBranches(customerAccountId) {
  const { data, error } = await supabase
    .from("customer_branches")
    .select("*")
    .eq("customer_account_id", customerAccountId)
    .order("branch_name", { ascending: true });

  if (error) throw error;
  return data || [];
}
