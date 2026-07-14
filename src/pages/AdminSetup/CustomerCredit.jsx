import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import { supabase } from "../../services/supabase";
import {
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";

const PAGE_SIZE = 20;
const BRANCH_SELECT = "__select__";
const ALL_BRANCHES = "__all__";

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
  const label = isInvoice ? (isPaidInvoice ? "Download" : "View") : "Receipt";

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
  const [selectedBranchId, setSelectedBranchId] = useState(ALL_BRANCHES);
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("summary");
  const [editingOpeningBalance, setEditingOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const [savingOpeningBalance, setSavingOpeningBalance] = useState(false);

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
          setSelectedCustomerId((value) => value || rows[0].id);
        }
      })
      .catch((loadError) =>
        setError(loadError.message || "Could not load customers.")
      );

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

  const branches = (selectedCustomer?.customer_branches || []).filter(
    (branch) => branch.active !== false
  );

  const hasBranches = branches.length > 0;
  const hasOneBranch = branches.length === 1;
  const hasMultipleBranches = branches.length > 1;
  const branchSelectionRequired =
    hasMultipleBranches && selectedBranchId === BRANCH_SELECT;
  const isAllBranches = selectedBranchId === ALL_BRANCHES;
  const snapshotBranchId =
    selectedBranchId === BRANCH_SELECT || selectedBranchId === ALL_BRANCHES
      ? ""
      : selectedBranchId;

  useEffect(() => {
    if (!selectedCustomer) {
      setSelectedBranchId(ALL_BRANCHES);
      return;
    }

    if (!hasBranches) {
      setSelectedBranchId(ALL_BRANCHES);
      return;
    }

    if (hasOneBranch) {
      setSelectedBranchId(String(branches[0].id));
      return;
    }

    setSelectedBranchId(BRANCH_SELECT);
  }, [selectedCustomer?.id]);

  useEffect(() => {
    if (!selectedCustomer) {
      setSnapshot(null);
      return;
    }

    if (selectedBranchId === BRANCH_SELECT) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId: snapshotBranchId,
    })
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError.message || "Could not load customer credit.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCustomer, selectedBranchId, snapshotBranchId]);

  useEffect(() => {
    setPage(1);
    setActiveTab("summary");
  }, [selectedCustomerId]);

  useEffect(() => {
    setPage(1);
  }, [selectedBranchId]);

  const hasSpecificBranch =
    selectedBranchId !== ALL_BRANCHES &&
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

  const summary = hasSpecificBranch
    ? snapshot?.branchSummary
    : snapshot?.customerSummary;

  const invoices = hasSpecificBranch
    ? snapshot?.selectedInvoices || []
    : snapshot?.allocatedInvoices || [];

  const payments = hasSpecificBranch
    ? snapshot?.selectedPayments || []
    : snapshot?.payments || [];


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
      const dateDifference =
        asTimestamp(b.transactionDate) - asTimestamp(a.transactionDate);

      if (dateDifference !== 0) return dateDifference;

      const createdDifference =
        asTimestamp(b.createdAt) - asTimestamp(a.createdAt);

      if (createdDifference !== 0) return createdDifference;

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

  const selectedInvoiceTotal = useMemo(
    () => invoices.reduce((sum, invoice) => sum + getInvoiceAmount(invoice), 0),
    [invoices]
  );

  const selectedPaymentTotal = useMemo(
    () => payments.reduce((sum, payment) => sum + getPaymentAmount(payment), 0),
    [payments]
  );

  const selectedOutstanding = Number(
    firstValue(
      hasSpecificBranch ? snapshot?.branchSummary?.outstanding : undefined,
      hasSpecificBranch ? snapshot?.branchSummary?.balance : undefined,
      selectedOpeningBalance + selectedInvoiceTotal - selectedPaymentTotal
    ) || 0
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

  const selectedAvailableCredit = Number(
    firstValue(
      hasSpecificBranch ? snapshot?.branchSummary?.availableCredit : undefined,
      hasSpecificBranch ? snapshot?.branchSummary?.available_credit : undefined,
      hasSpecificBranch
        ? accountCreditLimit - selectedOutstanding
        : snapshot?.customerSummary?.availableCredit,
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
      label: "Outstanding",
      value: hasSpecificBranch
        ? selectedOutstanding
        : snapshot?.customerSummary?.outstanding,
    },
    {
      label: "Available credit",
      value: hasSpecificBranch
        ? selectedAvailableCredit
        : snapshot?.customerSummary?.availableCredit,
    },
    {
      label: "Opening balance",
      value: selectedOpeningBalance,
      placeholder: branchSelectionRequired ? "Select branch" : "",
      isOpeningBalance: true,
    },
    {
      label: "Total invoices",
      value: hasSpecificBranch
        ? selectedInvoiceTotal
        : snapshot?.customerSummary?.invoiceTotal,
    },
    {
      label: "Total payments",
      value: hasSpecificBranch
        ? selectedPaymentTotal
        : snapshot?.customerSummary?.paymentTotal,
    },
    { label: "Last payment", value: lastPayment },
  ];

  return (
    <div className="space-y-4 p-4">
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

        <div className={`mt-4 grid grid-cols-1 gap-3 ${hasMultipleBranches ? "md:grid-cols-[1fr_1.2fr_1fr]" : "md:grid-cols-[1fr_1.2fr]"}`}>
          <input
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Search customer"
            className="rounded-xl border p-3"
          />

          <select
            value={selectedCustomerId}
            onChange={(event) => {
              setSelectedCustomerId(event.target.value);
              setSelectedBranchId(ALL_BRANCHES);
            }}
            className="rounded-xl border p-3"
          >
            {filteredCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.account_name}
              </option>
            ))}
          </select>

          {hasMultipleBranches && (
            <select
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              className="rounded-xl border p-3"
            >
              <option value={BRANCH_SELECT}>Select branch</option>
              <option value={ALL_BRANCHES}>All branches</option>
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

      {loading && (
        <div className="rounded-xl bg-slate-50 p-3 font-bold">
          Loading credit history...
        </div>
      )}

      {snapshot?.legacyFallbackUsed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          Temporary legacy compatibility is active for this account because
          matching new-table records were not found.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map(
          ({ label, value, placeholder, isOpeningBalance }) => (
            <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="text-xs font-bold uppercase text-slate-500">
                {label}
              </div>
              <div className="mt-1 text-xl font-extrabold text-slate-900">
                {placeholder || formatCurrency(Number(value || 0))}
              </div>

              {isOpeningBalance && canEditOpeningBalance && !branchSelectionRequired && (
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

      <div className="rounded-2xl border bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-2">
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
              className={`rounded-xl border px-4 py-2 text-sm font-bold ${
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
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="text-lg font-extrabold text-slate-900">Account Summary</h3>
          <p className="mt-1 text-sm text-slate-500">
            {hasSpecificBranch
              ? "All cards and history below are filtered to the selected branch."
              : hasMultipleBranches
              ? "The figures above show the total position across all branches."
              : hasOneBranch
              ? "This customer has one branch, which is selected automatically."
              : "This customer has no separate branches. Credit History and Transactions are available for the main account."}
          </p>
        </section>
      )}

      {(activeTab === "credit" || activeTab === "transactions") &&
        branchSelectionRequired && (
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
        !branchSelectionRequired && (
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

            <div className="max-h-[62vh] overflow-auto">
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
                      <td className="p-3 font-semibold">{row.reference}</td>
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

            <div className="flex items-center justify-between gap-3 border-t bg-white px-4 py-4">
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={safePage <= 1}
                className="rounded-xl border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <div className="text-sm font-bold text-slate-700">
                Page {safePage} of {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={safePage >= totalPages}
                className="rounded-xl border px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </section>
        )}
    </div>
  );
}
