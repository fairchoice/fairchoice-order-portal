const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function moneyCents(value) {
  const number = Number(value);
  const cents = Math.round(number * 100);
  return Number.isFinite(number) && Number.isSafeInteger(cents) &&
    Math.abs(number * 100 - cents) < 0.000001 ? cents : null;
}

// Previous payments are acknowledgements, never new collection allocations.
export function planInvoiceCollection(invoices = [], selections = {}) {
  const allocations = [];
  const previousStatuses = [];
  const errors = [];
  const seen = new Set();
  for (const invoice of invoices) {
    const reference = String(invoice._collectionReference || invoice.invoice_number || "").trim();
    if (!reference || seen.has(reference)) errors.push("Duplicate or missing invoice reference. Reload invoices.");
    seen.add(reference);
    const choice = selections[reference];
    if (!choice || choice.mode === "none") continue;
    if (!["paid", "part", "previous_paid", "previous_part"].includes(choice.mode)) {
      errors.push("Unknown invoice payment choice.");
      continue;
    }
    const remaining = moneyCents(invoice.remainingAmount);
    const total = moneyCents(invoice.invoiceAmount ?? invoice.invoice_total ?? invoice.remainingAmount);
    const isPrevious = choice.mode.startsWith("previous_");
    const isPart = choice.mode === "part" || choice.mode === "previous_part";
    const limit = isPrevious ? total : remaining;
    const amount = isPart ? moneyCents(choice.amount) : limit;
    if (invoice.source === "orders" || !UUID.test(String(invoice.id || ""))) {
      errors.push(`Invoice ${reference} needs a canonical invoice record before saving.`);
      continue;
    }
    if (!(remaining > 0) || !(amount > 0) || amount > limit || (isPart && amount >= limit) ||
        (isPrevious && amount < total - remaining)) {
      errors.push(`Enter a valid paid total for ${reference}. Previous Part Paid is the total already paid, below the invoice total; new Part Paid must be below the current balance.`);
      continue;
    }
    const common = {
      invoiceReference: reference,
      invoiceSourceId: String(invoice.id),
      customerBranchId: invoice.customer_branch_id || invoice.branch_id || null,
      expectedRemainingAmount: remaining / 100,
    };
    if (choice.mode.startsWith("previous_")) {
      previousStatuses.push({ ...common, mode: choice.mode, previouslyPaidAmount: amount / 100 });
    } else {
      allocations.push({ ...common, allocatedAmount: amount / 100 });
    }
  }
  for (const [reference, choice] of Object.entries(selections)) {
    if (choice?.mode && choice.mode !== "none" && !seen.has(reference)) {
      errors.push(`Invoice ${reference} changed. Reload invoices before saving.`);
    }
  }
  return {
    allocations,
    previousStatuses,
    collectedTotal: allocations.reduce((sum, item) => sum + Math.round(item.allocatedAmount * 100), 0) / 100,
    previousTotal: previousStatuses.reduce((sum, item) => sum + Math.round(item.previouslyPaidAmount * 100), 0) / 100,
    errors,
  };
}

// The baseline prevents an existing allocation and its status acknowledgement
// being added together. Only later allocations increase the acknowledged total.
export function previousStatusPaidAmount(invoice = {}, allocatedAmount = 0) {
  const acknowledged = Number(invoice.collection_previous_paid_amount || 0);
  const baseline = Number(invoice.collection_previous_allocated_amount || 0);
  const walletLater = Math.max(0, Number(invoice.wallet_applied_amount || 0) - Number(invoice.collection_previous_wallet_amount || 0));
  if (!(acknowledged > 0)) return 0;
  return Math.round((acknowledged + Math.max(0, allocatedAmount - baseline) + walletLater) * 100) / 100;
}
