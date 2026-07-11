import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

const customerMatches = (customer, search) => {
  const text = [
    customer.account_name,
    customer.company_name,
    customer.customer_code,
    ...(customer.customer_branches || []).map((branch) => branch.branch_name),
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(String(search || "").toLowerCase());
};

function StatusBadge({ status }) {
  const normalized = String(status || "UNPAID").toUpperCase();
  const className =
    normalized === "PAID"
      ? "bg-green-100 text-green-700"
      : normalized === "PARTIALLY PAID"
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";

  return (
    <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${className}`}>
      {normalized}
    </span>
  );
}

export default function CustomerCredit({ readOnly = false }) {
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const currentUser = getLoggedInUser();
  const userRole = String(currentUser?.role || currentUser?.access_level || "").toLowerCase();
  const isReadOnlyRole =
    readOnly ||
    userRole.includes("sales") ||
    userRole.includes("cash") ||
    userRole.includes("driver");

  useEffect(() => {
    let active = true;
    loadCentralPaymentCustomers()
      .then((rows) => {
        if (!active) return;
        setCustomers(rows);
        if (rows.length) setSelectedCustomerId((value) => value || rows[0].id);
      })
      .catch((loadError) => setError(loadError.message || "Could not load customers."));
    return () => {
      active = false;
    };
  }, []);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatches(customer, customerSearch)),
    [customers, customerSearch]
  );
  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(selectedCustomerId)
  );
  const branches = (selectedCustomer?.customer_branches || []).filter(
    (branch) => branch.active !== false
  );

  useEffect(() => {
    if (!selectedCustomer) {
      return;
    }

    let active = true;
    loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId,
    })
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Could not load customer credit.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCustomer, selectedBranchId]);

  const summary = selectedBranchId
    ? snapshot?.branchSummary
    : snapshot?.customerSummary;
  const transactions = snapshot?.transactionHistory || [];
  const invoices = selectedBranchId ? snapshot?.selectedInvoices || [] : snapshot?.allocatedInvoices || [];
  const payments = selectedBranchId ? snapshot?.selectedPayments || [] : snapshot?.payments || [];

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">
              Customer Credit
            </h2>
            <p className="text-sm text-slate-500">
              Calculation-only credit view from invoices, payments, allocations and opening balances.
            </p>
          </div>
          {isReadOnlyRole && (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
              Read-only access
            </span>
          )}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.2fr_1fr]">
          <input
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Search customer"
            className="rounded-xl border p-3"
          />
          <select
            value={selectedCustomerId}
            onChange={(event) => {
              setSelectedCustomerId(event.target.value);
              setSelectedBranchId("");
            }}
            className="rounded-xl border p-3"
          >
            {filteredCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.account_name}
              </option>
            ))}
          </select>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="rounded-xl border p-3"
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{error}</div>}
      {loading && <div className="rounded-xl bg-slate-50 p-3 font-bold">Loading credit history...</div>}
      {snapshot?.legacyFallbackUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Temporary legacy compatibility is active for this account because matching new-table records were not found.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Customer outstanding", snapshot?.customerSummary?.outstanding],
          ["Branch outstanding", snapshot?.branchSummary?.outstanding],
          ["Opening balance", summary?.openingBalance],
          ["Invoice total", summary?.invoiceTotal],
          ["Payment total", summary?.paymentTotal],
          ["Available credit", summary?.availableCredit],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
            <div className="mt-1 text-xl font-extrabold text-slate-900">
              {formatCurrency(value || 0)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Invoices</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Date</th>
                  <th className="p-3">Invoice</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3 text-right">Total</th>
                  <th className="p-3 text-right">Paid</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id || invoice.invoice_number} className="border-b">
                    <td className="p-3">{new Date(invoice.invoice_date || invoice.created_at).toLocaleDateString("en-GB")}</td>
                    <td className="p-3 font-bold">{invoice.invoice_number || invoice.reference_no}</td>
                    <td className="p-3">{invoice.branch_name || "-"}</td>
                    <td className="p-3 text-right">{formatCurrency(invoice.invoiceAmount || invoice.invoice_total)}</td>
                    <td className="p-3 text-right">{formatCurrency(invoice.paidAmount || 0)}</td>
                    <td className="p-3"><StatusBadge status={invoice.paymentStatus} /></td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr><td colSpan="6" className="p-4 text-center text-slate-500">No invoices found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Payments</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Date</th>
                  <th className="p-3">Reference</th>
                  <th className="p-3">Method</th>
                  <th className="p-3">Collector</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id || payment.payment_reference} className="border-b">
                    <td className="p-3">{new Date(payment.payment_date || payment.created_at).toLocaleDateString("en-GB")}</td>
                    <td className="p-3 font-bold">{payment.payment_reference || payment.reference_no}</td>
                    <td className="p-3">{payment.payment_method || payment.payment_type || "-"}</td>
                    <td className="p-3">{payment.paid_by || payment.who_paid || "-"}</td>
                    <td className="p-3 text-right font-bold text-green-700">{formatCurrency(payment.amount || payment.credit)}</td>
                  </tr>
                ))}
                {!payments.length && (
                  <tr><td colSpan="5" className="p-4 text-center text-slate-500">No payments found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-lg font-extrabold">Transaction History</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Date</th>
                <th className="p-3">Type</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Branch</th>
                <th className="p-3">Payment method</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Running balance</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((row) => (
                <tr key={`${row.id}-${row.runningBalance}`} className="border-b">
                  <td className="p-3">{new Date(row.date).toLocaleString("en-GB")}</td>
                  <td className="p-3 font-bold">{row.type}</td>
                  <td className="p-3">{row.reference}</td>
                  <td className="p-3">{row.branchName || "-"}</td>
                  <td className="p-3">{row.paymentMethod || "-"}</td>
                  <td className={`p-3 text-right font-bold ${row.amount < 0 ? "text-green-700" : "text-red-700"}`}>
                    {formatCurrency(row.amount)}
                  </td>
                  <td className="p-3 text-right font-bold">{formatCurrency(row.runningBalance)}</td>
                  <td className="p-3">{row.type === "INVOICE" ? <StatusBadge status={row.status} /> : row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
