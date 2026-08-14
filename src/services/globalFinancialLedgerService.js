import { supabase } from "./supabase.js";
import { isOwnerUser } from "./ownerFinancialSecurity.js";
import { getFcSessionState } from "./fcSession.js";

const PAGE_SIZE = 20;

function requireOwner(currentUser) {
  if (!isOwnerUser(currentUser)) {
    throw new Error("Global financial history is restricted to nisstaj_admin.");
  }
}

function requireOwnerSession(currentUser) {
  const session = getFcSessionState(currentUser);
  if (!session.valid) {
    throw new Error("FC login session is missing or expired. Sign in again.");
  }
  return session;
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
  currentUser, filters = {}, page = 1, pageSize = PAGE_SIZE,
} = {}) {
  requireOwner(currentUser);
  const session = requireOwnerSession(currentUser);
  const clean = buildLedgerFilters(filters);
  const currentPage = Math.max(1, Number(page || 1));
  const size = Math.min(100, Math.max(1, Number(pageSize || PAGE_SIZE)));

  const { data, error } = await supabase.rpc("list_global_financial_history_session_v1", {
    p_username: session.username,
    p_session_token: session.token,
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
  currentUser, transactionIds, reason,
} = {}) {
  requireOwner(currentUser);
  const session = requireOwnerSession(currentUser);
  const ids = [...new Set((transactionIds || []).filter(Boolean))];
  if (!ids.length) throw new Error("Select at least one active transaction.");
  if (!String(reason || "").trim()) throw new Error("Archive reason is required.");
  const { data, error } = await supabase.rpc("owner_archive_financial_transactions_session_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_transaction_ids: ids,
    p_reason: String(reason).trim(),
  });
  if (error) throw new Error(`Could not archive transactions: ${error.message}`);
  return Number(data || 0);
}

export async function restoreFinancialTransaction({
  currentUser, archiveId, reason,
} = {}) {
  requireOwner(currentUser);
  const session = requireOwnerSession(currentUser);
  if (!archiveId) throw new Error("Archive record is required.");
  const { data, error } = await supabase.rpc("owner_restore_financial_transaction_session_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_archive_id: archiveId,
    p_reason: String(reason || "").trim() || null,
  });
  if (error) throw new Error(`Could not restore transaction: ${error.message}`);
  return Boolean(data);
}

export async function permanentlyDeleteFinancialArchive({
  currentUser, archiveId, reason,
} = {}) {
  requireOwner(currentUser);
  const session = requireOwnerSession(currentUser);
  if (!archiveId) throw new Error("Archive record is required.");
  if (!String(reason || "").trim()) throw new Error("Permanent delete reason is required.");
  const { data, error } = await supabase.rpc("owner_delete_financial_archive_session_v1", {
    p_username: session.username,
    p_session_token: session.token,
    p_archive_id: archiveId,
    p_reason: String(reason).trim(),
  });
  if (error) throw new Error(`Could not permanently delete archive: ${error.message}`);
  return Boolean(data);
}
