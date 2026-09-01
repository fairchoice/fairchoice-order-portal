import { useEffect, useMemo, useState } from "react";
import { loadReadOnlyCustomerCreditSnapshot } from "../../services/centralPaymentService";
import { formatCurrency } from "../../utils/currency";

const PAGE_SIZE = 30;
const HISTORY_PAGE_SIZE = 50;
const money = (value) => formatCurrency(Number(value || 0));
const numberValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
};

const optionalNumberValue = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};
const dateValue = (...values) => {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};
const daysOld = (date, now = new Date()) => date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000)) : 0;
const ageBucket = (days) => {
  if (days <= 7) return "current";
  if (days <= 14) return "8_14";
  if (days <= 30) return "15_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
};
const formatDate = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "—";
const formatDateTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB");
};
const textValue = (...values) => {
  const value = values.find((item) => item !== undefined && item !== null && String(item).trim() !== "");
  return value === undefined ? "" : String(value);
};

async function loadInBatches(customers, onProgress) {
  const output = [];
  const queue = [...customers];
  const worker = async () => {
    while (queue.length) {
      const customer = queue.shift();
      try {
        const snapshot = await loadReadOnlyCustomerCreditSnapshot({
          customerAccountId: customer.id,
          customerName: customer.account_name,
          customer,
          selectedBranchId: "",
        });
        output.push(buildRow(customer, snapshot));
      } catch (error) {
        output.push(buildRow(customer, null, error));
      }
      onProgress?.(output.length, customers.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(5, customers.length || 1) }, worker));
  return output;
}

function buildRow(customer, snapshot, error = null) {
  const now = new Date();
  const summary = snapshot?.customerSummary || {};
  const accountSummary = snapshot?.accountHistory?.summary || {};
  const transactions = snapshot?.accountHistory?.transactions || snapshot?.transactionHistory || [];
  const latestTransaction = [...transactions]
    .filter((transaction) =>
      optionalNumberValue(transaction?.running_balance, transaction?.runningBalance) !== null
    )
    .sort((a, b) =>
      (dateValue(b.transaction_date, b.ordering_timestamp, b.created_at, b.updated_at)?.getTime() || 0) -
      (dateValue(a.transaction_date, a.ordering_timestamp, a.created_at, a.updated_at)?.getTime() || 0)
    )[0];
  const latestTransactionBalance = latestTransaction
    ? optionalNumberValue(latestTransaction.running_balance, latestTransaction.runningBalance)
    : null;

  // Customer Credit is the canonical source for the account outstanding balance.
  // Do not let an empty/zero-ish history fallback hide a real outstanding balance.
  const totalOutstanding = Math.max(
    0,
    numberValue(
      summary.outstandingBalance,
      summary.outstanding,
      accountSummary.closingBalance,
      latestTransactionBalance
    )
  );
  const buckets = { current: 0, "8_14": 0, "15_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
  let invoiceOutstanding = 0;
  let oldestDate = null;
  let outstandingInvoices = 0;

  (snapshot?.allocatedInvoices || []).forEach((invoice) => {
    const remaining = Math.max(0, numberValue(invoice.remainingAmount, invoice.remaining_amount));
    if (remaining <= 0) return;
    const date = dateValue(invoice.delivered_at, invoice.delivery_confirmed_at, invoice.invoice_date, invoice.created_at, invoice.updated_at);
    const days = daysOld(date, now);
    buckets[ageBucket(days)] += remaining;
    invoiceOutstanding += remaining;
    outstandingInvoices += 1;
    if (date && (!oldestDate || date < oldestDate)) oldestDate = date;
  });

  const otherOutstanding = Math.max(0, totalOutstanding - invoiceOutstanding);
  if (otherOutstanding > 0) buckets["90_plus"] += otherOutstanding;

  const lastPayment = (snapshot?.allPayments || [])
    .map((payment) => dateValue(payment.payment_date, payment.created_at, payment.updated_at))
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;
  const oldestDays = oldestDate ? daysOld(oldestDate, now) : (otherOutstanding > 0 ? 999 : 0);
  const creditLimit = numberValue(summary.creditLimit, summary.credit_limit, customer.credit_limit, customer.creditLimit);
  const customerName = customer.account_name || customer.company_name || customer.customer_code || "Unnamed customer";

  const branchNameById = new Map(
    (customer.customer_branches || customer.branches || []).map((branch) => [
      String(branch.id || branch.customer_branch_id || ""),
      textValue(branch.branch_name, branch.branchName, branch.name, ""),
    ])
  );

  const transactionHistory = transactions.map((transaction, index) => {
    const branchId = textValue(
      transaction.customer_branch_id,
      transaction.branch_id,
      transaction.branchId,
      transaction.delivery_branch_id,
      ""
    );
    const branchName = textValue(
      transaction.branch_name,
      transaction.branchName,
      transaction.customer_branch_name,
      transaction.customerBranchName,
      branchId ? branchNameById.get(String(branchId)) : "",
      "—"
    );

    return {
      id: textValue(transaction.transaction_id, transaction.id, `${customer.id}-${index}`),
      customerId: customer.id,
      customerName,
      type: textValue(transaction.transaction_type, transaction.type, transaction.entry_type, "TRANSACTION").toUpperCase(),
      date: textValue(transaction.transaction_date, transaction.ordering_timestamp, transaction.created_at),
      reference: textValue(transaction.reference, transaction.reference_no, transaction.order_number, transaction.payment_reference, "—"),
      description: textValue(transaction.description, transaction.notes, transaction.memo, ""),
      branchId,
      branchName,
      branchKey: branchId ? `id:${branchId}` : `name:${branchName}`,
      debit: numberValue(transaction.debit_amount, transaction.debit),
      credit: numberValue(transaction.credit_amount, transaction.credit, transaction.payment_amount),
      runningBalance: numberValue(transaction.running_balance, transaction.runningBalance),
      status: textValue(transaction.invoice_status, transaction.payment_status, transaction.status, transaction.activity_state, ""),
    };
  });

  return {
    customerId: customer.id,
    customerName,
    customerCode: customer.customer_code || "",
    country: customer.country || customer.customer_country || customer.address_country || customer.customer_branches?.[0]?.country || "",
    creditLimit,
    totalOutstanding,
    outstandingInvoices,
    current: buckets.current,
    age8_14: