import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  buildPaymentPreview,
  createCentralPayment,
  loadCentralPaymentCustomers,
  loadCentralPaymentSnapshot,
} from "../../services/centralPaymentService";

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

export default function CentralPayment() {
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
    amount: "",
    paymentMethod: "Cash",
    paymentDate: new Date().toISOString().slice(0, 10),
    paidBy: "",
    externalReference: "",
    notes: "",
  });

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

  const refreshSnapshot = async (options = {}) => {
    if (!selectedCustomer) return;
    if (!options.silent) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await loadCentralPaymentSnapshot({
        customerAccountId: selectedCustomer.id,
        customerName: selectedCustomer.account_name,
        customer: selectedCustomer,
        selectedBranchId,
      });
      setSnapshot(data);
    } catch (loadError) {
      setError(loadError.message || "Could not load payment snapshot.");
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedCustomer) return;
    let active = true;
    loadCentralPaymentSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId,
    })
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((loadError) => {
        if (active) setError(loadError.message || "Could not load payment snapshot.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedCustomer, selectedBranchId]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setSuccess("");
    setError("");
  };

  const savePayment = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const result = await createCentralPayment({
        customer: selectedCustomer,
        customerAccountId: selectedCustomer?.id,
        customerBranchId: selectedBranchId || null,
        amount: form.amount,
        paymentMethod: form.paymentMethod,
        paymentDate: form.paymentDate ? `${form.paymentDate}T12:00:00` : new Date().toISOString(),
        paidBy: form.paidBy,
        externalReference: form.externalReference,
        notes: form.notes,
        currentUser: getLoggedInUser(),
      });

      setSuccess(
        result.duplicate
          ? "Duplicate payment detected. Existing payment was not posted again."
          : "Payment saved and allocated oldest-first."
      );
      setForm((current) => ({ ...current, amount: "", externalReference: "", notes: "" }));
      await refreshSnapshot({ silent: true });
    } catch (saveError) {
      setError(saveError.message || "Could not save payment.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-extrabold text-slate-900">Central Payment</h2>
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

      {loading && <div className="rounded-xl bg-slate-50 p-3 font-bold">Loading balances...</div>}
      {error && <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{error}</div>}
      {success && <div className="rounded-xl bg-green-50 p-3 font-bold text-green-700">{success}</div>}
      {snapshot?.legacyFallbackUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Temporary legacy compatibility is active. New payments will still be written only to customer_payments.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase text-slate-500">Customer outstanding</div>
          <div className="mt-1 text-2xl font-extrabold text-red-700">
            {formatCurrency(snapshot?.customerSummary?.outstanding || 0)}
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase text-slate-500">Selected branch outstanding</div>
          <div className="mt-1 text-2xl font-extrabold text-red-700">
            {formatCurrency(snapshot?.branchSummary?.outstanding || 0)}
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-bold uppercase text-slate-500">Opening balance</div>
          <div className="mt-1 text-2xl font-extrabold text-slate-900">
            {formatCurrency(snapshot?.selectedOpeningBalance ?? snapshot?.customerSummary?.openingBalance ?? 0)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Payment Details</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) => updateForm("amount", event.target.value)}
              placeholder="Payment amount"
              className="rounded-xl border p-3"
            />
            <select
              value={form.paymentMethod}
              onChange={(event) => updateForm("paymentMethod", event.target.value)}
              className="rounded-xl border p-3"
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
            <input
              type="date"
              value={form.paymentDate}
              onChange={(event) => updateForm("paymentDate", event.target.value)}
              className="rounded-xl border p-3"
            />
            <input
              value={form.paidBy}
              onChange={(event) => updateForm("paidBy", event.target.value)}
              placeholder="Who paid"
              className="rounded-xl border p-3"
            />
            <input
              value={form.externalReference}
              onChange={(event) => updateForm("externalReference", event.target.value)}
              placeholder="External / reference number"
              className="rounded-xl border p-3 md:col-span-2"
            />
            <textarea
              value={form.notes}
              onChange={(event) => updateForm("notes", event.target.value)}
              placeholder="Notes"
              className="min-h-24 rounded-xl border p-3 md:col-span-2"
            />
          </div>
          <button
            type="button"
            onClick={savePayment}
            disabled={saving || !selectedCustomer || Number(form.amount || 0) <= 0}
            className="mt-4 w-full rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {saving ? "Saving payment..." : "Save payment"}
          </button>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-lg font-extrabold">Allocation Preview</h3>
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
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
                    <td className="p-3 font-bold">{allocation.invoiceReference}</td>
                    <td className="p-3">{branches.find((branch) => String(branch.id) === String(allocation.customerBranchId))?.branch_name || "-"}</td>
                    <td className="p-3 text-right font-bold">{formatCurrency(allocation.allocatedAmount)}</td>
                  </tr>
                ))}
                {!preview.allocations.length && (
                  <tr><td colSpan="3" className="p-4 text-center text-slate-500">Enter a payment amount to preview oldest-first allocation.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
