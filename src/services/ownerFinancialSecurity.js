import { supabase } from "./supabase";

export const OWNER_USERNAME = "nisstaj_admin";

const missingSecurityMessage =
  "Owner financial security is not installed yet. Review and apply the additive owner-security migration before using protected payment actions.";

const isMissingRpc = (error = {}) => {
  const text = String(error.message || error.details || "").toLowerCase();
  return error.code === "42883" || error.code === "PGRST202" || text.includes("could not find the function");
};

export function isOwnerUser(user) {
  return String(user?.username || "").trim().toLowerCase() === OWNER_USERNAME;
}

export function validateOwnerPassword(password) {
  const value = String(password || "");
  if (value.length < 12) throw new Error("Owner password must be at least 12 characters.");
  if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error("Owner password must include upper-case, lower-case, number and symbol characters.");
  }
  return value;
}

export async function getOwnerSecurityStatus() {
  const { data, error } = await supabase.rpc("owner_financial_security_status", {
    p_username: OWNER_USERNAME,
  });
  if (error) {
    if (isMissingRpc(error)) return { installed: false, configured: false };
    throw error;
  }
  return { installed: true, configured: Boolean(data?.configured), lockedUntil: data?.locked_until || null };
}

export async function setupOwnerPassword({ currentLoginPassword, newPassword }) {
  validateOwnerPassword(newPassword);
  const { data, error } = await supabase.rpc("setup_owner_financial_password", {
    p_username: OWNER_USERNAME,
    p_current_login_password: String(currentLoginPassword || ""),
    p_new_password: newPassword,
  });
  if (error) {
    if (isMissingRpc(error)) throw new Error(missingSecurityMessage);
    throw error;
  }
  return data;
}

export async function changeOwnerPassword({ currentOwnerPassword, newPassword }) {
  validateOwnerPassword(newPassword);
  const { data, error } = await supabase.rpc("change_owner_financial_password", {
    p_username: OWNER_USERNAME,
    p_current_password: String(currentOwnerPassword || ""),
    p_new_password: newPassword,
  });
  if (error) {
    if (isMissingRpc(error)) throw new Error(missingSecurityMessage);
    throw error;
  }
  return data;
}
