const gbpFormatter = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
});

export function formatCurrency(value) {
  return gbpFormatter.format(Number(value || 0));
}


