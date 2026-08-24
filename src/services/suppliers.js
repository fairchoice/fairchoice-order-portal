import { hasPermission } from "../utils/permissions.js";
import {
  FC_PERMISSIONS,
  hasFcPermission,
} from "../security/fcPermissions.js";
import { readStoredFcProfile } from "./fcSession.js";
import { supabase } from "./supabase.js";

export const SUPPLIER_SETUP_PERMISSION = "access_product_setup";
export const SUPPLIER_PAYMENT_METHODS = [
  "Cash",
  "Card",
  "Bank Transfer",
  "Cheque",
  "Direct Debit",
  "Other",
];
export const SUPPLIER_LEDGER_TYPES = [
  "opening_balance",
  "purchase_invoice",
  "payment",
  "credit_note",
  "refund",
  "debit_adjustment",
  "credit_adjustment",
];
export const SUPPLIER_MANUAL_LEDGER_TYPES = [
  "opening_balance",
  "debit_adjustment",
  "credit_adjustment",
];
export const SUPPLIER_LEDGER_TYPE_LABELS = Object.freeze({
  opening_balance: "Opening balance",
  purchase_invoice: "Purchase invoice",
  payment: "Payment",
  credit_note: "Credit note",
  refund: "Refund",
  debit_adjustment: "Debit adjustment",
  credit_adjustment: "Credit adjustment",
});

export function supplierLedgerTypeLabel(row = {}) {
  if (
    row.transaction_type === "payment" &&
    row.description === "Supplier Payment"
  ) {
    return "Supplier Payment";
  }
  return (
    SUPPLIER_LEDGER_TYPE_LABELS[row.transaction_type] ||
    row.transaction_type ||
    ""
  );
}

const OPTIONAL_TEXT_FIELDS = [
  "contact_name",
  "company_legal_name",
  "vat_number",
  "address_line_1",
  "address_line_2",
  "city",
  "postcode",
  "country",
  "phone",
  "email",
  "payment_terms",
  "default_payment_method",
  "bank_payment_reference",
  "notes",
];

export function canManageSupplierSetup(user) {
  return hasPermission(user, SUPPLIER_SETUP_PERMISSION);
}

export function canViewSupplierAccounts(user) {
  return hasFcPermission(user, FC_PERMISSIONS.SUPPLIERS_VIEW);
}

export function canPostSupplierLedger(user) {
  return hasFcPermission(user, FC_PERMISSIONS.SUPPLIERS_PAY);
}

export function normalizeOptionalText(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function validateSupplier(input = {}) {
  const supplier = {
    supplier_name: String(input.supplier_name ?? "").trim(),
  };

  for (const field of OPTIONAL_TEXT_FIELDS) {
    supplier[field] = normalizeOptionalText(input[field]);
  }
  supplier.vat_registered = input.vat_registered !== false;

  const errors = {};
  if (!supplier.supplier_name) {
    errors.supplier_name = "Supplier name is required.";
  } else if (supplier.supplier_name.length > 200) {
    errors.supplier_name = "Supplier name must be 200 characters or fewer.";
  }

  if (
    supplier.email &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.email)
  ) {
    errors.email = "Enter a valid email address.";
  }

  if (
    supplier.default_payment_method &&
    !SUPPLIER_PAYMENT_METHODS.includes(supplier.default_payment_method)
  ) {
    errors.default_payment_method = "Select a valid default payment method.";
  }

  if (supplier.notes && supplier.notes.length > 4000) {
    errors.notes = "Notes must be 4,000 characters or fewer.";
  }

  return { supplier, errors, valid: Object.keys(errors).length === 0 };
}

function supplierSearchText(supplier) {
  return [
    supplier.supplier_name,
    supplier.company_legal_name,
    supplier.vat_number,
    supplier.city,
    supplier.postcode,
    supplier.country,
    supplier.phone,
    supplier.email,
    supplier.bank_payment_reference,
    supplier.notes,
  ]
    .map((value) => String(value ?? "").toLocaleLowerCase())
    .join(" ");
}

export function filterSuppliers(suppliers = [], search = "", status = "all") {
  const literalTerm = String(search).trim().toLocaleLowerCase();
  return suppliers.filter((supplier) => {
    if (status === "active" && supplier.active === false) return false;
    if (status === "inactive" && supplier.active !== false) return false;
    return !literalTerm || supplierSearchText(supplier).includes(literalTerm);
  });
}

export function supplierOptionsForSelection(
  suppliers = [],
  currentSupplier = null,
) {
  const active = suppliers.filter((supplier) => supplier.active !== false);
  if (!currentSupplier) return active;

  const currentId = String(currentSupplier.id ?? "");
  const currentName = String(
    currentSupplier.supplier_name ?? currentSupplier.name ?? currentSupplier,
  ).trim();
  const alreadyPresent = active.some(
    (supplier) =>
      (currentId && String(supplier.id) === currentId) ||
      (currentName && supplier.supplier_name === currentName),
  );

  if (alreadyPresent) return active;
  if (typeof currentSupplier === "object" && currentSupplier !== null) {
    return [...active, { ...currentSupplier, active: false }];
  }
  if (!currentName) return active;
  return [
    ...active,
    {
      id: `inactive:${currentName}`,
      supplier_name: currentName,
      active: false,
    },
  ];
}

export function canonicalSupplierTransactionType(value) {
  const normalized = String(value ?? "").trim();
  const legacyTypes = {
    "Credit Purchase": "purchase_invoice",
    Payment: "payment",
    "Credit Note": "credit_note",
    Adjustment: "debit_adjustment",
  };
  return legacyTypes[normalized] || normalized.toLowerCase().replace(/\s+/g, "_");
}

export function supplierTransactionDirection(type) {
  const canonicalType = canonicalSupplierTransactionType(type);
  if (
    ["opening_balance", "purchase_invoice", "debit_adjustment"].includes(
      canonicalType,
    )
  ) {
    return "debit";
  }
  if (
    [
      "payment",
      "credit_note",
      "refund",
      "credit_adjustment",
    ].includes(canonicalType)
  ) {
    return "credit";
  }
  return null;
}

function ledgerSortKey(row) {
  return [
    String(row.transaction_date || ""),
    String(row.created_at || ""),
    String(row.row_key || row.id || ""),
  ].join("|");
}

export function calculateSupplierRunningBalances(rows = [], openingBalance = 0) {
  let runningBalance = Number(openingBalance || 0);
  return [...rows]
    .sort((left, right) => ledgerSortKey(left).localeCompare(ledgerSortKey(right)))
    .map((row) => {
      const active = String(row.status || "posted").toLowerCase() === "posted";
      const direction = supplierTransactionDirection(row.transaction_type);
      const amount = Number(row.amount || 0);
      const debit = active && direction === "debit" ? amount : 0;
      const credit = active && direction === "credit" ? amount : 0;
      runningBalance += debit - credit;
      return { ...row, debit, credit, running_balance: runningBalance };
    });
}

export function filterSupplierStatementRows(
  rows = [],
  { dateFrom = "", dateTo = "", transactionTypes = [], search = "" } = {},
) {
  const literalTerm = String(search).trim().toLocaleLowerCase();
  const allowedTypes = new Set(
    transactionTypes.map(canonicalSupplierTransactionType),
  );

  return rows.filter((row) => {
    if (row.is_opening_balance) return true;
    const date = String(row.transaction_date || "");
    if (dateFrom && date < dateFrom) return false;
    if (dateTo && date > dateTo) return false;
    if (
      allowedTypes.size &&
      !allowedTypes.has(canonicalSupplierTransactionType(row.transaction_type))
    ) {
      return false;
    }
    if (!literalTerm) return true;
    return [
      row.reference,
      row.description,
      row.invoice_number,
      row.notes,
      row.created_by,
    ]
      .map((value) => String(value ?? "").toLocaleLowerCase())
      .join(" ")
      .includes(literalTerm);
  });
}

export function validateManualSupplierLedgerEntry(input = {}) {
  const entry = {
    supplierId: String(input.supplierId || "").trim(),
    transactionDate: String(input.transactionDate || "").trim(),
    transactionType: canonicalSupplierTransactionType(input.transactionType),
    amount: Number(input.amount),
    reference: String(input.reference || "").trim(),
    description: String(input.description || "").trim(),
  };
  const errors = {};
  if (!entry.supplierId) errors.supplierId = "Supplier is required.";
  if (input.supplierActive === false) {
    errors.supplierId = "Manual postings cannot be made to an inactive supplier.";
  }
  if (!entry.transactionDate) {
    errors.transactionDate = "Transaction date is required.";
  }
  if (!SUPPLIER_MANUAL_LEDGER_TYPES.includes(entry.transactionType)) {
    errors.transactionType =
      "Select an opening balance or authorised adjustment.";
  }
  if (!(entry.amount > 0)) errors.amount = "Amount must be greater than zero.";
  if (!entry.reference) errors.reference = "Reference is required.";
  if (!entry.description) {
    errors.description = "Reason or description is required.";
  }
  return { entry, errors, valid: Object.keys(errors).length === 0 };
}

function sessionArguments(user = {}) {
  const saved = readStoredFcProfile() || {};
  const username = String(user.username || saved.username || "").trim();
  const sessionToken =
    user.fc_session_token ||
    user.session_token ||
    saved.fc_session_token ||
    saved.session_token ||
    "";

  if (!username || !sessionToken) {
    throw new Error("Your Fair Choice session is missing. Please sign in again.");
  }

  return {
    p_username: username,
    p_session_token: sessionToken,
  };
}

async function callSupplierRpc(name, parameters) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.rpc(name, parameters);
  if (error) throw error;
  return data;
}

export async function loadSupplierSetup(
  user,
  { includeInactive = true, search = "" } = {},
) {
  const data = await callSupplierRpc("fc_list_suppliers", {
    ...sessionArguments(user),
    p_include_inactive: includeInactive,
    p_search: String(search).trim() || null,
  });
  return data || [];
}

export async function saveSupplier(input, user, supplierId = null) {
  const validation = validateSupplier(input);
  if (!validation.valid) {
    const error = new Error("Please correct the highlighted supplier fields.");
    error.validationErrors = validation.errors;
    throw error;
  }

  return callSupplierRpc("fc_upsert_supplier", {
    ...sessionArguments(user),
    p_supplier_id: supplierId || null,
    p_supplier: validation.supplier,
  });
}

export async function setSupplierActive(supplierId, active, user) {
  if (!supplierId) throw new Error("Supplier ID is required.");
  return callSupplierRpc("fc_set_supplier_active", {
    ...sessionArguments(user),
    p_supplier_id: supplierId,
    p_active: Boolean(active),
  });
}

export async function loadSupplierAccounts(user) {
  const data = await callSupplierRpc(
    "fc_list_supplier_accounts_v1",
    sessionArguments(user),
  );
  return data || [];
}

function normalizeStatementRow(row) {
  return {
    ...row,
    debit: Number(row.debit || 0),
    credit: Number(row.credit || 0),
    running_balance: Number(row.running_balance || 0),
    opening_balance: Number(row.opening_balance || 0),
    current_balance: Number(row.current_balance || 0),
    is_opening_balance: row.is_opening_balance === true,
  };
}

export async function loadSupplierCreditStatement(
  user,
  {
    supplierId,
    dateFrom,
    dateTo,
    transactionTypes = [],
    search = "",
  },
) {
  if (!supplierId) throw new Error("Supplier is required.");
  const data = await callSupplierRpc("fc_supplier_credit_statement_v2", {
    ...sessionArguments(user),
    p_supplier_id: supplierId,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_transaction_types: transactionTypes.length ? transactionTypes : null,
    p_search: String(search).trim() || null,
  });
  return (data || []).map(normalizeStatementRow);
}

export async function postSupplierLedgerEntry(input, user) {
  const validation = validateManualSupplierLedgerEntry(input);
  if (!validation.valid) {
    const error = new Error("Please correct the highlighted ledger fields.");
    error.validationErrors = validation.errors;
    throw error;
  }
  const entry = validation.entry;
  return callSupplierRpc("fc_post_supplier_credit_adjustment_v1", {
    ...sessionArguments(user),
    p_supplier_id: entry.supplierId,
    p_transaction_date: entry.transactionDate,
    p_transaction_type: entry.transactionType,
    p_amount: entry.amount,
    p_reference: entry.reference,
    p_description: entry.description,
  });
}

export async function voidSupplierLedgerTransaction(
  transactionId,
  reason,
  user,
) {
  if (!transactionId) throw new Error("Supplier transaction ID is required.");
  const cleanReason = String(reason || "").trim();
  if (!cleanReason) throw new Error("A void reason is required.");
  return callSupplierRpc("fc_void_supplier_credit_transaction_v1", {
    ...sessionArguments(user),
    p_transaction_id: transactionId,
    p_reason: cleanReason,
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLedgerAmount(value) {
  return Number(value || 0).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
  });
}

export function printSupplierStatement({
  supplier,
  rows,
  dateFrom,
  dateTo,
  currentBalance,
}) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!printWindow) {
    throw new Error("Allow pop-ups to print the supplier statement.");
  }
  const tableRows = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.transaction_date || "")}</td>
          <td>${escapeHtml(
            row.is_opening_balance
              ? "Opening balance"
              : supplierLedgerTypeLabel(row),
          )}</td>
          <td>${escapeHtml(row.reference || row.invoice_number || "")}</td>
          <td>${escapeHtml(row.description || "")}</td>
          <td>${formatLedgerAmount(row.debit)}</td>
          <td>${formatLedgerAmount(row.credit)}</td>
          <td>${formatLedgerAmount(row.running_balance)}</td>
          <td>${escapeHtml(row.status || "")}</td>
          <td>${escapeHtml(row.created_by || "")}</td>
          <td>${escapeHtml(
            row.created_at
              ? new Date(row.created_at).toLocaleString("en-GB")
              : "",
          )}</td>
        </tr>`,
    )
    .join("");
  printWindow.document.write(`<!doctype html>
    <html><head><title>Supplier statement</title>
    <style>
      body{font:12px Arial,sans-serif;color:#111;margin:24px}
      h1{font-size:20px;margin:0 0 4px}p{margin:4px 0 14px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;text-align:left}
      th{background:#eee}@media print{body{margin:0}}
    </style></head><body>
    <h1>${escapeHtml(supplier?.supplier_name || "Supplier")} statement</h1>
    <p>${escapeHtml(dateFrom)} to ${escapeHtml(dateTo)} · Current balance:
      ${escapeHtml(formatLedgerAmount(currentBalance))}</p>
    <table><thead><tr><th>Date</th><th>Type</th><th>Reference</th>
      <th>Description</th><th>Debit</th><th>Credit</th><th>Balance</th>
      <th>Status</th><th>Created by</th><th>Created</th></tr></thead>
      <tbody>${tableRows}</tbody></table>
    <script>window.addEventListener("load",()=>window.print());</script>
    </body></html>`);
  printWindow.document.close();
}
