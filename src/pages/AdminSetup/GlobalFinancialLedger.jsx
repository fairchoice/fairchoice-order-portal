import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  bulkArchiveFinancialTransactions,
  listGlobalFinancialHistory,
  permanentlyDeleteFinancialArchive,
  restoreFinancialTransaction,
} from "../../services/globalFinancialLedgerService";

const methods = ["Cash", "Card", "Bank Transfer", "Cheque", "Other"];
const types = ["PAYMENT", "DISCOUNT", "INVOICE", "CREDIT", "REFUND", "ADJUSTMENT"];

export default function GlobalFinancialLedger({ currentUser, ownerPassword }) {
  const [filters, setFilters] = useState({ search: "", method: "", status: "ACTIVE", transactionType: "", dateFrom: "", dateTo: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ records: [], total: 0, totalPages: 1 });
  const [selected, setSelected] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!ownerPassword) return;
    setLoading(true);
    setMessage("");
    try {
      const data = await listGlobalFinancialHistory({ currentUser, ownerPassword, filters, page });
      setResult(data);
      setSelected([]);
    } catch (error) {
      setMessage(error.message || "Could not load global ledger.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [filters, page, ownerPassword]);

  const activeRows = useMemo(() => result.records.filter((row) => row.status === "ACTIVE"), [result.records]);
  const allSelected = activeRows.length > 0 && activeRows.every((row) => selected.includes(row.recordId));
  const updateFilter = (name, value) => { setFilters((current) => ({ ...current, [name]: value })); setPage(1); };
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  const bulkArchive = async () => {
    const reason = window.prompt("Enter the compulsory archive reason for the selected transactions.");
    if (!String(reason || "").trim()) return;
    if (!window.confirm(`Archive ${selected.length} selected transaction(s)?`)) return;
    try {
      const count = await bulkArchiveFinancialTransactions({ currentUser, ownerPassword, transactionIds: selected, reason });
      setMessage(`${count} transaction(s) archived with a permanent audit trail.`);
      await load();
    } catch (error) { setMessage(error.message || "Bulk archive failed."); }
  };

  const archiveAction = async (row, action) => {
    const reason = window.prompt(`Enter the compulsory ${action} reason.`);
    if (!String(reason || "").trim()) return;
    try {
      if (action === "restore") {
        await restoreFinancialTransaction({ currentUser, ownerPassword, archiveId: row.archiveId, reason });
      } else {
        if (!window.confirm("Permanently delete this archive record? This cannot be undone.")) return;
        await permanentlyDeleteFinancialArchive({ currentUser, ownerPassword, archiveId: row.archiveId, reason });
      }
      await load();
    } catch (error) { setMessage(error.message || "Archive action failed."); }
  };

  if (!ownerPassword) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">Enter the Owner Financial Password in Manual Payment to unlock the global ledger.</div>;

  return <section className="rounded-2xl border bg-white p-4 shadow-sm">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-extrabold">Global Financial Ledger</h3><p className="text-sm text-slate-600">All branches, customers and archived financial activity in one owner-only view.</p></div>
      <div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold">{result.total} records</span><button type="button" disabled={!selected.length} onClick={bulkArchive} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">Archive selected ({selected.length})</button></div>
    </div>

    <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-6">
      <input value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} placeholder="Reference, description, staff" className="rounded-xl border p-3" />
      <select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} className="rounded-xl border p-3"><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option><option value="VOIDED">Voided</option></select>
      <select value={filters.transactionType} onChange={(e) => updateFilter("transactionType", e.target.value)} className="rounded-xl border p-3"><option value="">All types</option>{types.map((value) => <option key={value}>{value}</option>)}</select>
      <select value={filters.method} onChange={(e) => updateFilter("method", e.target.value)} className="rounded-xl border p-3"><option value="">All methods</option>{methods.map((value) => <option key={value}>{value}</option>)}</select>
      <input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className="rounded-xl border p-3" aria-label="From date" />
      <input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className="rounded-xl border p-3" aria-label="To date" />
    </div>

    {message && <div className="mb-3 rounded-xl bg-slate-100 p-3 font-bold text-slate-700">{message}</div>}
    {loading && <div className="mb-3 rounded-xl bg-blue-50 p-3 font-bold text-blue-800">Loading ledger...</div>}

    <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-sm"><thead><tr className="border-b bg-slate-50 text-left">
      <th className="p-3"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : activeRows.map((row) => row.recordId))} aria-label="Select all active rows" /></th>
      <th className="p-3">Date</th><th className="p-3">Reference</th><th className="p-3">Type</th><th className="p-3">Source</th><th className="p-3">Method</th><th className="p-3">Staff</th><th className="p-3">Status</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3">Description</th><th className="p-3 text-right">Actions</th>
    </tr></thead><tbody>
      {result.records.map((row) => <tr key={`${row.archiveId || "active"}-${row.recordId}`} className="border-b align-top">
        <td className="p-3">{row.status === "ACTIVE" && <input type="checkbox" checked={selected.includes(row.recordId)} onChange={() => toggle(row.recordId)} aria-label={`Select ${row.reference || row.recordId}`} />}</td>
        <td className="p-3">{new Date(row.transactionDate).toLocaleDateString("en-GB")}</td><td className="p-3 font-bold">{row.reference || "-"}</td><td className="p-3">{row.transactionType || "-"}</td><td className="p-3">{row.sourceType || "-"}</td><td className="p-3">{row.paymentMethod || "-"}</td><td className="p-3">{row.staffName || "-"}</td><td className="p-3 font-bold">{row.status}</td><td className="p-3 text-right">{formatCurrency(row.debitAmount)}</td><td className="p-3 text-right">{formatCurrency(row.creditAmount)}</td><td className="max-w-[280px] whitespace-pre-wrap p-3">{row.description || "-"}</td>
        <td className="p-3 text-right">{row.status === "ARCHIVED" && row.archiveId && <><button type="button" onClick={() => archiveAction(row, "restore")} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Restore</button><button type="button" onClick={() => archiveAction(row, "delete")} className="ml-2 rounded-lg bg-red-800 px-3 py-2 text-xs font-bold text-white">Delete permanently</button></>}</td>
      </tr>)}
      {!result.records.length && <tr><td colSpan="12" className="p-6 text-center text-slate-500">No ledger records match these filters.</td></tr>}
    </tbody></table></div>

    <div className="mt-4 flex items-center justify-end gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Previous</button><span className="text-sm font-bold">Page {page} of {result.totalPages || 1}</span><button type="button" disabled={page >= (result.totalPages || 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Next</button></div>
  </section>;
}
