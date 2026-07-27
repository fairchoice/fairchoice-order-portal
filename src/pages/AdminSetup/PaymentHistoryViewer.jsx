import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  listReadOnlyPaymentBranches,
  listReadOnlyPaymentHistory,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_SOURCE_OPTIONS,
} from "../../services/paymentHistoryReadOnlyService";

const initialFilters = {
  dateFrom: "",
  dateTo: "",
  status: "",
  verificationStatus: "",
  method: "",
  source: "",
  branchId: "",
  sort: "payment_newest",
};

const formatDate = (value, includeTime = false) => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return includeTime
    ? date.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })
    : date.toLocaleDateString("en-GB");
};

const displayValue = (value) => {
  const text = String(value ?? "").trim();
  return text || "Not available";
};

const stateStyles = {
  active: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-900",
  voided: "bg-red-100 text-red-800",
  rejected: "bg-rose-100 text-rose-800",
  other: "bg-slate-100 text-slate-700",
};

const stateLabels = {
  active: "Active / posted",
  pending: "Pending bank",
  voided: "Voided",
  rejected: "Rejected",
  other: "Other",
};

export default function PaymentHistoryViewer() {
  const [draftSearch, setDraftSearch] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ records: [], total: 0, page: 1, pageSize: 20, totalPages: 1 });
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    listReadOnlyPaymentBranches().then((rows) => {
      if (!cancelled) setBranches(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    Promise.resolve()
      .then(() => {
        if (requestRef.current !== requestId) return null;
        setLoading(true);
        setError(null);
        return listReadOnlyPaymentHistory({ page, search, ...filters });
      })
      .then((nextResult) => {
        if (!nextResult || requestRef.current !== requestId) return;
        setResult(nextResult);
        if (page > nextResult.totalPages) setPage(nextResult.totalPages);
      })
      .catch((loadError) => {
        if (requestRef.current !== requestId) return;
        setResult((current) => ({ ...current, records: [] }));
        setError({
          message: loadError?.message || "Payment History could not be loaded.",
          technical: loadError?.technicalMessage || loadError?.cause?.message || "",
        });
      })
      .finally(() => {
        if (requestRef.current === requestId) setLoading(false);
      });
  }, [page, search, filters, reloadToken]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const applySearch = (event) => {
    event.preventDefault();
    setSearch(draftSearch.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setDraftSearch("");
    setSearch("");
    setFilters(initialFilters);
    setPage(1);
  };

  const firstVisible = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const lastVisible = Math.min(result.page * result.pageSize, result.total);

  return (
    <section className="space-y-4" aria-labelledby="payment-history-title">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 id="payment-history-title" className="text-2xl font-extrabold text-slate-950">
              Payment History
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Canonical records from customer_payments. One row represents one payment ID.
            </p>
          </div>
          <span className="w-fit rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-bold text-blue-800">
            Read-only viewer
          </span>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <form onSubmit={applySearch} className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600">Search</span>
            <input
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder="Payment reference, customer/account, or exact payment ID"
              className="min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2"
            />
          </label>
          <button type="submit" className="min-h-11 self-end rounded-xl bg-blue-700 px-5 py-2 font-bold text-white hover:bg-blue-800">
            Search
          </button>
          <button type="button" onClick={clearFilters} className="min-h-11 self-end rounded-xl border border-slate-300 px-5 py-2 font-bold text-slate-700 hover:bg-slate-50">
            Clear
          </button>
        </form>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <Filter label="From date"><input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className="filter-control" /></Filter>
          <Filter label="To date"><input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className="filter-control" /></Filter>
          <Filter label="Status"><select value={filters.status} onChange={(e) => updateFilter("status", e.target.value)} className="filter-control"><option value="">All</option><option value="POSTED">POSTED</option><option value="ACTIVE">ACTIVE</option><option value="VOIDED">VOIDED</option></select></Filter>
          <Filter label="Verification"><select value={filters.verificationStatus} onChange={(e) => updateFilter("verificationStatus", e.target.value)} className="filter-control"><option value="">All</option><option value="PENDING_VERIFICATION">PENDING</option><option value="CONFIRMED">CONFIRMED</option><option value="REJECTED">REJECTED</option><option value="VOIDED">VOIDED</option></select></Filter>
          <Filter label="Method"><select value={filters.method} onChange={(e) => updateFilter("method", e.target.value)} className="filter-control"><option value="">All</option>{PAYMENT_METHOD_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Filter>
          <Filter label="Source"><select value={filters.source} onChange={(e) => updateFilter("source", e.target.value)} className="filter-control"><option value="">All</option>{PAYMENT_SOURCE_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select></Filter>
          <Filter label="Branch"><select value={filters.branchId} onChange={(e) => updateFilter("branchId", e.target.value)} className="filter-control"><option value="">All</option><option value="MAIN">Main account</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name || "Not available"}</option>)}</select></Filter>
          <Filter label="Sort"><select value={filters.sort} onChange={(e) => updateFilter("sort", e.target.value)} className="filter-control"><option value="payment_newest">Payment: newest</option><option value="payment_oldest">Payment: oldest</option><option value="created_newest">Created: newest</option><option value="created_oldest">Created: oldest</option><option value="amount_highest">Amount: highest</option><option value="amount_lowest">Amount: lowest</option></select></Filter>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <Legend state="active" />
        <Legend state="pending" />
        <Legend state="voided" />
        <Legend state="rejected" />
      </div>

      {error && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-red-900 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold">{error.message}</div>
            {import.meta.env.DEV && error.technical && (
              <div className="mt-1 break-words font-mono text-xs">{error.technical}</div>
            )}
          </div>
          <button type="button" onClick={() => setReloadToken((value) => value + 1)} className="min-h-11 rounded-xl bg-red-800 px-4 py-2 font-bold text-white">Retry</button>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="font-bold text-slate-800">{loading ? "Loading canonical payments…" : `${result.total} payment${result.total === 1 ? "" : "s"}`}</span>
          {!loading && <span className="text-slate-600">Showing {firstVisible}–{lastVisible}</span>}
        </div>
        <div className="overflow-x-auto" aria-busy={loading}>
          <table className="min-w-[1650px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                {[
                  "Payment date", "Payment reference", "Customer/account", "Branch", "Amount",
                  "Payment method", "Payment source", "Payer/collector", "Status",
                  "Verification status", "Transaction type", "Created date", "Payment ID",
                ].map((heading) => <th key={heading} className="whitespace-nowrap px-3 py-3">{heading}</th>)}
              </tr>
            </thead>
            <tbody>
              {!loading && result.records.map((payment) => (
                <tr key={payment.id} data-payment-id={payment.id} className={`border-t border-slate-200 align-top ${payment.display_state === "voided" ? "bg-red-50/40" : payment.display_state === "pending" ? "bg-amber-50/50" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(payment.payment_date)}</td>
                  <td className="px-3 py-3 font-bold">{displayValue(payment.payment_reference)}</td>
                  <td className="px-3 py-3">{payment.customer_name}</td>
                  <td className="px-3 py-3">{payment.branch_name}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-extrabold">{formatCurrency(Number(payment.amount || 0))}</td>
                  <td className="px-3 py-3">{displayValue(payment.payment_method)}</td>
                  <td className="px-3 py-3">{displayValue(payment.source)}</td>
                  <td className="px-3 py-3"><div>{displayValue(payment.paid_by || payment.created_by)}</div><div className="text-xs text-slate-500">{displayValue(payment.collector_role)}</div></td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-extrabold ${stateStyles[payment.display_state]}`}>{stateLabels[payment.display_state]}</span><div className="mt-1 text-xs text-slate-600">{displayValue(payment.status)}</div></td>
                  <td className="px-3 py-3">{displayValue(payment.verification_status)}</td>
                  <td className="px-3 py-3">{displayValue(payment.transaction_type)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{formatDate(payment.created_at, true)}</td>
                  <td className="max-w-[280px] break-all px-3 py-3 font-mono text-xs" title={payment.id}>{payment.id}</td>
                </tr>
              ))}
              {!loading && !error && !result.records.length && (
                <tr><td colSpan="13" className="p-8 text-center text-slate-600">No canonical payments match the current search and filters.</td></tr>
              )}
              {loading && (
                <tr><td colSpan="13" className="p-8 text-center font-semibold text-slate-600">Loading payment page…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-bold text-slate-700">Page {result.page} of {result.totalPages}</span>
          <div className="flex gap-2">
            <button type="button" disabled={loading || result.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
            <button type="button" disabled={loading || result.page >= result.totalPages} onClick={() => setPage((value) => value + 1)} className="min-h-11 rounded-xl bg-blue-700 px-5 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">Next</button>
          </div>
        </div>
      </div>

      <style>{`.filter-control{min-height:44px;width:100%;border:1px solid #cbd5e1;border-radius:0.75rem;background:white;padding:0.5rem 0.625rem;color:#0f172a}`}</style>
    </section>
  );
}

function Filter({ label, children }) {
  return <label><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-600">{label}</span>{children}</label>;
}

function Legend({ state }) {
  return <span className={`rounded-full px-3 py-1 ${stateStyles[state]}`}>{stateLabels[state]}</span>;
}
