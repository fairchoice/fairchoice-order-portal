import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  buildPaymentPreview,
  confirmOwnerBankTransfer,
  rejectOwnerBankTransfer,
  createCentralPayment,
  listCentralPaymentRecords,
  loadCentralPaymentCustomers,
  loadCentralPaymentSnapshot,
} from "../../services/centralPaymentService";
import {
  bulkArchiveFinancialTransactions,
  listGlobalFinancialHistory,
  permanentlyDeleteFinancialArchive,
  restoreFinancialTransaction,
} from "../../services/globalFinancialLedgerService";
import {
  getCentralPaymentSections,
  isOwnerUser,
  runOwnerFinancialRequest,
} from "../../services/ownerFinancialSecurity";
import { getActiveCustomerBranches } from "../../utils/customerBranchScope";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  clearFcSessionStorage,
  getFcSessionState,
  isInvalidFcSessionError,
} from "../../services/fcSession";

const paymentMethods = ["Cash", "Card", "Bank Transfer", "Cheque", "Other"];
const ledgerTypes = ["PAYMENT", "DISCOUNT", "INVOICE", "CREDIT", "REFUND", "ADJUSTMENT", "EXPENSE"];
const BRANCH_SELECT = "__select__";

const getPaymentMetadata = (payment = {}) => {
  if (payment?.metadata && typeof payment.metadata === "object") return payment.metadata;
  if (typeof payment?.metadata === "string") {
    try {
      const parsed = JSON.parse(payment.metadata);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

const getBankProof = (payment = {}) => {
  const metadata = getPaymentMetadata(payment);
  return {
    dataUrl: String(metadata.bank_proof_data_url || metadata.payment_proof_data_url || ""),
    name: String(metadata.bank_proof_name || "Bank payment proof"),
  };
};

const matchesCustomer = (customer, search) =>
  [
    customer.account_name,
    customer.company_name,
    customer.customer_code,
    ...(customer.customer_branches || []).map((branch) => branch.branch_name),
  ]
    .join(" ")
    .toLowerCase()
    .includes(String(search || "").toLowerCase());

const getSensitiveFinancialDetails = (row = {}) => {
  const metadata =
    row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const snapshot =
    metadata.transaction_snapshot &&
    typeof metadata.transaction_snapshot === "object"
      ? metadata.transaction_snapshot
      : {};
  const priceMode =
    row.price_mode ||
    row.priceMode ||
    metadata.price_mode ||
    metadata.priceMode ||
    snapshot.price_mode ||
    snapshot.priceMode ||
    "";
  const incVat =
    row.inc_vat ??
    row.vat_included ??
    metadata.inc_vat ??
    metadata.vat_included ??
    snapshot.inc_vat ??
    snapshot.vat_included;
  const manager =
    row.manager_name ||
    row.manager ||
    metadata.manager_name ||
    metadata.manager ||
    snapshot.manager_name ||
    snapshot.manager ||
    (String(row.collector_role || "").trim().toUpperCase() === "MANAGER"
      ? row.paid_by || row.staffName || row.staff_name
      : "");

  return {
    priceMode: String(priceMode || "").trim() || "-",
    incVat:
      typeof incVat === "boolean"
        ? incVat
          ? "Yes"
          : "No"
        : String(incVat ?? "").trim() || "-",
    manager: String(manager || "").trim() || "-",
  };
};

function SummaryCard({ label, value, neutral = false }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-extrabold ${
          neutral ? "text-slate-900" : "text-red-700"
        }`}
      >
        {formatCurrency(value || 0)}
      </div>
    </div>
  );
}

function PaymentRecordsPanel({ archived, currentUser, onInvalidSessionError }) {
  const canViewFinancialHistory = isOwnerUser(currentUser);
  const [filters, setFilters] = useState({ search: "", method: "", dateFrom: "", dateTo: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ records: [], total: 0, total_pages: 1 });
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!canViewFinancialHistory) return;
    try {
      setMessage("");
      const data = await runOwnerFinancialRequest(currentUser, () =>
        listCentralPaymentRecords({ currentUser, archived, ...filters, page })
      );
      if (!data) return;
      setResult(data);
    } catch (loadError) {
      if (await onInvalidSessionError?.(loadError)) return;
      setMessage(loadError.message || "Could not load payment records.");
    }
  };

  useEffect(() => {
    if (!canViewFinancialHistory) return;
    void load();
  }, [archived, canViewFinancialHistory, filters, page]);

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  if (!canViewFinancialHistory) return null;

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-extrabold">{archived ? "Payment Archive" : "Payment History"}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{result.total || 0} records</span>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
        <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Reference, payer or notes" className="rounded-xl border p-3" />
        <select value={filters.method} onChange={(event) => updateFilter("method", event.target.value)} className="rounded-xl border p-3"><option value="">All methods</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
        <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} className="rounded-xl border p-3" aria-label="From date" />
        <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} className="rounded-xl border p-3" aria-label="To date" />
      </div>
      {message && <div className="mb-3 rounded-xl bg-red-50 p-3 font-bold text-red-700">{message}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead><tr className="border-b bg-slate-50 text-left"><th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Reference</th><th className="p-3">Method</th><th className="p-3">Paid By</th><th className="p-3">Price Mode</th><th className="p-3">Inc. VAT</th><th className="p-3">Manager</th><th className="p-3">Status</th><th className="p-3 text-right">Amount</th></tr></thead>
          <tbody>
            {(result.records || []).map((payment) => {
              const sensitive = getSensitiveFinancialDetails(payment);
              return (
                <tr key={payment.id} className="border-b align-middle">
                  <td className="p-3">{new Date(payment.payment_date || payment.created_at).toLocaleDateString("en-GB")}</td>
                  <td className="p-3 font-semibold">{payment.customer_name || "-"}</td>
                  <td className="p-3 font-bold">{formatDisplayOrderId(payment.payment_reference) || "-"}</td>
                  <td className="p-3">{payment.payment_method || "-"}</td>
                  <td className="p-3">{payment.paid_by || "-"}</td>
                  <td className="p-3">{sensitive.priceMode}</td>
                  <td className="p-3">{sensitive.incVat}</td>
                  <td className="p-3">{sensitive.manager}</td>
                  <td className="p-3 font-bold">{payment.verification_status === "REJECTED" ? "REJECTED" : payment.verification_status === "PENDING_VERIFICATION" ? "UNAPPROVED" : "APPROVED"}</td>
                  <td className="p-3 text-right font-bold">{formatCurrency(payment.amount || 0)}</td>
                </tr>
              );
            })}
            {!result.records?.length && <tr><td colSpan="10" className="p-8 text-center text-slate-500">No payment records match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-4 py-2 font-bold disabled:text-slate-300">Previous</button>
        <span className="font-bold">Page {page} of {result.total_pages || 1}</span>
        <button type="button" disabled={page >= (result.total_pages || 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-4 py-2 font-bold disabled:text-slate-300">Next</button>
      </div>
    </section>
  );
}

function GlobalLedgerPanel({
  currentUser,
  onInvalidSessionError,
}) {
  const [filters, setFilters] = useState({ search: "", method: "", status: "ACTIVE", transactionType: "", dateFrom: "", dateTo: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ records: [], total: 0, totalPages: 1 });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!isOwnerUser(currentUser)) return;
    setLoading(true);
    setMessage("");
    try {
      const data = await runOwnerFinancialRequest(currentUser, () =>
        listGlobalFinancialHistory({
          currentUser,
          filters,
          page,
        })
      );
      if (!data) return;
      setResult(data);
      setSelected([]);
    } catch (error) {
      if (await onInvalidSessionError?.(error)) return;
      setMessage(error.message || "Could not load global ledger.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [filters, page, currentUser]);

  const activeRows = useMemo(() => result.records.filter((row) => row.status === "ACTIVE"), [result.records]);
  const allSelected = activeRows.length > 0 && activeRows.every((row) => selected.includes(row.recordId));
  const updateFilter = (name, value) => { setFilters((current) => ({ ...current, [name]: value })); setPage(1); };
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const bulkArchive = async () => {
    const reason = window.prompt("Enter the compulsory archive reason for the selected transactions.");
    if (!String(reason || "").trim()) return;
    if (!window.confirm(`Archive ${selected.length} selected transaction(s)?`)) return;
    try {
      const count = await bulkArchiveFinancialTransactions({ currentUser, transactionIds: selected, reason });
      setMessage(`${count} transaction(s) archived with a permanent audit trail.`);
      await load();
    } catch (error) {
      if (await onInvalidSessionError?.(error)) return;
      setMessage(error.message || "Bulk archive failed.");
    }
  };

  const archiveAction = async (row, action) => {
    const reason = window.prompt(`Enter the compulsory ${action} reason.`);
    if (!String(reason || "").trim()) return;
    try {
      if (action === "restore") {
        await restoreFinancialTransaction({ currentUser, archiveId: row.archiveId, reason });
      } else {
        if (!window.confirm("Permanently delete this archive record? This cannot be undone.")) return;
        await permanentlyDeleteFinancialArchive({ currentUser, archiveId: row.archiveId, reason });
      }
      await load();
    } catch (error) {
      if (await onInvalidSessionError?.(error)) return;
      setMessage(error.message || "Archive action failed.");
    }
  };

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-xl font-extrabold">Global Financial Ledger</h3><p className="text-sm text-slate-600">All branches, customers and archived financial activity in one owner-only view.</p></div>
        <div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold">{result.total} records</span><button type="button" disabled={!selected.length} onClick={bulkArchive} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">Archive selected ({selected.length})</button></div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <input value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} placeholder="Reference, description, staff" className="rounded-xl border p-3" />
        <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} className="rounded-xl border p-3"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="VOIDED">Voided</option></select>
        <select value={filters.transactionType} onChange={(e) => updateFilter("transactionType", e.target.value)} className="rounded-xl border p-3"><option value="">All types</option>{ledgerTypes.map((value) => <option key={value}>{value}</option>)}</select>
        <select value={filters.method} onChange={(e) => updateFilter("method", e.target.value)} className="rounded-xl border p-3"><option value="">All methods</option>{paymentMethods.map((value) => <option key={value}>{value}</option>)}</select>
        <input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className="rounded-xl border p-3" aria-label="From date" />
        <input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className="rounded-xl border p-3" aria-label="To date" />
      </div>
      {message && <div className="mb-3 rounded-xl bg-slate-100 p-3 font-bold text-slate-700">{message}</div>}
      {loading && <div className="mb-3 rounded-xl bg-blue-50 p-3 font-bold text-blue-800">Loading ledger...</div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[1440px] text-sm"><thead><tr className="border-b bg-slate-50 text-left">
        <th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : activeRows.map((row) => row.recordId))} aria-label="Select all active rows" /></th>
        <th className="p-3">Date</th><th className="p-3">Reference</th><th className="p-3">Type</th><th className="p-3">Source</th><th className="p-3">Method</th><th className="p-3">Staff</th><th className="p-3">Price Mode</th><th className="p-3">Inc. VAT</th><th className="p-3">Manager</th><th className="p-3">Status</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3">Description</th><th className="p-3 text-right">Actions</th>
      </tr></thead><tbody>
        {result.records.map((row) => {
          const sensitive = getSensitiveFinancialDetails(row);
          return <tr key={`${row.archiveId || "active"}-${row.recordId}`} className="border-b align-top">
            <td className="p-3">{row.status === "ACTIVE" && <input type="checkbox" checked={selected.includes(row.recordId)} onChange={() => toggle(row.recordId)} aria-label={`Select ${formatDisplayOrderId(row.reference) || row.recordId}`} />}</td>
            <td className="p-3">{new Date(row.transactionDate).toLocaleDateString("en-GB")}</td><td className="p-3 font-bold">{formatDisplayOrderId(row.reference) || "-"}</td><td className="p-3">{row.transactionType || "-"}</td><td className="p-3">{row.sourceType || "-"}</td><td className="p-3">{row.paymentMethod || "-"}</td><td className="p-3">{row.staffName || "-"}</td><td className="p-3">{sensitive.priceMode}</td><td className="p-3">{sensitive.incVat}</td><td className="p-3">{sensitive.manager}</td><td className="p-3 font-bold">{row.status}</td><td className="p-3 text-right">{formatCurrency(row.debitAmount)}</td><td className="p-3 text-right">{formatCurrency(row.creditAmount)}</td><td className="max-w-[280px] whitespace-pre-wrap p-3">{row.description || "-"}</td>
            <td className="p-3 text-right">{row.status === "ARCHIVED" && row.archiveId && <><button type="button" onClick={() => archiveAction(row, "restore")} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Restore</button><button type="button" onClick={() => archiveAction(row, "delete")} className="ml-2 rounded-lg bg-red-800 px-3 py-2 text-xs font-bold text-white">Delete permanently</button></>}</td>
          </tr>;
        })}
        {!result.records.length && <tr><td colSpan="15" className="p-6 text-center text-slate-500">No ledger records match these filters.</td></tr>}
      </tbody></table></div>
      <div className="mt-4 flex items-center justify-end gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Previous</button><span className="text-sm font-bold">Page {page} of {result.totalPages || 1}</span><button type="button" disabled={page >= (result.totalPages || 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Next</button></div>
    </section>
  );
}

function ManualPaymentPanel({
  branches,
  branchSelectionRequired,
  form,
  ownerPassword,
  onOwnerPasswordChange,
  preview,
  saving,
  selectedCustomer,
  onSave,
  onUpdateForm,
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-extrabold">Owner Transaction</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <select value={form.transactionType} onChange={(event) => onUpdateForm("transactionType", event.target.value)} className="rounded-xl border p-3">
            <option value="PAYMENT">Payment</option>
            <option value="DISCOUNT">Discount / goodwill adjustment</option>
          </select>
          <input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => onUpdateForm("amount", event.target.value)} placeholder={form.transactionType === "DISCOUNT" ? "Discount amount" : "Payment amount"} className="rounded-xl border p-3" />
          {form.transactionType === "PAYMENT" && (
            <select value={form.paymentMethod} onChange={(event) => onUpdateForm("paymentMethod", event.target.value)} className="rounded-xl border p-3">
              {paymentMethods.map((method) => <option key={method}>{method}</option>)}
            </select>
          )}
          <input type="date" value={form.paymentDate} onChange={(event) => onUpdateForm("paymentDate", event.target.value)} className="rounded-xl border p-3" />
          <input value={form.paidBy} onChange={(event) => onUpdateForm("paidBy", event.target.value)} placeholder="Who paid / discount beneficiary" className="rounded-xl border p-3" />
          <input value={form.externalReference} onChange={(event) => onUpdateForm("externalReference", event.target.value)} placeholder="Bank/reference number (optional)" className="rounded-xl border p-3" />
          <textarea value={form.notes} onChange={(event) => onUpdateForm("notes", event.target.value)} placeholder={form.transactionType === "DISCOUNT" ? "Compulsory detailed discount reason" : "Notes"} className="min-h-24 rounded-xl border p-3 md:col-span-2" />
          {form.transactionType === "DISCOUNT" && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800 md:col-span-2">
              Authorised by the current nisstaj_admin FC session. No separate financial password is required.
            </div>
          )}
        </div>
        {form.paymentMethod === "Bank Transfer" && form.transactionType === "PAYMENT" && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
            Bank transfers are recorded as Pending Verification. They are not allocated and do not reduce the customer balance until the owner confirms them against the bank statement.
          </div>
        )}
        <button type="button" onClick={onSave} disabled={saving || !selectedCustomer || branchSelectionRequired || Number(form.amount || 0) <= 0} className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">
          {saving ? "Saving..." : form.transactionType === "DISCOUNT" ? "Save audited discount" : "Save owner payment"}
        </button>
      </section>
      <AllocationPreview branches={branches} preview={preview} />
    </div>
  );
}

function AllocationPreview({ branches, preview }) {
  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-extrabold">Allocation Preview</h3>
        <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">
          Unallocated {formatCurrency(preview.unallocatedAmount || 0)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b bg-slate-50 text-left"><th className="p-3">Invoice</th><th className="p-3">Branch</th><th className="p-3 text-right">Allocated</th></tr></thead>
          <tbody>
            {preview.allocations.map((allocation) => (
              <tr key={allocation.invoiceReference} className="border-b">
                <td className="p-3 font-bold">{formatDisplayOrderId(allocation.invoiceReference)}</td>
                <td className="p-3">{branches.find((branch) => String(branch.id) === String(allocation.customerBranchId))?.branch_name || "-"}</td>
                <td className="p-3 text-right font-bold">{formatCurrency(allocation.allocatedAmount)}</td>
              </tr>
            ))}
            {!preview.allocations.length && <tr><td colSpan="3" className="p-4 text-center text-slate-500">Enter an amount to preview oldest-first allocation.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function CentralPayment({ currentUser, onInvalidSession }) {
  const isNisstajAdmin = isOwnerUser(currentUser);
  const invalidatingSessionRef = useRef(false);
  const [activeTab, setActiveTab] = useState("manual");
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [form, setForm] = useState({
    transactionType: "PAYMENT",
    amount: "",
    paymentMethod: "Cash",
    paymentDate: new Date().toISOString().slice(0, 10),
    paidBy: "",
    externalReference: "",
    notes: "",
  });
  const fcSession = useMemo(
    () => getFcSessionState(currentUser),
    [currentUser],
  );
  const sessionReady = fcSession.valid && !sessionInvalid;

  const clearFinancialState = useCallback(() => {
    setCustomers([]);
    setSelectedCustomerId("");
    setSelectedBranchId("");
    setSnapshot(null);
    setOwnerPassword("");
    setSearch("");
    setSuccess("");
    setLoading(false);
  }, []);

  const invalidateFcSession = useCallback(async () => {
    if (invalidatingSessionRef.current) return;
    invalidatingSessionRef.current = true;
    setSessionInvalid(true);
    clearFinancialState();
    clearFcSessionStorage(window.localStorage);
    await onInvalidSession?.();
  }, [clearFinancialState, onInvalidSession]);

  const handleInvalidSessionError = useCallback(
    async (sessionError) => {
      if (!isInvalidFcSessionError(sessionError)) return false;
      await invalidateFcSession();
      return true;
    },
    [invalidateFcSession],
  );

  useEffect(() => {
    if (!fcSession.valid) {
      const invalidTimer = window.setTimeout(() => {
        void invalidateFcSession();
      }, 0);
      return () => window.clearTimeout(invalidTimer);
    }

    const validTimer = window.setTimeout(() => {
      invalidatingSessionRef.current = false;
      setSessionInvalid(false);
    }, 0);
    const expiryDelay = Math.max(0, fcSession.expiresAt - Date.now());
    const expiryTimer = window.setTimeout(
      () => void invalidateFcSession(),
      Math.min(expiryDelay, 2_147_483_647),
    );

    return () => {
      window.clearTimeout(validTimer);
      window.clearTimeout(expiryTimer);
    };
  }, [fcSession.expiresAt, fcSession.valid, invalidateFcSession]);

  useEffect(() => {
    if (!isNisstajAdmin && activeTab !== "manual") {
      setActiveTab("manual");
    }
  }, [activeTab, isNisstajAdmin]);

  useEffect(() => {
    if (!sessionReady) return undefined;
    let active = true;
    loadCentralPaymentCustomers()
      .then((rows) => {
        if (!active) return;
        setCustomers(rows);
        if (rows.length) setSelectedCustomerId((value) => value || rows[0].id);
      })
      .catch(async (loadError) => {
        if (await handleInvalidSessionError(loadError)) return;
        setError(loadError.message || "Could not load customers.");
      });
    return () => {
      active = false;
    };
  }, [handleInvalidSessionError, sessionReady]);

  const selectedCustomer = customers.find((customer) => String(customer.id) === String(selectedCustomerId));
  const branches = getActiveCustomerBranches(selectedCustomer);
  const hasBranches = branches.length > 0;
  const branchSelectionRequired = hasBranches && selectedBranchId === BRANCH_SELECT;
  const snapshotBranchId = selectedBranchId === BRANCH_SELECT ? "" : selectedBranchId;
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => matchesCustomer(customer, search)),
    [customers, search]
  );
  const preview = useMemo(
    () =>
      buildPaymentPreview({
        invoices: snapshot?.invoices || [],
        allocations: snapshot?.allocations || [],
        amount: Number(form.amount || 0),
        branchId: snapshotBranchId,
      }),
    [form.amount, snapshot, snapshotBranchId]
  );
  const payments = useMemo(
    () =>
      [...(snapshot?.selectedPayments || snapshot?.payments || [])].sort(
        (left, right) =>
          new Date(right.payment_date || right.created_at || 0) -
          new Date(left.payment_date || left.created_at || 0)
      ),
    [snapshot]
  );
  const pendingBankTransfers = useMemo(
    () =>
      [...(snapshot?.selectedAllPayments || snapshot?.allPayments || [])]
        .filter(
          (payment) =>
            payment.payment_method === "Bank Transfer" &&
            payment.verification_status === "PENDING_VERIFICATION"
        )
        .sort(
          (left, right) =>
            new Date(right.payment_date || right.created_at || 0) -
            new Date(left.payment_date || left.created_at || 0)
        ),
    [snapshot]
  );

  const refreshSnapshot = async () => {
    if (!sessionReady || !selectedCustomer) return;
    setLoading(true);
    try {
      setSnapshot(
        await loadCentralPaymentSnapshot({
          customerAccountId: selectedCustomer.id,
          customerName: selectedCustomer.account_name,
          customer: selectedCustomer,
          selectedBranchId: snapshotBranchId,
        })
      );
    } catch (loadError) {
      if (await handleInvalidSessionError(loadError)) return;
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!sessionReady) return undefined;
    let active = true;
    if (!selectedCustomer) return undefined;
    if (selectedBranchId === BRANCH_SELECT) {
      setSnapshot(null);
      setLoading(false);
      return undefined;
    }
    void Promise.resolve().then(async () => {
      if (active) setLoading(true);
      try {
        const nextSnapshot = await loadCentralPaymentSnapshot({
          customerAccountId: selectedCustomer.id,
          customerName: selectedCustomer.account_name,
          customer: selectedCustomer,
          selectedBranchId: snapshotBranchId,
        });
        if (active) setSnapshot(nextSnapshot);
      } catch (loadError) {
        if (await handleInvalidSessionError(loadError)) return;
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [
    handleInvalidSessionError,
    selectedBranchId,
    selectedCustomer,
    sessionReady,
    snapshotBranchId,
  ]);

  useEffect(() => {
    if (!selectedCustomer || !hasBranches) {
      setSelectedBranchId("");
      return;
    }
    setSelectedBranchId(BRANCH_SELECT);
  }, [selectedCustomer?.id]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSuccess("");
  };

  const savePayment = async () => {
    if (saving) return;

    if (form.transactionType === "DISCOUNT" && !String(form.notes).trim()) {
      setError("A detailed discount reason is compulsory.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result = await createCentralPayment({
        customer: selectedCustomer,
        customerAccountId: selectedCustomer?.id,
        customerBranchId: snapshotBranchId || null,
        transactionType: form.transactionType,
        amount: form.amount,
        paymentMethod: form.transactionType === "DISCOUNT" ? "Other" : form.paymentMethod,
        paymentDate: form.paymentDate ? `${form.paymentDate}T12:00:00` : new Date().toISOString(),
        paidBy: form.paidBy,
        externalReference: form.externalReference,
        notes: form.notes,
        currentUser,
        ownerPassword,
      });

      const pending =
        result?.verification_status === "PENDING_VERIFICATION" ||
        result?.payment?.verification_status === "PENDING_VERIFICATION";

      setSuccess(
        result.duplicate
          ? "Duplicate transaction detected; nothing was posted."
          : pending
          ? "Bank transfer recorded as Pending Verification. It has not reduced the balance or paid invoices."
          : form.transactionType === "DISCOUNT"
          ? "Owner discount saved with a compulsory audit reason."
          : "Payment saved and allocated oldest-first."
      );
      setForm((current) => ({
        ...current,
        amount: "",
        externalReference: "",
        notes: "",
      }));
      await refreshSnapshot();
    } catch (saveError) {
      if (await handleInvalidSessionError(saveError)) return;
      setError(saveError.message || "Could not save transaction.");
    } finally {
      setSaving(false);
    }
  };

  const confirmBank = async (payment) => {
    const note = window.prompt("Enter the compulsory bank verification note or bank statement reference.");
    if (!String(note || "").trim()) {
      setError("A bank verification note is compulsory.");
      return;
    }

    setError("");
    setSuccess("");
    try {
      await confirmOwnerBankTransfer({
        payment,
        customer: selectedCustomer,
        currentUser,
        note,
      });
      setSuccess("Bank transfer confirmed, audited and allocated to the oldest outstanding invoices.");
      await refreshSnapshot();
    } catch (confirmError) {
      if (await handleInvalidSessionError(confirmError)) return;
      setError(confirmError.message || "Could not confirm bank transfer.");
    }
  };

  const rejectBank = async (payment) => {
    const reason = window.prompt(
      "Enter the compulsory rejection reason. The customer will not see this rejected payment."
    );
    if (!String(reason || "").trim()) {
      setError("A rejection reason is compulsory.");
      return;
    }
    if (!window.confirm("Reject this bank transfer? It will remain in Payment History and Global History but will be hidden from the customer statement.")) return;

    setError("");
    setSuccess("");
    try {
      await rejectOwnerBankTransfer({
        payment,
        currentUser,
        reason,
      });
      setSuccess("Bank transfer rejected. It remains in internal history and has been removed from the customer display.");
      await refreshSnapshot();
    } catch (rejectError) {
      if (await handleInvalidSessionError(rejectError)) return;
      setError(rejectError.message || "Could not reject bank transfer.");
    }
  };

  if (!sessionReady) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 font-bold text-amber-900">
          Your Fair Choice session is missing or expired. Returning to sign in…
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {isNisstajAdmin && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold">Owner Finance Platform</h2>
              <p className="text-sm text-slate-600">
                Manage customer payments or inspect the permanent global ledger.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-extrabold">Central Payment</h2>
        <p className="mt-1 text-sm text-slate-600">
          One owner-controlled view for payments, pending bank transfers and audited discounts.
        </p>
        {activeTab === "manual" && (
        <div className={`mt-4 grid grid-cols-1 gap-3 ${hasBranches ? "lg:grid-cols-[1fr_1.2fr_1fr]" : "lg:grid-cols-[1fr_1.2fr]"}`}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer" className="rounded-xl border p-3" />
          <select value={selectedCustomerId} onChange={(event) => { setSelectedCustomerId(event.target.value); setSelectedBranchId(""); }} className="rounded-xl border p-3">
            {filteredCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.account_name}</option>)}
          </select>
          {hasBranches && (
            <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)} className="rounded-xl border p-3">
              <option value={BRANCH_SELECT}>Select branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
            </select>
          )}
        </div>
        )}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Central Payment sections">
        {getCentralPaymentSections(currentUser).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setActiveTab(value)} className={`rounded-xl px-4 py-3 font-bold ${activeTab === value ? "bg-blue-800 text-white" : "border bg-white text-slate-700"}`}>
            {label}
          </button>
        ))}
      </nav>

      {loading && <div className="rounded-xl bg-slate-50 p-3 font-bold">Loading balances...</div>}
      {error && <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{error}</div>}
      {success && <div className="rounded-xl bg-green-50 p-3 font-bold text-green-700">{success}</div>}

      {activeTab === "manual" && (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="Customer outstanding" value={snapshot?.customerSummary?.outstanding} />
        <SummaryCard label="Selected branch outstanding" value={snapshot?.branchSummary?.outstanding} />
        <SummaryCard label="Opening balance" value={snapshot?.selectedOpeningBalance ?? snapshot?.customerSummary?.openingBalance} neutral />
        <SummaryCard label="Pending bank transfers" value={pendingBankTransfers.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)} neutral />
      </div>
      )}

      {activeTab === "manual" && pendingBankTransfers.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <div className="mb-3">
            <h3 className="text-lg font-extrabold">Bank Transfers Awaiting Approval</h3>
            <p className="text-sm text-slate-600">Pending transfers do not affect the customer balance. Approve or reject each transfer here.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead><tr className="border-b bg-amber-50 text-left"><th className="p-3">Date</th><th className="p-3">Reference</th><th className="p-3">Paid By</th><th className="p-3 text-right">Amount</th><th className="p-3">Proof</th><th className="p-3">Status</th><th className="p-3 text-right">Action</th></tr></thead>
              <tbody>
                {pendingBankTransfers.map((payment) => {
                  const proof = getBankProof(payment);
                  return (
                  <tr key={payment.id} className="border-b">
                    <td className="p-3">{new Date(payment.payment_date || payment.created_at).toLocaleDateString("en-GB")}</td>
                    <td className="p-3 font-bold">{formatDisplayOrderId(payment.payment_reference) || "-"}</td>
                    <td className="p-3">{payment.paid_by || "-"}</td>
                    <td className="p-3 text-right font-extrabold">{formatCurrency(payment.amount || 0)}</td>
                    <td className="p-3">
                      {proof.dataUrl ? (
                        <a href={proof.dataUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 font-bold text-blue-800">
                          <img src={proof.dataUrl} alt="Bank proof" className="h-10 w-10 rounded object-cover" />
                          View proof
                        </a>
                      ) : (
                        <span className="text-xs font-bold text-red-700">No proof</span>
                      )}
                    </td>
                    <td className="p-3"><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-extrabold text-amber-800">UNAPPROVED</span></td>
                    <td className="p-3 text-right">
                      <button type="button" onClick={() => confirmBank(payment)} disabled={!proof.dataUrl} title={!proof.dataUrl ? "Bank proof is required before approval" : "Approve bank transfer"} className="rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Approve</button>
                      <button type="button" onClick={() => rejectBank(payment)} className="ml-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">Reject</button>
                    </td>
                  </tr>
                );})}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeTab === "manual" && (
        <ManualPaymentPanel
          branches={branches}
          branchSelectionRequired={branchSelectionRequired}
          form={form}
          ownerPassword={ownerPassword}
          onOwnerPasswordChange={setOwnerPassword}
          preview={preview}
          saving={saving}
          selectedCustomer={selectedCustomer}
          onSave={savePayment}
          onUpdateForm={updateForm}
        />
      )}

      {isNisstajAdmin && activeTab === "history" && (
        <PaymentRecordsPanel
          archived={false}
          currentUser={currentUser}
          onInvalidSessionError={handleInvalidSessionError}
        />
      )}
      {isNisstajAdmin && activeTab === "archive" && (
        <PaymentRecordsPanel
          archived
          currentUser={currentUser}
          onInvalidSessionError={handleInvalidSessionError}
        />
      )}
      {isNisstajAdmin && activeTab === "ledger" && (
        <GlobalLedgerPanel
          currentUser={currentUser}
          onInvalidSessionError={handleInvalidSessionError}
        />
      )}
    </div>
  );
}
