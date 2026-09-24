import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import AllCreditOutstanding from "./AllCreditOutstanding";
import {
  amendCustomerCreditPayment,
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
  setCustomerOpeningBalance,
  voidCustomerCreditPayment,
} from "../../services/centralPaymentService";
import { PAYMENT_POSTED_EVENT } from "../../services/canonicalPaymentService";
import {
  FC_PERMISSIONS,
  hasFcPermission,
} from "../../security/fcPermissions";
import { getActiveCustomerBranches } from "../../utils/customerBranchScope";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  canSelectCustomerForCredit,
  hasConfiguredCreditAccount,
  hasCreditSnapshotActivity,
} from "../../utils/customerCreditSelection";
import { getInvoiceActionForStatus } from "../../utils/invoicePaymentStatus";
import { sortTransactionsForDisplay } from "../../utils/customerAccountTransactions";

const PAGE_SIZE = 20;
const BRANCH_SELECT = "__select__";
const MAIN_ACCOUNT = "__main__";

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

const customerMatches = (customer, search) => {
  const text = [
    customer.account_name,
    customer.company_name,
    customer.customer_code,
    ...(customer.customer_branches || []).map((branch) => branch.branch_name),
  ]
    .join(" ")
    .toLowerCase();

  return text.includes(String(search || "").toLowerCase());
};

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getPaymentAmount = (payment = {}) =>
  Math.abs(
    Number(
      firstValue(
        payment.payment_amount,
        payment.credit,
        payment.amount,
        payment.total,
        0
      )
    )
  );

const getDocumentUrl = (record, kind) => {
  if (!record) return "";

  const invoiceCandidates = [
    record.invoice_url,
    record.invoiceUrl,
    record.invoice_pdf_url,
    record.invoicePdfUrl,
    record.pdf_url,
    record.pdfUrl,
    record.download_url,
    record.downloadUrl,
    record.document_url,
    record.documentUrl,
  ];

  const receiptCandidates = [
    record.receipt_url,
    record.receiptUrl,
    record.receipt_pdf_url,
    record.receiptPdfUrl,
    record.pdf_url,
    record.pdfUrl,
    record.download_url,
    record.downloadUrl,
    record.document_url,
    record.documentUrl,
  ];

  return String(
    firstValue(...(kind === "PAYMENT" ? receiptCandidates : invoiceCandidates)) || ""
  );
};

const formatTransactionDate = (row = {}) => {
  if (row.transaction_type === "OPENING_BALANCE" && !row.transactionDate) {
    return "Opening Balance";
  }
  const value = row.transactionDate || row.createdAt;
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const [year, month, day] = String(value).split("-");
    return `${day}/${month}/${year}`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-GB");
};

function StatusBadge({ status }) {
  const normalized = String(status || "UNPAID").replaceAll("_", " ").toUpperCase();
  const className =
    normalized === "PAID" || normalized === "COMPLETED" || normalized === "POSTED"
      ? "bg-green-100 text-green-700"
      : normalized.includes("PARTIAL") || normalized === "PART PAID" || normalized === "PENDING"
      ? "bg-amber-100 text-amber-700"
      : normalized === "VOID" || normalized === "CANCELLED"
      ? "bg-slate-100 text-slate-600"
      : "bg-red-100 text-red-700";

  return (
    <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${className}`}>
      {normalized}
    </span>
  );
}

function DocumentActions({ row, restricted }) {
  if (restricted) return null;

  const url = row.documentUrl;
  if (!url) {
    return <span className="text-xs font-semibold text-slate-400">—</span>;
  }

  const isInvoice = row.type === "INVOICE";
  if (isInvoice) {
    const action = getInvoiceActionForStatus(row.status);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {action === "VIEW" && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-slate-700"
          >
            View Invoice
          </a>
        )}
        {action === "DOWNLOAD" && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          download=""
          className="inline-flex rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-500"
        >
          Download Invoice
        </a>
        )}
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
    >
      Receipt
    </a>
  );
}

export default function CustomerCredit({ readOnly = false, initialView = "individual" }) {
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState(MAIN_ACCOUNT);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectionMessage, setSelectionMessage] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("summary");
  const [creditView, setCreditView] = useState(initialView === "all" ? "all" : "individual");
  const [historySort, setHistorySort] = useState("oldest");
  const [editingOpeningBalance, setEditingOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const [openingBalanceReason, setOpeningBalanceReason] = useState("");
  const [savingOpeningBalance, setSavingOpeningBalance] = useState(false);
  const [paymentRefreshVersion, setPaymentRefreshVersion] = useState(0);
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentForm, setPaymentForm] = useState(null);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentActionError, setPaymentActionError] = useState("");
  const selectionRequestRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const prefetchedSnapshotRef = useRef(null);

  const currentUser = getLoggedInUser();
  const userRole = String(
    currentUser?.role || currentUser?.access_level || ""
  ).toLowerCase();

  const isAdminUser =
    userRole.includes("admin") ||
    currentUser?.permissions?.access_accounts === true;

  const canEditOpeningBalance = hasFcPermission(
    currentUser,
    FC_PERMISSIONS.CUSTOMER_CREDIT_OPENING_BALANCE_EDIT
  );
  const canEditPayments = hasFcPermission(
    currentUser,
    FC_PERMISSIONS.CUSTOMER_CREDIT_PAYMENT_EDIT
  );
  const canDeletePayments =
    hasFcPermission(
      currentUser,
      FC_PERMISSIONS.CUSTOMER_CREDIT_PAYMENT_DELETE
    ) ||
    hasFcPermission(
      currentUser,
      FC_PERMISSIONS.CUSTOMER_CREDIT_PAYMENT_VOID
    );

  const historyOnlyRole =
    readOnly ||
    (!isAdminUser &&
      (userRole.includes("sales") ||
        userRole.includes("server") ||
        userRole.includes("manager") ||
        userRole.includes("cash") ||
        userRole.includes("driver")));

  useEffect(() => {
    let active = true;

    loadCentralPaymentCustomers()
      .then((rows) => {
        if (!active) return;
        setCustomers(rows);
        if (rows.length) {
          const initialCustomer =
            rows.find((customer) => hasConfiguredCreditAccount(customer)) || rows[0];
          setSelectedCustomerId((value) => value || initialCustomer.id);
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError.message || "Could not load customers.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatches(customer, customerSearch)),
    [customers, customerSearch]
  );

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(selectedCustomerId)
  );

  const displayedCustomers = useMemo(() => {
    if (!selectedCustomer) return filteredCustomers;
    if (
      filteredCustomers.some(
        (customer) => String(customer.id) === String(selectedCustomer.id)
      )
    ) {
      return filteredCustomers;
    }
    return [selectedCustomer, ...filteredCustomers];
  }, [filteredCustomers, selectedCustomer]);

  const branches = getActiveCustomerBranches(selectedCustomer);

  const hasBranches = branches.length > 0;
  const branchDetailsRequired =
    hasBranches && selectedBranchId === MAIN_ACCOUNT;
  // Active branches mean branch accounting is ON. Without active branches,
  // Customer Credit uses the main customer account. There is no combined
  // "all branches" financial scope because that can mix separate balances.
  const snapshotBranchId =
    selectedBranchId === BRANCH_SELECT || selectedBranchId === MAIN_ACCOUNT
      ? ""
      : selectedBranchId;

  useEffect(() => {
    setSelectedBranchId(MAIN_ACCOUNT);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    const handlePaymentPosted = (event) => {
      if (
        String(event?.detail?.customerAccountId || "") ===
        String(selectedCustomer?.id || "")
      ) {
        setPaymentRefreshVersion((value) => value + 1);
      }
    };
    window.addEventListener(PAYMENT_POSTED_EVENT, handlePaymentPosted);
    return () => window.removeEventListener(PAYMENT_POSTED_EVENT, handlePaymentPosted);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    const requestId = snapshotRequestRef.current + 1;
    snapshotRequestRef.current = requestId;

    if (!selectedCustomer?.id) {
      setSnapshot(null);
      setLoading(false);
      return undefined;
    }

    const prefetchedSnapshot = prefetchedSnapshotRef.current;
    if (
      !snapshotBranchId &&
      prefetchedSnapshot &&
      String(prefetchedSnapshot.customerId) === String(selectedCustomer.id)
    ) {
      prefetchedSnapshotRef.current = null;
      setSnapshot(prefetchedSnapshot.snapshot);
      setLoading(false);
      setError("");
      return undefined;
    }

    let active = true;
    setSnapshot(null);
    setLoading(true);
    setError("");

    loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId: snapshotBranchId,
    })
      .then((data) => {
        if (active && snapshotRequestRef.current === requestId) {
          setSnapshot(data);
        }
      })
      .catch((loadError) => {
        if (active && snapshotRequestRef.current === requestId) {
          setError(loadError.message || "Could not load customer credit.");
        }
      })
      .finally(() => {
        if (active && snapshotRequestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [selectedCustomer?.id, snapshotBranchId, paymentRefreshVersion]);

  useEffect(() => {
    setPage(1);
    setActiveTab("summary");
    setSelectionMessage("");
  }, [selectedCustomerId]);

  useEffect(() => {
    setPage(1);
  }, [selectedBranchId]);

  const selectCreditCustomer = async (customerId) => {
    const candidate = customers.find(
      (customer) => String(customer.id) === String(customerId)
    );
    if (!candidate || String(candidate.id) === String(selectedCustomerId)) return;

    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    snapshotRequestRef.current += 1;
    const previousSnapshot = snapshot;
    setSnapshot(null);
    setPage(1);
    setLoading(true);
    setError("");
    setSelectionMessage("");

    try {
      const candidateSnapshot = await loadReadOnlyCustomerCreditSnapshot({
        customerAccountId: candidate.id,
        customerName: candidate.account_name,
        customer: candidate,
        selectedBranchId: "",
      });

      if (selectionRequestRef.current !== requestId) return;

      if (!canSelectCustomerForCredit(candidate, candidateSnapshot)) {
        setSnapshot(previousSnapshot);
        setSelectionMessage(
          "No credit account or credit transactions found for this customer."
        );
        return;
      }

      prefetchedSnapshotRef.current = {
        customerId: candidate.id,
        snapshot: candidateSnapshot,
      };
      setSnapshot(null);
      setPage(1);
      setActiveTab("summary");
      setSelectedBranchId(MAIN_ACCOUNT);
      setSelectedCustomerId(candidate.id);
    } catch (loadError) {
      if (selectionRequestRef.current === requestId) {
        setSnapshot(previousSnapshot);
        setError(loadError.message || "Could not load customer credit.");
      }
    } finally {
      if (selectionRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  const hasSpecificBranch =
    selectedBranchId !== MAIN_ACCOUNT &&
    selectedBranchId !== BRANCH_SELECT &&
    Boolean(selectedBranchId);

  const selectedBranch = branches.find(
    (branch) => String(branch.id) === String(selectedBranchId)
  );

  const selectedOpeningBalance = Number(
    hasSpecificBranch
      ? snapshot?.branchSummary?.openingBalance || 0
      : snapshot?.customerSummary?.openingBalance || 0
  );

  const creditHistory = useMemo(() => {
    const mappedRows = (snapshot?.accountHistory?.transactions || []).map(
      (transaction, index) => {
        const source = transaction.source_record || transaction;
        const type = transaction.type || transaction.transaction_type;
        return {
          ...transaction,
          source,
          type,
          reference: transaction.reference || "-",
          debit: Number(transaction.debit_amount || 0),
          credit: Number(transaction.credit_amount || 0),
          runningBalance: Number(transaction.running_balance || 0),
          status:
            transaction.invoice_status ||
            transaction.status ||
            (type === "INVOICE" ? "UNPAID" : "POSTED"),
          transactionDate: transaction.transaction_date,
          createdAt: transaction.ordering_timestamp || transaction.created_at,
          documentUrl: getDocumentUrl(source, type),
          relatedInvoice: transaction.related_invoice,
          sortIndex: index,
        };
      }
    );

    return sortTransactionsForDisplay(mappedRows, historySort);
  }, [
    snapshot,
    historySort,
  ]);

  const displayedHistory = useMemo(
    () =>
      activeTab === "payments"
        ? creditHistory.filter(
            (row) =>
              row.transaction_type === "PAYMENT" ||
              row.transaction_type === "CREDIT" ||
              row.transaction_type === "ADJUSTMENT"
          )
        : creditHistory,
    [activeTab, creditHistory]
  );

  const accountCreditLimit = Number(
    firstValue(
      snapshot?.customerSummary?.creditLimit,
      snapshot?.customerSummary?.credit_limit,
      selectedCustomer?.credit_limit,
      selectedCustomer?.creditLimit,
      0
    ) || 0
  );

  const lastPayment = Number(
    snapshot?.customerSummary?.lastPaymentAmount || 0
  );

  const totalPages = Math.max(1, Math.ceil(displayedHistory.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = displayedHistory.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const beginOpeningBalanceEdit = () => {
    if (!canEditOpeningBalance || !selectedCustomer) return;

    setOpeningBalanceInput(
      String(
        hasSpecificBranch
          ? snapshot?.branchSummary?.openingBalance || 0
          : snapshot?.customerSummary?.openingBalance || 0
      )
    );
    setOpeningBalanceReason("");
    setEditingOpeningBalance(true);
  };

  const saveOpeningBalance = async () => {
    if (!canEditOpeningBalance || !selectedCustomer) return;

    const nextOpeningBalance = Number(openingBalanceInput || 0);
    if (!Number.isFinite(nextOpeningBalance)) {
      setError("Enter a valid opening balance.");
      return;
    }
    if (!String(openingBalanceReason || "").trim()) {
      setError("Enter a reason for the opening-balance amendment.");
      return;
    }

    setSavingOpeningBalance(true);
    setError("");

    try {
      const openingBranchId = hasSpecificBranch ? selectedBranchId : null;
      await setCustomerOpeningBalance({
        customerAccountId: selectedCustomer.id,
        customerBranchId: openingBranchId,
        amount: nextOpeningBalance,
        reason: openingBalanceReason,
        currentUser,
      });

      const refreshed = await loadReadOnlyCustomerCreditSnapshot({
        customerAccountId: selectedCustomer.id,
        customerName: selectedCustomer.account_name,
        customer: selectedCustomer,
        selectedBranchId: hasSpecificBranch ? selectedBranchId : "",
      });

      setSnapshot(refreshed);
      setEditingOpeningBalance(false);
    } catch (saveError) {
      setError(
        saveError?.message || "Could not update the opening balance."
      );
    } finally {
      setSavingOpeningBalance(false);
    }
  };

  const refreshAfterPaymentAmendment = async () => {
    const refreshed = await loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId: hasSpecificBranch ? selectedBranchId : "",
    });
    setSnapshot(refreshed);
  };

  const getEditablePayment = (row) => {
    if (row?.type !== "PAYMENT") return null;
    const payment = row.source || {};
    const paymentId = payment.central_payment_id || payment.id;
    const status = String(payment.status || payment.payment_status || "POSTED")
      .trim()
      .toUpperCase();
    const verification = String(
      payment.verification_status || payment.verificationStatus || "CONFIRMED"
    )
      .trim()
      .toUpperCase();

    if (!UUID_PATTERN.test(String(paymentId || ""))) return null;
    if (status !== "POSTED" || payment.voided_at || payment.reversed_at) return null;
    if (
      ["VOIDED", "REVERSED", "REJECTED", "PENDING", "PENDING_VERIFICATION"].includes(
        verification
      )
    ) {
      return null;
    }
    return { ...payment, id: paymentId };
  };

  const beginPaymentEdit = (row) => {
    const payment = getEditablePayment(row);
    if (!payment || (!canEditPayments && !canDeletePayments)) return;

    setEditingPayment(payment);
    setPaymentForm({
      amount: String(getPaymentAmount(payment)),
      paymentMethod: firstValue(
        payment.payment_method,
        payment.payment_type,
        "Other"
      ),
      paidBy: firstValue(payment.paid_by, payment.who_paid, ""),
      collectionType: firstValue(
        payment.metadata?.collection_type,
        payment.collection_type,
        payment.resolved_collection_type,
        ""
      ),
      paymentDate: String(
        firstValue(payment.payment_date, payment.created_at, "")
      ).slice(0, 10),
      reference: firstValue(
        payment.payment_reference,
        payment.reference_no,
        ""
      ),
      notes: firstValue(payment.notes, payment.transaction_reason, ""),
      reason: "",
    });
    setPaymentActionError("");
  };

  const closePaymentEditor = () => {
    if (savingPayment) return;
    setEditingPayment(null);
    setPaymentForm(null);
    setPaymentActionError("");
  };

  const savePaymentAmendment = async () => {
    if (!editingPayment || !paymentForm || !selectedCustomer?.id) return;
    if (
      !window.confirm(
        `Save this payment correction? The existing ${formatCurrency(
          getPaymentAmount(editingPayment)
        )} payment will be updated and FIFO allocations recalculated.`
      )
    ) {
      return;
    }

    setSavingPayment(true);
    setPaymentActionError("");
    try {
      await amendCustomerCreditPayment({
        customerAccountId: selectedCustomer.id,
        paymentId: editingPayment.id,
        changes: paymentForm,
        reason: paymentForm.reason,
        currentUser,
      });
      await refreshAfterPaymentAmendment();
      setEditingPayment(null);
      setPaymentForm(null);
    } catch (paymentError) {
      setPaymentActionError(
        paymentError?.message || "Could not amend the payment."
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const voidEditedPayment = async () => {
    if (!editingPayment || !paymentForm || !selectedCustomer?.id) return;
    if (!String(paymentForm.reason || "").trim()) {
      setPaymentActionError("Enter a reason before voiding this payment.");
      return;
    }
    if (
      !window.confirm(
        `Void the ${formatCurrency(
          getPaymentAmount(editingPayment)
        )} payment? Its allocations and account effect will be removed.`
      )
    ) {
      return;
    }

    setSavingPayment(true);
    setPaymentActionError("");
    try {
      await voidCustomerCreditPayment({
        customerAccountId: selectedCustomer.id,
        paymentId: editingPayment.id,
        reason: paymentForm.reason,
        currentUser,
      });
      await refreshAfterPaymentAmendment();
      setEditingPayment(null);
      setPaymentForm(null);
    } catch (paymentError) {
      setPaymentActionError(
        paymentError?.message || "Could not void the payment."
      );
    } finally {
      setSavingPayment(false);
    }
  };

  const summaryCards = [
    {
      label: "Credit limit",
      value: accountCreditLimit,
    },
    {
      label: "Outstanding Balance",
      value: snapshot?.customerSummary?.outstandingBalance,
    },
    {
      label: "Customer Credit",
      value: snapshot?.customerSummary?.customerCredit,
    },
    {
      label: hasSpecificBranch ? "Branch opening balance" : "Opening balance",
      value: hasSpecificBranch
        ? selectedOpeningBalance
        : snapshot?.customerSummary?.openingBalance,
      placeholder: "",
      isOpeningBalance: true,
    },
    {
      label: "Available Credit Limit",
      value: snapshot?.customerSummary?.availableCreditLimit,
    },
    {
      label: "Branch Credit",
      text: hasBranches ? "ON" : "OFF",
    },
    { label: "Last payment", value: lastPayment },
  ];

  const hasNoCreditTransactions =
    !loading &&
    Boolean(selectedCustomer) &&
    Boolean(snapshot) &&
    !hasCreditSnapshotActivity(snapshot);

  if (creditView === "all") {
    return (
      <div className="w-full min-w-0 space-y-4 overflow-x-hidden p-2 sm:p-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-extrabold text-slate-900">Customer Credit</h2>
              <p className="text-sm text-slate-500">Total outstanding and ageing across every customer account.</p>
            </div>
            <button type="button" onClick={() => setCreditView("individual")} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-bold text-blue-700 hover:bg-blue-100">Individual Credit</button>
          </div>
        </div>
        <AllCreditOutstanding customers={customers} />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3 overflow-x-hidden p-2 sm:space-y-4 sm:p-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">
              Customer Credit
            </h2>
            <p className="text-sm text-slate-500">
              Customer account summary and complete credit history.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCreditView("all")} className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600">All Outstanding</button>
            {historyOnlyRole && (
              <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
                History-only access
              </span>
            )}
          </div>
        </div>

        <div className={`mt-4 grid min-w-0 grid-cols-1 gap-3 ${hasBranches ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"}`}>
          <input
            value={customerSearch}
            onChange={(event) => {
              setCustomerSearch(event.target.value);
              setSelectionMessage("");
              setPage(1);
            }}
            placeholder="Search customer"
            className="min-h-11 w-full min-w-0 rounded-xl border p-3"
          />

          <select
            value={selectedCustomerId}
            onChange={(event) => {
              selectCreditCustomer(event.target.value);
            }}
            className="min-h-11 w-full min-w-0 rounded-xl border p-3"
          >
            {displayedCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.account_name}
              </option>
            ))}
          </select>

      {hasBranches && (
            <select
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              className="min-h-11 w-full min-w-0 rounded-xl border p-3"
            >
              <option value={MAIN_ACCOUNT}>Main Customer Account</option>

              {branches.map((branch) => (
                <option key={branch.id} value={String(branch.id)}>
                  {branch.branch_name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">
          {error}
        </div>
      )}

      {selectionMessage && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 font-bold text-amber-800">
          {selectionMessage}
        </div>
      )}

      {loading && (
        <div className="rounded-xl bg-slate-50 p-3 font-bold">
          Loading credit history...
        </div>
      )}

      {hasNoCreditTransactions && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 font-bold text-slate-700">
          No credit account or credit transactions found for this customer.
        </div>
      )}

      <div className="rounded-xl border bg-white p-3 text-sm font-bold text-slate-700">
        Branch Credit: {hasBranches ? "ON" : "OFF"}
        <span className="mx-2 text-slate-300">|</span>
        Financial scope:{" "}
        {hasSpecificBranch
          ? selectedBranch?.branch_name || "Selected branch"
          : "Main Customer Account"}
      </div>

      {isAdminUser && snapshot?.legacyFallbackUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Temporary legacy payment compatibility is active for this account
          because matching new-table payment records were not found.
        </div>
      )}

      {isAdminUser && snapshot?.paymentDiagnostics && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <summary className="cursor-pointer font-bold">
            Payment reconciliation diagnostics
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
            <div>Canonical payments: {snapshot.paymentDiagnostics.canonicalPaymentCount}</div>
            <div>Legacy-only payments: {snapshot.paymentDiagnostics.legacyOnlyPaymentCount}</div>
            <div>Suppressed duplicates: {snapshot.paymentDiagnostics.suppressedDuplicateCount}</div>
            <div>Canonical total: {formatCurrency(snapshot.paymentDiagnostics.canonicalPaymentTotal)}</div>
            <div>Legacy-only total: {formatCurrency(snapshot.paymentDiagnostics.legacyOnlyPaymentTotal)}</div>
            <div>Combined unique total: {formatCurrency(snapshot.paymentDiagnostics.combinedUniquePaymentTotal)}</div>
          </div>
        </details>
      )}

      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(
          ({ label, value, text, placeholder, isOpeningBalance }) => (
            <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase text-slate-500">
                {label}
              </div>
              <div className="mt-1 text-xl font-extrabold text-slate-900">
                {placeholder || text || formatCurrency(Number(value || 0))}
              </div>

              {isOpeningBalance && canEditOpeningBalance && (
                <button
                  type="button"
                  onClick={beginOpeningBalanceEdit}
                  className="mt-3 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-100"
                >
                  Edit opening balance
                </button>
              )}
            </div>
          )
        )}
      </div>

      {editingOpeningBalance && canEditOpeningBalance && (
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-bold text-slate-700">
                {hasSpecificBranch
                    ? `Branch opening balance — ${
                        selectedBranch?.branch_name || "Selected branch"
                      }`
                    : "Account opening balance"}
              </label>
              <input
                type="number"
                step="0.01"
                value={openingBalanceInput}
                onChange={(event) => setOpeningBalanceInput(event.target.value)}
                className="w-full rounded-xl border bg-white p-3"
                placeholder="0.00"
              />
              <input
                value={openingBalanceReason}
                onChange={(event) => setOpeningBalanceReason(event.target.value)}
                className="mt-2 w-full rounded-xl border bg-white p-3"
                placeholder="Reason for amendment (required)"
              />
             <p className="mt-1 text-xs font-semibold text-slate-500">
                {hasSpecificBranch
                  ? `This opening balance applies only to ${
                      selectedBranch?.branch_name || "the selected branch"
                    }.`
                  : "This opening balance applies to the full customer account."}
              </p>
            </div>

            <button
              type="button"
              onClick={saveOpeningBalance}
              disabled={savingOpeningBalance}
              className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {savingOpeningBalance ? "Saving..." : "Save"}
            </button>

            <button
              type="button"
              onClick={() => setEditingOpeningBalance(false)}
              disabled={savingOpeningBalance}
              className="rounded-xl border bg-white px-5 py-3 font-bold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <div className="min-w-0 overflow-x-auto rounded-2xl border bg-white p-2 shadow-sm">
        <div className="flex min-w-max gap-2">
          {[
            ["summary", "Summary"],
            ["credit", "Credit History"],
            ["payments", "Payment History"],
            ["transactions", "Transactions"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setActiveTab(value);
                setPage(1);
              }}
              className={`min-h-11 whitespace-nowrap rounded-xl border px-4 py-2 text-sm font-bold ${
                activeTab === value
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "bg-white text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "summary" && (
        <section className="space-y-4 rounded-2xl border bg-white p-5 shadow-sm">
          <div>
            <h3 className="text-lg font-extrabold text-slate-900">Account Summary</h3>
            <p className="mt-1 text-sm text-slate-500">
              The customer total is always shown across the full account. Branch
              summaries show every active branch at the same time.
            </p>
          </div>

          <div className="rounded-xl border bg-slate-50 p-4">
            <div className="text-xs font-bold uppercase text-slate-500">
              Total Outstanding
            </div>
            <div className="mt-1 text-2xl font-extrabold text-slate-900">
              {formatCurrency(snapshot?.customerSummary?.outstandingBalance || 0)}
            </div>
          </div>

          {hasBranches ? (
            <div>
              <h4 className="mb-3 text-base font-extrabold text-slate-900">
                Branch Outstanding
              </h4>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(snapshot?.branchSummaries || []).map((branchSummary) => (
                  <div
                    key={branchSummary.branchId || "main-unassigned"}
                    className="min-w-0 rounded-xl border bg-white p-4 shadow-sm"
                  >
                    <div className="text-lg font-extrabold text-slate-900">
                      {branchSummary.branchName || "Branch"}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="font-bold text-slate-500">Opening</dt>
                        <dd className="font-extrabold">{formatCurrency(branchSummary.openingBalance || 0)}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-slate-500">Invoices</dt>
                        <dd className="font-extrabold">{formatCurrency(branchSummary.invoiceTotal || 0)}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-slate-500">Payments</dt>
                        <dd className="font-extrabold">{formatCurrency(branchSummary.paymentTotal || 0)}</dd>
                      </div>
                      <div>
                        <dt className="font-bold text-slate-500">Outstanding</dt>
                        <dd className="font-extrabold">{formatCurrency(branchSummary.outstandingBalance || 0)}</dd>
                      </div>
                      {Number(branchSummary.creditLimit || 0) > 0 && (
                        <div>
                          <dt className="font-bold text-slate-500">Available credit</dt>
                          <dd className="font-extrabold">{formatCurrency(branchSummary.availableCreditLimit || 0)}</dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="rounded-xl border bg-slate-50 p-4 text-sm font-semibold text-slate-600">
              Branch Credit is OFF. This customer uses the Main Customer Account automatically.
            </p>
          )}
        </section>
      )}

      {(["credit", "payments", "transactions"].includes(activeTab)) &&
         branchDetailsRequired && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-center shadow-sm">
            <h3 className="font-extrabold text-blue-900">
              Select a branch to view{" "}
              {activeTab === "credit"
                ? "Credit History"
                : activeTab === "payments"
                  ? "Payment History"
                  : "Transactions"}
            </h3>
            <p className="mt-2 text-sm font-semibold text-blue-700">
              The total account outstanding remains visible above.
            </p>
          </section>
        )}

      {(["credit", "payments", "transactions"].includes(activeTab)) &&
        !branchDetailsRequired && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex flex-col gap-2 border-b bg-white/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  {activeTab === "credit"
                    ? "Credit History"
                    : activeTab === "payments"
                      ? "Payment History"
                      : "Transactions"}{" "}
                  ({displayedHistory.length})
                </h3>
                <p className="text-sm text-slate-500">
                  Running balances are always calculated chronologically.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-500">
                <button
                  type="button"
                  onClick={() => {
                    setHistorySort("oldest");
                    setPage(1);
                  }}
                  className={`rounded-lg border px-3 py-2 ${
                    historySort === "oldest" ? "bg-slate-900 text-white" : "bg-white"
                  }`}
                >
                  Oldest first
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistorySort("newest");
                    setPage(1);
                  }}
                  className={`rounded-lg border px-3 py-2 ${
                    historySort === "newest" ? "bg-slate-900 text-white" : "bg-white"
                  }`}
                >
                  Newest first
                </button>
                <span>
                  {displayedHistory.length
                    ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}-${Math.min(
                        safePage * PAGE_SIZE,
                        displayedHistory.length
                      )} of ${displayedHistory.length}`
                    : "No transactions"}
                </span>
              </div>
            </div>

            <div className="max-h-[62vh] w-full overflow-auto overscroll-contain">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="p-3">Date and time</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Reference</th>
                    <th className="p-3">Details</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Running balance</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Related invoice</th>
                    {activeTab === "transactions" && (
                      <>
                        <th className="p-3 text-right">Allocated</th>
                        <th className="p-3 text-right">Unallocated</th>
                        <th className="p-3">Source</th>
                        <th className="p-3">Created / updated</th>
                      </>
                    )}
                    {!historyOnlyRole && <th className="p-3">Action</th>}
                  </tr>
                </thead>

                <tbody>
                  {pageRows.map((row) => (
                    <tr
                      key={`${row.type}-${row.reference}-${row.transactionDate}-${row.sortIndex}`}
                      className="border-b last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="whitespace-nowrap p-3">
                        {formatTransactionDate(row)}
                      </td>
                      <td className="p-3 font-bold">
                        {String(row.transaction_subtype || row.type).replaceAll("_", " ")}
                      </td>
                      <td className="p-3 font-semibold">{formatDisplayOrderId(row.reference)}</td>
                      <td className="p-3 text-slate-600">{row.description}</td>
                      <td className="p-3 text-right font-bold text-red-700">
                        {row.debit ? formatCurrency(row.debit) : "-"}
                      </td>
                      <td className="p-3 text-right font-bold text-green-700">
                        {row.credit ? formatCurrency(row.credit) : "-"}
                      </td>
                      <td className="p-3 text-right font-extrabold text-slate-900">
                        {formatCurrency(row.runningBalance)}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="p-3 font-semibold">
                        {row.relatedInvoice || "—"}
                      </td>
                      {activeTab === "transactions" && (
                        <>
                          <td className="p-3 text-right">
                            {row.allocated_amount
                              ? formatCurrency(row.allocated_amount)
                              : "—"}
                          </td>
                          <td className="p-3 text-right">
                            {row.unallocated_amount
                              ? formatCurrency(row.unallocated_amount)
                              : "—"}
                          </td>
                          <td className="p-3">{row.source_table || "—"}</td>
                          <td className="whitespace-nowrap p-3 text-xs">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString("en-GB")
                              : "—"}
                            {row.updated_at && (
                              <div className="text-slate-500">
                                Updated {new Date(row.updated_at).toLocaleString("en-GB")}
                              </div>
                            )}
                          </td>
                        </>
                      )}
                      {!historyOnlyRole && (
                        <td className="p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <DocumentActions row={row} restricted={historyOnlyRole} />
                            {getEditablePayment(row) &&
                              (canEditPayments || canDeletePayments) && (
                                <button
                                  type="button"
                                  onClick={() => beginPaymentEdit(row)}
                                  className="inline-flex rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-600"
                                >
                                  Edit Payment
                                </button>
                              )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}

                  {!pageRows.length && !loading && (
                    <tr>
                      <td
                        colSpan={(historyOnlyRole ? 9 : 10) + (activeTab === "transactions" ? 4 : 0)}
                        className="p-8 text-center text-slate-500"
                      >
                        No{" "}
                        {activeTab === "credit"
                          ? "credit history"
                          : activeTab === "payments"
                            ? "payments"
                            : "transactions"}{" "}
                        found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-t bg-white px-3 py-4 sm:gap-3 sm:px-4">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={safePage <= 1}
                className="min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
              >
                Previous
              </button>
              <div className="whitespace-nowrap text-center text-sm font-bold text-slate-700">
                Page {safePage} of {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={safePage >= totalPages}
                className="min-h-11 rounded-xl border px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 sm:px-4"
              >
                 Next
              </button>
            </div>
          </section>
        )}

      {editingPayment && paymentForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-payment-title"
        >
          <div className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="edit-payment-title"
                  className="text-xl font-extrabold text-slate-900"
                >
                  Edit Payment
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Correct the canonical payment. Saving or voiding will rebuild
                  FIFO allocations and account balances.
                </p>
              </div>
              <button
                type="button"
                onClick={closePaymentEditor}
                disabled={savingPayment}
                className="rounded-lg border px-3 py-1.5 font-bold text-slate-600 disabled:opacity-50"
                aria-label="Close payment editor"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm font-bold text-slate-700">
                Payment amount
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      amount: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700">
                Payment type
                <select
                  value={paymentForm.paymentMethod}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      paymentMethod: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                >
                  {["Cash", "Card", "Bank Transfer", "Other", "Discount"].map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm font-bold text-slate-700">
                Who paid
                <input
                  value={paymentForm.paidBy}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      paidBy: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700">
                Collection type
                <input
                  value={paymentForm.collectionType}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      collectionType: event.target.value,
                    }))
                  }
                  placeholder="Office, driver, today's invoice..."
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700">
                Payment date
                <input
                  type="date"
                  value={paymentForm.paymentDate}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      paymentDate: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700">
                Reference
                <input
                  value={paymentForm.reference}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      reference: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700 sm:col-span-2">
                Notes
                <textarea
                  rows={3}
                  value={paymentForm.notes}
                  disabled={!canEditPayments || savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      notes: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-xl border p-3 disabled:bg-slate-100"
                />
              </label>

              <label className="text-sm font-bold text-slate-700 sm:col-span-2">
                Reason for amendment or void
                <textarea
                  rows={2}
                  required
                  value={paymentForm.reason}
                  disabled={savingPayment}
                  onChange={(event) =>
                    setPaymentForm((value) => ({
                      ...value,
                      reason: event.target.value,
                    }))
                  }
                  placeholder="Required for the audit record"
                  className="mt-1 w-full rounded-xl border border-amber-300 bg-amber-50 p-3"
                />
              </label>
            </div>

            {paymentActionError && (
              <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
                {paymentActionError}
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <div>
                {canDeletePayments && (
                  <button
                    type="button"
                    onClick={voidEditedPayment}
                    disabled={savingPayment}
                    className="w-full rounded-xl border border-red-300 bg-red-50 px-5 py-3 font-bold text-red-700 hover:bg-red-100 disabled:opacity-50 sm:w-auto"
                  >
                    {savingPayment ? "Working..." : "Void mistaken payment"}
                  </button>
                )}
              </div>
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={closePaymentEditor}
                  disabled={savingPayment}
                  className="rounded-xl border px-5 py-3 font-bold text-slate-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                {canEditPayments && (
                  <button
                    type="button"
                    onClick={savePaymentAmendment}
                    disabled={
                      savingPayment ||
                      !(Number(paymentForm.amount) > 0) ||
                      !String(paymentForm.reason || "").trim()
                    }
                    className="rounded-xl bg-blue-700 px-5 py-3 font-bold text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingPayment ? "Saving..." : "Save correction"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
