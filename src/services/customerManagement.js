import { supabase } from "./supabase";

const normaliseStatus = (status) => status || "Active";
const normalisePriceMode = (mode) =>
  mode === "Super" || mode === "super" ? "Admin Offer" : mode || "VAT";

export async function getCustomerAccounts() {
  const { data, error } = await supabase
    .from("customer_accounts")
    .select(`
      *,
      customer_branches (*)
    `)
    .order("account_name", { ascending: true });

  if (error) throw error;
  return data || [];
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
    default_price_mode: defaultPriceMode === "Admin Offer" ? "VAT" : defaultPriceMode,

    status: normaliseStatus(account.status),
    active: account.active ?? true,

    allow_vat: account.allow_vat ?? true,
    allow_server: account.allow_server ?? false,
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
