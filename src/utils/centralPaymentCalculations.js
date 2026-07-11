const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

export const getInvoiceReference = (invoice = {}) =>
  String(
    invoice.invoice_number ||
      invoice.reference_no ||
      invoice.order_number ||
      invoice.id ||
      ""
  ).trim();

export const getInvoiceAmount = (invoice = {}) =>
  money(
    invoice.invoice_total ??
      invoice.invoice_amount ??
      invoice.total_amount ??
      invoice.order_total ??
      invoice.final_total ??
      invoice.amount ??
      invoice.debit ??
      0
  );

export const getInvoiceDate = (invoice = {}) =>
  invoice.invoice_date ||
  invoice.delivered_at ||
  invoice.delivery_confirmed_at ||
  invoice.created_at ||
  new Date(0).toISOString();

export function allocatePaymentOldestFirst(invoices = [], amount = 0) {
  let remaining = money(amount);
  const sorted = [...invoices]
    .filter((invoice) => Number(invoice.remainingAmount ?? invoice.remaining_amount ?? getInvoiceAmount(invoice)) > 0)
    .sort((a, b) => new Date(getInvoiceDate(a)).getTime() - new Date(getInvoiceDate(b)).getTime());

  const allocations = [];

  for (const invoice of sorted) {
    if (remaining <= 0) break;

    const invoiceRemaining = money(
      invoice.remainingAmount ?? invoice.remaining_amount ?? getInvoiceAmount(invoice)
    );
    const allocatedAmount = money(Math.min(invoiceRemaining, remaining));

    if (allocatedAmount <= 0) continue;

    allocations.push({
      invoiceReference: getInvoiceReference(invoice),
      invoiceSourceId: invoice.id ? String(invoice.id) : null,
      allocatedAmount,
    });
    remaining = money(remaining - allocatedAmount);
  }

  return { allocations, unallocatedAmount: remaining };
}

export function applyAllocationsToInvoices(invoices = [], allocations = []) {
  const allocatedByInvoice = allocations.reduce((result, allocation) => {
    const key = String(allocation.invoice_reference || allocation.invoiceReference || "");
    result[key] = money((result[key] || 0) + Number(allocation.allocated_amount || allocation.allocatedAmount || 0));
    return result;
  }, {});

  return invoices.map((invoice) => {
    const invoiceAmount = getInvoiceAmount(invoice);
    const reference = getInvoiceReference(invoice);
    const paidAmount = money(allocatedByInvoice[reference] || 0);
    const remainingAmount = money(Math.max(0, invoiceAmount - paidAmount));
    const paymentStatus =
      remainingAmount <= 0 ? "PAID" : paidAmount > 0 ? "PARTIALLY PAID" : "UNPAID";

    return {
      ...invoice,
      invoiceAmount,
      paidAmount,
      remainingAmount,
      paymentStatus,
    };
  });
}

export function buildCustomerTransactionHistory({
  openingBalance = 0,
  invoices = [],
  payments = [],
} = {}) {
  const rows = [
    ...invoices.map((invoice) => ({
      id: `invoice-${getInvoiceReference(invoice)}`,
      type: "INVOICE",
      date: getInvoiceDate(invoice),
      reference: getInvoiceReference(invoice),
      amount: getInvoiceAmount(invoice),
      paymentMethod: null,
      status: invoice.paymentStatus || invoice.payment_status || invoice.invoice_status || "UNPAID",
    })),
    ...payments
      .filter((payment) => String(payment.status || "POSTED").toUpperCase() === "POSTED")
      .map((payment) => ({
        id: `payment-${payment.id}`,
        type: "PAYMENT",
        date: payment.payment_date || payment.created_at,
        reference: payment.payment_reference || payment.id,
        amount: money(-Math.abs(Number(payment.amount || 0))),
        paymentMethod: payment.payment_method || "Other",
        status: "POSTED",
      })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = money(openingBalance);
  const withBalances = rows.map((row) => {
    runningBalance = money(runningBalance + row.amount);
    return { ...row, runningBalance };
  });

  return withBalances.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function createPaymentIdempotencyKey({
  customerAccountId,
  customerBranchId,
  amount,
  paymentDate,
  paymentMethod,
  externalReference,
}) {
  return [
    customerAccountId,
    customerBranchId || "MAIN",
    money(amount).toFixed(2),
    String(paymentDate || "").slice(0, 16),
    String(paymentMethod || "").trim().toUpperCase(),
    String(externalReference || "").trim().toUpperCase(),
  ].join("|");
}
