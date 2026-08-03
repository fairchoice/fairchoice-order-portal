const number = (value) => Number(value || 0);

export function getPickingAvailability(remaining, product) {
  if (!product || product.inventoryLocationMissing) {
    return {
      key: "not_configured",
      label: "Stock not set",
      detail: "Add this product to the selected warehouse inventory",
      stock: 0,
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  const stock = Math.max(0, number(product.stock));
  if (stock <= 0) {
    return {
      key: "pre_order",
      label: "Pre-order",
      detail: "No stock available",
      stock,
      className: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  if (stock < remaining) {
    return {
      key: "part_stock",
      label: "Part stock",
      detail: `${stock} available`,
      stock,
      className: "border-yellow-200 bg-yellow-50 text-yellow-800",
    };
  }
  return {
    key: "in_stock",
    label: "In stock",
    detail: `${stock} available`,
    stock,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}
