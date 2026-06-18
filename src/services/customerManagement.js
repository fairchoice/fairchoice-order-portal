import { supabase } from "./supabase";

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
  const payload = {
    account_name: account.account_name,
    contact_name: account.contact_name || "",
    phone: account.phone || "",
    email: account.email || "",
    address: account.address || "",
    country: account.country || "Wales",
    credit_limit: Number(account.credit_limit || 0),
    default_price_mode: account.default_price_mode || "VAT",
    active: account.active ?? true,
    allow_vat: account.allow_vat ?? true,
    allow_server: account.allow_server ?? false,
    allow_manager: account.allow_manager ?? false,
    allow_super: account.allow_super ?? false,
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