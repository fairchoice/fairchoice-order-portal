// Keep the legacy single offer alongside the new list until all clients are upgraded.
export const getCustomerOfferCodeIds = (customer = {}) => [...new Set([
  customer.customer_price_overlay_code_id,
  ...(customer.customer_price_overlay_code_ids || []),
].filter(Boolean).map(String))];

export const canAssignCustomerOfferCode = (customer, code) => {
  if (!customer?.customer_price_code_id || !code || code.active === false) return false;
  if (String(code.id) === String(customer.customer_price_code_id)) return false;
  return String(code.code_type || "base").toLowerCase() !== "sub" ||
    String(code.parent_price_code_id || "") === String(customer.customer_price_code_id);
};

export const getActiveCustomerOfferCodeIds = (customer, codes = []) =>
  getCustomerOfferCodeIds(customer).filter((id) => codes.some((code) =>
    String(code.id) === id && canAssignCustomerOfferCode(customer, code)
  ));

export const normalizeOfferCodeIds = (value) => [...new Set(
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((id) => String(id).trim()).filter(Boolean)
)];

// Use the loaded assignment as a compare-and-set guard for concurrent edits.
export async function saveCustomerOfferCode(client, customer, codeId, remove = false) {
  const currentIds = getCustomerOfferCodeIds(customer);
  const nextIds = remove
    ? currentIds.filter((id) => id !== String(codeId))
    : [...new Set([...currentIds, String(codeId)])];
  let query = client.from("customer_accounts").update({
    customer_price_overlay_code_ids: nextIds,
    customer_price_overlay_code_id: nextIds[0] || null,
  }).eq("id", customer.id)
    .eq("customer_price_overlay_code_ids", `{${(customer.customer_price_overlay_code_ids || []).join(",")}}`);
  query = customer.customer_price_overlay_code_id
    ? query.eq("customer_price_overlay_code_id", customer.customer_price_overlay_code_id)
    : query.is("customer_price_overlay_code_id", null);
  query = customer.customer_price_code_id
    ? query.eq("customer_price_code_id", customer.customer_price_code_id)
    : query.is("customer_price_code_id", null);
  const { data, error } = await query.select("id").single();
  if (error || !data) throw error || new Error("Customer changed. Refresh and try again.");
  return nextIds;
}
