import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";

const getReference = (row) => row.return_number || row.reference_no || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || "-";
const getDate = (row) => row.created_at || row.return_date || row.date || "";

export default function ReturnsPortal() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadReturns = async () => {
    setLoading(true);
    setError("");

    try {
      const { data, error: returnError } = await supabase
        .from("customer_returns")
        .select("*")
        .order("created_at", { ascending: false });

      if (returnError) throw returnError;
      setReturns(data || []);
    } catch (err) {
      console.error("Returns portal loading error:", err);
      setError(
        `${err.message || "Could not load returns."} Run the returns SQL file in Supabase if the return tables are not created yet.`
      );
      setReturns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReturns();
  }, []);

  const filteredReturns = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return returns;

    return returns.filter((row) =>
      [getReference(row), row.order_number, getCustomer(row), row.return_type, row.status]
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [returns, search]);

  const pendingCount = filteredReturns.filter((row) => String(row.status || "").toLowerCase().includes("pending")).length;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Returns</h2>
            <p className="text-sm text-slate-500">Central return portal. Driver and sales return requests appear here before warehouse confirmation.</p>
          </div>
          <button type="button" onClick={loadReturns} className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold">
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Returns</div>
            <div className="text-2xl font-extrabold">{filteredReturns.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Pending Warehouse</div>
            <div className="text-2xl font-extrabold">{pendingCount}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Return Value</div>
            <div className="text-2xl font-extrabold">{formatCurrency(filteredReturns.reduce((sum, row) => sum + Number(row.return_total || 0), 0))}</div>
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search return, order, customer, type, status"
          className="mt-5 w-full border border-slate-300 rounded-xl p-3"
        />
      </div>

      {error && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4">{error}</div>}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left p-3">Return No</th>
                <th className="text-left p-3">Order</th>
                <th className="text-left p-3">Customer</th>
                <th className="text-left p-3">Type</th>
                <th className="text-right p-3">Qty</th>
                <th className="text-right p-3">Value</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="8">Loading returns...</td></tr>
              ) : filteredReturns.length === 0 ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="8">No returns found yet.</td></tr>
              ) : (
                filteredReturns.map((row) => (
                  <tr key={row.id || getReference(row)} className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{getReference(row)}</td>
                    <td className="p-3">{row.order_number || "-"}</td>
                    <td className="p-3">{getCustomer(row)}</td>
                    <td className="p-3">{row.return_type || "-"}</td>
                    <td className="p-3 text-right">{Number(row.total_qty || 0)}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(Number(row.return_total || 0))}</td>
                    <td className="p-3"><span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold">{row.status || "Pending"}</span></td>
                    <td className="p-3">{getDate(row) ? new Date(getDate(row)).toLocaleDateString() : "-"}</td>
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
