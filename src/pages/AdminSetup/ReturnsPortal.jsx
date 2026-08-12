import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  confirmReturnCredit,
  loadReturnFinancialReconciliation,
  reverseReturnApproval,
} from "../../services/centralReturnEngine";
import {
  canApproveReturns as canCurrentLoginApproveReturns,
  canReconcileReturns as canCurrentLoginReconcileReturns,
  canReverseReturns as canCurrentLoginReverseReturns,
} from "../../security/returnAuthorization";

const getReference = (row) => row.return_number || row.reference_no || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || "-";
const getDate = (row) => row.created_at || row.return_date || row.date || "";
const isPendingReturn = (row) => row.status === "Pending Warehouse Confirmation";

export default function ReturnsPortal() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [approvingId, setApprovingId] = useState(null);
  const [success, setSuccess] = useState("");
  const [approvalModal, setApprovalModal] = useState(null);
  const [reversalModal, setReversalModal] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [reconciliationLoading, setReconciliationLoading] = useState(false);
  const approvalLocks = useRef(new Set());
  const currentUser = JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );
  const normalizedRole = String(currentUser?.role || currentUser?.access_level || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const isAdminUser = normalizedRole.includes("admin");
  const canApproveReturns = canCurrentLoginApproveReturns(currentUser);
  const canReverseReturns = canCurrentLoginReverseReturns(currentUser);
  const canReconcileReturns = canCurrentLoginReconcileReturns(currentUser);

  const loadReturns = useCallback(async () => {
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
  }, [isAdminUser]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) return loadReturns();
      return undefined;
    });
    return () => { active = false; };
  }, [loadReturns]);

  const approveReturn = async ({ row, note, financialDisposition }) => {
    if (!canApproveReturns) {
      setError("Only admin or warehouse users can approve return credits.");
      return;
    }

    const approvalKey = row.id || getReference(row);
    if (approvalLocks.current.has(approvalKey)) return;
    approvalLocks.current.add(approvalKey);
    setApprovingId(approvalKey);
    setError("");
    setSuccess("");

    try {
      await confirmReturnCredit({
        returnRequest: {
          ...row,
          approvalNote: note,
          financialDisposition,
        },
        currentUser,
      });
      setSuccess(
        `${getReference(row)} approved. The customer credit was posted and allocated to outstanding invoices.`
      );
      await loadReturns();
      setApprovalModal(null);
    } catch (err) {
      console.error("Return approval error:", err);
      setError(err.message || "Could not approve the return credit.");
    } finally {
      approvalLocks.current.delete(approvalKey);
      setApprovingId(null);
    }
  };

  const reverseReturn = async ({ row, reason }) => {
    const reversalKey = `reverse:${row.id}`;
    if (approvalLocks.current.has(reversalKey)) return;
    approvalLocks.current.add(reversalKey);
    setApprovingId(reversalKey);
    setError("");
    try {
      await reverseReturnApproval({ returnRequest: row, currentUser, reason });
      setSuccess(`${getReference(row)} approval reversed. Original financial history was preserved.`);
      await loadReturns();
      setReversalModal(null);
    } catch (err) {
      setError(err.message || "Could not reverse the return approval.");
    } finally {
      approvalLocks.current.delete(reversalKey);
      setApprovingId(null);
    }
  };

  const loadReconciliation = async () => {
    setReconciliationLoading(true);
    setError("");
    try {
      setReconciliation(await loadReturnFinancialReconciliation(currentUser));
    } catch (err) {
      setError(err.message || "Could not load return financial reconciliation.");
    } finally {
      setReconciliationLoading(false);
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

  const pendingCount = filteredReturns.filter(isPendingReturn).length;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Returns</h2>
            <p className="text-sm text-slate-500">Central return portal. Driver and sales return requests appear here before warehouse confirmation.</p>
          </div>
          <div className="flex gap-2">
            {canReconcileReturns && (
              <button type="button" onClick={loadReconciliation} className="border border-blue-700 text-blue-700 px-4 py-2 rounded-xl font-bold">
                {reconciliationLoading ? "Loading..." : "Reconcile"}
              </button>
            )}
            <button type="button" onClick={loadReturns} className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold">
              Refresh
            </button>
          </div>
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

      {Array.isArray(reconciliation) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Return Financial Reconciliation</h3>
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="sticky top-0 bg-slate-100"><tr><th className="p-2 text-left">Return No</th><th className="p-2 text-left">Customer</th><th className="p-2 text-left">Branch</th><th className="p-2 text-left">Type</th><th className="p-2 text-right">Qty</th><th className="p-2 text-right">Value</th><th className="p-2 text-left">Return Status</th><th className="p-2 text-right">Legacy Credit</th><th className="p-2 text-right">Global Ledger</th><th className="p-2 text-right">Reversal</th><th className="p-2 text-left">Reconciliation Status</th></tr></thead>
              <tbody>{reconciliation.map((row) => <tr key={row.id} className="border-t"><td className="p-2 font-bold">{row.return_number}</td><td className="p-2">{row.customer_name}</td><td className="p-2">{row.branch_name || "Main / unassigned"}</td><td className="p-2">{row.return_type}</td><td className="p-2 text-right">{Number(row.total_qty || 0)}</td><td className="p-2 text-right">{formatCurrency(row.return_total)}</td><td className="p-2">{row.status}</td><td className="p-2 text-right">{row.legacy_credit_count}</td><td className="p-2 text-right">{row.global_ledger_count}</td><td className="p-2 text-right">{row.reversal_count}</td><td className="p-2 font-bold">{row.reconciliation_status}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

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
                  <Fragment key={row.id || getReference(row)}>
                  <tr className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{formatDisplayOrderId(getReference(row))}</td>
                    <td className="p-3">{formatDisplayOrderId(row.order_number) || "-"}</td>
                    <td className="p-3">{getCustomer(row)}</td>
                    <td className="p-3">{row.return_type || "-"}</td>
                    <td className="p-3 text-right">{Number(row.total_qty || 0)}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(Number(row.return_total || 0))}</td>
                    <td className="p-3"><span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold">{row.status || "Pending"}</span></td>
                    <td className="p-3">{getDate(row) ? new Date(getDate(row)).toLocaleDateString() : "-"}</td>
                    <td className="p-3 text-right">
                      {isPendingReturn(row) ? (
                        <button
                          type="button"
                          onClick={() => setApprovalModal({ row, note: "", financialDisposition: "" })}
                          disabled={!canApproveReturns || approvingId === (row.id || getReference(row))}
                          title={
                            canApproveReturns
                              ? "Review and approve this return"
                              : "returns.approve permission is required"
                          }
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          {approvingId === (row.id || getReference(row))
                            ? "Approving..."
                            : "Approve"}
                        </button>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setViewingId((value) => value === row.id ? null : row.id)} className="rounded-lg border px-3 py-2 text-xs font-bold">View</button>
                          {row.status === "Confirmed" && canReverseReturns && (
                            <button type="button" onClick={() => setReversalModal({ row, reason: "" })} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">Reverse Approval</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {viewingId === row.id && (
                    <tr className="border-t bg-slate-50"><td colSpan="9" className="p-4"><div className="grid gap-2 md:grid-cols-4"><div><b>Financial Effect:</b> {row.financial_disposition === "CUSTOMER_CREDIT" ? `Customer Credit ${formatCurrency(row.return_total)}` : row.financial_disposition === "NO_CREDIT" ? "No Financial Credit" : "Not recorded"}</div><div><b>Stock Effect:</b> Pending / Not processed</div><div><b>Approved By:</b> {row.confirmed_by_name || "-"}</div><div><b>Approved Date:</b> {row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "-"}</div></div></td></tr>
                  )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {approvalModal && (
        <ReturnApprovalDialog
          state={approvalModal}
          busy={approvingId === (approvalModal.row.id || getReference(approvalModal.row))}
          onChange={setApprovalModal}
          onCancel={() => setApprovalModal(null)}
          onConfirm={() => approveReturn(approvalModal)}
        />
      )}
      {reversalModal && (
        <ReturnReversalDialog
          state={reversalModal}
          busy={approvingId === `reverse:${reversalModal.row.id}`}
          onChange={setReversalModal}
          onCancel={() => setReversalModal(null)}
          onConfirm={() => reverseReturn(reversalModal)}
        />
      )}
    </div>
  );
}

function DialogShell({ children }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">{children}</div></div>;
}

function ReturnApprovalDialog({ state, busy, onChange, onCancel, onConfirm }) {
  const { row } = state;
  return (
    <DialogShell>
      <h3 className="text-xl font-extrabold">Approve this return?</h3>
      <p className="mt-2 text-sm text-slate-600">This will create the selected customer financial effect and cannot be directly edited afterward.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><b>Return Number</b><span>{getReference(row)}</span><b>Customer</b><span>{getCustomer(row)}</span><b>Return Type</b><span>{row.return_type}</span><b>Quantity</b><span>{Number(row.total_qty || 0)}</span><b>Value</b><span>{formatCurrency(row.return_total)}</span><b>Stock Effect</b><span>Pending / Not processed</span></div>
      <label className="mt-4 block text-sm font-bold">Financial Effect</label>
      <select value={state.financialDisposition} onChange={(event) => onChange({ ...state, financialDisposition: event.target.value })} className="mt-1 w-full rounded-xl border p-3">
        <option value="">Select financial effect</option><option value="CUSTOMER_CREDIT">Customer Credit</option><option value="NO_CREDIT">No Financial Credit</option>
      </select>
      <label className="mt-3 block text-sm font-bold">Approval note</label>
      <textarea value={state.note} onChange={(event) => onChange({ ...state, note: event.target.value })} className="mt-1 w-full rounded-xl border p-3" rows="3" />
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button type="button" onClick={onConfirm} disabled={busy || !state.financialDisposition} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:bg-slate-300">{busy ? "Approving..." : "Confirm Approval"}</button></div>
    </DialogShell>
  );
}

function ReturnReversalDialog({ state, busy, onChange, onCancel, onConfirm }) {
  const { row } = state;
  return (
    <DialogShell>
      <h3 className="text-xl font-extrabold">Reverse this approved return?</h3>
      <p className="mt-2 text-sm text-slate-600">The original credit will remain in financial history and an opposite reversal transaction will be created.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><b>Return Number</b><span>{getReference(row)}</span><b>Customer</b><span>{getCustomer(row)}</span><b>Original Credit</b><span>{formatCurrency(row.return_total)}</span><b>Approved By</b><span>{row.confirmed_by_name || "-"}</span><b>Approved Date</b><span>{row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "-"}</span></div>
      <label className="mt-4 block text-sm font-bold">Reason for reversal (required)</label>
      <textarea value={state.reason} onChange={(event) => onChange({ ...state, reason: event.target.value })} className="mt-1 w-full rounded-xl border p-3" rows="3" />
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button type="button" onClick={onConfirm} disabled={busy || !state.reason.trim()} className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white disabled:bg-slate-300">{busy ? "Reversing..." : "Confirm Reversal"}</button></div>
    </DialogShell>
  );
}
