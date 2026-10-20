// Keep the legacy single offer alongside the new list until all clients are upgraded.
export const getCustomerOfferCodeIds = (customer = {}) => [...new Set([
  customer.customer_price_overlay_code_id,
  ...(customer.customer_price_overlay_code_ids || []),
].filter(Boolean).map(String))];

export const getActiveCustomerOfferCodeIds = (customer, codes = []) =>
  getCustomerOfferCodeIds(customer).filter((id) => codes.some((code) =>
    String(code.id) === id && code.active !== false && String(code.code_type || "").toLowerCase() === "sub" &&
    String(code.parent_price_code_id || "") === String(customer.customer_price_code_id || "")
  ));

export const normalizeOfferCodeIds = (value) => [...new Set(
  (Array.isArray(value) ? value : String(value || "").split(","))
    .map((id) => String(id).trim()).filter(Boolean)
)];
