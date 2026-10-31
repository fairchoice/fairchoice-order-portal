import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  confirmReturnCredit,
  loadReturnFinancialReconciliation,
  reverseReturnApproval,
  linkReturnCustomer,
} from "../../services/centralReturnEngine";
import {
  canApproveReturns as canCurrentLoginApproveReturns,
  canReconcileReturns as canCurrentLoginReconcileReturns,
  canReverseReturns as canCurrentLoginReverseReturns,
} from "../../security/returnAuthorization";

import { returnDisplayStatus } from "../../services/returnHeaderPersistence.js";

const getReference = (row) => row.return_number || row.reference_no || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || "-";
const getDate = (row) => row.created_at || row.return_date || row.date || "";
const isReversedReturn = (row) => Boolean(row.reversed_at) ||
  String(row.status || "").trim().toLowerCase() === "reversed";
const isPendingReturn = (row) => !isReversedReturn(row) && row.status === "Pending Warehouse Confirmation";

export default function ReturnsPortal() {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [returnScope, setReturnScope] = useState("pending");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [approvingId, setApprovingId] = useState(null);
  const [success, setSuccess] = useState("");
  const [approvalModal, setApprovalModal] = useState(null);
  const [reversalModal, setReversalModal] = useState(null);
  const [viewingId, setViewingId] = useState(null);
  const [linkModal, setLinkModal] = useState(null);
  const [linkCustomers, setLinkCustomers] = useState([]);
  const openCustomerLink = async (row) => {
    setError("");
    setLinkModal({ row, customerId: "", branchId: "", reason: "" });
    try {
      const { data, error: loadError } = await supabase.from("customer_accounts")
        .select("id, account_name, customer_branches(id, branch_name, active)").order("account_name");
      if (loadError) throw loadError;
      setLinkCustomers(data || []);
    } catch (err) { setError(err.message || "Could not load customer accounts."); }
  };
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
        .select("*, customer_return_items(*)")
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
      setSuccess(financialDisposition === "CUSTOMER_CREDIT"
        ? `${getReference(row)} approved. Customer credit is available in Wallet and the return credit note is available in Invoices.`
        : `${getReference(row)} approved without financial credit.`);
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

  const saveCustomerLink = async () => {
    if (!linkModal || !canReconcileReturns) return;
    const key = `link:${linkModal.row.id}`;
    if (approvalLocks.current.has(key)) return;
    approvalLocks.current.add(key);
    setApprovingId(key);
    setError("");
    try {
      await linkReturnCustomer({ returnRequest: linkModal.row, currentUser,
        customerAccountId: linkModal.customerId, customerBranchId: linkModal.branchId,
        reason: linkModal.reason });
      await loadReturns();
      setLinkModal(null);
      setSuccess("Return linked to the selected customer. Any active confirmed credit was added to Wallet once.");
    } catch (err) { setError(err.message || "Could not link this return."); }
    finally { approvalLocks.current.delete(key); setApprovingId(null); }
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
    return returns.filter((row) => {
      const reversed = isReversedReturn(row);
      if (returnScope === "pending" && !isPendingReturn(row)) return false;
      if (returnScope === "approved" && (reversed || !["confirmed", "approved", "credited"].includes(String(row.status || "").trim().toLowerCase()))) return false;
      if (returnScope === "reversed" && !reversed) return false;
      if (dateFrom || dateTo) {
        const date = new Date(getDate(row));
        if (Number.isNaN(date.getTime())) return false;
        // Match the local calendar date displayed in the table, including both endpoints.
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        if (dateFrom && day < dateFrom) return false;
        if (dateTo && day > dateTo) return false;
      }
      return !value || [getReference(row), row.order_number, getCustomer(row), row.return_type, returnDisplayStatus(row)]
        .join(" ")
        .toLowerCase()
        .includes(value);
    });
  }, [returns, search, returnScope, dateFrom, dateTo]);

  const pendingCount = filteredReturns.filter(isPendingReturn).length;

  return (
    <div className="space-y-5 pb-24">
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

        <div className="mt-5 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search returns"
            placeholder="Search return, order, customer, type, status"
            className="w-full flex-1 border border-slate-300 rounded-xl p-3"
          />
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            Show returns
            <select
              value={returnScope}
              onChange={(e) => setReturnScope(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white p-3 font-normal"
            >
              <option value="pending">Waiting for approval</option>
              <option value="approved">Approved returns</option>
              <option value="reversed">Reversed returns</option>
              <option value="all">All returns</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            From date
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white p-3 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
            To date
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white p-3 font-normal" />
          </label>
          <button type="button" onClick={() => { setSearch(""); setReturnScope("pending"); setDateFrom(""); setDateTo(""); }}
            className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold">Clear filters</button>
        </div>
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
                <tr><td className="p-5 text-center text-slate-500" colSpan="9">No returns match the selected filters.</td></tr>
              ) : (
                filteredReturns.map((row) => (
                  <Fragment key={row.id || getReference(row)}>
                  <tr className="border-t border-slate-100">
                    <td className="p-3 font-bold text-slate-900">{formatDisplayOrderId(getReference(row))}</td>
                    <td className="p-3">{formatDisplayOrderId(row.order_number) || "-"}</td>
                    <td className="p-3">{getCustomer(row)}{!row.customer_account_id && <div className="text-xs font-bold text-red-700">Customer account not linked</div>}</td>
                    <td className="p-3">{row.return_type || "-"}</td>
                    <td className="p-3 text-right">{Number(row.total_qty || 0)}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(Number(row.return_total || 0))}</td>
                    <td className="p-3"><span className="rounded-full bg-amber-50 text-amber-700 px-3 py-1 text-xs font-bold">{returnDisplayStatus(row)}</span></td>
                    <td className="p-3">{getDate(row) ? new Date(getDate(row)).toLocaleDateString() : "-"}</td>
                    <td className="p-3 text-right">
                      {!row.customer_account_id && canReconcileReturns && <button type="button" onClick={() => openCustomerLink(row)} className="mb-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Link customer</button>}
                      {isPendingReturn(row) ? (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setViewingId((value) => value === row.id ? null : row.id)}
                            className="rounded-lg border px-3 py-2 text-xs font-bold"
                          >
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => { setError(""); setApprovalModal({ row, note: "", financialDisposition: "" }); }}
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
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setViewingId((value) => value === row.id ? null : row.id)} className="rounded-lg border px-3 py-2 text-xs font-bold">View</button>
                          {row.status === "Confirmed" && !row.reversed_at && canReverseReturns && (
                            <button type="button" onClick={() => { setError(""); setReversalModal({ row, reason: "" }); }} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white">Reverse Approval</button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {viewingId === row.id && (
                    <tr className="border-t bg-slate-50">
                      <td colSpan="9" className="p-4">
                        <div className="max-h-[70vh] overflow-y-auto overscroll-contain pr-1">
                          <ReturnProductDetails row={row} />
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {linkModal && (
        <DialogShell>
          <h3 className="text-xl font-extrabold">Link return to customer</h3>
          <p className="mt-2 text-sm">{getReference(linkModal.row)} · {getCustomer(linkModal.row)} · {formatCurrency(linkModal.row.return_total)}</p>
          <p className="mt-2 text-sm text-slate-600">Choose the customer this return belongs to. For an active confirmed credit, this also posts its missing Wallet credit once. Original approval history is retained.</p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
          <label className="mt-4 block font-bold">Customer account</label>
          <select className="mt-1 w-full rounded-xl border p-3" value={linkModal.customerId} onChange={event => setLinkModal({ ...linkModal, customerId: event.target.value, branchId: "" })}>
            <option value="">Select customer</option>{linkCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.account_name}</option>)}
          </select>
          <label className="mt-3 block font-bold">Branch</label>
          <select className="mt-1 w-full rounded-xl border p-3" value={linkModal.branchId} onChange={event => setLinkModal({ ...linkModal, branchId: event.target.value })}>
            <option value="">Main customer account / no branch</option>{(linkCustomers.find(customer => customer.id === linkModal.customerId)?.customer_branches || []).filter(branch => branch.active !== false).map(branch => <option key={branch.id} value={branch.id}>{branch.branch_name}</option>)}
          </select>
          <label className="mt-3 block font-bold">Reason</label>
          <textarea className="mt-1 w-full rounded-xl border p-3" value={linkModal.reason} onChange={event => setLinkModal({ ...linkModal, reason: event.target.value })} />
          <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={Boolean(approvingId)} onClick={() => setLinkModal(null)} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button type="button" disabled={Boolean(approvingId) || !linkModal.customerId || !linkModal.reason.trim()} onClick={saveCustomerLink} className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white disabled:opacity-50">{approvingId ? "Linking..." : "Confirm customer link"}</button></div>
        </DialogShell>
      )}

      {approvalModal && (
        <ReturnApprovalDialog
          state={approvalModal}
          busy={approvingId === (approvalModal.row.id || getReference(approvalModal.row))}
          onChange={setApprovalModal}
          onCancel={() => setApprovalModal(null)}
          error={error}
          onConfirm={() => approveReturn(approvalModal)}
        />
      )}
      {reversalModal && (
        <ReturnReversalDialog
          state={reversalModal}
          busy={approvingId === `reverse:${reversalModal.row.id}`}
          onChange={setReversalModal}
          onCancel={() => setReversalModal(null)}
          error={error}
          onConfirm={() => reverseReturn(reversalModal)}
        />
      )}
    </div>
  );
}

function ReturnProductDetails({ row }) {
  const items = row.customer_return_items || row.items || [];
  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-5 text-sm">
        <div><b>Price Mode:</b> {row.price_mode || "-"}</div>
        <div><b>Financial Effect:</b> {row.financial_disposition === "CUSTOMER_CREDIT" ? `Customer Credit ${formatCurrency(row.return_total)}` : row.financial_disposition === "NO_CREDIT" ? "No Financial Credit" : "Pending approval"}</div>
        <div><b>Stock Effect:</b> Pending / Not processed</div>
        <div><b>Approved By:</b> {row.confirmed_by_name || "-"}</div>
        <div><b>Approved Date:</b> {row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "-"}</div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="p-2 text-left">Product Code</th>
              <th className="p-2 text-left">Product</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2 text-right">Unit Price</th>
              <th className="p-2 text-right">Line Total</th>
              <th className="p-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? items.map((item) => (
              <tr key={item.id || `${item.product_id}-${item.product_code}`} className="border-t">
                <td className="p-2">{item.product_code || "-"}</td>
                <td className="p-2 font-semibold">{item.product_name || "-"}</td>
                <td className="p-2 text-right">{Number(item.qty || item.quantity || 0)}</td>
                <td className="p-2 text-right">{formatCurrency(Number(item.unit_price || item.price || 0))}</td>
                <td className="p-2 text-right font-bold">{formatCurrency(Number(item.gross_total ?? item.net_total ?? item.line_total ?? 0))}</td>
                <td className="p-2">{item.reason || row.return_type || "-"}</td>
              </tr>
            )) : (
              <tr><td colSpan="6" className="p-3 text-center text-slate-500">No return product lines found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DialogShell({ children }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-4 sm:p-6">
      <div className="flex min-h-full items-start justify-center py-2 sm:items-center">
        <div className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-2xl bg-white p-5 shadow-2xl sm:max-h-[calc(100vh-3rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}

function ReturnApprovalDialog({ state, busy, error, onChange, onCancel, onConfirm }) {
  const { row } = state;
  return (
    <DialogShell>
      <h3 className="text-xl font-extrabold">Approve this return?</h3>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <p className="mt-2 text-sm text-slate-600">This will create the selected customer financial effect and cannot be directly edited afterward.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><b>Return Number</b><span>{getReference(row)}</span><b>Customer</b><span>{getCustomer(row)}</span><b>Return Type</b><span>{row.return_type}</span><b>Price Mode</b><span>{row.price_mode || "-"}</span><b>Quantity</b><span>{Number(row.total_qty || 0)}</span><b>Value</b><span>{formatCurrency(row.return_total)}</span><b>Stock Effect</b><span>Pending / Not processed</span></div>
      <div className="mt-4"><ReturnProductDetails row={row} /></div>
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

function ReturnReversalDialog({ state, busy, error, onChange, onCancel, onConfirm }) {
  const { row } = state;
  return (
    <DialogShell>
      <h3 className="text-xl font-extrabold">Reverse this approved return?</h3>
      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      <p className="mt-2 text-sm text-slate-600">The original credit will remain in financial history and an opposite reversal transaction will be created.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm"><b>Return Number</b><span>{getReference(row)}</span><b>Customer</b><span>{getCustomer(row)}</span><b>Original Credit</b><span>{formatCurrency(row.return_total)}</span><b>Approved By</b><span>{row.confirmed_by_name || "-"}</span><b>Approved Date</b><span>{row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "-"}</span></div>
      <label className="mt-4 block text-sm font-bold">Reason for reversal (required)</label>
      <textarea value={state.reason} onChange={(event) => onChange({ ...state, reason: event.target.value })} className="mt-1 w-full rounded-xl border p-3" rows="3" />
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button type="button" onClick={onConfirm} disabled={busy || !state.reason.trim()} className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white disabled:bg-slate-300">{busy ? "Reversing..." : "Confirm Reversal"}</button></div>
    </DialogShell>
  );
}
