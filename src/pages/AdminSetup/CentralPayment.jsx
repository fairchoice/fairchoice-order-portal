import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  buildPaymentPreview,
  confirmOwnerBankTransfer,
  createCentralPayment,
  loadCentralPaymentCustomers,
  loadCentralPaymentSnapshot,
} from "../../services/centralPaymentService";
import {
  OWNER_USERNAME,
  changeOwnerPassword,
  getOwnerSecurityStatus,
  isOwnerUser,
  setupOwnerPassword,
} from "../../services/ownerFinancialSecurity";

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

function OwnerSecurityPanel({ status, onRefresh }) {
  const [mode, setMode] = useState(status?.configured ? "change" : "setup");
  const [currentLoginPassword, setCurrentLoginPassword] = useState("");
  const [currentOwnerPassword, setCurrentOwnerPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setMode(status?.configured ? "change" : "setup");
  }, [status?.configured]);

  const submit = async () => {
    if (newPassword !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      if (mode === "setup") {
        await setupOwnerPassword({ currentLoginPassword, newPassword });
      } else {
        await changeOwnerPassword({ currentOwnerPassword, newPassword });
      }

      setCurrentLoginPassword("");
      setCurrentOwnerPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(
        mode === "setup"
          ? "Owner financial password configured."
          : "Owner financial password changed."
      );
      await onRefresh();
    } catch (error) {
      setMessage(error.message || "Could not update owner security.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-extrabold text-blue-950">Owner Financial Security</h3>
          <p className="text-sm text-blue-800">
            Protected account: {OWNER_USERNAME}. The financial password is hashed
            in Supabase and is never stored in browser code.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${
            status?.configured
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {status?.configured ? "Configured" : "Setup required"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {mode === "setup" ? (
          <input
            type="password"
            value={currentLoginPassword}
            onChange={(event) => setCurrentLoginPassword(event.target.value)}
            placeholder="Current login password"
            className="rounded-xl border p-3"
            autoComplete="current-password"
          />
        ) : (
          <input
            type="password"
            value={currentOwnerPassword}
            onChange={(event) => setCurrentOwnerPassword(event.target.value)}
            placeholder="Current financial password"
            className="rounded-xl border p-3"
            autoComplete="current-password"
          />
        )}
        <input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New secure password"
          className="rounded-xl border p-3"
          autoComplete="new-password"
        />
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm new password"
          className="rounded-xl border p-3"
          autoComplete="new-password"
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={
          busy ||
          !newPassword ||
          !confirmPassword ||
          (mode === "setup" ? !currentLoginPassword : !currentOwnerPassword)
        }
        className="mt-3 rounded-xl bg-blue-800 px-4 py-3 font-bold text-white disabled:bg-slate-300"
      >
        {busy
          ? "Saving..."
          : mode === "setup"
            ? "Set owner financial password"
            : "Change owner financial password"}
      </button>

      {message && (
        <div className="mt-3 rounded-lg bg-white p-3 text-sm font-semibold">
          {message}
        </div>
      )}
    </section>
  );
}

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

export default function CentralPayment() {
  const currentUser = getLoggedInUser();
  const owner = isOwnerUser(currentUser);
  const [securityStatus, setSecurityStatus] = useState({
    installed: false,
    configured: false,
  });
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmingId, setConfirmingId] = useState("");
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

  const refreshSecurity = async () => {
    try {
      setSecurityStatus(await getOwnerSecurityStatus());
    } catch (securityError) {
      setError(securityError.message);
    }
  };

  useEffect(() => {
    refreshSecurity();
  }, []);

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
    refreshSnapshot();
  }, [selectedCustomerId, selectedBranchId]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setSuccess("");
  };

  const savePayment = async () => {
    if (!owner) {
      setError("Only nisstaj_admin can create Central Payment transactions.");
      return;
    }
    if (!securityStatus.configured) {
      setError("Set the owner financial password before posting transactions.");
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
        ownerPassword: "",
      }));
      await refreshSnapshot();
    } catch (saveError) {
      setError(saveError.message || "Could not save transaction.");
    } finally {
      setSaving(false);
    }
  };

  const confirmBank = async (payment) => {
    const ownerPassword = window.prompt(
      "Enter the owner financial password to confirm this bank transfer."
    );
    if (!ownerPassword) return;

    const note = window.prompt(
      "Enter the compulsory bank verification note or bank statement reference."
    );
    if (!String(note || "").trim()) {
      setError("A bank verification note is compulsory.");
      return;
    }

    setConfirmingId(payment.id);
    setError("");
    setSuccess("");
    try {
      await confirmOwnerBankTransfer({
        payment,
        customer: selectedCustomer,
        ownerPassword,
        note,
      });
      setSuccess(
        "Bank transfer confirmed, audited and allocated to the oldest outstanding invoices."
      );
      await refreshSnapshot();
    } catch (confirmError) {
      setError(confirmError.message || "Could not confirm bank transfer.");
    } finally {
      setConfirmingId("");
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
      <OwnerSecurityPanel status={securityStatus} onRefresh={refreshSecurity} />

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

      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-extrabold">All Customer Payments</h3>
            <p className="text-sm text-slate-600">
              Cash, card, bank, other payments and owner discounts in one place.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">
            {payments.length} records
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Date</th>
                <th className="p-3">Reference</th>
                <th className="p-3">Type</th>
                <th className="p-3">Method</th>
                <th className="p-3">Paid by</th>
                <th className="p-3">Status</th>
                <th className="p-3">Notes</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => {
                const pending =
                  payment.payment_method === "Bank Transfer" &&
                  payment.verification_status === "PENDING_VERIFICATION";
                return (
                  <tr key={payment.id} className="border-b align-top">
                    <td className="p-3">
                      {new Date(
                        payment.payment_date || payment.created_at
                      ).toLocaleDateString("en-GB")}
                    </td>
                    <td className="p-3 font-bold">
                      {payment.payment_reference || "-"}
                    </td>
                    <td className="p-3">
                      {payment.transaction_type || "PAYMENT"}
                    </td>
                    <td className="p-3">{payment.payment_method || "-"}</td>
                    <td className="p-3">{payment.paid_by || "-"}</td>
                    <td className="p-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${
                          pending
                            ? "bg-amber-100 text-amber-800"
                            : payment.status === "VOIDED"
                              ? "bg-red-100 text-red-800"
                              : "bg-green-100 text-green-800"
                        }`}
                      >
                        {payment.verification_status || payment.status || "POSTED"}
                      </span>
                    </td>
                    <td className="max-w-[300px] whitespace-pre-wrap p-3">
                      {payment.mandatory_reason || payment.notes || "-"}
                    </td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(payment.amount || 0)}
                    </td>
                    <td className="p-3 text-right">
                      {pending ? (
                        <button
                          type="button"
                          onClick={() => confirmBank(payment)}
                          disabled={confirmingId === payment.id}
                          className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"
                        >
                          {confirmingId === payment.id
                            ? "Confirming..."
                            : "Confirm bank"}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!payments.length && (
                <tr>
                  <td colSpan="9" className="p-5 text-center text-slate-500">
                    No payment records found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
