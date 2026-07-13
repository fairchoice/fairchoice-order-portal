import { useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../../utils/currency";
import {
  loadCentralPaymentCustomers,
  loadReadOnlyCustomerCreditSnapshot,
} from "../../services/centralPaymentService";

const PAGE_SIZE = 20;

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
      : normalized.includes("PARTIAL") || normalized === "PENDING"
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
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("summary");

  const currentUser = getLoggedInUser();
  const userRole = String(
    currentUser?.role || currentUser?.access_level || ""
  ).toLowerCase();

  const historyOnlyRole =
    readOnly ||
    userRole.includes("sales") ||
    userRole.includes("server") ||
    userRole.includes("manager") ||
    userRole.includes("cash") ||
    userRole.includes("driver");

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
  const branchSelectionRequired = hasBranches && !selectedBranchId;

  useEffect(() => {
    if (!selectedCustomer) {
      setSnapshot(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError("");

    loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: selectedCustomer.id,
      customerName: selectedCustomer.account_name,
      customer: selectedCustomer,
      selectedBranchId,
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
  }, [selectedCustomer, selectedBranchId]);

  useEffect(() => {
    setPage(1);
    setActiveTab("summary");
  }, [selectedCustomerId]);

  useEffect(() => {
    setPage(1);
  }, [selectedBranchId]);

  const summary = selectedBranchId
    ? snapshot?.branchSummary
    : snapshot?.customerSummary;

  const invoices = selectedBranchId
    ? snapshot?.selectedInvoices || []
    : snapshot?.allocatedInvoices || [];

  const payments = selectedBranchId
    ? snapshot?.selectedPayments || []
    : snapshot?.payments || [];

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
    return (snapshot?.transactionHistory || [])
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
          status: firstValue(
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
          asTimestamp(b.transactionDate) - asTimestamp(a.transactionDate);

        if (dateDifference !== 0) return dateDifference;

        const createdDifference =
          asTimestamp(b.createdAt) - asTimestamp(a.createdAt);

        if (createdDifference !== 0) return createdDifference;

        return b.sortIndex - a.sortIndex;
      });
  }, [snapshot, invoiceByReference, paymentByReference]);

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

  const summaryCards = [
    { label: "Outstanding", value: snapshot?.customerSummary?.outstanding },
    { label: "Available credit", value: snapshot?.customerSummary?.availableCredit },
    {
      label: "Opening balance",
      value: selectedBranchId
        ? snapshot?.branchSummary?.openingBalance
        : hasBranches
        ? null
        : snapshot?.customerSummary?.openingBalance,
      placeholder: hasBranches && !selectedBranchId ? "Select branch" : "",
    },
    { label: "Total invoices", value: snapshot?.customerSummary?.invoiceTotal },
    { label: "Total payments", value: snapshot?.customerSummary?.paymentTotal },
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

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.2fr_1fr]">
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
            disabled={!hasBranches}
            className="rounded-xl border p-3 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="">{hasBranches ? "All branches" : "No branches"}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name}
              </option>
            ))}
          </select>
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
        {summaryCards.map(({ label, value, placeholder }) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-xs font-bold uppercase text-slate-500">
              {label}
            </div>
            <div className="mt-1 text-xl font-extrabold text-slate-900">
              {placeholder || formatCurrency(Number(value || 0))}
            </div>
          </div>
        ))}
      </div>

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
            {selectedBranchId
              ? "The account totals remain customer-wide. Opening balance and history are filtered to the selected branch."
              : hasBranches
              ? "The figures above show the total position across all branches. Select a branch to view its opening balance and history."
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
                        colSpan={historyOnlyRole ? 9 : 10}
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
