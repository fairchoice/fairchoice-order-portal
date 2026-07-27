import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import { supabase } from "../../services/supabase";
import {
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";
import { PAYMENT_POSTED_EVENT } from "../../services/canonicalPaymentService";
import { getActiveCustomerBranches } from "../../utils/customerBranchScope";
import { formatDisplayOrderId } from "../../utils/orderDisplay";
import {
  canSelectCustomerForCredit,
  hasConfiguredCreditAccount,
  hasCreditSnapshotActivity,
} from "../../utils/customerCreditSelection";

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

const asTimestamp = (value) => {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const firstValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== "");

const normalizeReference = (value) => String(value || "").trim().toLowerCase();

const getInvoiceAmount = (invoice = {}) =>
  Math.abs(
    Number(
      firstValue(
        invoice.invoice_total,
        invoice.invoice_amount,
        invoice.debit,
        invoice.amount,
        invoice.total,
        0
      )
    )
  );

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

const getRecordDate = (record = {}) =>
  firstValue(
    record.transaction_date,
    record.payment_date,
    record.invoice_date,
    record.date,
    record.created_at
  );

const buildFifoInvoiceAllocation = ({
  invoices = [],
  payments = [],
  openingBalance = 0,
}) => {
  const oldestInvoices = [...invoices].sort(
    (a, b) => asTimestamp(getRecordDate(a)) - asTimestamp(getRecordDate(b))
  );

  const totalPayments = payments.reduce(
    (sum, payment) => sum + getPaymentAmount(payment),
    0
  );

  // Customer payments clear the brought-forward opening balance first.
  let remainingPayment = Math.max(
    0,
    totalPayments - Math.max(0, Number(openingBalance || 0))
  );

  const allocationByReference = new Map();

  oldestInvoices.forEach((invoice) => {
    const invoiceAmount = getInvoiceAmount(invoice);
    const allocatedAmount = Math.min(invoiceAmount, remainingPayment);
    const remainingAmount = Math.max(0, invoiceAmount - allocatedAmount);

    let status = "UNPAID";
    if (invoiceAmount > 0 && remainingAmount <= 0.009) {
      status = "PAID";
    } else if (allocatedAmount > 0) {
      status = "PART PAID";
    }

    const allocation = {
      status,
      allocatedAmount,
      remainingAmount,
      invoiceAmount,
    };

    [
      invoice.id,
      invoice.invoice_number,
      invoice.reference_no,
      invoice.invoice_reference,
      invoice.order_number,
    ].forEach((value) => {
      const key = normalizeReference(value);
      if (key) allocationByReference.set(key, allocation);
    });

    remainingPayment = Math.max(0, remainingPayment - allocatedAmount);
  });

  return allocationByReference;
};

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

const isCustomerVisiblePayment = (payment = {}) => {
  const method = String(payment.payment_method || payment.paymentMethod || "").toUpperCase();
  const verification = String(payment.verification_status || payment.verificationStatus || "").toUpperCase();
  if (method !== "BANK TRANSFER") return true;
  return !["PENDING_VERIFICATION", "REJECTED"].includes(verification);
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
    return <span className="text-xs font-semibold text-slate-400">Not available</span>;
  }

  const isInvoice = row.type === "INVOICE";
  const isPaidInvoice =
    isInvoice && String(row.status || "").toUpperCase() === "PAID";
 const label =
    isInvoice
        ? "Download Invoice"
        : "Receipt";

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      download={isPaidInvoice ? "" : undefined}
      className="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
    >
      {label}
    </a>
  );
}

export default function CustomerCredit({ readOnly = false }) {
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
  const [editingOpeningBalance, setEditingOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const [savingOpeningBalance, setSavingOpeningBalance] = useState(false);
  const [paymentRefreshVersion, setPaymentRefreshVersion] = useState(0);
  const selectionRequestRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const prefetchedSnapshotRef = useRef(null);

  const currentUser = getLoggedInUser();
  const userRole = String(
    currentUser?.role || currentUser?.access_level || ""
  ).toLowerCase();

  const username = String(
    currentUser?.username ||
      currentUser?.user_name ||
      currentUser?.login ||
      ""
  )
    .trim()
    .toLowerCase();

  const isAdminUser =
    userRole.includes("admin") ||
    currentUser?.permissions?.access_accounts === true;

  const canEditOpeningBalance = username === "nisstaj_admin";

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

  const transactionMatchesSelectedBranch = (transaction = {}, source = {}) => {
    if (!hasSpecificBranch) return true;
    if (String(transaction.type || "").toUpperCase() === "OPENING") return true;

    const selectedId = String(selectedBranchId || "");
    const selectedName = String(selectedBranch?.branch_name || "")
      .trim()
      .toLowerCase();

    const transactionBranchIds = [
      transaction.branch_id,
      transaction.customer_branch_id,
      transaction.branchId,
      transaction.customerBranchId,
      source?.branch_id,
      source?.customer_branch_id,
      source?.branchId,
      source?.customerBranchId,
    ]
      .map((value) => String(value || ""))
      .filter(Boolean);

    if (transactionBranchIds.includes(selectedId)) return true;

    const transactionBranchNames = [
      transaction.branch_name,
      transaction.customer_branch_name,
      transaction.branchName,
      transaction.customerBranchName,
      source?.branch_name,
      source?.customer_branch_name,
      source?.branchName,
      source?.customerBranchName,
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);

    return Boolean(
      selectedName && transactionBranchNames.includes(selectedName)
    );
  };

  const invoices = hasSpecificBranch
    ? snapshot?.selectedInvoices || []
    : snapshot?.allocatedInvoices || [];

  const payments = (hasSpecificBranch
    ? snapshot?.selectedPayments || []
    : snapshot?.payments || []
  ).filter(isCustomerVisiblePayment);


  const selectedOpeningBalance = Number(
    hasSpecificBranch
      ? snapshot?.branchSummary?.openingBalance || 0
      : snapshot?.customerSummary?.openingBalance || 0
  );

  const fifoInvoiceAllocation = useMemo(
    () =>
      buildFifoInvoiceAllocation({
        invoices,
        payments,
        openingBalance: selectedOpeningBalance,
      }),
    [invoices, payments, selectedOpeningBalance]
  );

  const invoiceByReference = useMemo(() => {
    const map = new Map();

    invoices.forEach((invoice) => {
      [
        invoice.id,
        invoice.invoice_number,
        invoice.reference_no,
        invoice.invoice_reference,
      ].forEach((value) => {
        const key = normalizeReference(value);
        if (key) map.set(key, invoice);
      });
    });

    return map;
  }, [invoices]);

  const paymentByReference = useMemo(() => {
    const map = new Map();

    payments.forEach((payment) => {
      [
        payment.id,
        payment.payment_reference,
        payment.reference_no,
        payment.payment_number,
      ].forEach((value) => {
        const key = normalizeReference(value);
        if (key) map.set(key, payment);
      });
    });

    return map;
  }, [payments]);

  const creditHistory = useMemo(() => {
    const mappedRows = (snapshot?.transactionHistory || [])
      .filter((transaction) => {
        const type = String(transaction.type || "TRANSACTION").toUpperCase();
        const reference = firstValue(
          transaction.reference,
          transaction.invoice_number,
          transaction.payment_reference,
          transaction.reference_no,
          transaction.id
        );
        const lookupKey = normalizeReference(reference);
        const source =
          type === "PAYMENT"
            ? paymentByReference.get(lookupKey)
            : invoiceByReference.get(lookupKey);

        if (type === "PAYMENT") {
          const paymentRecord = source || transaction;
          if (!isCustomerVisiblePayment(paymentRecord)) return false;
        }
        return transactionMatchesSelectedBranch(transaction, source);
      })
      .map((transaction, index) => {
        const type = String(transaction.type || "TRANSACTION").toUpperCase();
        const reference = firstValue(
          transaction.reference,
          transaction.invoice_number,
          transaction.payment_reference,
          transaction.reference_no,
          transaction.id
        );

        const lookupKey = normalizeReference(reference);
        const source =
          type === "PAYMENT"
            ? paymentByReference.get(lookupKey)
            : invoiceByReference.get(lookupKey);

        const amount = Number(transaction.amount || 0);
        const isCredit = amount < 0 || type === "PAYMENT";
        const transactionDate = firstValue(
          transaction.transaction_date,
          transaction.date,
          transaction.payment_date,
          transaction.invoice_date,
          transaction.created_at,
          source?.transaction_date,
          source?.payment_date,
          source?.invoice_date,
          source?.created_at
        );

        const description =
          type === "INVOICE"
            ? firstValue(
                source?.price_mode,
                source?.pricing_mode,
                source?.offer_type,
                source?.description,
                transaction.description,
                "Customer invoice"
              )
            : type === "PAYMENT"
            ? firstValue(
                transaction.paymentMethod,
                source?.payment_method,
                source?.payment_type,
                transaction.description,
                "Customer payment"
              )
            : firstValue(transaction.description, type.replaceAll("_", " "));

        return {
          ...transaction,
          source,
          type,
          reference: reference || "-",
          description,
          debit: isCredit ? 0 : Math.abs(amount),
          credit: isCredit ? Math.abs(amount) : 0,
          runningBalance: Number(transaction.runningBalance || 0),
          status:
            type === "INVOICE"
              ? firstValue(
                  fifoInvoiceAllocation.get(lookupKey)?.status,
                  source?.paymentStatus,
                  source?.payment_status,
                  source?.invoice_status,
                  source?.status,
                  transaction.status,
                  "UNPAID"
                )
              : firstValue(
                  transaction.status,
                  source?.paymentStatus,
                  source?.payment_status,
                  source?.status,
                  type === "PAYMENT" ? "POSTED" : "UNPAID"
                ),
          branchName: firstValue(
            transaction.branchName,
            source?.branch_name,
            source?.customer_branch_name,
            "-"
          ),
          transactionDate,
          createdAt: firstValue(
            transaction.created_at,
            source?.created_at,
            transactionDate
          ),
          documentUrl: getDocumentUrl(source || transaction, type),
          sortIndex: index,
        };
      })
      .sort((a, b) => {
        const dateDifference =
          asTimestamp(a.transactionDate) - asTimestamp(b.transactionDate);

        if (dateDifference !== 0) return dateDifference;

        const createdDifference =
          asTimestamp(a.createdAt) - asTimestamp(b.createdAt);

        if (createdDifference !== 0) return createdDifference;

        return a.sortIndex - b.sortIndex;
      });

    let runningBalance = 0;

    const rowsWithBranchBalance = mappedRows.map((row) => {
      if (row.type === "OPENING") {
        runningBalance = Number(row.debit || row.runningBalance || 0);
        return {
          ...row,
          runningBalance,
        };
      }

      runningBalance += Number(row.debit || 0) - Number(row.credit || 0);
      return {
        ...row,
        runningBalance,
      };
    });

   return rowsWithBranchBalance.sort((a, b) => {

  const dateDiff =
    asTimestamp(b.transactionDate) -
    asTimestamp(a.transactionDate);

  if (dateDiff !== 0) return dateDiff;

  const aInvoice = a.type === "INVOICE";
  const bInvoice = b.type === "INVOICE";

  const aPayment = a.type === "PAYMENT";
  const bPayment = b.type === "PAYMENT";

  // Same invoice
// A payment allocated to an invoice must appear after that invoice.
if (
  aPayment &&
  bInvoice &&
  isPaymentLinkedToInvoice(a, b)
) {
  return 1;
}

if (
  aInvoice &&
  bPayment &&
  isPaymentLinkedToInvoice(b, a)
) {
  return -1;
}

  const createdDiff =
    asTimestamp(b.createdAt) -
    asTimestamp(a.createdAt);

  if (createdDiff !== 0) return createdDiff;

  return b.sortIndex - a.sortIndex;
});

  }, [
    snapshot,
    invoiceByReference,
    paymentByReference,
    fifoInvoiceAllocation,
    hasSpecificBranch,
    selectedBranchId,
    selectedBranch?.branch_name,
    selectedOpeningBalance,
  ]);

  const accountCreditLimit = Number(
    firstValue(
      snapshot?.customerSummary?.creditLimit,
      snapshot?.customerSummary?.credit_limit,
      selectedCustomer?.credit_limit,
      selectedCustomer?.creditLimit,
      0
    ) || 0
  );

  const sortedPayments = useMemo(
    () =>
      [...payments].sort(
        (a, b) =>
          asTimestamp(b.payment_date || b.created_at) -
          asTimestamp(a.payment_date || a.created_at)
      ),
    [payments]
  );

  const lastPayment = Number(
    firstValue(sortedPayments[0]?.amount, sortedPayments[0]?.credit, 0)
  );

  const totalPages = Math.max(1, Math.ceil(creditHistory.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = creditHistory.slice(
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
    setEditingOpeningBalance(true);
  };

  const saveOpeningBalance = async () => {
    if (!canEditOpeningBalance || !selectedCustomer) return;

    const nextOpeningBalance = Number(openingBalanceInput || 0);
    if (!Number.isFinite(nextOpeningBalance)) {
      setError("Enter a valid opening balance.");
      return;
    }

    setSavingOpeningBalance(true);
    setError("");

    try {
      const openingBranchId = hasSpecificBranch ? selectedBranchId : null;
      let lookup = supabase
        .from("customer_branch_opening_balances")
        .select("id")
        .eq("customer_account_id", selectedCustomer.id)
        .limit(1);

      lookup = openingBranchId
        ? lookup.eq("customer_branch_id", openingBranchId)
        : lookup.is("customer_branch_id", null);

      const { data: existingRows, error: lookupError } = await lookup;
      if (lookupError) throw lookupError;

      const existingId = existingRows?.[0]?.id;
      const request = existingId
        ? supabase
            .from("customer_branch_opening_balances")
            .update({
              opening_balance: nextOpeningBalance,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingId)
        : supabase.from("customer_branch_opening_balances").insert({
            customer_account_id: selectedCustomer.id,
            customer_branch_id: openingBranchId,
            opening_balance: nextOpeningBalance,
          });

      const { error: saveError } = await request;
      if (saveError) throw saveError;

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

  const summaryCards = [
    {
      label: "Credit limit",
      value: accountCreditLimit,
    },
    {
      label: "Total Outstanding",
      value: snapshot?.customerSummary?.outstanding,
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
      label: "Available credit",
      value: snapshot?.customerSummary?.availableCredit,
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

          {historyOnlyRole && (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">
              History-only access
            </span>
          )}
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

      {snapshot?.legacyFallbackUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Temporary legacy payment compatibility is active for this account
          because matching new-table payment records were not found.
        </div>
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
              {formatCurrency(snapshot?.customerSummary?.outstanding || 0)}
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
                        <dd className="font-extrabold">{formatCurrency(branchSummary.outstanding || 0)}</dd>
                      </div>
                      {Number(branchSummary.creditLimit || 0) > 0 && (
                        <div>
                          <dt className="font-bold text-slate-500">Available credit</dt>
                          <dd className="font-extrabold">{formatCurrency(branchSummary.availableCredit || 0)}</dd>
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

      {(activeTab === "credit" || activeTab === "transactions") &&
         branchDetailsRequired && (
          <section className="rounded-2xl border border-blue-200 bg-blue-50 p-6 text-center shadow-sm">
            <h3 className="font-extrabold text-blue-900">
              Select a branch to view {activeTab === "credit" ? "Credit History" : "Transactions"}
            </h3>
            <p className="mt-2 text-sm font-semibold text-blue-700">
              The total account outstanding remains visible above.
            </p>
          </section>
        )}

      {(activeTab === "credit" || activeTab === "transactions") &&
        !branchDetailsRequired && (
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="sticky top-0 z-20 flex flex-col gap-2 border-b bg-white/95 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  {activeTab === "credit" ? "Credit History" : "Transactions"} ({creditHistory.length})
                </h3>
                <p className="text-sm text-slate-500">Newest transactions first.</p>
              </div>
              <div className="text-sm font-semibold text-slate-500">
                {creditHistory.length
                  ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}-${Math.min(
                      safePage * PAGE_SIZE,
                      creditHistory.length
                    )} of ${creditHistory.length}`
                  : "No transactions"}
              </div>
            </div>

            <div className="max-h-[62vh] w-full overflow-auto overscroll-contain">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-sm">
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="p-3">Date</th>
                                        {activeTab === "transactions" && (
                      <th className="p-3">Type</th>
                    )}
                    <th className="p-3">Reference</th>
                    <th className="p-3">Description</th>
                                        <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                    <th className="p-3">Status</th>
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
                        {row.transactionDate
                          ? new Date(row.transactionDate).toLocaleString("en-GB")
                          : "-"}
                      </td>
                      {activeTab === "transactions" && (
                        <td className="p-3 font-bold">{row.type}</td>
                      )}
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
                      {!historyOnlyRole && (
                        <td className="p-3">
                          <DocumentActions row={row} restricted={historyOnlyRole} />
                        </td>
                      )}
                    </tr>
                  ))}

                  {!pageRows.length && !loading && (
                    <tr>
                      <td
                        colSpan={(historyOnlyRole ? 7 : 8) + (activeTab === "transactions" ? 1 : 0)}
                        className="p-8 text-center text-slate-500"
                      >
                        No {activeTab === "credit" ? "credit history" : "transactions"} found.
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
    </div>
  );
}
