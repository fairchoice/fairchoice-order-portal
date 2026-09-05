export const PROMOTION_RUN_ROUTE = "#promotion-run";

export const PROMOTION_PAYMENT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
];

export const CUSTOMER_MODES = {
  REGISTERED: "registered",
  GUEST: "guest",
};

export function canUsePromotionInvoice(customerMode, customer) {
  return customerMode === CUSTOMER_MODES.REGISTERED && Boolean(customer?.id);
}

export function getPromotionRunCustomer({ customerMode, customer } = {}) {
  if (customerMode === CUSTOMER_MODES.GUEST) {
    return {
      id: null,
      account_name: "Guest Customer",
      country: "",
      customer_branches: [],
    };
  }
  return customer || null;
}

export function buildPromotionRunNotes({
  paymentMethod,
  competitorSales,
  customerMode,
  invoiceRequested,
  invoiceEmail,
  promotionName,
} = {}) {
  const lines = [
    "Promotion Run sale",
    promotionName ? `Promotion: ${promotionName}` : "",
    paymentMethod ? `Payment method: ${paymentMethod}` : "",
    `Customer mode: ${customerMode === CUSTOMER_MODES.GUEST ? "Guest Customer" : "Registered Customer"}`,
    competitorSales ? `Competitor sales: ${String(competitorSales).trim()}` : "Competitor sales: Not provided",
    invoiceRequested ? "Invoice requested: Yes" : "Invoice requested: No",
    invoiceRequested && invoiceEmail ? `Invoice email: ${String(invoiceEmail).trim()}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}

export function makePromotionOrderNumber() {
  const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `ORD-${Date.now()}-${suffix}`;
}

export function buildPromotionCartLine({ product, quantity = 1, unitPrice = 0 } = {}) {
  if (!product?.id) throw new Error("Promotion product is required.");
  const qty = Math.max(1, Number(quantity || 1));
  const price = Math.max(0, Number(unitPrice || 0));
  const lineTotal = qty * price;

  return {
    ...product,
    id: product.id,
    productId: product.id,
    product_id: product.id,
    productCode: product.productCode || product.product_code || "",
    product_code: product.product_code || product.productCode || "",
    name: product.name || product.product_name || "Promotion Product",
    productName: product.name || product.product_name || "Promotion Product",
    product_name: product.product_name || product.name || "Promotion Product",
    qty,
    quantity: qty,
    pickedQty: Math.min(Number(product.stock || 0), qty),
    sourceStatus: Number(product.stock || 0) < qty ? "Need Supplier" : "In Stock",
    includeInPicking: true,
    selectedPrice: price,
    price,
    unitPrice: price,
    unit_price: price,
    amount: lineTotal,
    lineTotal,
    line_total: lineTotal,
    total: lineTotal,
  };
}
