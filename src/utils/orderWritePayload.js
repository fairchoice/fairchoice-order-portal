const ORDER_WRITE_COMPATIBILITY_FIELDS = new Set([
  "finalTotal",
  "final_total",
  "total",
  "totalAmount",
  "total_amount",
  "orderTotal",
]);

export const sanitizeOrderWritePayload = (payload = {}) =>
  Object.fromEntries(
    Object.entries(payload || {}).filter(
      ([key]) => !ORDER_WRITE_COMPATIBILITY_FIELDS.has(key)
    )
  );
