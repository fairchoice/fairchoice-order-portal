import { useEffect, useMemo, useState } from "react";
import { loadReadOnlyCustomerCreditSnapshot } from "../../services/centralPaymentService";
import { formatCurrency } from "../../utils/currency";

const PAGE_SIZE = 30;
const HISTORY_PAGE_SIZE = 50;
const money = (value) => formatCurrency(Number(value || 0));
const numberValue = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
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
  const latestTransactionBalance = transactions.length
    ? numberValue(transactions[transactions.length - 1]?.running_balance, transactions[transactions.length - 1]?.runningBalance)
    : NaN;
  const totalOutstanding = Math.max(0, numberValue(
    accountSummary.closingBalance,
    Number.isFinite(latestTransactionBalance) ? latestTransactionBalance : undefined,
    summary.outstandingBalance,
    summary.outstanding
  ));
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
    age8_14: buckets["8_14"],
    age15_30: buckets["15_30"],
    age31_60: buckets["31_60"],
    age61_90: buckets["61_90"],
    age90Plus: buckets["90_plus"],
    oldestDate,
    oldestDays,
    lastPayment,
    availableCredit: creditLimit - totalOutstanding,
    transactionHistory,
    error: error?.message || "",
  };
}

export default function AllCreditOutstanding({ customers = [] }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [activeTab, setActiveTab] = useState("outstanding");
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("All");
  const [ageFilter, setAgeFilter] = useState("All");
  const [sort, setSort] = useState("outstanding_desc");
  const [historyCustomer, setHistoryCustomer] = useState("All");
  const [historyBranch, setHistoryBranch] = useState("All");
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  const refresh = async () => {
    setLoading(true);
    setProgress({ done: 0, total: customers.length });
    const loaded = await loadInBatches(customers, (done, total) => setProgress({ done, total }));
    setRows(loaded);
    setPage(1);
    setHistoryPage(1);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [customers]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = rows.filter((row) => {
      if (row.totalOutstanding <= 0 && !row.error) return false;
      if (needle && !`${row.customerName} ${row.customerCode}`.toLowerCase().includes(needle)) return false;
      if (countryFilter !== "All" && String(row.country || "").trim().toLowerCase() !== countryFilter.toLowerCase()) return false;
      if (ageFilter === "8+") return row.oldestDays >= 8;
      if (ageFilter === "15+") return row.oldestDays >= 15;
      if (ageFilter === "30+") return row.oldestDays >= 30;
      if (ageFilter === "60+") return row.oldestDays >= 60;
      if (ageFilter === "90+") return row.oldestDays >= 90;
      return true;
    });
    return result.sort((a, b) => {
      if (sort === "outstanding_asc") return a.totalOutstanding - b.totalOutstanding;
      if (sort === "age_desc") return b.oldestDays - a.oldestDays || b.totalOutstanding - a.totalOutstanding;
      if (sort === "age_asc") return a.oldestDays - b.oldestDays || b.totalOutstanding - a.totalOutstanding;
      if (sort === "name") return a.customerName.localeCompare(b.customerName);
      return b.totalOutstanding - a.totalOutstanding;
    });
  }, [rows, search, countryFilter, ageFilter, sort]);

  const totals = useMemo(() => filtered.reduce((sum, row) => ({
    outstanding: sum.outstanding + row.totalOutstanding,
    current: sum.current + row.current,
    age8_14: sum.age8_14 + row.age8_14,
    age15_30: sum.age15_30 + row.age15_30,
    age31_60: sum.age31_60 + row.age31_60,
    age61_90: sum.age61_90 + row.age61_90,
    age90Plus: sum.age90Plus + row.age90Plus,
  }), { outstanding: 0, current: 0, age8_14: 0, age15_30: 0, age31_60: 0, age61_90: 0, age90Plus: 0 }), [filtered]);

  const allTransactions = useMemo(() => rows.flatMap((row) => row.transactionHistory || []), [rows]);
  const historyBranches = useMemo(() => {
    const branches = new Map();
    allTransactions
      .filter((transaction) => historyCustomer === "All" || String(transaction.customerId) === String(historyCustomer))
      .forEach((transaction) => {
        const name = String(transaction.branchName || "").trim();
        if (!name || name === "—") return;
        branches.set(transaction.branchKey || `name:${name}`, name);
      });
    return [...branches.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allTransactions, historyCustomer]);

  const filteredTransactions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allTransactions
      .filter((transaction) => historyCustomer === "All" || String(transaction.customerId) === String(historyCustomer))
      .filter((transaction) => historyBranch === "All" || transaction.branchKey === historyBranch)
      .filter((transaction) => {
        if (!needle) return true;
        return `${transaction.customerName} ${transaction.reference} ${transaction.branchName} ${transaction.description} ${transaction.type} ${transaction.status}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  }, [allTransactions, historyCustomer, historyBranch, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visible = filtered.slice((activePage - 1) * PAGE_SIZE, activePage * PAGE_SIZE);
  const historyPageCount = Math.max(1, Math.ceil(filteredTransactions.length / HISTORY_PAGE_SIZE));
  const activeHistoryPage = Math.min(historyPage, historyPageCount);
  const visibleTransactions = filteredTransactions.slice((activeHistoryPage - 1) * HISTORY_PAGE_SIZE, activeHistoryPage * HISTORY_PAGE_SIZE);

  useEffect(() => setPage(1), [search, countryFilter, ageFilter, sort]);
  useEffect(() => setHistoryPage(1), [search, historyCustomer, historyBranch]);
  useEffect(() => setHistoryBranch("All"), [historyCustomer]);

  return <section className="space-y-4">
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold text-slate-900">Total Credit Outstanding</h3>
          <p className="text-sm text-slate-500">Outstanding credit and transaction history in one report.</p>
        </div>
        <button type="button" onClick={refresh} disabled={loading} className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50">{loading ? `Loading ${progress.done}/${progress.total}` : "Refresh"}</button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button type="button" onClick={() => setActiveTab("outstanding")} className={`rounded-xl px-4 py-2 text-sm font-bold ${activeTab === "outstanding" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>Credit Outstanding</button>
        <button type="button" onClick={() => setActiveTab("history")} className={`rounded-xl px-4 py-2 text-sm font-bold ${activeTab === "history" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>Transaction History</button>
      </div>

      {activeTab === "outstanding" ? (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer" className="rounded-xl border p-3" />
          <select value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} className="rounded-xl border p-3"><option value="All">All Countries</option><option value="England">England</option><option value="Wales">Wales</option></select>
          <select value={ageFilter} onChange={(e) => setAgeFilter(e.target.value)} className="rounded-xl border p-3"><option>All</option><option value="8+">Age 8+ days</option><option value="15+">Age 15+ days</option><option value="30+">Age 30+ days</option><option value="60+">Age 60+ days</option><option value="90+">Age 90+ days</option></select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-xl border p-3"><option value="outstanding_desc">Highest outstanding first</option><option value="outstanding_asc">Lowest outstanding first</option><option value="age_desc">Oldest debt first</option><option value="age_asc">Newest debt first</option><option value="name">Customer name</option></select>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer, reference, branch or description" className="rounded-xl border p-3" />
          <select value={historyCustomer} onChange={(e) => setHistoryCustomer(e.target.value)} className="rounded-xl border p-3">
            <option value="All">All Customers</option>
            {[...rows].sort((a, b) => a.customerName.localeCompare(b.customerName)).map((row) => <option key={row.customerId} value={row.customerId}>{row.customerName}</option>)}
          </select>
          <select value={historyBranch} onChange={(e) => setHistoryBranch(e.target.value)} className="rounded-xl border p-3">
            <option value="All">All Branches</option>
            {historyBranches.map((branch) => <option key={branch.key} value={branch.key}>{branch.name}</option>)}
          </select>
        </div>
      )}
    </div>

    {activeTab === "outstanding" ? <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[["Total Outstanding", totals.outstanding], ["0-7 Days", totals.current], ["8-14 Days", totals.age8_14], ["15-30 Days", totals.age15_30], ["31-60 Days", totals.age31_60], ["61-90 Days", totals.age61_90], ["90+ Days", totals.age90Plus]].map(([label, value]) => <div key={label} className="rounded-xl border bg-white p-3 shadow-sm"><div className="text-xs font-bold uppercase text-slate-500">{label}</div><div className={`mt-1 text-lg font-extrabold ${label === "90+ Days" && Number(value) > 0 ? "text-red-700" : "text-slate-900"}`}>{money(value)}</div></div>)}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto"><table className="w-full min-w-[1250px] text-sm"><thead><tr className="bg-slate-100 text-left"><th className="p-3">Customer</th><th className="p-3 text-right">Outstanding</th><th className="p-3 text-right">Invoices</th><th className="p-3 text-right">0-7</th><th className="p-3 text-right">8-14</th><th className="p-3 text-right">15-30</th><th className="p-3 text-right">31-60</th><th className="p-3 text-right">61-90</th><th className="p-3 text-right">90+</th><th className="p-3">Oldest</th><th className="p-3 text-right">Age</th><th className="p-3">Last Payment</th><th className="p-3 text-right">Credit Limit</th><th className="p-3 text-right">Available</th></tr></thead><tbody>
          {visible.map((row) => <tr key={row.customerId} className="border-t hover:bg-blue-50"><td className="p-3"><div className="font-bold text-slate-900">{row.customerName}</div><div className="text-xs text-slate-500">{row.customerCode || (row.error ? row.error : "")}</div></td><td className="p-3 text-right font-extrabold text-red-700">{money(row.totalOutstanding)}</td><td className="p-3 text-right">{row.outstandingInvoices}</td><td className="p-3 text-right">{money(row.current)}</td><td className="p-3 text-right">{money(row.age8_14)}</td><td className="p-3 text-right">{money(row.age15_30)}</td><td className="p-3 text-right">{money(row.age31_60)}</td><td className="p-3 text-right">{money(row.age61_90)}</td><td className="p-3 text-right font-bold text-red-700">{money(row.age90Plus)}</td><td className="p-3">{formatDate(row.oldestDate)}</td><td className="p-3 text-right font-bold">{row.oldestDays >= 999 ? "Opening" : `${row.oldestDays}d`}</td><td className="p-3">{formatDate(row.lastPayment)}</td><td className="p-3 text-right">{money(row.creditLimit)}</td><td className={`p-3 text-right font-bold ${row.availableCredit < 0 ? "text-red-700" : "text-green-700"}`}>{money(row.availableCredit)}</td></tr>)}
          {!visible.length && !loading && <tr><td colSpan="14" className="p-8 text-center text-slate-500">No outstanding customer credit found.</td></tr>}
        </tbody></table></div>
        {filtered.length > PAGE_SIZE && <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm"><span>Showing {(activePage - 1) * PAGE_SIZE + 1}-{Math.min(activePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span><div className="flex items-center gap-2"><button disabled={activePage <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Previous</button><span>Page {activePage} of {pageCount}</span><button disabled={activePage >= pageCount} onClick={() => setPage((v) => Math.min(pageCount, v + 1))} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Next</button></div></div>}
      </div>
    </> : (
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="border-b bg-slate-50 px-4 py-3 text-sm text-slate-600">{filteredTransactions.length} transaction{filteredTransactions.length === 1 ? "" : "s"}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm">
            <thead><tr className="bg-slate-100 text-left"><th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Type</th><th className="p-3">Reference</th><th className="p-3">Branch</th><th className="p-3">Description</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th><th className="p-3 text-right">Running Balance</th><th className="p-3">Status</th></tr></thead>
            <tbody>
              {visibleTransactions.map((transaction, index) => <tr key={`${transaction.customerId}-${transaction.id}-${index}`} className="border-t hover:bg-blue-50"><td className="whitespace-nowrap p-3">{formatDateTime(transaction.date)}</td><td className="p-3 font-bold text-slate-900">{transaction.customerName}</td><td className="p-3"><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{transaction.type.replaceAll("_", " ")}</span></td><td className="p-3 font-medium">{transaction.reference || "—"}</td><td className="p-3">{transaction.branchName || "—"}</td><td className="p-3 text-slate-600">{transaction.description || "—"}</td><td className="p-3 text-right font-semibold text-red-700">{transaction.debit ? money(transaction.debit) : "—"}</td><td className="p-3 text-right font-semibold text-green-700">{transaction.credit ? money(transaction.credit) : "—"}</td><td className="p-3 text-right font-extrabold">{money(transaction.runningBalance)}</td><td className="p-3">{transaction.status ? <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold">{transaction.status.replaceAll("_", " ").toUpperCase()}</span> : "—"}</td></tr>)}
              {!visibleTransactions.length && !loading && <tr><td colSpan="10" className="p-8 text-center text-slate-500">No transaction history found.</td></tr>}
            </tbody>
          </table>
        </div>
        {filteredTransactions.length > HISTORY_PAGE_SIZE && <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm"><span>Showing {(activeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(activeHistoryPage * HISTORY_PAGE_SIZE, filteredTransactions.length)} of {filteredTransactions.length}</span><div className="flex items-center gap-2"><button disabled={activeHistoryPage <= 1} onClick={() => setHistoryPage((v) => Math.max(1, v - 1))} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Previous</button><span>Page {activeHistoryPage} of {historyPageCount}</span><button disabled={activeHistoryPage >= historyPageCount} onClick={() => setHistoryPage((v) => Math.min(historyPageCount, v + 1))} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Next</button></div></div>}
      </div>
    )}
  </section>;
}
