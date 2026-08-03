import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import { confirmReturnCredit } from "../../services/centralReturnEngine";

const getReference = (row) => row.return_number || row.reference_no || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || "-";
const getDate = (row) => row.created_at || row.return_date || row.date || "";

export default function ReturnsPortal() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [approvingId, setApprovingId] = useState(null);
  const [success, setSuccess] = useState("");
  const currentUser = JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );
  const role = String(currentUser?.role || currentUser?.access_level || "").toLowerCase();
  const normalizedRole = role.replace(/[^a-z0-9]/g, "");
  const permissions = currentUser?.effective_permissions || currentUser?.permissions || {};
  const isAdminUser = normalizedRole.includes("admin");
  const isWarehouseUser =
    normalizedRole === "warehouse" || permissions.access_warehouse === true;
  const canApproveReturns = isAdminUser || isWarehouseUser;

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
      const message = String(err.message || "").toLowerCase();
      setError(
        message.includes("customer_returns") || message.includes("schema cache")
          ? isAdminUser
            ? "Return invoice setup is required. Run supabase/migrations/20260704_financial_documents_setup.sql in Supabase, then refresh this page."
            : "Returns are not available yet. Please contact an admin."
          : err.message || "Could not load returns."
      );
      setReturns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReturns();
  }, []);

  const approveReturn = async (row) => {
    if (!canApproveReturns) {
      setError("Only admin or warehouse users can approve return credits.");
      return;
    }

    const approvalKey = row.id || getReference(row);
    setApprovingId(approvalKey);
    setError("");
    setSuccess("");

    try {
      await confirmReturnCredit({ returnRequest: row, currentUser });
      setSuccess(
        `${getReference(row)} approved. The customer credit was posted and allocated to outstanding invoices.`
      );
      await loadReturns();
    } catch (err) {
      console.error("Return approval error:", err);
      setError(err.message || "Could not approve the return credit.");
    } finally {
      setApprovingId(null);
    }
  };

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
      {success && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4">{success}</div>}

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
                <th className="text-right p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="9">Loading returns...</td></tr>
              ) : filteredReturns.length === 0 ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="9">No returns found yet.</td></tr>
              ) : (
                filteredReturns.map((row) => (
                  <tr key={row.id || getReference(row)} className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{formatDisplayOrderId(getReference(row))}</td>
                    <td className="p-3">{formatDisplayOrderId(row.order_number) || "-"}</td>
                    <td className="p-3">{getCustomer(row)}</td>
                    <td className="p-3">{row.return_type || "-"}</td>
                    <td className="p-3 text-right">{Number(row.total_qty || 0)}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(Number(row.return_total || 0))}</td>
                    <td className="p-3"><span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold">{row.status || "Pending"}</span></td>
                    <td className="p-3">{getDate(row) ? new Date(getDate(row)).toLocaleDateString() : "-"}</td>
                    <td className="p-3 text-right">
                      {String(row.status || "").toLowerCase().includes("pending") ? (
                        <button
                          type="button"
                          onClick={() => approveReturn(row)}
                          disabled={!canApproveReturns || approvingId === (row.id || getReference(row))}
                          title={
                            canApproveReturns
                              ? "Approve and post this return as customer credit"
                              : "Admin or warehouse permission is required"
                          }
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {approvingId === (row.id || getReference(row))
                            ? "Approving..."
                            : "Approve Credit"}
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-700">Approved</span>
                      )}
                    </td>
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
