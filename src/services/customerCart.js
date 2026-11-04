import { supabase } from "./supabase.js";
import { getFcSessionState, readStoredFcProfile } from "./fcSession.js";

export const CENTRAL_CART_ENABLED =
  String(import.meta.env?.VITE_CENTRAL_CART_ENABLED || "")
    .trim()
    .toLowerCase() === "true";

function normalizeId(value) {
  return value === null || value === undefined || value === ""
    ? null
    : String(value);
}

function getSessionCredentials(profile) {
  const resolvedProfile = profile || readStoredFcProfile();
  const session = getFcSessionState(resolvedProfile);
  if (!session.valid) {
    const error = new Error("FC session is invalid or expired. Please sign in again.");
    error.code = "28000";
    throw error;
  }
  return {
    username: session.username,
    sessionToken: session.token,
  };
}

function getScope({ customerAccountId, customerBranchId }) {
  const accountId = normalizeId(customerAccountId);
  if (!accountId) throw new Error("Customer account is required for the central cart.");
  return {
    accountId,
    branchId: normalizeId(customerBranchId),
  };
}

async function callCartRpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export async function loadCentralCart({
  profile,
  customerAccountId,
  customerBranchId = null,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  const { accountId, branchId } = getScope({ customerAccountId, customerBranchId });

  const result = await callCartRpc("fc_cart_get_or_create_v1", {
    p_customer_account_id: accountId,
    p_customer_branch_id: branchId,
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });

  return {
    cartId: result?.cart_id || null,
    status: result?.status || "ACTIVE",
    submissionOrderNumber: result?.submission_order_number || null,
    updatedAt: result?.updated_at || null,
    updatedByName: result?.updated_by_name || "",
    items: Array.isArray(result?.items) ? result.items : [],
  };
}

export async function incrementCentralCartItem({
  profile,
  cartId,
  productId,
  delta = 1,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  if (!cartId || !productId) throw new Error("Cart and product are required.");

  return callCartRpc("fc_cart_increment_item_v1", {
    p_cart_id: cartId,
    p_product_id: productId,
    p_delta: Number(delta || 0),
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });
}

export async function setCentralCartItemQuantity({
  profile,
  cartId,
  productId,
  quantity,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  if (!cartId || !productId) throw new Error("Cart and product are required.");

  return callCartRpc("fc_cart_set_quantity_v1", {
    p_cart_id: cartId,
    p_product_id: productId,
    p_quantity: Number(quantity || 0),
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });
}

export async function removeCentralCartItem({ profile, cartId, productId }) {
  return setCentralCartItemQuantity({
    profile,
    cartId,
    productId,
    quantity: 0,
  });
}

export async function beginCentralCartSubmission({
  profile,
  cartId,
  orderNumber,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  if (!cartId || !orderNumber) throw new Error("Cart and order number are required.");

  return callCartRpc("fc_cart_begin_submission_v1", {
    p_cart_id: cartId,
    p_order_number: orderNumber,
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });
}

export async function finalizeCentralCartSubmission({
  profile,
  cartId,
  orderNumber,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  if (!cartId || !orderNumber) throw new Error("Cart and order number are required.");

  return callCartRpc("fc_cart_finalize_submission_v1", {
    p_cart_id: cartId,
    p_order_number: orderNumber,
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });
}

export async function cancelCentralCartSubmission({
  profile,
  cartId,
  orderNumber,
}) {
  const { username, sessionToken } = getSessionCredentials(profile);
  if (!cartId || !orderNumber) return null;

  return callCartRpc("fc_cart_cancel_submission_v1", {
    p_cart_id: cartId,
    p_order_number: orderNumber,
    p_fc_username: username,
    p_fc_session_token: sessionToken,
  });
}
