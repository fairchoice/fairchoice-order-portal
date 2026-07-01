import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";

const getCreatedDate = (row) => row.created_at || row.invoice_date || row.date || "";
const getReference = (row) => row.reference_no || row.order_number || row.invoice_number || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || row.account_name || "-";
const getAmount = (row) => Number(row.invoice_amount ?? row.amount ?? row.debit ?? 0);

export default function InvoicesPortal() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadInvoices = async () => {
    setLoading(true);
    setError("");

    try {
      let { data, error: ledgerError } = await supabase
        .from("customer_ledger")
        .select("*")
        .eq("entry_type", "INVOICE")
        .order("created_at", { ascending: false });

      if (ledgerError) {
        const retry = await supabase
          .from("customer_ledger")
          .select("*")
          .ilike("entry_type", "%invoice%")
          .order("created_at", { ascending: false });
        data = retry.data;
        ledgerError = retry.error;
      }

      if (ledgerError) throw ledgerError;
      setInvoices(data || []);
    } catch (err) {
      console.error("Invoice portal loading error:", err);
      setError(err.message || "Could not load invoices.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, []);

  const filteredInvoices = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return invoices;

    return invoices.filter((row) =>
      [getReference(row), getCustomer(row), row.invoice_status, row.status]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [invoices, search]);

  const totalOutstanding = filteredInvoices.reduce(
    (sum, row) => sum + Math.max(0, Number(row.debit || getAmount(row)) - Number(row.credit || 0)),
    0
  );

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Invoices</h2>
            <p className="text-sm text-slate-500">Central invoice list created from delivered orders.</p>
          </div>
          <button type="button" onClick={loadInvoices} className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold">
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Invoices</div>
            <div className="text-2xl font-extrabold">{filteredInvoices.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Total</div>
            <div className="text-2xl font-extrabold">{formatCurrency(filteredInvoices.reduce((sum, row) => sum + getAmount(row), 0))}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Outstanding</div>
            <div className="text-2xl font-extrabold">{formatCurrency(totalOutstanding)}</div>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice, order, customer, status"
          className="mt-5 w-full border border-slate-300 rounded-xl p-3"
        />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left p-3">Invoice / Order</th>
                <th className="text-left p-3">Customer</th>
                <th className="text-left p-3">Date</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="5">Loading invoices...</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="5">No invoices found yet. Confirm a delivery to create an invoice.</td></tr>
              ) : (
                filteredInvoices.map((row) => (
                  <tr key={row.id || getReference(row)} className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{getReference(row)}</td>
                    <td className="p-3">{getCustomer(row)}</td>
                    <td className="p-3">{getCreatedDate(row) ? new Date(getCreatedDate(row)).toLocaleDateString() : "-"}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(getAmount(row))}</td>
                    <td className="p-3"><span className="rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-bold">{row.invoice_status || row.status || "UNPAID"}</span></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
