import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  buildPaymentPreview,
  confirmOwnerBankTransfer,
  createCentralPayment,
  editCentralPayment,
  listCentralPaymentRecords,
  loadCentralPaymentCustomers,
  loadCentralPaymentSnapshot,
  permanentlyDeleteCentralPayment,
  removeCentralPayment,
  restoreCentralPayment,
} from "../../services/centralPaymentService";
import { OWNER_USERNAME, isOwnerUser } from "../../services/ownerFinancialSecurity";

const paymentMethods = ["Cash", "Card", "Bank Transfer", "Cheque", "Other"];

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

const matchesCustomer = (customer, search) =>
  [
    customer.account_name,
    customer.company_name,
    customer.customer_code,
    ...(customer.customer_branches || []).map((branch) => branch.branch_name),
  ]
    .join(" ")
    .toLowerCase()
    .includes(String(search || "").toLowerCase());

function Summary({ label, value, neutral = false }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-extrabold ${
          neutral ? "text-slate-900" : "text-red-700"
        }`}
      >
        {formatCurrency(value || 0)}
      </div>
    </div>
  );
}

function PaymentRecordsPanel({ archived, currentUser, ownerPassword, customer, branchId, onChanged, onConfirmBank }) {
  const [filters, setFilters] = useState({ search: "", method: "", dateFrom: "", dateTo: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ records: [], total: 0, total_pages: 1 });
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    if (!customer?.id || !ownerPassword) {
      setResult({ records: [], total: 0, total_pages: 1 });
      return;
    }
    try {
      setMessage("");
      setResult(await listCentralPaymentRecords({
        currentUser,
        ownerPassword,
        customerAccountId: customer.id,
        customerBranchId: branchId || null,
        archived,
        ...filters,
        page,
      }));
    } catch (loadError) {
      setMessage(loadError.message || "Could not load payment records.");
    }
  };

  useEffect(() => {
    let active = true;
    if (!customer?.id || !ownerPassword) return undefined;
    listCentralPaymentRecords({
      currentUser,
      ownerPassword,
      customerAccountId: customer.id,
      customerBranchId: branchId || null,
      archived,
      ...filters,
      page,
    }).then((data) => {
      if (active) setResult(data);
    }).catch((loadError) => {
      if (active) setMessage(loadError.message || "Could not load payment records.");
    });
    return () => { active = false; };
  }, [archived, branchId, currentUser, customer?.id, filters, ownerPassword, page]);

  const updateFilter = (field, value) => {
    setFilters((current) => ({ ...current, [field]: value }));
    setPage(1);
  };

  const runAction = async (payment, action) => {
    const labels = { remove: "removal", restore: "restore", permanent: "permanent deletion", edit: "edit" };
    const reason = window.prompt(`Enter the compulsory ${labels[action]} reason.`);
    if (!String(reason || "").trim()) return;
    if (action === "permanent" && !window.confirm("Permanently delete this archived payment? This cannot be undone.")) return;
    setBusyId(payment.id);
    setMessage("");
    try {
      if (action === "remove") {
        await removeCentralPayment({ currentUser, ownerPassword, payment, reason });
      } else if (action === "restore") {
        await restoreCentralPayment({ currentUser, ownerPassword, payment, reason });
      } else if (action === "permanent") {
        await permanentlyDeleteCentralPayment({ currentUser, ownerPassword, payment, reason });
      } else {
        const amount = window.prompt("Payment amount", String(payment.amount || ""));
        if (amount === null) return;
        const paymentDate = window.prompt("Payment date (YYYY-MM-DD)", String(payment.payment_date || "").slice(0, 10));
        if (paymentDate === null) return;
        const paymentMethod = window.prompt("Payment method", payment.payment_method || "Cash");
        if (paymentMethod === null) return;
        const paidBy = window.prompt("Paid by", payment.paid_by || "");
        if (paidBy === null) return;
        const externalReference = window.prompt("Reference", payment.payment_reference || "");
        if (externalReference === null) return;
        const notes = window.prompt("Notes", payment.notes || "");
        if (notes === null) return;
        await editCentralPayment({
          currentUser,
          ownerPassword,
          payment,
          changes: { amount, paymentDate: `${paymentDate}T12:00:00`, paymentMethod, paidBy, externalReference, notes },
          reason,
        });
      }
      await load();
      await onChanged();
    } catch (actionError) {
      setMessage(actionError.message || "Payment lifecycle action failed.");
    } finally {
      setBusyId("");
    }
  };

  if (!ownerPassword) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 font-semibold text-amber-900">Enter the Owner Financial Password in Manual Payment to unlock this admin-only tab.</div>;
  }

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-extrabold">{archived ? "Payment Archive" : "Payment History"}</h3>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{result.total || 0} records</span>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-4">
        <input value={filters.search} onChange={(event) => updateFilter("search", event.target.value)} placeholder="Reference, payer or notes" className="rounded-xl border p-3" />
        <select value={filters.method} onChange={(event) => updateFilter("method", event.target.value)} className="rounded-xl border p-3"><option value="">All methods</option>{paymentMethods.map((method) => <option key={method}>{method}</option>)}</select>
        <input type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} className="rounded-xl border p-3" aria-label="From date" />
        <input type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} className="rounded-xl border p-3" aria-label="To date" />
      </div>
      {message && <div className="mb-3 rounded-xl bg-red-50 p-3 font-bold text-red-700">{message}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead><tr className="border-b bg-slate-50 text-left"><th className="p-3">Date</th><th className="p-3">Reference</th><th className="p-3">Type</th><th className="p-3">Method</th><th className="p-3">Paid by</th><th className="p-3">Status</th><th className="p-3">Notes</th><th className="p-3 text-right">Amount</th><th className="p-3 text-right">Actions</th></tr></thead>
          <tbody>
            {(result.records || []).map((payment) => {
              const pending = payment.payment_method === "Bank Transfer" && payment.verification_status === "PENDING_VERIFICATION";
              return <tr key={payment.id} className="border-b align-top">
                <td className="p-3">{new Date(payment.payment_date || payment.created_at).toLocaleDateString("en-GB")}</td>
                <td className="p-3 font-bold">{payment.payment_reference || "-"}</td><td className="p-3">{payment.transaction_type || "PAYMENT"}</td><td className="p-3">{payment.payment_method || "-"}</td><td className="p-3">{payment.paid_by || "-"}</td>
                <td className="p-3">{archived ? "ARCHIVED" : payment.verification_status || payment.status}</td><td className="max-w-[260px] whitespace-pre-wrap p-3">{archived ? payment.removed_reason : payment.notes || "-"}</td><td className="p-3 text-right font-bold">{formatCurrency(payment.amount || 0)}</td>
                <td className="p-3 text-right">
                  {archived ? <><button type="button" disabled={busyId === payment.id} onClick={() => runAction(payment, "restore")} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Restore</button><button type="button" disabled={busyId === payment.id} onClick={() => runAction(payment, "permanent")} className="ml-2 rounded-lg bg-red-800 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Permanent delete</button></> : <><button type="button" disabled={busyId === payment.id} onClick={() => runAction(payment, "edit")} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Edit</button><button type="button" disabled={busyId === payment.id} onClick={() => runAction(payment, "remove")} className="ml-2 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Remove</button>{pending && <button type="button" disabled={busyId === payment.id} onClick={() => onConfirmBank(payment)} className="ml-2 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white">Confirm bank</button>}</>}
                </td>
              </tr>;
            })}
            {!result.records?.length && <tr><td colSpan="9" className="p-5 text-center text-slate-500">No payment records match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Previous</button><span className="text-sm font-bold">Page {page} of {result.total_pages || 1}</span><button type="button" disabled={page >= (result.total_pages || 1)} onClick={() => setPage((value) => value + 1)} className="rounded-lg border px-3 py-2 font-bold disabled:text-slate-300">Next</button></div>
    </section>
  );
}

export default function CentralPayment() {
  const currentUser = useMemo(() => getLoggedInUser(), []);
  const owner = isOwnerUser(currentUser);
  const [activeTab, setActiveTab] = useState("manual");
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    transactionType: "PAYMENT",
    amount: "",
    paymentMethod: "Cash",
    paymentDate: new Date().toISOString().slice(0, 10),
    paidBy: "",
    externalReference: "",
    notes: "",
    ownerPassword: "",
  });

  useEffect(() => {
    let active = true;
    loadCentralPaymentCustomers()
      .then((rows) => {
        if (!active) return;
        setCustomers(rows);
        if (rows.length) setSelectedCustomerId((value) => value || rows[0].id);
      })
      .catch((loadError) =>
        setError(loadError.message || "Could not load customers.")
      );
    return () => {
      active = false;
    };
  }, []);

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(selectedCustomerId)
  );
  const branches = (selectedCustomer?.customer_branches || []).filter(
    (branch) => branch.active !== false
  );
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => matchesCustomer(customer, search)),
    [customers, search]
  );
  const preview = useMemo(
    () =>
      buildPaymentPreview({
        invoices: snapshot?.invoices || [],
        allocations: snapshot?.allocations || [],
        amount: Number(form.amount || 0),
        branchId: selectedBranchId,
      }),
    [form.amount, selectedBranchId, snapshot]
  );
  const payments = useMemo(
    () =>
      [...(snapshot?.selectedPayments || snapshot?.payments || [])].sort(
        (left, right) =>
          new Date(right.payment_date || right.created_at || 0) -
          new Date(left.payment_date || left.created_at || 0)
      ),
    [snapshot]
  );
  const pendingBankTransfers = payments.filter(
    (payment) =>
      payment.payment_method === "Bank Transfer" &&
      payment.verification_status === "PENDING_VERIFICATION"
  );

  const refreshSnapshot = async () => {
    if (!selectedCustomer) return;
    setLoading(true);
    try {
      setSnapshot(
        await loadCentralPaymentSnapshot({
          customerAccountId: selectedCustomer.id,
          customerName: selectedCustomer.account_name,
          customer: selectedCustomer,
          selectedBranchId,
        })
      );
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!selectedCustomer) return undefined;
    void Promise.resolve().then(async () => {
      if (active) setLoading(true);
      try {
        const nextSnapshot = await loadCentralPaymentSnapshot({
          customerAccountId: selectedCustomer.id,
          customerName: selectedCustomer.account_name,
          customer: selectedCustomer,
          selectedBranchId,
        });
        if (active) setSnapshot(nextSnapshot);
      } catch (loadError) {
        if (active) setError(loadError.message);
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [selectedBranchId, selectedCustomer]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSuccess("");
  };

  const savePayment = async () => {
    if (saving) return;
    if (!owner) {
      setError("Only nisstaj_admin can create Central Payment transactions.");
      return;
    }
    if (form.transactionType === "DISCOUNT" && !String(form.notes).trim()) {
      setError("A detailed discount reason is compulsory.");
      return;
    }

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const result = await createCentralPayment({
        customer: selectedCustomer,
        customerAccountId: selectedCustomer?.id,
        customerBranchId: selectedBranchId || null,
        transactionType: form.transactionType,
        amount: form.amount,
        paymentMethod:
          form.transactionType === "DISCOUNT" ? "Other" : form.paymentMethod,
        paymentDate: form.paymentDate
          ? `${form.paymentDate}T12:00:00`
          : new Date().toISOString(),
        paidBy: form.paidBy,
        externalReference: form.externalReference,
        notes: form.notes,
        currentUser,
        ownerPassword: form.ownerPassword,
      });

      const pending =
        result?.verification_status === "PENDING_VERIFICATION" ||
        result?.payment?.verification_status === "PENDING_VERIFICATION";

      setSuccess(
        result.duplicate
          ? "Duplicate transaction detected; nothing was posted."
          : pending
            ? "Bank transfer recorded as Pending Verification. It has not reduced the balance or paid invoices."
            : form.transactionType === "DISCOUNT"
              ? "Owner discount saved with a compulsory audit reason."
              : "Payment saved and allocated oldest-first."
      );
      setForm((current) => ({
        ...current,
        amount: "",
        externalReference: "",
        notes: "",
      }));
      await refreshSnapshot();
    } catch (saveError) {
      setError(saveError.message || "Could not save transaction.");
    } finally {
      setSaving(false);
    }
  };

  const confirmBank = async (payment) => {
    if (!form.ownerPassword) {
      setError("Enter the Owner Financial Password in Manual Payment first.");
      return;
    }

    const note = window.prompt(
      "Enter the compulsory bank verification note or bank statement reference."
    );
    if (!String(note || "").trim()) {
      setError("A bank verification note is compulsory.");
      return;
    }

    setError("");
    setSuccess("");
    try {
      await confirmOwnerBankTransfer({
        payment,
        customer: selectedCustomer,
        currentUser,
        ownerPassword: form.ownerPassword,
        note,
      });
      setSuccess(
        "Bank transfer confirmed, audited and allocated to the oldest outstanding invoices."
      );
      await refreshSnapshot();
    } catch (confirmError) {
      setError(confirmError.message || "Could not confirm bank transfer.");
    }
  };

  if (!owner) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-xl font-extrabold text-red-900">
          Central Payment restricted
        </h2>
        <p className="mt-2 text-red-800">
          Only the owner account <strong>{OWNER_USERNAME}</strong> can create,
          confirm, void, reverse, reallocate or discount financial transactions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-extrabold">Central Payment</h2>
        <p className="mt-1 text-sm text-slate-600">
          One owner-controlled view for payments, pending bank transfers and
          audited discounts.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1.2fr_1fr]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
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

      <nav className="flex flex-wrap gap-2" aria-label="Central Payment sections">
        {[["manual", "Manual Payment"], ["history", "Payment History"], ["archive", "Payment Archive"]].map(([value, label]) => (
          <button key={value} type="button" onClick={() => setActiveTab(value)} className={`rounded-xl px-4 py-3 font-bold ${activeTab === value ? "bg-blue-800 text-white" : "border bg-white text-slate-700"}`}>
            {label}
          </button>
        ))}
      </nav>

      {loading && (
        <div className="rounded-xl bg-slate-50 p-3 font-bold">
          Loading balances...
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl bg-green-50 p-3 font-bold text-green-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Summary
          label="Customer outstanding"
          value={snapshot?.customerSummary?.outstanding}
        />
        <Summary
          label="Selected branch outstanding"
          value={snapshot?.branchSummary?.outstanding}
        />
        <Summary
          label="Opening balance"
          value={
            snapshot?.selectedOpeningBalance ??
            snapshot?.customerSummary?.openingBalance
          }
          neutral
        />
        <Summary
          label="Pending bank transfers"
          value={pendingBankTransfers.reduce(
            (sum, payment) => sum + Number(payment.amount || 0),
            0
          )}
          neutral
        />
      </div>

      {activeTab === "manual" && (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Owner Transaction</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              value={form.transactionType}
              onChange={(event) =>
                updateForm("transactionType", event.target.value)
              }
              className="rounded-xl border p-3"
            >
              <option value="PAYMENT">Payment</option>
              <option value="DISCOUNT">Discount / goodwill adjustment</option>
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) => updateForm("amount", event.target.value)}
              placeholder={
                form.transactionType === "DISCOUNT"
                  ? "Discount amount"
                  : "Payment amount"
              }
              className="rounded-xl border p-3"
            />
            {form.transactionType === "PAYMENT" && (
              <select
                value={form.paymentMethod}
                onChange={(event) =>
                  updateForm("paymentMethod", event.target.value)
                }
                className="rounded-xl border p-3"
              >
                {paymentMethods.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            )}
            <input
              type="date"
              value={form.paymentDate}
              onChange={(event) =>
                updateForm("paymentDate", event.target.value)
              }
              className="rounded-xl border p-3"
            />
            <input
              value={form.paidBy}
              onChange={(event) => updateForm("paidBy", event.target.value)}
              placeholder="Who paid / discount beneficiary"
              className="rounded-xl border p-3"
            />
            <input
              value={form.externalReference}
              onChange={(event) =>
                updateForm("externalReference", event.target.value)
              }
              placeholder="Bank/reference number (optional)"
              className="rounded-xl border p-3"
            />
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder={
                form.transactionType === "DISCOUNT"
                  ? "Compulsory detailed discount reason"
                  : "Notes"
              }
              className="min-h-24 rounded-xl border p-3 md:col-span-2"
            />
            <input
              type="password"
              value={form.ownerPassword}
              onChange={(event) =>
                updateForm("ownerPassword", event.target.value)
              }
              placeholder="Owner financial password required"
              className="rounded-xl border border-blue-300 p-3 md:col-span-2"
              autoComplete="current-password"
            />
          </div>

          {form.paymentMethod === "Bank Transfer" &&
            form.transactionType === "PAYMENT" && (
              <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">
                Bank transfers are recorded as Pending Verification. They are
                not allocated and do not reduce the customer balance until the
                owner confirms them against the bank statement.
              </div>
            )}

          <button
            type="button"
            onClick={savePayment}
            disabled={
              saving ||
              !selectedCustomer ||
              Number(form.amount || 0) <= 0 ||
              !form.ownerPassword
            }
            className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:bg-slate-300"
          >
            {saving
              ? "Saving..."
              : form.transactionType === "DISCOUNT"
                ? "Save audited discount"
                : "Save owner payment"}
          </button>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-lg font-extrabold">Allocation Preview</h3>
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold">
              Unallocated {formatCurrency(preview.unallocatedAmount || 0)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Invoice</th>
                  <th className="p-3">Branch</th>
                  <th className="p-3 text-right">Allocated</th>
                </tr>
              </thead>
              <tbody>
                {preview.allocations.map((allocation) => (
                  <tr key={allocation.invoiceReference} className="border-b">
                    <td className="p-3 font-bold">
                      {allocation.invoiceReference}
                    </td>
                    <td className="p-3">
                      {branches.find(
                        (branch) =>
                          String(branch.id) ===
                          String(allocation.customerBranchId)
                      )?.branch_name || "-"}
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(allocation.allocatedAmount)}
                    </td>
                  </tr>
                ))}
                {!preview.allocations.length && (
                  <tr>
                    <td colSpan="3" className="p-4 text-center text-slate-500">
                      Enter an amount to preview oldest-first allocation.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      )}

      {activeTab === "history" && (
        <PaymentRecordsPanel archived={false} currentUser={currentUser} ownerPassword={form.ownerPassword} customer={selectedCustomer} branchId={selectedBranchId} onChanged={refreshSnapshot} onConfirmBank={confirmBank} />
      )}
      {activeTab === "archive" && (
        <PaymentRecordsPanel archived currentUser={currentUser} ownerPassword={form.ownerPassword} customer={selectedCustomer} branchId={selectedBranchId} onChanged={refreshSnapshot} onConfirmBank={confirmBank} />
      )}
    </div>
  );
}
