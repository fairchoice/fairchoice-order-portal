import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canPostSupplierLedger,
  canViewSupplierAccounts,
  loadSupplierAccounts,
  loadSupplierCreditStatement,
  postSupplierLedgerEntry,
  printSupplierStatement,
  SUPPLIER_LEDGER_TYPE_LABELS,
  SUPPLIER_LEDGER_TYPES,
  SUPPLIER_MANUAL_LEDGER_TYPES,
  validateManualSupplierLedgerEntry,
  voidSupplierLedgerTransaction,
} from "../../services/suppliers";

const today = () => new Date().toISOString().slice(0, 10);
const recentDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return date.toISOString().slice(0, 10);
};
const money = (value) =>
  Number(value || 0).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
  });
const emptyEntry = (supplierId = "") => ({
  supplierId,
  transactionDate: today(),
  transactionType: "debit_adjustment",
  amount: "",
  reference: "",
  description: "",
});

export default function SupplierAccounts({ user }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [dateFrom, setDateFrom] = useState(recentDate);
  const [dateTo, setDateTo] = useState(today);
  const [transactionType, setTransactionType] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entry, setEntry] = useState(emptyEntry());
  const [entryErrors, setEntryErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const canView = canViewSupplierAccounts(user);
  const canPost = canPostSupplierLedger(user);
  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === supplierId) || null;

  const refreshAccounts = useCallback(async () => {
    setError("");
    try {
      const data = await loadSupplierAccounts(user);
      setSuppliers(data);
      setSupplierId((current) =>
        data.some((supplier) => supplier.id === current)
          ? current
          : data[0]?.id || "",
      );
    } catch (loadError) {
      setError(loadError.message || "Supplier accounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const refreshStatement = useCallback(async () => {
    if (!supplierId) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await loadSupplierCreditStatement(user, {
        supplierId,
        dateFrom,
        dateTo,
        transactionTypes:
          transactionType === "all" ? [] : [transactionType],
        search,
      });
      setRows(data);
    } catch (loadError) {
      setRows([]);
      setError(loadError.message || "Supplier statement could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, search, supplierId, transactionType, user]);

  useEffect(() => {
    if (!canView) return undefined;
    const timer = window.setTimeout(() => void refreshAccounts(), 0);
    return () => window.clearTimeout(timer);
  }, [canView, refreshAccounts]);

  useEffect(() => {
    if (!canView || !supplierId) return undefined;
    const timer = window.setTimeout(() => void refreshStatement(), 250);
    return () => window.clearTimeout(timer);
  }, [canView, refreshStatement, supplierId]);

  const openingBalance = rows[0]?.opening_balance || 0;
  const currentBalance = rows[0]?.current_balance || 0;
  const endingBalance =
    [...rows].reverse().find((row) => !row.is_opening_balance)
      ?.running_balance ?? openingBalance;
  const statementRows = useMemo(() => rows, [rows]);

  function clearFilters() {
    setDateFrom(recentDate());
    setDateTo(today());
    setTransactionType("all");
    setSearch("");
  }

  function openEntryForm() {
    setEntry(emptyEntry(supplierId));
    setEntryErrors({});
    setShowEntryForm(true);
  }

  async function submitEntry(event) {
    event.preventDefault();
    const validation = validateManualSupplierLedgerEntry({
      ...entry,
      supplierId,
      supplierActive: selectedSupplier?.active !== false,
    });
    if (!validation.valid) {
      setEntryErrors(validation.errors);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await postSupplierLedgerEntry(
        {
          ...entry,
          supplierId,
          supplierActive: selectedSupplier?.active !== false,
        },
        user,
      );
      setShowEntryForm(false);
      await refreshStatement();
    } catch (saveError) {
      setEntryErrors(saveError.validationErrors || {});
      setError(saveError.message || "The supplier entry could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  async function voidTransaction(row) {
    const reason = window.prompt(
      `Reason for voiding ${row.reference || row.transaction_type}:`,
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A void reason is required.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await voidSupplierLedgerTransaction(row.transaction_id, reason, user);
      await refreshStatement();
    } catch (voidError) {
      setError(voidError.message || "The supplier transaction could not be voided.");
    } finally {
      setBusy(false);
    }
  }

  function handlePrint() {
    try {
      printSupplierStatement({
        supplier: selectedSupplier,
        rows: statementRows,
        dateFrom,
        dateTo,
        currentBalance,
      });
    } catch (printError) {
      setError(printError.message || "The statement could not be printed.");
    }
  }

  if (!canView) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900">Supplier Accounts</h2>
        <p className="mt-2 text-sm text-slate-600">
          You do not have permission to view supplier statements.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Supplier Accounts</h2>
          <p className="mt-1 text-sm text-slate-600">
            Positive balances are amounts Fair Choice owes the supplier.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePrint}
            disabled={!supplierId || loading}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Print statement
          </button>
          {canPost && (
            <button
              type="button"
              onClick={openEntryForm}
              disabled={!supplierId || selectedSupplier?.active === false}
              className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Add manual entry
            </button>
          )}
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <section className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Supplier">
          <select
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
            className="input"
          >
            {suppliers.length === 0 && <option value="">No suppliers</option>}
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.supplier_name}
                {supplier.active === false ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="input"
          />
        </Field>
        <Field label="Transaction type">
          <select
            value={transactionType}
            onChange={(event) => setTransactionType(event.target.value)}
            className="input"
          >
            <option value="all">All types</option>
            {SUPPLIER_LEDGER_TYPES.map((type) => (
              <option key={type} value={type}>
                {SUPPLIER_LEDGER_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Reference, invoice, notes…"
            className="input"
          />
        </Field>
        <button
          type="button"
          onClick={clearFilters}
          className="justify-self-start text-sm font-semibold text-blue-700 underline"
        >
          Clear filters
        </button>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <BalanceCard label="Opening balance" value={openingBalance} />
        <BalanceCard label="Displayed ending balance" value={endingBalance} />
        <BalanceCard label="True current balance" value={currentBalance} />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                {[
                  "Date",
                  "Type",
                  "Reference",
                  "Description",
                  "Debit",
                  "Credit",
                  "Balance",
                  "Status",
                  "Created by",
                  "Created",
                  "Actions",
                ].map((heading) => (
                  <th key={heading} className="px-3 py-3">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {statementRows.map((row) => (
                <tr
                  key={row.row_key}
                  className={row.is_opening_balance ? "bg-slate-50 font-semibold" : ""}
                >
                  <Cell>{row.transaction_date || "—"}</Cell>
                  <Cell>
                    {row.is_opening_balance
                      ? "Opening balance"
                      : SUPPLIER_LEDGER_TYPE_LABELS[row.transaction_type] ||
                        row.transaction_type}
                  </Cell>
                  <Cell>{row.reference || row.invoice_number || "—"}</Cell>
                  <Cell>
                    {row.description || "—"}
                    {row.status === "voided" && row.void_reason && (
                      <span className="block text-xs text-red-700">
                        Void reason: {row.void_reason}
                      </span>
                    )}
                  </Cell>
                  <Cell>{row.debit ? money(row.debit) : "—"}</Cell>
                  <Cell>{row.credit ? money(row.credit) : "—"}</Cell>
                  <Cell>{money(row.running_balance)}</Cell>
                  <Cell>
                    <Status value={row.status} />
                  </Cell>
                  <Cell>{row.created_by || "—"}</Cell>
                  <Cell>
                    {row.created_at
                      ? new Date(row.created_at).toLocaleString("en-GB")
                      : "—"}
                  </Cell>
                  <Cell>
                    {canPost &&
                    row.transaction_id &&
                    row.source === "supplier_credit" &&
                    row.status === "posted" ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => voidTransaction(row)}
                        className="text-sm font-semibold text-red-700 underline disabled:opacity-50"
                      >
                        Void
                      </button>
                    ) : (
                      "—"
                    )}
                  </Cell>
                </tr>
              ))}
              {!loading && statementRows.length === 0 && (
                <tr>
                  <td colSpan="11" className="px-4 py-8 text-center text-slate-600">
                    No supplier transactions match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && <p className="p-4 text-sm text-slate-600">Loading statement…</p>}
      </section>

      {showEntryForm && (
        <ManualEntryForm
          entry={entry}
          errors={entryErrors}
          busy={busy}
          supplier={selectedSupplier}
          onChange={(field, value) => {
            setEntry((current) => ({ ...current, [field]: value }));
            setEntryErrors((current) => ({ ...current, [field]: undefined }));
          }}
          onClose={() => setShowEntryForm(false)}
          onSubmit={submitEntry}
        />
      )}
      <style>{`.input{margin-top:.25rem;width:100%;border:1px solid #cbd5e1;border-radius:.5rem;padding:.5rem .75rem;background:white}`}</style>
    </div>
  );
}

function ManualEntryForm({
  entry,
  errors,
  busy,
  supplier,
  onChange,
  onClose,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Close manual supplier entry"
        onClick={onClose}
      />
      <form
        onSubmit={onSubmit}
        className="relative mx-auto w-full max-w-xl rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl"
      >
        <h3 className="text-xl font-bold text-slate-900">Manual supplier entry</h3>
        <p className="mt-1 text-sm text-slate-600">{supplier?.supplier_name}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Input
            label="Transaction date"
            type="date"
            value={entry.transactionDate}
            error={errors.transactionDate}
            onChange={(value) => onChange("transactionDate", value)}
          />
          <Field label="Entry type" error={errors.transactionType}>
            <select
              value={entry.transactionType}
              onChange={(event) =>
                onChange("transactionType", event.target.value)
              }
              className="input"
            >
              {SUPPLIER_MANUAL_LEDGER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SUPPLIER_LEDGER_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          <Input
            label="Amount"
            type="number"
            value={entry.amount}
            error={errors.amount}
            onChange={(value) => onChange("amount", value)}
          />
          <Input
            label="Reference"
            value={entry.reference}
            error={errors.reference}
            onChange={(value) => onChange("reference", value)}
          />
          <label className="text-sm font-semibold text-slate-800 sm:col-span-2">
            Reason / description
            <textarea
              value={entry.description}
              onChange={(event) => onChange("description", event.target.value)}
              className="input min-h-24"
            />
            <ErrorText value={errors.description} />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Posting…" : "Post entry"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, error }) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      {children}
      <ErrorText value={error} />
    </label>
  );
}

function Input({ label, value, onChange, error, type = "text" }) {
  return (
    <Field label={label} error={error}>
      <input
        type={type}
        value={value}
        min={type === "number" ? "0.01" : undefined}
        step={type === "number" ? "0.01" : undefined}
        onChange={(event) => onChange(event.target.value)}
        className="input"
      />
    </Field>
  );
}

function ErrorText({ value }) {
  return value ? (
    <span className="mt-1 block text-xs font-normal text-red-700">{value}</span>
  ) : null;
}

function BalanceCard({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-bold text-slate-900">{money(value)}</div>
    </div>
  );
}

function Cell({ children }) {
  return <td className="px-3 py-3 align-top text-slate-800">{children}</td>;
}

function Status({ value }) {
  const normalized = String(value || "posted").toLowerCase();
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
        normalized === "posted"
          ? "bg-emerald-50 text-emerald-800"
          : "bg-slate-200 text-slate-700"
      }`}
    >
      {normalized}
    </span>
  );
}
