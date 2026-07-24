import { supabase } from "./supabase.js";
import { isOwnerUser } from "./ownerFinancialSecurity.js";

const PAGE_SIZE = 20;

function requireOwner(currentUser) {
  if (!isOwnerUser(currentUser)) {
    throw new Error("Global financial history is restricted to nisstaj_admin.");
  }
}

function requireOwnerPassword(ownerPassword) {
  if (!String(ownerPassword || "").trim()) {
    throw new Error("Owner financial password is required.");
  }
}

export function buildLedgerFilters({
  search = "", method = "", status = "", transactionType = "",
  dateFrom = "", dateTo = "", customerAccountId = "", customerBranchId = "",
} = {}) {
  return {
    search: String(search || "").trim(),
    method: String(method || "").trim(),
    status: String(status || "").trim().toUpperCase(),
    transactionType: String(transactionType || "").trim().toUpperCase(),
    dateFrom: String(dateFrom || "").trim(),
    dateTo: String(dateTo || "").trim(),
    customerAccountId: String(customerAccountId || "").trim(),
    customerBranchId: String(customerBranchId || "").trim(),
  };
}

export function normalizeLedgerRecord(row = {}) {
  return {
    ...row,
    recordId: row.record_id || row.id,
    archiveId: row.archive_id || null,
    sourceType: row.source_type || "",
    sourceId: row.source_id || "",
    transactionType: row.transaction_type || "",
    transactionDate: row.transaction_date || row.created_at,
    debitAmount: Number(row.debit_amount || 0),
    creditAmount: Number(row.credit_amount || 0),
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method || "",
    staffName: row.staff_name || "",
    reference: row.reference || "",
    description: row.description || "",
    status: String(row.status || "ACTIVE").toUpperCase(),
  };
}

export async function listGlobalFinancialHistory({
  currentUser, ownerPassword, filters = {}, page = 1, pageSize = PAGE_SIZE,
} = {}) {
  requireOwner(currentUser);
  requireOwnerPassword(ownerPassword);
  const clean = buildLedgerFilters(filters);
  const currentPage = Math.max(1, Number(page || 1));
  const size = Math.min(100, Math.max(1, Number(pageSize || PAGE_SIZE)));

  const { data, error } = await supabase.rpc("list_global_financial_history_v1", {
    p_owner_username: currentUser.username,
    p_owner_password: ownerPassword,
    p_search: clean.search || null,
    p_payment_method: clean.method || null,
    p_status: clean.status || null,
    p_transaction_type: clean.transactionType || null,
    p_date_from: clean.dateFrom || null,
    p_date_to: clean.dateTo || null,
    p_customer_account_id: clean.customerAccountId || null,
    p_customer_branch_id: clean.customerBranchId || null,
    p_page: currentPage,
    p_page_size: size,
  });
  if (error) throw new Error(`Could not load global financial history: ${error.message}`);
  const total = Number(data?.total || 0);
  return {
    records: (Array.isArray(data?.records) ? data.records : []).map(normalizeLedgerRecord),
    total,
    page: Number(data?.page || currentPage),
    pageSize: Number(data?.page_size || size),
    totalPages: Number(data?.total_pages || Math.max(1, Math.ceil(total / size))),
  };
}

export async function bulkArchiveFinancialTransactions({
  currentUser, ownerPassword, transactionIds, reason,
} = {}) {
  requireOwner(currentUser);
  requireOwnerPassword(ownerPassword);
  const ids = [...new Set((transactionIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one active transaction.");
  if (!String(reason || "").trim()) throw new Error("Archive reason is required.");
  const { data, error } = await supabase.rpc("owner_archive_financial_transactions", {
    p_owner_username: currentUser.username,
    p_owner_password: ownerPassword,
    p_transaction_ids: ids,
    p_reason: String(reason).trim(),
  });
  if (error) throw new Error(`Could not archive transactions: ${error.message}`);
  return Number(data || 0);
}

export async function restoreFinancialTransaction({
  currentUser, ownerPassword, archiveId, reason,
} = {}) {
  requireOwner(currentUser);
  requireOwnerPassword(ownerPassword);
  if (!archiveId) throw new Error("Archive record is required.");
  const { data, error } = await supabase.rpc("owner_restore_financial_transaction", {
    p_owner_username: currentUser.username,
    p_owner_password: ownerPassword,
    p_archive_id: archiveId,
    p_reason: String(reason || "").trim() || null,
  });
  if (error) throw new Error(`Could not restore transaction: ${error.message}`);
  return Boolean(data);
}

export async function permanentlyDeleteFinancialArchive({
  currentUser, ownerPassword, archiveId, reason,
} = {}) {
  requireOwner(currentUser);
  requireOwnerPassword(ownerPassword);
  if (!archiveId) throw new Error("Archive record is required.");
  if (!String(reason || "").trim()) throw new Error("Permanent delete reason is required.");
  const { data, error } = await supabase.rpc("owner_delete_financial_archive", {
    p_owner_username: currentUser.username,
    p_owner_password: ownerPassword,
    p_archive_id: archiveId,
    p_reason: String(reason).trim(),
  });
  if (error) throw new Error(`Could not permanently delete archive: ${error.message}`);
  return Boolean(data);
}
