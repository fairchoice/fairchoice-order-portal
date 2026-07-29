import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import {
  loadProcessingQueueOrders,
  mergeDeliveredOrderInvoicesIntoLedgerRows,
} from "../../services/centralInvoiceEngine";
import { loadDeliveredInvoices } from "../../services/centralPaymentService";
import { formatCurrency } from "../../utils/currency";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  getWeeklyPaymentDate,
  getWeeklyPaymentDateKey,
  loadWeeklyAccountPayments,
} from "../../services/weeklyAccountPayments";
import { saveHandover, getHandoverHistory } from "../../services/handovers";
import {
  loadStaffCashExpenses,
  saveStaffCashExpense,
  updateStaffCashExpenseStatus,
} from "../../services/staffCashExpenses";

const PAGE_SIZE = 30;
const EXPENSE_CATEGORIES = [
  "Fuel",
  "Parking",
  "Vehicle",
  "Delivery",
  "Customer Refund",
  "Office Purchase",
  "Other",
];

const normalize = (value) => String(value || "").trim().toLowerCase();
const isCashPayment = (row) => normalize(row.payment_type || row.payment_method) === "cash";
const paymentAmount = (row) => Number(row.payment_amount ?? row.amount ?? row.credit ?? 0);
const collectorNameFor = (row) =>
  row.collector_name ||
  row.driver_name ||
  row.sales_rep_name ||
  row.collected_by ||
  row.metadata?.collector_name ||
  row.metadata?.driver_name ||
  row.metadata?.sales_rep_name ||
  "";
const collectorTypeFor = (row) => {
  const role = normalize(row.collection_type || row.collector_role || row.collected_by_role);
  if (role.includes("driver")) return "Driver";
  if (role.includes("sales")) return "Sales Rep";
  return "Office";
};
const dateInRange = (value, startDate, endDate) => {
  if (!value) return false;
  const key = String(value).slice(0, 10);
  if (startDate && key < startDate) return false;
  if (endDate && key > endDate) return false;
  return true;
};
const getLoggedInUser = () => {
  try {
    return JSON.parse(
      localStorage.getItem("loggedInUser") ||
        localStorage.getItem("fairchoice_user") ||
        "null",
    ) || {};
  } catch {
    return {};
  }
};
const isOwnerLogin = () =>
  String(getLoggedInUser()?.username || "").trim().toLowerCase() === "nisstaj_admin";
const isRestrictedCreditRecord = (row = {}) => {
  const invoiceValue = normalize(
    row.invoice_option ||
      row.invoice_status ||
      row.metadata?.invoice_option ||
      row.metadata?.invoice_status ||
      row.metadata?.invoice_type,
  );
  const payValue = normalize(
    row.payment_type || row.payment_method || row.metadata?.payment_type || row.metadata?.payment_method,
  );
  return invoiceValue === "paid" && payValue === "credit";
};
const getLoggedInName = () => {
  try {
    const user = getLoggedInUser();
    return user?.staff_name || user?.name || user?.username || user?.user_name || "";
  } catch {
    return "";
  }
};

export default function WeeklyAccount() {
  const [activeTab, setActiveTab] = useState("total");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [payments, setPayments] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [handoverHistory, setHandoverHistory] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [collectorType, setCollectorType] = useState("Driver");
  const [collectorName, setCollectorName] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [handoverReason, setHandoverReason] = useState("");
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingHandover, setSavingHandover] = useState(false);

  const [expenseForm, setExpenseForm] = useState({
    collectorType: "Driver",
    collectorName: "",
    expenseDate: new Date().toISOString().slice(0, 10),
    amount: "",
    category: "Fuel",
    reason: "",
    reference: "",
    status: "APPROVED",
  });
  const [savingExpense, setSavingExpense] = useState(false);

  const money = (value) => formatCurrency(Number(value || 0));
  const formatDate = (value) =>
    value ? new Date(value).toLocaleDateString("en-GB") : "-";
  const formatDateTime = (value) =>
    value ? new Date(value).toLocaleString("en-GB") : "-";

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const today = new Date();
      const weekStart = new Date(today);
      const day = today.getDay();
      weekStart.setDate(today.getDate() + (day === 0 ? -6 : 1 - day));
      weekStart.setHours(0, 0, 0, 0);

      const results = await Promise.allSettled([
        loadWeeklyAccountPayments(supabase, {
          loadInvoices: loadDeliveredInvoices,
        }),
        supabase.from("drivers").select("*"),
        supabase
          .from("customer_ledger")
          .select("*")
          .eq("entry_type", "INVOICE")
          .in("invoice_status", ["UNPAID", "PARTIAL", "PART PAID"])
          .gte("created_at", weekStart.toISOString())
          .order("created_at", { ascending: false }),
        loadProcessingQueueOrders(),
        getHandoverHistory(),
        loadStaffCashExpenses(),
      ]);

      const valueAt = (index, fallback) =>
        results[index].status === "fulfilled" ? results[index].value : fallback;
      const paymentsData = valueAt(0, []);
      const driverResult = valueAt(1, { data: [], error: null });
      const invoiceResult = valueAt(2, { data: [], error: null });
      const queueOrders = valueAt(3, []);
      const history = valueAt(4, []);
      const expenseRows = valueAt(5, []);

      if (results[0].status === "rejected") throw results[0].reason;
      if (driverResult.error) console.warn("Could not load drivers:", driverResult.error);
      if (invoiceResult.error) console.warn("Could not load outstanding invoices:", invoiceResult.error);
      if (results[4].status === "rejected") console.warn("Could not load handovers:", results[4].reason);
      if (results[5].status === "rejected") console.warn("Staff cash expenses table is not installed yet.");

      const deliveredThisWeek = (queueOrders || []).filter((order) => {
        const delivered = new Date(order.deliveredAt || order.delivered_at || order.createdAt || order.created_at || 0);
        return !Number.isNaN(delivered.getTime()) && delivered >= weekStart;
      });
      const merged = mergeDeliveredOrderInvoicesIntoLedgerRows(
        invoiceResult.data || [],
        deliveredThisWeek,
      ).filter((row) => {
        const type = String(row.entry_type || row.transaction_type || "").toUpperCase();
        const status = String(row.invoice_status || "UNPAID").toUpperCase();
        const paymentType = normalize(row.payment_type || row.payment_method || row.delivery_payment_type);
        return (
          type === "INVOICE" &&
          !["PAID", "VOIDED", "CANCELLED"].includes(status) &&
          (!paymentType || paymentType === "credit")
        );
      });

      setPayments(
        (paymentsData || []).filter((row) => isOwnerLogin() || !isRestrictedCreditRecord(row)),
      );
      setDrivers(driverResult.data || []);
      setUnpaidInvoices(merged);
      setHandoverHistory(history || []);
      setExpenses(expenseRows || []);
    } catch (err) {
      console.error("Weekly Account load error:", err);
      setError(err.message || "Could not load Weekly Account.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredPayments = useMemo(
    () =>
      payments.filter((row) => {
        const key = getWeeklyPaymentDateKey(row);
        if (startDate && key < startDate) return false;
        if (endDate && key > endDate) return false;
        return true;
      }),
    [payments, startDate, endDate],
  );

  const driverPayments = useMemo(
    () => filteredPayments.filter((row) => collectorTypeFor(row) === "Driver"),
    [filteredPayments],
  );
  const salesRepPayments = useMemo(
    () => filteredPayments.filter((row) => collectorTypeFor(row) === "Sales Rep"),
    [filteredPayments],
  );

  const collectorNames = useMemo(() => {
    const driverNames = new Set(
      drivers
        .map((driver) => driver.name || driver.full_name || driver.driverName)
        .filter(Boolean),
    );
    const salesRepNames = new Set();
    payments.forEach((row) => {
      const name = collectorNameFor(row);
      if (!name) return;
      if (collectorTypeFor(row) === "Driver") driverNames.add(name);
      if (collectorTypeFor(row) === "Sales Rep") salesRepNames.add(name);
    });
    expenses.forEach((row) => {
      if (row.collector_type === "Driver") driverNames.add(row.collector_name);
      if (row.collector_type === "Sales Rep") salesRepNames.add(row.collector_name);
    });
    return {
      Driver: [...driverNames].sort(),
      "Sales Rep": [...salesRepNames].sort(),
    };
  }, [drivers, payments, expenses]);

  const totalsByCollector = (rows) => {
    const result = new Map();
    rows.forEach((row) => {
      const name = collectorNameFor(row) || "Unknown Collector";
      result.set(name, (result.get(name) || 0) + paymentAmount(row));
    });
    return [...result.entries()].sort((a, b) => b[1] - a[1]);
  };

  const approvedExpenses = useMemo(
    () => expenses.filter((row) => String(row.status).toUpperCase() === "APPROVED"),
    [expenses],
  );

  const cashHoldingRows = useMemo(() => {
    const keys = new Map();
    payments.forEach((row) => {
      const type = collectorTypeFor(row);
      const name = collectorNameFor(row);
      if ((type === "Driver" || type === "Sales Rep") && name) keys.set(`${type}|${name}`, { type, name });
    });
    expenses.forEach((row) => {
      if (row.collector_name) keys.set(`${row.collector_type}|${row.collector_name}`, { type: row.collector_type, name: row.collector_name });
    });
    handoverHistory.forEach((row) => {
      if (row.collector_name) keys.set(`${row.collector_type}|${row.collector_name}`, { type: row.collector_type, name: row.collector_name });
    });

    return [...keys.values()].map(({ type, name }) => {
      const matchingCash = payments.filter(
        (row) =>
          isCashPayment(row) &&
          collectorTypeFor(row) === type &&
          normalize(collectorNameFor(row)) === normalize(name),
      );
      const collected = matchingCash.reduce((sum, row) => sum + paymentAmount(row), 0);
      const expenseTotal = approvedExpenses
        .filter((row) => row.collector_type === type && normalize(row.collector_name) === normalize(name))
        .reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const handedOver = handoverHistory
        .filter((row) => row.collector_type === type && normalize(row.collector_name) === normalize(name))
        .reduce((sum, row) => sum + Number(row.cash_received || 0), 0);
      const lastHandover = handoverHistory
        .filter((row) => row.collector_type === type && normalize(row.collector_name) === normalize(name))
        .sort((a, b) => new Date(b.created_at || b.handover_date) - new Date(a.created_at || a.handover_date))[0];
      const lastCollection = matchingCash
        .slice()
        .sort((a, b) => new Date(getWeeklyPaymentDate(b) || 0) - new Date(getWeeklyPaymentDate(a) || 0))[0];
      const holding = collected - expenseTotal - handedOver;
      const anchor = lastCollection ? new Date(getWeeklyPaymentDate(lastCollection)) : null;
      return {
        key: `${type}|${name}`,
        collectorType: type,
        collectorName: name,
        collected,
        expenses: expenseTotal,
        handedOver,
        holding,
        lastHandoverDate: lastHandover?.created_at || lastHandover?.handover_date,
        daysHolding: anchor ? Math.max(0, Math.floor((Date.now() - anchor.getTime()) / 86400000)) : 0,
      };
    }).sort((a, b) => b.holding - a.holding);
  }, [payments, approvedExpenses, handoverHistory]);

  const lastCollectorHandover = useMemo(
    () =>
      handoverHistory
        .filter(
          (row) =>
            row.collector_type === collectorType &&
            normalize(row.collector_name) === normalize(collectorName),
        )
        .sort((a, b) => new Date(b.period_end || b.created_at) - new Date(a.period_end || a.created_at))[0],
    [handoverHistory, collectorType, collectorName],
  );

  const handoverPeriodStart = useMemo(() => {
    if (lastCollectorHandover) return new Date(lastCollectorHandover.period_end || lastCollectorHandover.created_at);
    return new Date(0);
  }, [lastCollectorHandover]);
  const handoverPeriodEnd = new Date();
  const selectedCashCollected = payments
    .filter(
      (row) =>
        isCashPayment(row) &&
        collectorTypeFor(row) === collectorType &&
        normalize(collectorNameFor(row)) === normalize(collectorName) &&
        new Date(getWeeklyPaymentDate(row) || 0) > handoverPeriodStart &&
        new Date(getWeeklyPaymentDate(row) || 0) <= handoverPeriodEnd,
    )
    .reduce((sum, row) => sum + paymentAmount(row), 0);
  const selectedApprovedExpenses = approvedExpenses
    .filter(
      (row) =>
        row.collector_type === collectorType &&
        normalize(row.collector_name) === normalize(collectorName) &&
        new Date(row.expense_date || row.created_at) > handoverPeriodStart &&
        new Date(row.expense_date || row.created_at) <= handoverPeriodEnd,
    )
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const selectedAmountDue = selectedCashCollected - selectedApprovedExpenses;
  const handoverDifference = Number(cashReceived || 0) - selectedAmountDue;

  async function handleSaveHandover() {
    if (!collectorName) return alert(`Please select ${collectorType}.`);
    if (!(Number(cashReceived) >= 0)) return alert("Please enter the cash received.");
    if (Math.abs(handoverDifference) > 0.009 && !handoverReason.trim()) {
      return alert("Please explain the handover difference.");
    }
    const confirmed = window.confirm(
      `Save handover for ${collectorName}?\n\nCash collected: ${money(selectedCashCollected)}\nApproved expenses: ${money(selectedApprovedExpenses)}\nAmount due: ${money(selectedAmountDue)}\nCash received: ${money(cashReceived)}\nDifference: ${money(handoverDifference)}`,
    );
    if (!confirmed) return;

    setSavingHandover(true);
    try {
      await saveHandover({
        collectorType,
        collectorName,
        handoverDate,
        periodStart: handoverPeriodStart.toISOString(),
        periodEnd: handoverPeriodEnd.toISOString(),
        systemCollection: selectedAmountDue,
        cashReceived: Number(cashReceived || 0),
        difference: handoverDifference,
        reason: handoverReason,
      });
      setCashReceived("");
      setHandoverReason("");
      setHandoverHistory(await getHandoverHistory());
      alert("Handover saved successfully.");
    } catch (err) {
      alert(err.message || "Failed to save handover.");
    } finally {
      setSavingHandover(false);
    }
  }

  async function handleSaveExpense(event) {
    event.preventDefault();
    setSavingExpense(true);
    try {
      await saveStaffCashExpense({
        ...expenseForm,
        createdBy: getLoggedInName(),
        approvedBy: getLoggedInName(),
      });
      setExpenses(await loadStaffCashExpenses());
      setExpenseForm((current) => ({ ...current, amount: "", reason: "", reference: "" }));
      alert("Expense / pay-out saved. Approved expenses now reduce cash holding.");
    } catch (err) {
      alert(err.message || "Could not save expense.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function handleExpenseStatus(id, status) {
    try {
      await updateStaffCashExpenseStatus(id, status, getLoggedInName());
      setExpenses(await loadStaffCashExpenses());
    } catch (err) {
      alert(err.message || "Could not update expense status.");
    }
  }

  const tabs = [
    ["total", "Total Collection"],
    ["driver", "Driver Collection"],
    ["salesrep", "Sales Rep Collection"],
    ["holding", "Cash Holding"],
    ["handover", "Driver / Sales Rep Handover"],
    ["unpaid", "Customers Didn’t Pay"],
  ];

  const filteredExpenses = expenses.filter((row) =>
    dateInRange(row.expense_date || row.created_at, startDate, endDate),
  );
  const filteredHandovers = handoverHistory.filter((row) =>
    dateInRange(row.handover_date || row.created_at, startDate, endDate),
  );
  const filteredUnpaid = unpaidInvoices.filter((row) =>
    dateInRange(row.delivered_at || row.created_at, startDate, endDate),
  );

  if (loading) return <div className="p-4">Loading Weekly Account...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Weekly Account</h1>
          <p className="text-sm text-slate-500">Central payments remain read-only. Expenses and handovers reconcile staff cash.</p>
        </div>
        <button type="button" onClick={loadData} className="rounded-lg bg-slate-700 px-4 py-2 font-bold text-white">Refresh</button>
      </div>

      {error && <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-700">{error}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Start Date"><input type="date" className="border rounded-lg px-3 py-2" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
        <Field label="End Date"><input type="date" className="border rounded-lg px-3 py-2" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        <button type="button" onClick={() => { setStartDate(""); setEndDate(""); }} className="rounded-lg bg-slate-600 px-4 py-2 font-bold text-white">Clear</button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-xl border px-3 py-3 font-bold ${activeTab === key ? "border-blue-700 bg-blue-700 text-white" : "border-blue-700 bg-white text-blue-800"}`}>{label}</button>
        ))}
      </div>

      {activeTab === "total" && <CollectionSection rows={filteredPayments} title="Total Collection" money={money} formatDate={formatDate} />}
      {activeTab === "driver" && <CollectorCollectionSection rows={driverPayments} title="Driver Collection" money={money} formatDate={formatDate} totals={totalsByCollector(driverPayments)} />}
      {activeTab === "salesrep" && <CollectorCollectionSection rows={salesRepPayments} title="Sales Rep Collection" money={money} formatDate={formatDate} totals={totalsByCollector(salesRepPayments)} />}

      {activeTab === "holding" && (
        <PaginatedTable rows={cashHoldingRows} empty="No staff cash holding found." renderHeader={() => <tr className="bg-blue-700 text-white"><Th>Type</Th><Th>Collector</Th><Th right>Cash Collected</Th><Th right>Approved Expenses</Th><Th right>Handed Over</Th><Th right>Amount Due</Th><Th>Last Handover</Th><Th right>Days Holding</Th></tr>} renderRow={(row) => <tr key={row.key} className="border-b"><Td>{row.collectorType}</Td><Td bold>{row.collectorName}</Td><Td right>{money(row.collected)}</Td><Td right>{money(row.expenses)}</Td><Td right>{money(row.handedOver)}</Td><Td right bold className={row.holding > 0 ? "text-red-600" : "text-green-600"}>{money(row.holding)}</Td><Td>{formatDate(row.lastHandoverDate)}</Td><Td right>{row.daysHolding}</Td></tr>} />
      )}

      {activeTab === "handover" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-lg font-bold">Driver / Sales Rep Handover</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Collector Type"><select className="w-full rounded-lg border p-2.5" value={collectorType} onChange={(e) => { setCollectorType(e.target.value); setCollectorName(""); }}><option>Driver</option><option>Sales Rep</option></select></Field>
              <Field label="Collector Name"><select className="w-full rounded-lg border p-2.5" value={collectorName} onChange={(e) => setCollectorName(e.target.value)}><option value="">Select</option>{collectorNames[collectorType].map((name) => <option key={name}>{name}</option>)}</select></Field>
              <Field label="Handover Date"><input type="date" className="w-full rounded-lg border p-2.5" value={handoverDate} onChange={(e) => setHandoverDate(e.target.value)} /></Field>
              <Field label="Cash Collected"><ReadOnlyValue value={money(selectedCashCollected)} /></Field>
              <Field label="Approved Expenses"><ReadOnlyValue value={money(selectedApprovedExpenses)} /></Field>
              <Field label="Amount Due"><ReadOnlyValue value={money(selectedAmountDue)} /></Field>
              <Field label="Cash Received"><input min="0" step="0.01" type="number" className="w-full rounded-lg border p-2.5" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} /></Field>
              <Field label="Difference"><ReadOnlyValue value={money(handoverDifference)} /></Field>
            </div>
            <Field label="Reason (required when different)"><textarea className="w-full rounded-lg border p-2.5" value={handoverReason} onChange={(e) => setHandoverReason(e.target.value)} /></Field>
            <button type="button" onClick={handleSaveHandover} disabled={savingHandover} className="rounded-lg bg-green-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">{savingHandover ? "Saving..." : "Save Handover"}</button>
          </div>
          <HandoverTable rows={filteredHandovers} money={money} formatDateTime={formatDateTime} />
        </div>
      )}

      {activeTab === "unpaid" && <OutstandingTable rows={filteredUnpaid} money={money} formatDate={formatDate} />}
    </div>
  );
}

function CollectionSection({ rows, title, money, formatDate }) {
  const total = rows.reduce((sum, row) => sum + paymentAmount(row), 0);
  const paymentCount = new Set(rows.map((row) => row.canonical_payment_key || row.id)).size;
  return <><div className="grid grid-cols-1 gap-3 md:grid-cols-3"><SummaryCard title="Paid Customers" value={new Set(rows.map((row) => row.customer_name)).size} /><SummaryCard title="Payments" value={paymentCount} /><SummaryCard title={title} value={money(total)} /></div><PaymentTable rows={rows} money={money} formatDate={formatDate} /></>;
}

function CollectorCollectionSection({ rows, totals, title, money, formatDate }) {
  return <><div className="grid grid-cols-1 gap-3 md:grid-cols-3">{totals.map(([name, total]) => <SummaryCard key={name} title={name} value={money(total)} />)}{totals.length === 0 && <SummaryCard title={title} value={money(0)} />}</div><PaymentTable rows={rows} money={money} formatDate={formatDate} /></>;
}

function PaymentTable({ rows, money, formatDate }) {
  const invoiceTotal = (row) => Number(row.invoice_total || row.order_total || row.total_amount || row.invoice_amount || 0);
  const balance = (row) =>
    Number.isFinite(Number(row.running_balance))
      ? Number(row.running_balance)
      : Math.max(0, invoiceTotal(row) - paymentAmount(row));
  return <PaginatedTable rows={rows} empty="No payment records found." renderHeader={() => <tr className="bg-gray-100 text-left"><Th>Customer</Th><Th>Order No</Th><Th right>Invoice Total</Th><Th right>Paid Amount</Th><Th right>Balance</Th><Th>Payment Date</Th><Th>Payment Type</Th><Th>Who Paid</Th><Th>Collected By</Th><Th>Collection Type</Th><Th>Source</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-t"><Td>{row.customer_name || "-"}</Td><Td>{formatDisplayOrderId(row.invoice_no || row.order_number)}</Td><Td right>{money(invoiceTotal(row))}</Td><Td right>{money(paymentAmount(row))}</Td><Td right>{money(balance(row))}</Td><Td>{formatDate(getWeeklyPaymentDate(row))}</Td><Td>{row.payment_type || row.payment_method || "-"}</Td><Td>{row.who_paid || row.paid_by || "-"}</Td><Td bold>{collectorNameFor(row) || "-"}</Td><Td>{collectorTypeFor(row)}</Td><Td><SourceBadge legacy={row.is_legacy} /></Td></tr>} />;
}

function ExpenseTable({ rows, money, formatDate, onStatus }) {
  return <PaginatedTable rows={rows} empty="No expenses or pay-outs found." renderHeader={() => <tr className="bg-gray-100"><Th>Date</Th><Th>Type</Th><Th>Staff</Th><Th>Category</Th><Th>Reason</Th><Th>Reference</Th><Th right>Amount</Th><Th>Status</Th><Th>Approval</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-t"><Td>{formatDate(row.expense_date)}</Td><Td>{row.collector_type}</Td><Td bold>{row.collector_name}</Td><Td>{row.category}</Td><Td>{row.reason}</Td><Td>{row.reference || "-"}</Td><Td right>{money(row.amount)}</Td><Td><StatusBadge value={row.status} /></Td><Td>{row.status === "PENDING" ? <div className="flex gap-2"><button type="button" onClick={() => onStatus(row.id, "APPROVED")} className="rounded bg-green-600 px-2 py-1 text-xs font-bold text-white">Approve</button><button type="button" onClick={() => onStatus(row.id, "REJECTED")} className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-white">Reject</button></div> : "-"}</Td></tr>} />;
}

function HandoverTable({ rows, money, formatDateTime }) {
  return <PaginatedTable rows={rows} empty="No handover history found." renderHeader={() => <tr className="bg-blue-700 text-white"><Th>Date</Th><Th>Type</Th><Th>Collector</Th><Th right>Amount Due</Th><Th right>Cash Received</Th><Th right>Difference</Th><Th>Reason</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-b"><Td>{formatDateTime(row.created_at || row.handover_date)}</Td><Td>{row.collector_type}</Td><Td bold>{row.collector_name}</Td><Td right>{money(row.system_collection)}</Td><Td right>{money(row.cash_received)}</Td><Td right bold className={Number(row.difference) < 0 ? "text-red-600" : Number(row.difference) > 0 ? "text-green-600" : ""}>{money(row.difference)}</Td><Td>{row.reason || "-"}</Td></tr>} />;
}

function OutstandingTable({ rows, money, formatDate }) {
  const invoiceTotal = (row) => Number(row.invoice_total || row.order_total || row.total_amount || row.invoice_amount || row.amount || 0);
  const collected = (row) => Number(row.payment_amount || row.paid_amount || 0);
  const outstanding = (row) => Math.max(0, invoiceTotal(row) - collected(row));
  const outstandingValue = rows.reduce((sum, row) => sum + outstanding(row), 0);
  return <><div className="grid grid-cols-1 gap-3 md:grid-cols-3"><SummaryCard title="Unpaid Customers" value={new Set(rows.map((row) => row.customer_name)).size} /><SummaryCard title="Outstanding Invoices" value={rows.length} /><SummaryCard title="Outstanding Value" value={money(outstandingValue)} /></div><PaginatedTable rows={rows} empty="No delivered credit invoices are outstanding." renderHeader={() => <tr className="bg-gray-100"><Th>Customer</Th><Th>Order No</Th><Th>Delivery Date</Th><Th right>Invoice Total</Th><Th right>Collected</Th><Th right>Outstanding</Th><Th>Driver / Sales Rep</Th><Th>Status</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-t"><Td>{row.customer_name || "-"}</Td><Td>{formatDisplayOrderId(row.invoice_no || row.order_number)}</Td><Td>{formatDate(row.delivered_at || row.created_at)}</Td><Td right>{money(invoiceTotal(row))}</Td><Td right>{money(collected(row))}</Td><Td right bold className="text-red-600">{money(outstanding(row))}</Td><Td>{row.driver_name || row.name || row.sales_rep_name || row.collected_by || "-"}</Td><Td><StatusBadge value={row.invoice_status || "OUTSTANDING"} /></Td></tr>} /></>;
}

function PaginatedTable({ rows, renderHeader, renderRow, empty }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(1), [rows]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <div className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-sm"><thead>{renderHeader()}</thead><tbody>{visible.map(renderRow)}{rows.length === 0 && <tr><td colSpan="20" className="p-6 text-center text-gray-500">{empty}</td></tr>}</tbody></table></div>{rows.length > PAGE_SIZE && <div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span>Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}</span><div className="flex items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page === pages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Next</button></div></div>}</div>;
}

function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>{children}</label>; }
function ReadOnlyValue({ value }) { return <input className="w-full rounded-lg border bg-slate-100 p-2.5 font-bold" value={value} readOnly />; }
function SummaryCard({ title, value }) { return <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-sm text-gray-500">{title}</div><div className="text-2xl font-bold">{value}</div></div>; }
function Th({ children, right }) { return <th className={`whitespace-nowrap p-3 ${right ? "text-right" : "text-left"}`}>{children}</th>; }
function Td({ children, right, bold, className = "" }) { return <td className={`whitespace-nowrap p-3 ${right ? "text-right" : "text-left"} ${bold ? "font-bold" : ""} ${className}`}>{children}</td>; }
function StatusBadge({ value }) { const status = String(value || "").toUpperCase(); const style = status === "APPROVED" || status === "PAID" ? "bg-green-100 text-green-700" : status === "PENDING" || status.includes("PART") ? "bg-amber-100 text-amber-700" : status === "REJECTED" || status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"; return <span className={`rounded-full px-2 py-1 text-xs font-bold ${style}`}>{status}</span>; }
function SourceBadge({ legacy }) { return <span className={`rounded-full px-2 py-1 text-xs font-bold ${legacy ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}`}>{legacy ? "Legacy" : "Current"}</span>; }
