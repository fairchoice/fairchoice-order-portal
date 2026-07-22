const ORDER_NUMBER_PATTERN = /^ORD-(\d+)/i;

export function formatDisplayOrderId(value) {
  if (value === null || value === undefined) return "";

  const orderId = String(value).trim();
  const match = orderId.match(ORDER_NUMBER_PATTERN);

  if (!match) return orderId;

  return `ORD-${match[1].slice(0, 10)}`;
}
