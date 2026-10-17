import { useEffect, useMemo, useState } from "react";
import { loadReadOnlyCustomerCreditSnapshot } from "../../services/centralPaymentService";
import { getCustomerAccounts } from "../../services/customerManagement";
import { formatCurrency } from "../../utils/currency";

// Compatibility for the legacy CustomerOrder report mount, which still references
// `customers` even though that page now stores the list as `customerAccounts`.
// The report loads its own customer list below, so this only prevents the bad
// legacy prop expression from crashing the whole Back Office page.
if (typeof globalThis !== "undefined" && !("customers" in globalThis)) {
  globalThis.customers = [];
}

const PAGE_SIZE = 30;
const money = (value) => formatCurrency(Number(value || 0));

const optionalNumber = (...values) => {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
};

const numberValue = (...values) => optionalNumber(...values) ?? 0;

const validDate = (...values) => {
  for (const value of values) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
};

const daysOld = (date, now = new Date()) =>
  date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000)) : 0;

const bucketKey = (days) => {
  if (days <= 7) return "current";
  if (days <= 14) return "age8_14";
  if (days <= 30) return "age15_30";
  if (days <= 60) return "age31_60";
  if (days <= 90) return "age61_90";
  return "age90Plus";
};

const formatDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-GB");
};

async function loadRows(customers, onProgress) {
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

  await Promise.all(
    Array.from({ length: Math.min(5, Math.max(1, customers.length)) }, worker)
  );
  return output;
}

function buildRow(customer, snapshot, error = null) {
  const now = new Date();
  const summary = snapshot?.customerSummary || {};
  const accountSummary = snapshot?.accountHistory?.summary || {};
  const transactions =
    snapshot?.accountHistory?.transactions || snapshot?.transactionHistory || [];

  const latestTransaction = [...transactions]
    .filter(
      (transaction) =>
        optionalNumber(transaction?.running_balance, transaction?.runningBalance) !== null
    )
    .sort(
      (a, b) =>
        (validDate(
          b.transaction_date,
          b.ordering_timestamp,
          b.created_at,
          b.updated_at
        )?.getTime() || 0) -
        (validDate(
          a.transaction_date,
          a.ordering_timestamp,
          a.created_at,
          a.updated_at
        )?.getTime() || 0)
    )[0];

  const latestTransactionBalance = latestTransaction
    ? optionalNumber(latestTransaction.running_balance, latestTransaction.runningBalance)
    : null;

  // Customer Credit is the canonical source. Only fall back when it is genuinely absent.
  const totalOutstanding = Math.max(
    0,
    numberValue(
      summary.outstandingBalance,
      summary.outstanding,
      accountSummary.closingBalance,
      latestTransactionBalance
    )
  );

  const buckets = {
    current: 0,
    age8_14: 0,
    age15_30: 0,
    age31_60: 0,
    age61_90: 0,
    age90Plus: 0,
  };

  let invoiceOutstanding = 0;
  let outstandingInvoices = 0;
  let oldestDate = null;

  (snapshot?.allocatedInvoices || []).forEach((invoice) => {
    const remaining = Math.max(
      0,
      numberValue(invoice.remainingAmount, invoice.remaining_amount)
    );
    if (remaining <= 0) return;

    const date = validDate(
      invoice.delivered_at,
      invoice.delivery_confirmed_at,
      invoice.invoice_date,
      invoice.created_at,
      invoice.updated_at
    );
    buckets[bucketKey(daysOld(date, now))] += remaining;
    invoiceOutstanding += remaining;
    outstandingInvoices += 1;
    if (date && (!oldestDate || date < oldestDate)) oldestDate = date;
  });

  const otherOutstanding = Math.max(0, totalOutstanding - invoiceOutstanding);
  if (otherOutstanding > 0) buckets.age90Plus += otherOutstanding;

  const lastPayment = (snapshot?.allPayments || [])
    .map((payment) =>
      validDate(payment.payment_date, payment.created_at, payment.updated_at)
    )
    .filter(Boolean)
    .sort((a, b) => b - a)[0] || null;

  const creditLimit = numberValue(
    summary.creditLimit,
    summary.credit_limit,
    customer.credit_limit,
    customer.creditLimit
  );

  return {
    customerId: customer.id,
    customerName:
      customer.account_name ||
      customer.company_name ||
      customer.customer_code ||
      "Unnamed customer",
    customerCode: customer.customer_code || customer.account_code || "",
    country:
      customer.country ||
      customer.customer_country ||
      customer.address_country ||
      customer.customer_branches?.[0]?.country ||
      "",
    creditLimit,
    totalOutstanding,
    outstandingInvoices,
    ...buckets,
    oldestDate,
    oldestDays: oldestDate ? daysOld(oldestDate, now) : otherOutstanding > 0 ? 999 : 0,
    lastPayment,
    availableCredit: creditLimit - totalOutstanding,
    error: error?.message || "",
  };
}

export default function AllCreditOutstanding({ customers: providedCustomers = [] }) {
  const [customers, setCustomers] = useState(
    Array.isArray(providedCustomers) ? providedCustomers : []
  );
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("All");
  const [ageFilter, setAgeFilter] = useState("All");
  const [sort, setSort] = useState("outstanding_desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;

    if (Array.isArray(providedCustomers) && providedCustomers.length) {
      setCustomers(providedCustomers);
      return () => {
        active = false;
      };
    }

    getCustomerAccounts()
      .then((data) => {
        if (active) setCustomers(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        console.error("Credit outstanding customer load failed:", error);
        if (active) setCustomers([]);
      });

    return () => {
      active = false;
    };
  }, [providedCustomers]);

  const refresh = async () => {
    setLoading(true);
    setProgress({ done: 0, total: customers.length });
    try {
      const loaded = await loadRows(customers, (done, total) =>
        setProgress({ done, total })
      );
      setRows(loaded);
      setPage(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (customers.length) {
      void refresh();
    } else {
      setRows([]);
    }
  }, [customers]);

  const countries = useMemo(
    () => [
      "All",
      ...new Set(rows.map((row) => String(row.country || "").trim()).filter(Boolean)),
    ],
    [rows]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const result = rows.filter((row) => {
      if (row.totalOutstanding <= 0 && !row.error) return false;
      if (
        needle &&
        !`${row.customerName} ${row.customerCode}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (
        countryFilter !== "All" &&
        String(row.country || "").trim().toLowerCase() !==
          countryFilter.toLowerCase()
      ) {
        return false;
      }
      if (ageFilter === "8+" && row.oldestDays < 8) return false;
      if (ageFilter === "15+" && row.oldestDays < 15) return false;
      if (ageFilter === "30+" && row.oldestDays < 30) return false;
      if (ageFilter === "60+" && row.oldestDays < 60) return false;
      if (ageFilter === "90+" && row.oldestDays < 90) return false;
      return true;
    });

    return result.sort((a, b) => {
      if (sort === "outstanding_asc") return a.totalOutstanding - b.totalOutstanding;
      if (sort === "age_desc") return b.oldestDays - a.oldestDays;
      if (sort === "age_asc") return a.oldestDays - b.oldestDays;
      if (sort === "name") return a.customerName.localeCompare(b.customerName);
      return b.totalOutstanding - a.totalOutstanding;
    });
  }, [rows, search, countryFilter, ageFilter, sort]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          outstanding: sum.outstanding + row.totalOutstanding,
          current: sum.current + row.current,
          age8_14: sum.age8_14 + row.age8_14,
          age15_30: sum.age15_30 + row.age15_30,
          age31_60: sum.age31_60 + row.age31_60,
          age61_90: sum.age61_90 + row.age61_90,
          age90Plus: sum.age90Plus + row.age90Plus,
        }),
        {
          outstanding: 0,
          current: 0,
          age8_14: 0,
          age15_30: 0,
          age31_60: 0,
          age61_90: 0,
          age90Plus: 0,
        }
      ),
    [filtered]
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount);
  const visible = filtered.slice(
    (activePage - 1) * PAGE_SIZE,
    activePage * PAGE_SIZE
  );

  useEffect(() => setPage(1), [search, countryFilter, ageFilter, sort]);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold text-slate-900">
              Total Credit Outstanding
            </h3>
            <p className="text-sm text-slate-500">
              Canonical customer credit outstanding and ageing report.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || !customers.length}
            className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-white disabled:opacity-50"
          >
            {loading
              ? `Loading ${progress.done}/${progress.total}`
              : "Refresh"}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customer"
            className="rounded-xl border p-3"
          />
          <select
            value={countryFilter}
            onChange={(event) => setCountryFilter(event.target.value)}
            className="rounded-xl border p-3"
          >
            {countries.map((country) => (
              <option key={country} value={country}>{country === "All" ? "All Countries" : country}</option>
            ))}
          </select>
          <select
            value={ageFilter}
            onChange={(event) => setAgeFilter(event.target.value)}
            className="rounded-xl border p-3"
          >
            <option value="All">All ages</option>
            <option value="8+">Age 8+ days</option>
            <option value="15+">Age 15+ days</option>
            <option value="30+">Age 30+ days</option>
            <option value="60+">Age 60+ days</option>
            <option value="90+">Age 90+ days</option>
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-xl border p-3"
          >
            <option value="outstanding_desc">Highest outstanding first</option>
            <option value="outstanding_asc">Lowest outstanding first</option>
            <option value="age_desc">Oldest debt first</option>
            <option value="age_asc">Newest debt first</option>
            <option value="name">Customer name</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["Total Outstanding", totals.outstanding],
          ["0-7 Days", totals.current],
          ["8-14 Days", totals.age8_14],
          ["15-30 Days", totals.age15_30],
          ["31-60 Days", totals.age31_60],
          ["61-90 Days", totals.age61_90],
          ["90+ Days", totals.age90Plus],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
            <div className="mt-1 text-lg font-extrabold text-slate-900">{money(value)}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1250px] text-sm">
            <thead>
              <tr className="bg-slate-100 text-left">
                <th className="p-3">Customer</th>
                <th className="p-3 text-right">Outstanding</th>
                <th className="p-3 text-right">Invoices</th>
                <th className="p-3 text-right">0-7</th>
                <th className="p-3 text-right">8-14</th>
                <th className="p-3 text-right">15-30</th>
                <th className="p-3 text-right">31-60</th>
                <th className="p-3 text-right">61-90</th>
                <th className="p-3 text-right">90+</th>
                <th className="p-3">Oldest</th>
                <th className="p-3 text-right">Age</th>
                <th className="p-3">Last Payment</th>
                <th className="p-3 text-right">Credit Limit</th>
                <th className="p-3 text-right">Available</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.customerId} className="border-t hover:bg-blue-50">
                  <td className="p-3">
                    <div className="font-bold text-slate-900">{row.customerName}</div>
                    <div className="text-xs text-slate-500">
                      {row.customerCode || row.error || ""}
                    </div>
                  </td>
                  <td className="p-3 text-right font-extrabold text-red-700">{money(row.totalOutstanding)}</td>
                  <td className="p-3 text-right">{row.outstandingInvoices}</td>
                  <td className="p-3 text-right">{money(row.current)}</td>
                  <td className="p-3 text-right">{money(row.age8_14)}</td>
                  <td className="p-3 text-right">{money(row.age15_30)}</td>
                  <td className="p-3 text-right">{money(row.age31_60)}</td>
                  <td className="p-3 text-right">{money(row.age61_90)}</td>
                  <td className="p-3 text-right font-bold text-red-700">{money(row.age90Plus)}</td>
                  <td className="p-3">{formatDate(row.oldestDate)}</td>
                  <td className="p-3 text-right font-bold">{row.oldestDays >= 999 ? "Opening" : `${row.oldestDays}d`}</td>
                  <td className="p-3">{formatDate(row.lastPayment)}</td>
                  <td className="p-3 text-right">{money(row.creditLimit)}</td>
                  <td className={`p-3 text-right font-bold ${row.availableCredit < 0 ? "text-red-700" : "text-green-700"}`}>{money(row.availableCredit)}</td>
                </tr>
              ))}
              {!visible.length && !loading && (
                <tr>
                  <td colSpan="14" className="p-8 text-center text-slate-500">
                    {customers.length
                      ? "No outstanding customer credit found."
                      : "Loading customer accounts…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-3 text-sm">
            <span>
              Showing {(activePage - 1) * PAGE_SIZE + 1}-
              {Math.min(activePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={activePage <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="rounded border px-3 py-1.5 font-bold disabled:opacity-40"
              >
                Previous
              </button>
              <span>Page {activePage} of {pageCount}</span>
              <button
                disabled={activePage >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                className="rounded border px-3 py-1.5 font-bold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
