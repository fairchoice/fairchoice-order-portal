import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  approvePayout,
  createPayout,
  loadExpenseTypes,
  loadPayouts,
  loadSuppliers,
  PAYMENT_TYPES,
  PAYOUT_STATUSES,
  rejectPayout,
  submitPayout,
  updatePayout,
  voidPayout,
} from "../../services/expenses";
import { supplierOptionsForSelection } from "../../services/suppliers";

const field =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  payoutDate: today(),
  expenseTypeId: "",
  supplierId: "",
  amount: "",
  paymentMethod: "Cash",
  description: "",
  receiptReference: "",
  receiptUrl: "",
  paidByType: "BUSINESS",
  paidByStaffId: "",
});

function currentUser() {
  try {
    return (
      JSON.parse(
        localStorage.getItem("loggedInUser") ||
          localStorage.getItem("fairchoice_user") ||
          "null",
      ) || {}
    );
  } catch {
    return {};
  }
}

function hasPermission(user, permission) {
  const permissions = user.effective_permissions || user.permissions || {};
  return permissions.all_access === true || permissions[permission] === true;
}

export default function Expenses() {
  const [user] = useState(currentUser);
  const [expenseTypes, setExpenseTypes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("All");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [types, supplierRows, payoutRows] = await Promise.all([
        loadExpenseTypes(user),
        loadSuppliers(),
        loadPayouts(user),
      ]);
      setExpenseTypes(types);
      setSuppliers(supplierRows);
      setPayouts(payoutRows);
      setForm((existing) => ({
        ...existing,
        expenseTypeId: existing.expenseTypeId || types[0]?.id || "",
      }));
    } catch (refreshError) {
      setError(refreshError.message || "Could not load expenses.");
    }
  }, [user]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refresh]);

  const visiblePayouts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return payouts.filter((row) => {
      if (status !== "All" && row.status !== status) return false;
      return `${row.payout_reference} ${row.expense_type_name} ${row.supplier_name || ""} ${row.description || ""}`
        .toLowerCase()
        .includes(term);
    });
  }, [payouts, search, status]);

  const supplierOptions = useMemo(() => {
    const currentPayout = payouts.find((row) => row.id === editingId);
    const currentSupplier = form.supplierId
      ? {
          id: form.supplierId,
          supplier_name: currentPayout?.supplier_name || "Inactive supplier",
        }
      : null;
    return supplierOptionsForSelection(suppliers, currentSupplier);
  }, [editingId, form.supplierId, payouts, suppliers]);

  function resetForm() {
    setEditingId(null);
    setForm({
      ...emptyForm(),
      expenseTypeId: expenseTypes[0]?.id || "",
    });
  }

  async function saveExpense(event, submit) {
    event.preventDefault();
    if (busy) return;
    const action = submit ? "submit this expense for approval" : "save this expense";
    if (!window.confirm(`Are you sure you want to ${action}?`)) return;

    setBusy(true);
    try {
      if (editingId) {
        await updatePayout(editingId, form, user);
        if (submit) await submitPayout(editingId, user);
      } else {
        await createPayout({ ...form, submit }, user);
      }
      resetForm();
      await refresh();
      window.alert(submit ? "Expense submitted for approval." : "Expense saved as a draft.");
    } catch (saveError) {
      window.alert(saveError.message || "Could not save the expense.");
    } finally {
      setBusy(false);
    }
  }

  function editExpense(row) {
    setEditingId(row.id);
    setForm({
      payoutDate: row.payout_date,
      expenseTypeId: row.expense_type_id,
      supplierId: row.supplier_id || "",
      amount: String(row.amount),
      paymentMethod: row.payment_method,
      description: row.description || "",
      receiptReference: row.receipt_reference || "",
      receiptUrl: row.receipt_url || "",
      paidByType: row.paid_by_type || "BUSINESS",
      paidByStaffId: row.paid_by_staff_id || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function runTransition(label, operation, reasonRequired = false) {
    const reason = reasonRequired ? window.prompt(`${label} reason:`) : undefined;
    if (reasonRequired && !String(reason || "").trim()) return;
    if (!window.confirm(`Are you sure you want to ${label.toLowerCase()} this expense?`)) {
      return;
    }
    setBusy(true);
    try {
      await operation(reason);
      await refresh();
      window.alert(`Expense ${label.toLowerCase()} completed.`);
    } catch (transitionError) {
      window.alert(transitionError.message || `Could not ${label.toLowerCase()} the expense.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <header>
          <h2 className="text-2xl font-extrabold text-slate-950">Expenses</h2>
          <p className="text-sm text-slate-600">
            Record business expenses, submit them for approval, and post approved
            money-out entries to the Global Ledger.
          </p>
        </header>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800">
            {error}
          </div>
        )}

        <form className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold">
              {editingId ? "Edit draft expense" : "Record expense"}
            </h3>
            {editingId && (
              <button type="button" className="text-sm font-semibold text-blue-700" onClick={resetForm}>
                Cancel edit
              </button>
            )}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Input label="Payout date" type="date" value={form.payoutDate} onChange={(value) => setForm({ ...form, payoutDate: value })} />
            <Select label="Expense type" value={form.expenseTypeId} onChange={(value) => setForm({ ...form, expenseTypeId: value })}>
              {expenseTypes.map((type) => <option key={type.id} value={type.id}>{type.expense_type_name}</option>)}
            </Select>
            <Select label="Supplier (optional)" value={form.supplierId} required={false} onChange={(value) => setForm({ ...form, supplierId: value })}>
              <option value="">Not applicable</option>
              {supplierOptions.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.supplier_name}{supplier.active === false ? " (inactive)" : ""}</option>)}
            </Select>
            <Input label="Amount" type="number" step="0.01" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
            <Select label="Payment method" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value })}>
              {PAYMENT_TYPES.map((method) => <option key={method}>{method}</option>)}
            </Select>
            <Input label="Paid by type" value={form.paidByType} onChange={(value) => setForm({ ...form, paidByType: value })} />
            <Input label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
            <Input label="Receipt reference" required={false} value={form.receiptReference} onChange={(value) => setForm({ ...form, receiptReference: value })} />
            <Input label="Receipt URL" type="url" required={false} value={form.receiptUrl} onChange={(value) => setForm({ ...form, receiptUrl: value })} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={busy} onClick={(event) => saveExpense(event, false)} className="rounded-lg border border-blue-700 bg-white px-5 py-2 font-bold text-blue-700 disabled:opacity-50">
              {editingId ? "Update draft" : "Save draft"}
            </button>
            <button disabled={busy} onClick={(event) => saveExpense(event, true)} className="rounded-lg bg-blue-700 px-5 py-2 font-bold text-white disabled:opacity-50">
              {editingId ? "Update and submit" : "Save and submit"}
            </button>
          </div>
        </form>

        <div className="flex flex-col gap-2 rounded-xl border bg-white p-3 md:flex-row">
          <input className={field} placeholder="Search expenses..." value={search} onChange={(event) => setSearch(event.target.value)} />
          <select className={field} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All</option>
            {PAYOUT_STATUSES.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>

        <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  {["Date", "Reference", "Type", "Supplier", "Amount", "Method", "Status", "Recorded by", "Actions"].map((heading) => (
                    <th key={heading} className="p-3">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visiblePayouts.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <Cell>{row.payout_date}</Cell>
                    <Cell>{row.payout_reference}</Cell>
                    <Cell>{row.expense_type_name}</Cell>
                    <Cell>{row.supplier_name || "—"}</Cell>
                    <Cell>{formatCurrency(row.amount)}</Cell>
                    <Cell>{row.payment_method}</Cell>
                    <Cell><StatusBadge status={row.status} /></Cell>
                    <Cell>{row.recorded_by_staff_name}</Cell>
                    <Cell>
                      <div className="flex min-w-48 flex-wrap gap-2">
                        {["DRAFT", "REJECTED"].includes(row.status) && (
                          <button disabled={busy} className="text-blue-700 underline" onClick={() => editExpense(row)}>Edit</button>
                        )}
                        {row.status === "DRAFT" && (
                          <button disabled={busy} className="text-blue-700 underline" onClick={() => runTransition("Submit", () => submitPayout(row.id, user))}>Submit</button>
                        )}
                        {row.status === "SUBMITTED" && hasPermission(user, "expenses.approve") && (
                          <>
                            <button disabled={busy} className="text-green-700 underline" onClick={() => runTransition("Approve", () => approvePayout(row.id, user))}>Approve</button>
                            <button disabled={busy} className="text-amber-700 underline" onClick={() => runTransition("Reject", (reason) => rejectPayout(row.id, reason, user), true)}>Reject</button>
                          </>
                        )}
                        {row.status !== "VOIDED" && hasPermission(user, "expenses.void") && (
                          <button disabled={busy} className="text-red-700 underline" onClick={() => runTransition("Void", (reason) => voidPayout(row.id, reason, user), true)}>Void</button>
                        )}
                      </div>
                    </Cell>
                  </tr>
                ))}
                {!visiblePayouts.length && (
                  <tr><td colSpan="9" className="p-8 text-center text-slate-500">No expenses found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Input({ label, type = "text", value, onChange, required = true, step }) {
  return (
    <label className="text-xs font-bold text-slate-700">
      {label}
      <input className={field} type={type} step={step} required={required} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({ label, value, onChange, children, required = true }) {
  return (
    <label className="text-xs font-bold text-slate-700">
      {label}
      <select className={field} required={required} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function Cell({ children }) {
  return <td className="p-3">{children || "—"}</td>;
}

function StatusBadge({ status }) {
  const styles = {
    DRAFT: "bg-slate-100 text-slate-800",
    SUBMITTED: "bg-blue-100 text-blue-800",
    POSTED: "bg-green-100 text-green-800",
    REJECTED: "bg-amber-100 text-amber-900",
    VOIDED: "bg-red-100 text-red-800",
  };
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ${styles[status] || styles.DRAFT}`}>{status}</span>;
}
