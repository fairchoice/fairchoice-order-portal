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
  calculateWeeklyHandoverAmounts,
  filterWeeklyAccountRows,
  getWeeklyPaymentDate,
  getWeeklyPaymentDateKey,
  loadWeeklyAccountPayments,
} from "../../services/weeklyAccountPayments";
import { isOwnerUser } from "../../services/ownerFinancialSecurity";
import { saveHandover, getHandoverHistory } from "../../services/handovers";
import {
  buildCollectorOptions,
  collectorOptionMatchesRow,
  loadWeeklyAccountCollectors,
} from "../../services/weeklyAccountCollectors";
import {
  approvedExpenseTotalForCollector,
  loadWeeklyApprovedCashExpenseTotals,
} from "../../services/weeklyAccountExpenseTotals";
import {
  filterAndSortApprovedExpenseDetails,
  loadWeeklyApprovedCashExpenseDetails,
  sumApprovedExpenseDetails,
} from "../../services/weeklyAccountExpenseDetails";

const PAGE_SIZE = 30;
const PAYMENT_SEARCH_FIELDS = [
  "customer_name",
  "invoice_no",
  "order_number",
  "payment_reference",
  "reference_no",
  "collector_name",
  "driver_name",
  "sales_rep_name",
  "collected_by",
  "who_paid",
  "paid_by",
  "payment_type",
  "payment_method",
  "branch_name",
  "status",
  "verification_status",
  "collection_type",
  "collector_role",
  "source",
];
const CASH_HOLDING_SEARCH_FIELDS = ["collectorType", "collectorName"];
const HANDOVER_SEARCH_FIELDS = [
  "collector_type",
  "collector_name",
  "reason",
];
const UNPAID_SEARCH_FIELDS = [
  "customer_name",
  "invoice_no",
  "order_number",
  "reference_no",
  "driver_name",
  "name",
  "sales_rep_name",
  "collected_by",
  "payment_type",
  "payment_method",
  "branch_name",
  "invoice_status",
];
const normalize = (value) => String(value || "").trim().toLowerCase();
const isCashPayment = (row) => normalize(row.payment_type || row.payment_method) === "cash";
const isCreditSelection = (row = {}) => {
  const type = normalize(row.payment_type || row.payment_method || row.metadata?.payment_type || row.metadata?.payment_method);
  return type === "credit";
};
const weeklyInvoiceKey = (row = {}) => String(row.invoice_no || row.order_number || row.order_id || row.invoice_reference || row.id || "");
const invoiceTotalValue = (row = {}) => Number(row.invoice_total || row.order_total || row.total_amount || row.invoice_amount || row.amount || 0);
const paymentAmount = (row) => Number(row.payment_amount ?? row.amount ?? row.credit ?? 0);
const NON_COLLECTION_PAYMENT_MARKERS = [
  "credit",
  "return credit",
  "credit note",
  "refund",
  "reversal",
  "reversed",
  "void",
  "voided",
];
const INACTIVE_COLLECTION_STATUS_MARKERS = [
  "pending",
  "pending_verification",
  "pending verification",
  "rejected",
  "voided",
  "reversed",
  "archived",
  "deleted",
  "inactive",
  "cancelled",
];
const isGenuineIncomingPayment = (row = {}) => {
  if (paymentAmount(row) <= 0) return false;

  const paymentType = normalize(
    row.payment_type || row.payment_method || row.metadata?.payment_type || row.metadata?.payment_method,
  );
  const transactionType = normalize(row.transaction_type || row.entry_type);
  const lifecycleStatus = normalize(row.payment_status || row.status);
  const verificationStatus = normalize(row.verification_status);

  if (
    INACTIVE_COLLECTION_STATUS_MARKERS.includes(lifecycleStatus) ||
    INACTIVE_COLLECTION_STATUS_MARKERS.includes(verificationStatus)
  ) {
    return false;
  }

  if (NON_COLLECTION_PAYMENT_MARKERS.some((marker) => paymentType === marker || paymentType.includes(marker))) {
    return false;
  }

  if (["refund", "return credit", "reversal", "void"].some((marker) => transactionType.includes(marker))) {
    return false;
  }

  return true;
};
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
export default function WeeklyAccount({ currentUser }) {
  const canViewTotalCollection = isOwnerUser(currentUser);
  const [activeTab, setActiveTab] = useState("total");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [searchByTab, setSearchByTab] = useState({});
  const [payments, setPayments] = useState([]);
  const [unpaidInvoices, setUnpaidInvoices] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [collectorIdentities, setCollectorIdentities] = useState([]);
  const [handoverHistory, setHandoverHistory] = useState([]);
  const [approvedExpenseTotals, setApprovedExpenseTotals] = useState([]);
  const [approvedExpenseDetails, setApprovedExpenseDetails] = useState([]);
  const [approvedExpenseDetailsLoading, setApprovedExpenseDetailsLoading] = useState(false);
  const [approvedExpenseDetailsError, setApprovedExpenseDetailsError] = useState("");
  const [approvedExpensesExpanded, setApprovedExpensesExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [collectorType, setCollectorType] = useState("Driver");
  const [collectorSelection, setCollectorSelection] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [handoverReason, setHandoverReason] = useState("");
  const [handoverDate, setHandoverDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingHandover, setSavingHandover] = useState(false);

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
        loadWeeklyApprovedCashExpenseTotals(currentUser || getLoggedInUser()),
        loadWeeklyAccountCollectors(currentUser || getLoggedInUser()),
      ]);

      const valueAt = (index, fallback) =>
        results[index].status === "fulfilled" ? results[index].value : fallback;
      const paymentsData = valueAt(0, []);
      const driverResult = valueAt(1, { data: [], error: null });
      const invoiceResult = valueAt(2, { data: [], error: null });
      const queueOrders = valueAt(3, []);
      const history = valueAt(4, []);
      const expenseTotals = valueAt(5, []);
      const identities = valueAt(6, []);

      if (results[0].status === "rejected") throw results[0].reason;
      if (driverResult.error) console.warn("Could not load drivers:", driverResult.error);
      if (invoiceResult.error) console.warn("Could not load outstanding invoices:", invoiceResult.error);
      if (results[4].status === "rejected") console.warn("Could not load handovers:", results[4].reason);
      if (results[5].status === "rejected") throw results[5].reason;
      if (results[6].status === "rejected") throw results[6].reason;

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

      // A Cash Collection choice of Credit means no money was collected. Keep it
      // visible in Customers Didn’t Pay even if the collection workflow wrote a
      // payment-shaped compatibility row. Do not count it in cash collection.
      const creditSelections = (paymentsData || []).filter((row) => {
        if (!isCreditSelection(row)) return false;
        const eventDate = getWeeklyPaymentDate(row) || row.created_at || row.updated_at;
        return eventDate && new Date(eventDate) >= weekStart;
      });
      const unpaidByInvoice = new Map(merged.map((row) => [weeklyInvoiceKey(row), row]));
      creditSelections.forEach((row) => {
        const key = weeklyInvoiceKey(row);
        if (!key) return;
        const existing = unpaidByInvoice.get(key);
        if (existing) {
          unpaidByInvoice.set(key, {
            ...existing,
            credit_selected_at: getWeeklyPaymentDate(row) || row.created_at || null,
            credit_selected_by: collectorNameFor(row) || row.who_paid || row.paid_by || "",
            credit_selected: true,
          });
          return;
        }
        const total = invoiceTotalValue(row);
        if (total <= 0) return;
        unpaidByInvoice.set(key, {
          ...row,
          entry_type: "INVOICE",
          invoice_status: "CREDIT / UNPAID",
          payment_amount: 0,
          paid_amount: 0,
          invoice_total: total,
          delivered_at: row.delivered_at || getWeeklyPaymentDate(row) || row.created_at,
          credit_selected_at: getWeeklyPaymentDate(row) || row.created_at || null,
          credit_selected_by: collectorNameFor(row) || row.who_paid || row.paid_by || "",
          credit_selected: true,
        });
      });

      setPayments(
        (paymentsData || []).filter(
          (row) => canViewTotalCollection || !isRestrictedCreditRecord(row),
        ),
      );
      setDrivers(driverResult.data || []);
      setUnpaidInvoices([...unpaidByInvoice.values()]);
      setHandoverHistory(history || []);
      setApprovedExpenseTotals(expenseTotals || []);
      setCollectorIdentities(identities || []);
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

  const collectionPayments = useMemo(
    () => filteredPayments.filter(isGenuineIncomingPayment),
    [filteredPayments],
  );

  const driverPayments = useMemo(
    () => collectionPayments.filter((row) => collectorTypeFor(row) === "Driver"),
    [collectionPayments],
  );
  const salesRepPayments = useMemo(
    () => collectionPayments.filter((row) => collectorTypeFor(row) === "Sales Rep"),
    [collectionPayments],
  );

  const collectorOptions = useMemo(
    () =>
      buildCollectorOptions(collectorIdentities, [
        ...drivers.map((driver) => ({
          ...driver,
          collector_type: "Driver",
          collector_name: driver.name || driver.full_name || driver.driverName,
        })),
        ...payments,
        ...approvedExpenseTotals,
        ...handoverHistory,
      ]),
    [
      collectorIdentities,
      drivers,
      payments,
      approvedExpenseTotals,
      handoverHistory,
    ],
  );
  const resolveCollectorOptionForRow = (row) => {
    const type = collectorTypeFor(row);
    const sameTypeOptions = collectorOptions.filter((option) => option.type === type);
    const strictMatch = sameTypeOptions.find((option) =>
      collectorOptionMatchesRow(option, row),
    );
    if (strictMatch) return strictMatch;

    const rowName = normalize(collectorNameFor(row));
    if (!rowName) return null;

    return (
      sameTypeOptions.find((option) =>
        [
          option.username,
          option.staffName,
          option.nameSnapshot,
          ...(option.aliases || []),
        ]
          .map(normalize)
          .filter(Boolean)
          .includes(rowName),
      ) || null
    );
  };

  const handoverCollectorMatchesRow = (option, row) => {
    if (!option || collectorTypeFor(row) !== option.type) return false;
    if (collectorOptionMatchesRow(option, row)) return true;

    const rowName = normalize(collectorNameFor(row));
    if (!rowName) return false;

    return [
      option.username,
      option.staffName,
      option.nameSnapshot,
      ...(option.aliases || []),
    ]
      .map(normalize)
      .filter(Boolean)
      .includes(rowName);
  };

  const optionsByType = useMemo(() => {
    const buildOptions = (type, rows) => {
      const options = new Map(
        collectorOptions
          .filter((option) => option.type === type)
          .map((option) => [option.value, option]),
      );

      rows
        .filter((row) => collectorTypeFor(row) === type)
        .forEach((row) => {
          const resolved = resolveCollectorOptionForRow(row);
          if (resolved) {
            options.set(resolved.value, resolved);
            return;
          }

          const name = collectorNameFor(row);
          const normalizedName = normalize(name);
          if (!normalizedName) return;
          const value = `legacy:${type}:${normalizedName}`;
          if (!options.has(value)) {
            options.set(value, {
              value,
              staffId: "",
              type,
              username: "",
              staffName: "",
              nameSnapshot: name,
              label: name,
              aliases: [normalizedName],
              legacy: true,
            });
          }
        });

      return [...options.values()].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );
    };

    return {
      Driver: buildOptions("Driver", driverPayments),
      "Sales Rep": buildOptions("Sales Rep", salesRepPayments),
    };
  }, [collectorOptions, driverPayments, salesRepPayments]);
  const selectedCollector = useMemo(
    () =>
      optionsByType[collectorType].find(
        (option) => option.value === collectorSelection,
      ) || null,
    [optionsByType, collectorType, collectorSelection],
  );
  const collectorName = selectedCollector?.nameSnapshot || "";
  const collectorStaffId = selectedCollector?.staffId || null;

  useEffect(() => {
    let cancelled = false;

    async function loadApprovedExpenseDetails() {
      await Promise.resolve();
      if (cancelled) return;

      setApprovedExpenseDetails([]);
      setApprovedExpenseDetailsError("");
      if (!collectorStaffId) {
        setApprovedExpenseDetailsLoading(false);
        return;
      }

      setApprovedExpenseDetailsLoading(true);
      try {
        const rows = await loadWeeklyApprovedCashExpenseDetails(
          currentUser || getLoggedInUser(),
          {
            collectorStaffId,
            periodStart: startDate || null,
            periodEnd: endDate || null,
          },
        );
        if (!cancelled) setApprovedExpenseDetails(rows);
      } catch (err) {
        if (!cancelled) {
          setApprovedExpenseDetailsError(
            err.message || "Could not load approved expense details.",
          );
        }
      } finally {
        if (!cancelled) setApprovedExpenseDetailsLoading(false);
      }
    }

    loadApprovedExpenseDetails();

    return () => {
      cancelled = true;
    };
  }, [collectorStaffId, currentUser, endDate, startDate]);

  const totalsByCollector = (rows) => {
    const totals = new Map();

    rows.forEach((row) => {
      const matchedOption = collectorOptions.find((option) =>
        collectorOptionMatchesRow(option, row),
      );
      const fallbackName = collectorNameFor(row) || "Unassigned";
      const label = matchedOption?.label || fallbackName;
      totals.set(label, (totals.get(label) || 0) + paymentAmount(row));
    });

    return [...totals.entries()]
      .filter(([, total]) => total !== 0)
      .sort((left, right) => right[1] - left[1]);
  };

  const cashHoldingRows = useMemo(() => {
    return collectorOptions.map((option) => {
      const matchingCash = collectionPayments.filter(
        (row) =>
          isCashPayment(row) &&
          collectorOptionMatchesRow(option, row),
      );
      const collected = matchingCash.reduce((sum, row) => sum + paymentAmount(row), 0);
      const expenseTotal = approvedExpenseTotalForCollector(
        approvedExpenseTotals,
        option,
      );
      const handedOver = handoverHistory
        .filter((row) => collectorOptionMatchesRow(option, row))
        .reduce((sum, row) => sum + Number(row.cash_received || 0), 0);
      const lastHandover = handoverHistory
        .filter((row) => collectorOptionMatchesRow(option, row))
        .sort((a, b) => new Date(b.created_at || b.handover_date) - new Date(a.created_at || a.handover_date))[0];
      const lastCollection = matchingCash
        .slice()
        .sort((a, b) => new Date(getWeeklyPaymentDate(b) || 0) - new Date(getWeeklyPaymentDate(a) || 0))[0];
      const holding = collected - expenseTotal - handedOver;
      const anchor = lastCollection ? new Date(getWeeklyPaymentDate(lastCollection)) : null;
      return {
        key: option.value,
        collectorType: option.type,
        collectorName: option.label,
        collected,
        expenses: expenseTotal,
        handedOver,
        holding,
        lastHandoverDate: lastHandover?.created_at || lastHandover?.handover_date,
        daysHolding: anchor ? Math.max(0, Math.floor((Date.now() - anchor.getTime()) / 86400000)) : 0,
      };
    }).sort((a, b) => b.holding - a.holding);
  }, [collectorOptions, collectionPayments, approvedExpenseTotals, handoverHistory]);

  const lastCollectorHandover = useMemo(
    () =>
      handoverHistory
        .filter(
          (row) =>
            handoverCollectorMatchesRow(selectedCollector, row),
        )
        .sort((a, b) => new Date(b.period_end || b.created_at) - new Date(a.period_end || a.created_at))[0],
    [handoverHistory, selectedCollector],
  );

  const handoverPeriodStart = useMemo(() => {
    if (lastCollectorHandover) return new Date(lastCollectorHandover.period_end || lastCollectorHandover.created_at);
    return new Date(0);
  }, [lastCollectorHandover]);
  const handoverPeriodEnd = new Date();
  const selectedCashCollected = collectionPayments
    .filter(
      (row) =>
        isCashPayment(row) &&
        handoverCollectorMatchesRow(selectedCollector, row),
    )
    .reduce((sum, row) => sum + paymentAmount(row), 0);
  const approvedExpenseDetailTotal = sumApprovedExpenseDetails(
    approvedExpenseDetails,
  );
  const selectedApprovedExpenses = approvedExpenseDetailTotal;
  const selectedCashHandedOver = handoverHistory
    .filter(
      (row) =>
        handoverCollectorMatchesRow(selectedCollector, row) &&
        dateInRange(row.handover_date || row.created_at, startDate, endDate),
    )
    .reduce((sum, row) => sum + Number(row.cash_received || 0), 0);
  const approvedExpenseTotalMismatch =
    Math.abs(
      Number(selectedApprovedExpenses || 0) -
        Number(approvedExpenseDetailTotal || 0),
    ) > 0.009;
  const {
    amountDue: selectedAmountDue,
    difference: handoverDifference,
  } = calculateWeeklyHandoverAmounts({
    cashCollected: selectedCashCollected,
    approvedExpenses: selectedApprovedExpenses,
    cashHandedOver: selectedCashHandedOver,
    cashReceived,
  });

  async function handleSaveHandover() {
    if (!selectedCollector) return alert(`Please select ${collectorType}.`);
    if (approvedExpenseDetailsLoading) return alert("Please wait for approved expenses to finish loading.");
    if (approvedExpenseDetailsError) return alert("Approved expenses could not be verified. Refresh and try again.");
    if (!(Number(cashReceived) >= 0)) return alert("Please enter the cash received.");
    if (Math.abs(handoverDifference) > 0.009 && !handoverReason.trim()) {
      return alert("Please explain the handover difference.");
    }
    const confirmed = window.confirm(
      `Save handover for ${collectorName}?\n\nCash collected: ${money(selectedCashCollected)}\nApproved expenses: ${money(selectedApprovedExpenses)}\nAlready handed over: ${money(selectedCashHandedOver)}\nBalance due: ${money(selectedAmountDue)}\nCash received: ${money(cashReceived)}\nDifference: ${money(handoverDifference)}`,
    );
    if (!confirmed) return;

    setSavingHandover(true);
    try {
      await saveHandover({
        collectorStaffId,
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

  const tabs = [
    [
      "total",
      canViewTotalCollection ? "Total Collection" : "Payment Reconciliation",
    ],
    ["driver", "Driver Collection"],
    ["salesrep", "Sales Rep Collection"],
    ["holding", "Cash Holding"],
    ["handover", "Driver / Sales Rep Handover"],
    ["unpaid", "Customers Didn’t Pay"],
  ];

  const filteredHandovers = handoverHistory.filter((row) =>
    dateInRange(row.handover_date || row.created_at, startDate, endDate),
  );
  const filteredUnpaid = unpaidInvoices.filter((row) =>
    dateInRange(row.delivered_at || row.created_at, startDate, endDate),
  );
  const activeSearch = searchByTab[activeTab] || "";
  const searchedPayments = filterWeeklyAccountRows(
    collectionPayments,
    searchByTab.total,
    PAYMENT_SEARCH_FIELDS,
  );
  const searchedDriverPayments = filterWeeklyAccountRows(
    driverPayments,
    searchByTab.driver,
    PAYMENT_SEARCH_FIELDS,
  );
  const searchedSalesRepPayments = filterWeeklyAccountRows(
    salesRepPayments,
    searchByTab.salesrep,
    PAYMENT_SEARCH_FIELDS,
  );
  const searchedCashHoldingRows = filterWeeklyAccountRows(
    cashHoldingRows,
    searchByTab.holding,
    CASH_HOLDING_SEARCH_FIELDS,
  );
  const searchedHandovers = filterWeeklyAccountRows(
    filteredHandovers,
    searchByTab.handover,
    HANDOVER_SEARCH_FIELDS,
  );
  const searchedUnpaid = filterWeeklyAccountRows(
    filteredUnpaid,
    searchByTab.unpaid,
    UNPAID_SEARCH_FIELDS,
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

      <div className="flex flex-wrap items-end gap-2">
        <Field label={`Search ${tabs.find(([key]) => key === activeTab)?.[1] || "Weekly Account"}`}>
          <input
            type="search"
            value={activeSearch}
            onChange={(event) =>
              setSearchByTab((current) => ({
                ...current,
                [activeTab]: event.target.value,
              }))
            }
            placeholder="Search visible records..."
            className="w-full min-w-64 rounded-lg border px-3 py-2 sm:w-80"
          />
        </Field>
        {activeSearch && (
          <button
            type="button"
            onClick={() =>
              setSearchByTab((current) => ({ ...current, [activeTab]: "" }))
            }
            className="rounded-lg bg-slate-600 px-4 py-2 font-bold text-white"
          >
            Clear Search
          </button>
        )}
      </div>

      {activeTab === "total" && (
        <CollectionSection
          rows={searchedPayments}
          showSummary={canViewTotalCollection}
          money={money}
          formatDate={formatDate}
        />
      )}
      {activeTab === "driver" && <CollectorCollectionSection rows={searchedDriverPayments} title="Driver Collection" showSummary={canViewTotalCollection} money={money} formatDate={formatDate} totals={totalsByCollector(searchedDriverPayments)} />}
      {activeTab === "salesrep" && <CollectorCollectionSection rows={searchedSalesRepPayments} title="Sales Rep Collection" showSummary={canViewTotalCollection} money={money} formatDate={formatDate} totals={totalsByCollector(searchedSalesRepPayments)} />}

      {activeTab === "holding" && (
        <PaginatedTable rows={searchedCashHoldingRows} empty="No staff cash holding found." renderHeader={() => <tr className="bg-blue-700 text-white"><Th>Type</Th><Th>Collector</Th><Th right>Cash Collected</Th><Th right>Approved Expenses</Th><Th right>Handed Over</Th><Th right>Amount Due</Th><Th>Last Handover</Th><Th right>Days Holding</Th></tr>} renderRow={(row) => <tr key={row.key} className="border-b"><Td>{row.collectorType}</Td><Td bold>{row.collectorName}</Td><Td right>{money(row.collected)}</Td><Td right>{money(row.expenses)}</Td><Td right>{money(row.handedOver)}</Td><Td right bold className={row.holding > 0 ? "text-red-600" : "text-green-600"}>{money(row.holding)}</Td><Td>{formatDate(row.lastHandoverDate)}</Td><Td right>{row.daysHolding}</Td></tr>} />
      )}

      {activeTab === "handover" && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4 shadow-sm space-y-3">
            <h2 className="text-lg font-bold">Driver / Sales Rep Handover</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <Field label="Collector Type"><select className="w-full rounded-lg border p-2.5" value={collectorType} onChange={(e) => { setCollectorType(e.target.value); setCollectorSelection(""); setApprovedExpensesExpanded(false); }}><option>Driver</option><option>Sales Rep</option></select></Field>
              <Field label="Collector Name"><select className="w-full rounded-lg border p-2.5" value={collectorSelection} onChange={(e) => { setCollectorSelection(e.target.value); setApprovedExpensesExpanded(false); }}><option value="">Select</option>{optionsByType[collectorType].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
              <Field label="Handover Date"><input type="date" className="w-full rounded-lg border p-2.5" value={handoverDate} onChange={(e) => setHandoverDate(e.target.value)} /></Field>
              <Field label="Cash Collected"><ReadOnlyValue value={money(selectedCashCollected)} /></Field>
              <ApprovedExpensesToggle
                expanded={approvedExpensesExpanded}
                loading={approvedExpenseDetailsLoading}
                total={selectedApprovedExpenses}
                money={money}
                onToggle={() => setApprovedExpensesExpanded((value) => !value)}
              />
              <Field label="Handed Over"><ReadOnlyValue value={money(selectedCashHandedOver)} /></Field>
              <Field label="Balance Due"><ReadOnlyValue value={money(selectedAmountDue)} /></Field>
              <Field label="Cash Received"><input min="0" step="0.01" type="number" className="w-full rounded-lg border p-2.5" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} /></Field>
              <Field label="Difference"><ReadOnlyValue value={money(handoverDifference)} /></Field>
            </div>
            {approvedExpensesExpanded && (
              <ApprovedExpenseDetails
                rows={approvedExpenseDetails}
                loading={approvedExpenseDetailsLoading}
                error={approvedExpenseDetailsError}
                total={approvedExpenseDetailTotal}
                mismatch={approvedExpenseTotalMismatch}
                money={money}
                formatDate={formatDate}
                formatDateTime={formatDateTime}
              />
            )}
            <Field label="Reason (required when different)"><textarea className="w-full rounded-lg border p-2.5" value={handoverReason} onChange={(e) => setHandoverReason(e.target.value)} /></Field>
            <button type="button" onClick={handleSaveHandover} disabled={savingHandover || approvedExpenseDetailsLoading || Boolean(approvedExpenseDetailsError)} className="rounded-lg bg-green-600 px-5 py-2.5 font-bold text-white disabled:opacity-50">{savingHandover ? "Saving..." : "Save Handover"}</button>
          </div>
          <HandoverTable rows={searchedHandovers} money={money} formatDateTime={formatDateTime} />
        </div>
      )}

      {activeTab === "unpaid" && <OutstandingTable rows={searchedUnpaid} money={money} formatDate={formatDate} />}
    </div>
  );
}

function CollectionSection({ rows, showSummary, money, formatDate }) {
  const total = rows.reduce((sum, row) => sum + paymentAmount(row), 0);
  const paymentCount = new Set(rows.map((row) => row.canonical_payment_key || row.id)).size;
  const totalsByType = ["Driver", "Sales Rep", "Office"].map((type) => [
    type,
    rows
      .filter((row) => collectorTypeFor(row) === type)
      .reduce((sum, row) => sum + paymentAmount(row), 0),
  ]);

  return (
    <>
      {showSummary && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SummaryCard title="Paid Customers" value={new Set(rows.map((row) => row.customer_name)).size} />
            <SummaryCard title="Payments" value={paymentCount} />
            <SummaryCard title="Total Collection" value={money(total)} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {totalsByType.map(([type, amount]) => (
              <MiniSummaryCard key={type} title={`${type} Collection`} value={money(amount)} />
            ))}
          </div>
        </div>
      )}
      <PaymentTable rows={rows} money={money} formatDate={formatDate} />
    </>
  );
}

function CollectorCollectionSection({ rows, totals, title, showSummary, money, formatDate }) {
  const [showCollectorTotals, setShowCollectorTotals] = useState(true);

  return (
    <>
      {showSummary && (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowCollectorTotals((value) => !value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              {showCollectorTotals ? "Hide collector totals" : "View collector totals"}
            </button>
          </div>
          {showCollectorTotals && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {totals.map(([name, total]) => (
                <CompactCollectorCard key={name} title={name} value={money(total)} />
              ))}
              {totals.length === 0 && <CompactCollectorCard title={title} value={money(0)} />}
            </div>
          )}
        </div>
      )}
      <PaymentTable rows={rows} money={money} formatDate={formatDate} />
    </>
  );
}

function PaymentTable({ rows, money, formatDate }) {
  const invoiceTotal = (row) => Number(row.invoice_total || row.order_total || row.total_amount || row.invoice_amount || 0);
  const balance = (row) =>
    Number.isFinite(Number(row.running_balance))
      ? Number(row.running_balance)
      : Math.max(0, invoiceTotal(row) - paymentAmount(row));
  return <PaginatedTable rows={rows} empty="No payment records found." renderHeader={() => <tr className="bg-gray-100 text-left"><Th>Customer</Th><Th>Order No</Th><Th right>Invoice Total</Th><Th right>Paid Amount</Th><Th right>Balance</Th><Th>Payment Date</Th><Th>Payment Type</Th><Th>Who Paid</Th><Th>Collected By</Th><Th>Collection Type</Th><Th>Source</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-t"><Td>{row.customer_name || "-"}</Td><Td>{formatDisplayOrderId(row.invoice_no || row.order_number)}</Td><Td right>{money(invoiceTotal(row))}</Td><Td right>{money(paymentAmount(row))}</Td><Td right>{money(balance(row))}</Td><Td>{formatDate(getWeeklyPaymentDate(row))}</Td><Td>{row.payment_type || row.payment_method || "-"}</Td><Td>{row.who_paid || row.paid_by || "-"}</Td><Td bold>{collectorNameFor(row) || "-"}</Td><Td>{collectorTypeFor(row)}</Td><Td><SourceBadge legacy={row.is_legacy} /></Td></tr>} />;
}

function HandoverTable({ rows, money, formatDateTime }) {
  return <PaginatedTable rows={rows} empty="No handover history found." renderHeader={() => <tr className="bg-blue-700 text-white"><Th>Date</Th><Th>Type</Th><Th>Collector</Th><Th right>Amount Due</Th><Th right>Cash Received</Th><Th right>Difference</Th><Th>Reason</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-b"><Td>{formatDateTime(row.created_at || row.handover_date)}</Td><Td>{row.collector_type}</Td><Td bold>{row.collector_name}</Td><Td right>{money(row.system_collection)}</Td><Td right>{money(row.cash_received)}</Td><Td right bold className={Number(row.difference) < 0 ? "text-red-600" : Number(row.difference) > 0 ? "text-green-600" : ""}>{money(row.difference)}</Td><Td>{row.reason || "-"}</Td></tr>} />;
}

function OutstandingTable({ rows, money, formatDate }) {
  const invoiceTotal = (row) => Number(row.invoice_total || row.order_total || row.total_amount || row.invoice_amount || row.amount || 0);
  const collected = (row) => Number(row.payment_amount || row.paid_amount || 0);
  const outstanding = (row) => Math.max(0, invoiceTotal(row) - collected(row));
  const outstandingValue = rows.reduce((sum, row) => sum + outstanding(row), 0);
  return <><div className="grid grid-cols-1 gap-3 md:grid-cols-3"><SummaryCard title="Unpaid Customers" value={new Set(rows.map((row) => row.customer_name)).size} /><SummaryCard title="Outstanding Invoices" value={rows.length} /><SummaryCard title="Outstanding Value" value={money(outstandingValue)} /></div><PaginatedTable rows={rows} empty="No delivered credit invoices are outstanding." renderHeader={() => <tr className="bg-gray-100"><Th>Customer</Th><Th>Order No</Th><Th>Delivery Date</Th><Th right>Invoice Total</Th><Th right>Collected</Th><Th right>Outstanding</Th><Th>Driver / Sales Rep</Th><Th>Credit Selected</Th><Th>Status</Th></tr>} renderRow={(row) => <tr key={row.id} className="border-t"><Td>{row.customer_name || "-"}</Td><Td>{formatDisplayOrderId(row.invoice_no || row.order_number)}</Td><Td>{formatDate(row.delivered_at || row.created_at)}</Td><Td right>{money(invoiceTotal(row))}</Td><Td right>{money(collected(row))}</Td><Td right bold className="text-red-600">{money(outstanding(row))}</Td><Td>{row.driver_name || row.name || row.sales_rep_name || row.collected_by || row.credit_selected_by || "-"}</Td><Td>{row.credit_selected ? `Yes${row.credit_selected_at ? ` · ${formatDate(row.credit_selected_at)}` : ""}` : "—"}</Td><Td><StatusBadge value={row.invoice_status || "OUTSTANDING"} /></Td></tr>} /></>;
}

function PaginatedTable({ rows, renderHeader, renderRow, empty }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(1), [rows]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return <div className="overflow-hidden rounded-xl border bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full text-sm"><thead>{renderHeader()}</thead><tbody>{visible.map(renderRow)}{rows.length === 0 && <tr><td colSpan="20" className="p-6 text-center text-gray-500">{empty}</td></tr>}</tbody></table></div>{rows.length > PAGE_SIZE && <div className="flex items-center justify-between border-t px-4 py-3 text-sm"><span>Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, rows.length)} of {rows.length}</span><div className="flex items-center gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Previous</button><span>Page {page} of {pages}</span><button type="button" disabled={page === pages} onClick={() => setPage((value) => value + 1)} className="rounded border px-3 py-1.5 font-bold disabled:opacity-40">Next</button></div></div>}</div>;
}

function ApprovedExpensesToggle({ expanded, loading, total, money, onToggle }) {
  return <div className="block"><span className="mb-1 block text-xs font-bold text-slate-600">Approved Expenses</span><button type="button" aria-expanded={expanded} onClick={onToggle} className="flex w-full items-center justify-between rounded-lg border bg-blue-50 p-2.5 text-left font-bold text-blue-800 hover:bg-blue-100"><span>{loading ? "Loading approved expenses..." : `Approved Expenses (${money(total)})`}</span><span aria-hidden="true">{expanded ? "▲" : "▼"}</span></button></div>;
}

function ApprovedExpenseDetails({ rows, loading, error, total, mismatch, money, formatDate, formatDateTime }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDirection, setSortDirection] = useState("desc");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [expandedRowId, setExpandedRowId] = useState(null);
  const filteredRows = filterAndSortApprovedExpenseDetails(rows, {
    search,
    sortKey,
    sortDirection,
  });
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const activePage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice(
    (activePage - 1) * pageSize,
    activePage * pageSize,
  );
  const toggleSort = (key) => {
    setSortDirection((direction) =>
      sortKey === key && direction === "asc" ? "desc" : "asc",
    );
    setSortKey(key);
    setPage(1);
  };
  const sortMarker = (key) =>
    sortKey === key ? (sortDirection === "asc" ? " ▲" : " ▼") : "";

  return (
    <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4" aria-label="Approved expense details">
      {loading && <div className="text-sm text-slate-600">Loading approved expenses...</div>}
      {error && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
      {!loading && !error && rows.length === 0 && <div className="text-sm text-slate-600">No approved expenses</div>}
      {!loading && !error && rows.length > 0 && (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="min-w-64 flex-1 text-xs font-bold text-slate-600">
              Search approved expenses
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Reference, supplier, type or approved by"
                className="mt-1 w-full rounded-lg border bg-white p-2.5 text-sm font-normal text-slate-900"
              />
            </label>
            <label className="text-xs font-bold text-slate-600">
              Rows
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="mt-1 block rounded-lg border bg-white p-2.5 text-sm font-normal text-slate-900"
              >
                {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
            </label>
          </div>
          <div className="max-h-96 overflow-auto rounded-lg border bg-white">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="sticky top-0 z-10 bg-blue-700 text-white shadow-sm">
                <tr>
                  <ExpenseSortHeader label="Date" sortKey="date" marker={sortMarker("date")} onSort={toggleSort} />
                  <th className="p-2 text-left">Reference</th>
                  <ExpenseSortHeader label="Amount" sortKey="amount" marker={sortMarker("amount")} onSort={toggleSort} right />
                  <ExpenseSortHeader label="Type" sortKey="type" marker={sortMarker("type")} onSort={toggleSort} />
                  <ExpenseSortHeader label="Supplier" sortKey="supplier" marker={sortMarker("supplier")} onSort={toggleSort} />
                  <th className="p-2 text-left">Method</th>
                  <th className="p-2 text-left">Approved</th>
                  <th className="p-2 text-left">Approved By</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const rowId = row.weekly_effect_id || row.business_payout_id;
                  const expanded = expandedRowId === rowId;
                  return (
                    <ApprovedExpenseTableRow
                      key={rowId}
                      row={row}
                      expanded={expanded}
                      money={money}
                      formatDate={formatDate}
                      formatDateTime={formatDateTime}
                      onToggle={() => setExpandedRowId(expanded ? null : rowId)}
                    />
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr><td colSpan="8" className="p-6 text-center text-slate-500">No approved expenses match the search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>Showing {filteredRows.length === 0 ? 0 : (activePage - 1) * pageSize + 1}-{Math.min(activePage * pageSize, filteredRows.length)} of {filteredRows.length}</span>
            <div className="flex items-center gap-2">
              <button type="button" disabled={activePage === 1} onClick={() => setPage(activePage - 1)} className="rounded border bg-white px-3 py-1.5 font-bold disabled:opacity-40">Previous</button>
              <span>Page {activePage} of {pageCount}</span>
              <button type="button" disabled={activePage === pageCount} onClick={() => setPage(activePage + 1)} className="rounded border bg-white px-3 py-1.5 font-bold disabled:opacity-40">Next</button>
            </div>
          </div>
        </>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-blue-200 pt-3 font-bold">
        <span>Approved Expense Count: {rows.length}</span>
        <span>Total Approved Expenses: {money(total)}</span>
      </div>
      {mismatch && <div className="mt-3 rounded border border-red-400 bg-red-50 p-3 text-sm font-bold text-red-700">Warning: the approved-expense detail total does not match the handover summary.</div>}
    </section>
  );
}

function ExpenseSortHeader({ label, sortKey, marker, onSort, right = false }) {
  return <th className={`p-0 ${right ? "text-right" : "text-left"}`}><button type="button" onClick={() => onSort(sortKey)} className={`w-full whitespace-nowrap p-2 font-bold hover:bg-blue-800 ${right ? "text-right" : "text-left"}`}>{label}{marker}</button></th>;
}

function ApprovedExpenseTableRow({ row, expanded, money, formatDate, formatDateTime, onToggle }) {
  return <><tr className={`border-t hover:bg-blue-50 ${row.is_legacy_compatibility ? "bg-amber-50" : ""}`}><td className="whitespace-nowrap p-2">{formatDate(row.payout_date)}</td><td className="whitespace-nowrap p-2"><button type="button" aria-expanded={expanded} onClick={onToggle} className="font-bold text-blue-700 hover:underline">{row.payout_reference || "Legacy entry"} {expanded ? "▲" : "▼"}</button>{row.is_legacy_compatibility && <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-bold text-amber-900">Legacy</span>}</td><td className="whitespace-nowrap p-2 text-right font-bold">{money(row.amount)}</td><td className="whitespace-nowrap p-2">{row.expense_type_name || "Not recorded"}</td><td className="whitespace-nowrap p-2">{row.supplier_name || "Not applicable"}</td><td className="whitespace-nowrap p-2">{row.payment_method || "Not recorded"}</td><td className="whitespace-nowrap p-2">{formatDateTime(row.approved_at)}</td><td className="whitespace-nowrap p-2">{row.approved_by_name || "Not recorded"}</td></tr>{expanded && <tr className={row.is_legacy_compatibility ? "bg-amber-50" : "bg-slate-50"}><td colSpan="8" className="border-t p-3"><div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2 lg:grid-cols-4"><ExpenseDetail label="Reference" value={row.payout_reference || "Legacy entry"} /><ExpenseDetail label="Supplier" value={row.supplier_name || "Not applicable"} /><ExpenseDetail label="Expense type" value={row.expense_type_name || "Not recorded"} /><ExpenseDetail label="Amount" value={money(row.amount)} /><ExpenseDetail label="Method" value={row.payment_method || "Not recorded"} /><ExpenseDetail label="Paid from" value={row.paid_by_type || "Not recorded"} /><ExpenseDetail label="Description" value={row.description || "Not recorded"} /><ExpenseDetail label="Receipt reference" value={row.receipt_reference || "Not recorded"} /><ExpenseDetail label="Approved by" value={row.approved_by_name || "Not recorded"} /><ExpenseDetail label="Approved date" value={formatDateTime(row.approved_at)} /><ExpenseDetail label="Status" value={row.weekly_effect_status || "Not recorded"} /></div>{row.is_legacy_compatibility && <p className="mt-3 text-xs font-semibold text-amber-800">Legacy compatibility entry: no linked business payout or supplier details are inferred.</p>}</td></tr>}</>;
}

function ExpenseDetail({ label, value }) {
  return <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</div><div className="font-medium text-slate-800">{value}</div></div>;
}

function Field({ label, children }) { return <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>{children}</label>; }
function ReadOnlyValue({ value }) { return <input className="w-full rounded-lg border bg-slate-100 p-2.5 font-bold" value={value} readOnly />; }
function SummaryCard({ title, value }) { return <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-sm text-gray-500">{title}</div><div className="text-2xl font-bold">{value}</div></div>; }
function MiniSummaryCard({ title, value }) { return <div className="rounded-lg border bg-white px-3 py-2 shadow-sm"><div className="text-xs text-gray-500">{title}</div><div className="text-lg font-bold">{value}</div></div>; }
function CompactCollectorCard({ title, value }) { return <div className="min-w-0 rounded-lg border bg-white px-3 py-2 shadow-sm"><div className="truncate text-xs text-gray-500" title={title}>{title}</div><div className="mt-0.5 text-lg font-bold leading-tight">{value}</div></div>; }
function Th({ children, right }) { return <th className={`whitespace-nowrap p-3 ${right ? "text-right" : "text-left"}`}>{children}</th>; }
function Td({ children, right, bold, className = "" }) { return <td className={`whitespace-nowrap p-3 ${right ? "text-right" : "text-left"} ${bold ? "font-bold" : ""} ${className}`}>{children}</td>; }
function StatusBadge({ value }) { const status = String(value || "").toUpperCase(); const style = status === "APPROVED" || status === "PAID" ? "bg-green-100 text-green-700" : status === "PENDING" || status.includes("PART") ? "bg-amber-100 text-amber-700" : status === "REJECTED" || status === "VOIDED" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"; return <span className={`rounded-full px-2 py-1 text-xs font-bold ${style}`}>{status}</span>; }
function SourceBadge({ legacy }) { return <span className={`rounded-full px-2 py-1 text-xs font-bold ${legacy ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"}`}>{legacy ? "Legacy" : "Current"}</span>; }
