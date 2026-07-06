import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import {
  getOrderItemQty,
} from "../../utils/orderTotals";
import { calculateDocumentTotals } from "../../utils/documentTotals";
import {
  calculateCustomerCredit,
  getLedgerCredit,
  getLedgerDebit,
} from "../../utils/customerCredit";
import {
  allocateCustomerPaymentToInvoices,
  applyInvoicePaymentAllocations,
  loadProcessingQueueOrders,
  mergeOperationalOrders,
  mergeDeliveredOrderInvoicesIntoLedgerRows,
  printInvoice as printCentralInvoice,
} from "../../services/centralInvoiceEngine";

const DELIVERED_ORDERS_PAGE_SIZE = 3;
const HISTORY_PAGE_SIZE = 5;

export default function CustomerCredit() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [statementRows, setStatementRows] = useState([]);
  const [deliveredOrders, setDeliveredOrders] = useState([]);
  const [showDeliveredOrders, setShowDeliveredOrders] = useState(true);
  const [deliveredOrdersPage, setDeliveredOrdersPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [selectedBranch, setSelectedBranch] = useState("All Branches");
  const [activeTab, setActiveTab] = useState("summary");

  const [editOpeningBalance, setEditOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");
  const [editingPayment, setEditingPayment] = useState(null);
  const [paymentEditForm, setPaymentEditForm] = useState({
    amount: "",
    paymentType: "Cash",
    paymentDate: "",
    branchId: "",
    whoPaid: "",
    notes: "",
  });

  const loggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );
  const userRole = String(loggedInUser?.role || loggedInUser?.access_level || "").toLowerCase();
  const isSuperAdmin = userRole.includes("super admin");
  const isAdmin =
    isSuperAdmin ||
    userRole === "admin" ||
    loggedInUser?.permissions?.access_accounts === true;
  const canEditPaymentTransactions =
    userRole === "admin" ||
    isSuperAdmin ||
    loggedInUser?.permissions?.can_edit_payment_transactions === true ||
    loggedInUser?.permissions?.can_edit_transactions === true;
  const canRemovePaymentTransactions =
    isSuperAdmin ||
    loggedInUser?.permissions?.can_remove_payment_transactions === true ||
    loggedInUser?.permissions?.can_delete_transactions === true;

function formatCollectionSource(source) {
  if (!source) return "";

  const labels = {
    DRIVER_DELIVERY_COLLECTION: "Driver Delivery",
    DRIVER_PREVIOUS_BALANCE: "Driver Previous Balance",
    SALES_REP_PREVIOUS_BALANCE: "Sales Rep Previous Balance",
    OFFICE_COLLECTION: "Office Collection",
  };

  return labels[source] || source.replaceAll("_", " ");
}

  useEffect(() => {
    loadCustomers();
  }, []);

  useEffect(() => {
    if (selectedCustomer) {
      loadStatement(selectedCustomer);
    }
  }, [selectedCustomer, customers]);

  useEffect(() => {
    setDeliveredOrdersPage(1);
    setHistoryPage(1);
  }, [selectedCustomer, selectedBranch]);

      const loadCustomers = async () => {
        const { data, error } = await supabase
          .from("customer_accounts")
          .select("*, customer_branches(*)")
          .order("account_name");

        if (error) {
          alert("Could not load customers.");
          return;
        }

        setCustomers(data || []);

        if (data?.length && !selectedCustomer) {
          setSelectedCustomer(data[0].account_name);
        }
      };

      const isDeliveredOrderStatus = (status) =>
        ["delivered", "confirmed", "delivery confirmed", "completed"].includes(
          String(status || "").trim().toLowerCase()
        );

      const mapDeliveredOrder = (order) => ({
        dbId: order.id,
        orderId: order.order_number,
        customerBranchId: order.customer_branch_id || order.branch_id || "",
        customer_branch_id: order.customer_branch_id || order.branch_id || "",
        customerName: order.company_name,
        companyName: order.company_name,
        branchName:
          order.delivery_branch_name ||
          order.branch_name ||
          order.branchName ||
          order.shop_name ||
          order.shopName ||
          "",
        deliveryAddress:
          order.delivery_address || order.delivery_postcode || order.postcode || "",
        priceMode: order.price_mode || "vat",
        createdAt: order.created_at,
        deliveredAt: order.delivered_at || order.updated_at || order.created_at,
        status: order.status,
        items: (order.order_items || []).map((item) => ({
          dbId: item.id,
          id: item.product_id,
          productCode:
            item.product_code ||
            item.productCode ||
            item.sku ||
            item.code ||
            item.products?.product_code ||
            item.products?.code ||
            item.product?.product_code ||
            item.product?.code ||
            "",
          product_code:
            item.product_code ||
            item.productCode ||
            item.sku ||
            item.code ||
            item.products?.product_code ||
            item.products?.code ||
            item.product?.product_code ||
            item.product?.code ||
            "",
          products: item.products || null,
          product: item.product || item.products || null,
          name: item.product_name,
          productName: item.product_name,
          qty: Number(item.qty || item.quantity || 0),
          quantity: Number(item.quantity || item.qty || 0),
          selectedPrice: Number(item.price || item.unit_price || 0),
          price: Number(item.price || item.unit_price || 0),
          unit_price: Number(item.unit_price || item.price || 0),
          lineTotal: Number(item.line_total || item.lineTotal || 0),
          line_total: Number(item.line_total || item.lineTotal || 0),
          net_total: Number(item.net_total || item.netTotal || 0),
          gross_total: Number(item.gross_total || item.grossTotal || 0),
          vatRate: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
          vat_percent: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
          vatTotal: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
          vat_total: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
          sourceStatus: item.source_status || item.status || "In Stock",
          source_status: item.source_status || item.status || "In Stock",
          pickedQty: Number(item.picked_qty || item.qty || item.quantity || 0),
          includeInPicking: item.include_in_picking !== false,
          include_in_picking: item.include_in_picking !== false,
        })),
      });

      const loadDeliveredOrders = async (customer) => {
        if (!customer?.account_name) {
          setDeliveredOrders([]);
          return [];
        }

        const { data, error } = await supabase
          .from("orders")
          .select("*, order_items(*)")
          .or(
            `customer_account_id.eq.${customer.id},company_name.eq.${customer.account_name}`
          )
          .order("created_at", { ascending: false })
          .limit(100);

        if (error) {
          console.error("Could not load delivered customer orders:", error);
          setDeliveredOrders([]);
          return [];
        }

        const mappedDeliveredOrders = (data || [])
          .filter((order) => isDeliveredOrderStatus(order.status))
          .map(mapDeliveredOrder);
        const processingQueueOrders = await loadProcessingQueueOrders({
          customerAccountId: customer?.id,
          customerName: customer?.account_name,
        });
        const operationalOrders = mergeOperationalOrders(
          mappedDeliveredOrders,
          processingQueueOrders
        );

        setDeliveredOrders(operationalOrders);
        return operationalOrders;
      };

      const mergeDeliveredOrderInvoicesIntoStatement = (
        ledgerRows = [],
        deliveredOrderRows = []
      ) => {
        const invoiceReferences = new Set(
          (ledgerRows || [])
            .filter(
              (row) =>
                String(row.entry_type || row.transaction_type || "")
                  .trim()
                  .toUpperCase() === "INVOICE"
            )
            .map((row) => String(row.reference_no || row.order_number || "").trim())
            .filter(Boolean)
        );

        const fallbackInvoiceRows = deliveredOrderRows
          .filter((order) => {
            const referenceNo = String(order.orderId || "").trim();
            return referenceNo && !invoiceReferences.has(referenceNo);
          })
          .map((order) => {
            const totals = calculateDocumentTotals(order.items || [], order);

            return {
              id: `delivered-invoice-${order.orderId}`,
              created_at:
                order.deliveredAt || order.createdAt || new Date().toISOString(),
              entry_type: "INVOICE",
              transaction_type: "INVOICE",
              reference_no: order.orderId,
              order_number: order.orderId,
              description: "Invoice",
              debit: totals.grandTotal,
              credit: 0,
              amount: totals.grandTotal,
              invoice_amount: totals.grandTotal,
              invoice_status: "UNPAID",
              customer_name: order.companyName || order.customerName || "",
              branch_name: order.branchName || null,
              price_mode: order.priceMode || null,
              order_price_mode: order.priceMode || null,
            };
          });

        return [...ledgerRows, ...fallbackInvoiceRows].sort((a, b) => {
          const aTime = new Date(a.created_at || 0).getTime();
          const bTime = new Date(b.created_at || 0).getTime();
          return aTime - bTime;
        });
      };
     
      const loadStatement = async (customerName) => {
  const customer = customers.find(
    (c) => c.account_name === customerName
  );

  const { data: balanceRow } = await supabase
    .from("customer_opening_balances")
    .select("*")
    .eq("customer_name", customerName)
    .maybeSingle();

  setOpeningBalance(Number(balanceRow?.opening_balance || 0));

  let ledgerResult = customer?.id
    ? await supabase
        .from("customer_ledger")
        .select("*")
        .eq("customer_account_id", customer.id)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (!customer?.id || (!ledgerResult.error && !ledgerResult.data?.length)) {
    ledgerResult = await supabase
      .from("customer_ledger")
      .select("*")
      .eq("customer_name", customerName)
      .order("created_at", { ascending: true });
  }

  const { data, error } = ledgerResult;

  if (error) {
    alert("Could not load customer statement.");
    return;
  }

  const deliveredOrderRows = await loadDeliveredOrders(customer);
  setStatementRows(
    mergeDeliveredOrderInvoicesIntoLedgerRows(data || [], deliveredOrderRows)
  );
};

const toDateInputValue = (value) => {
  if (!value) return new Date().toISOString().split("T")[0];
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString().split("T")[0]
    : date.toISOString().split("T")[0];
};

const startEditPayment = (row) => {
  setEditingPayment(row);
  setPaymentEditForm({
    amount: String(row.credit || row.amount || row.payment_amount || ""),
    paymentType: row.payment_type || "Cash",
    paymentDate: toDateInputValue(row.created_at),
    branchId: String(row.branch_id || row.customer_branch_id || ""),
    whoPaid: row.paid_by || row.who_paid || "",
    notes: row.notes || "",
  });
};

const recalculateSelectedCustomerLedger = async () => {
  const customer = customers.find(
    (account) => account.account_name === selectedCustomer
  );

  await allocateCustomerPaymentToInvoices({
    customerAccountId: customer?.id,
    customerName: selectedCustomer,
  });
  await loadStatement(selectedCustomer);
};

const saveEditedPayment = async () => {
  if (!editingPayment?.id) return;

  const amount = Number(paymentEditForm.amount || 0);
  if (!amount || amount <= 0) {
    alert("Please enter payment amount.");
    return;
  }

  const branch = customerBranches.find(
    (item) => String(item.id) === String(paymentEditForm.branchId)
  );
  const paymentDate = paymentEditForm.paymentDate
    ? `${paymentEditForm.paymentDate}T12:00:00`
    : editingPayment.created_at;

  const payload = {
    created_at: paymentDate,
    credit: amount,
    amount,
    payment_amount: amount,
    payment_type: paymentEditForm.paymentType,
    branch_id: branch?.id || null,
    customer_branch_id: branch?.id || null,
    branch_name: branch?.branch_name || null,
    paid_by: paymentEditForm.whoPaid || null,
    who_paid: paymentEditForm.whoPaid || null,
    notes: paymentEditForm.notes || null,
  };

  const { error } = await supabase
    .from("customer_ledger")
    .update(payload)
    .eq("id", editingPayment.id);

  if (error) {
    alert("Could not update payment: " + error.message);
    return;
  }

  setEditingPayment(null);
  await recalculateSelectedCustomerLedger();
};

const removePayment = async (row) => {
  if (
    !window.confirm(
      "Are you sure you want to remove this payment? This will update customer credit and invoice balances."
    )
  ) {
    return;
  }

  const { error } = await supabase
    .from("customer_ledger")
    .delete()
    .eq("id", row.id);

  if (error) {
    alert("Could not remove payment: " + error.message);
    return;
  }

  await recalculateSelectedCustomerLedger();
};
       
  const saveOpeningBalance = async () => {
    if (!selectedCustomer) {
      alert("Please select a customer first.");
      return;
    }

    const { error } = await supabase
      .from("customer_opening_balances")
      .update({
        opening_balance: Number(openingBalanceInput || 0),
      })
      .eq("customer_name", selectedCustomer);

    if (error) {
      alert("Opening balance update failed: " + error.message);
      return;
    }

    setOpeningBalance(Number(openingBalanceInput || 0));
    setEditOpeningBalance(false);
    await loadCustomers();

    alert("Opening balance updated.");
  };

  const printStatement = () => {
    const statement = document.getElementById("statement-print");

    if (!statement) {
      alert("Statement section not found.");
      return;
    }

    const printContents = statement.innerHTML;
    const originalContents = document.body.innerHTML;

    document.body.innerHTML = `
      <div style="padding:20px">
        ${printContents}
      </div>
    `;

    window.print();

    document.body.innerHTML = originalContents;
    window.location.reload();
  };

  const getStatus = (row, balance) => {
    if (row.entry_type === "PAYMENT") return "Payment Received";

    if (row.entry_type === "INVOICE") {
      if (balance <= 0) return "Paid Invoice";
      if (balance < Number(row.debit || 0)) return "Part Paid Invoice";
      return "Unpaid Invoice";
    }

    return "";
  };

  const formatDocumentDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
  };

  const openInvoiceDocument = (order) => {
    printCentralInvoice(order);
  };

  let runningBalance = Number(openingBalance || 0);

  const selectedCustomerAccount = customers.find(
    (customer) => customer.account_name === selectedCustomer
  );
  const customerBranches = (selectedCustomerAccount?.customer_branches || []).filter(
    (branch) => branch.active !== false
  );
  const ledgerBranchNames = statementRows.map((row) => row.branch_name).filter(Boolean);
  const branches = [
    ...new Map(
      [
        ...customerBranches.map((branch) => [
          branch.branch_name,
          {
            id: branch.id,
            name: branch.branch_name,
            label: `${branch.branch_name}${branch.postcode ? ` - ${branch.postcode}` : ""}`,
          },
        ]),
        ...ledgerBranchNames.map((branchName) => [
          branchName,
          { id: branchName, name: branchName, label: branchName },
        ]),
      ].filter(([name]) => Boolean(name))
    ).values(),
  ];

  const filteredRows =
    selectedBranch === "All Branches"
      ? statementRows
      : statementRows.filter(
          (row) =>
            String(row.branch_id || row.customer_branch_id || "") ===
              String(selectedBranch) ||
            String(row.branch_name || "") === String(selectedBranch)
        );
  const allocatedFilteredRows = applyInvoicePaymentAllocations(filteredRows);
  const allocatedAllRows = applyInvoicePaymentAllocations(statementRows);

  const filteredDeliveredOrders =
    selectedBranch === "All Branches"
      ? deliveredOrders
      : deliveredOrders.filter(
          (order) =>
            String(order.customerBranchId || order.customer_branch_id || "") ===
              String(selectedBranch) ||
            String(order.branchName || "") === String(selectedBranch)
        );

  const deliveredOrdersPageCount = Math.max(
    1,
    Math.ceil(filteredDeliveredOrders.length / DELIVERED_ORDERS_PAGE_SIZE)
  );
  const currentDeliveredOrdersPage = Math.min(
    deliveredOrdersPage,
    deliveredOrdersPageCount
  );
  const paginatedDeliveredOrders = filteredDeliveredOrders.slice(
    (currentDeliveredOrdersPage - 1) * DELIVERED_ORDERS_PAGE_SIZE,
    currentDeliveredOrdersPage * DELIVERED_ORDERS_PAGE_SIZE
  );

  const filteredOpeningBalance =
    selectedBranch === "All Branches" ? Number(openingBalance || 0) : 0;
  let calculatedHistoryBalance = filteredOpeningBalance;
  const historyRowsWithBalance = allocatedFilteredRows.map((row) => {
    const debit = getLedgerDebit(row);
    const credit = getLedgerCredit(row);
    calculatedHistoryBalance += debit - credit;

    return {
      row,
      debit,
      credit,
      balance: calculatedHistoryBalance,
    };
  });
  const historyPageCount = Math.max(
    1,
    Math.ceil(historyRowsWithBalance.length / HISTORY_PAGE_SIZE)
  );
  const currentHistoryPage = Math.min(historyPage, historyPageCount);
  const paginatedHistoryRows = historyRowsWithBalance.slice(
    (currentHistoryPage - 1) * HISTORY_PAGE_SIZE,
    currentHistoryPage * HISTORY_PAGE_SIZE
  );

  const creditSummary = calculateCustomerCredit(
    selectedCustomerAccount,
    allocatedAllRows,
    openingBalance
  );
  const totalOutstanding = creditSummary.outstanding;
  const creditLimit = creditSummary.creditLimit;
  const availableCredit = creditSummary.availableCredit;
  const totalInvoiceAmount = allocatedAllRows.reduce(
    (sum, row) =>
      String(row.entry_type || row.transaction_type || "").toUpperCase() === "INVOICE"
        ? sum + getLedgerDebit(row)
        : sum,
    0
  );
  const totalPayments = allocatedAllRows.reduce(
    (sum, row) =>
      String(row.entry_type || row.transaction_type || "").toUpperCase() === "PAYMENT"
        ? sum + getLedgerCredit(row)
        : sum,
    0
  );
  const branchSummaryRows = branches.map((branch) => {
    const rows = allocatedAllRows.filter(
      (row) =>
        String(row.branch_id || row.customer_branch_id || "") === String(branch.id) ||
        String(row.branch_name || "") === String(branch.name)
    );

    return {
      ...branch,
      outstanding: rows.reduce(
        (total, row) => total + getLedgerDebit(row) - getLedgerCredit(row),
        0
      ),
    };
  });
  const transactionRows = allocatedFilteredRows;
  const getInvoiceLedgerRowForDeliveredOrder = (order = {}) => {
    const orderReference = String(order.orderId || order.order_number || "").trim();
    if (!orderReference) return null;

    return allocatedFilteredRows.find((row) => {
      const type = String(row.entry_type || row.transaction_type || "")
        .trim()
        .toUpperCase();
      const reference = String(row.reference_no || row.order_number || "").trim();
      return type === "INVOICE" && reference === orderReference;
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <h2 className="text-2xl font-bold">Customer Credit</h2>

        <button
          onClick={printStatement}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
        >
          Print / Save PDF
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-4 space-y-3">
        <label className="block text-sm font-bold">Customer</label>

        <div className="flex flex-col md:flex-row gap-2">
          <select
            value={selectedCustomer}
            onChange={(e) => {
              setSelectedCustomer(e.target.value);
              setSelectedBranch("All Branches");
              setEditOpeningBalance(false);
            }}
            className="border rounded-xl p-3 flex-1"
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.account_name}>
                {customer.account_name}
              </option>
            ))}
          </select>

          {isAdmin && (
            <button
              onClick={() => {
                setOpeningBalanceInput(openingBalance);
                setEditOpeningBalance(true);
              }}
              disabled={!selectedCustomer}
              className="bg-green-600 text-white px-4 py-3 rounded-xl font-bold disabled:bg-slate-300"
            >
              Edit Opening Balance
            </button>
          )}
        </div>

        {branches.length > 0 && (
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="border rounded-xl p-3 w-full"
          >
            <option value="All Branches">All Branches</option>
            {branches.map((branch) => (
              <option key={branch.id || branch.name} value={branch.id || branch.name}>
                {branch.label}
              </option>
            ))}
          </select>
        )}

        {editOpeningBalance && (
          <div className="flex flex-col md:flex-row gap-2">
            <input
              type="number"
              step="0.01"
              value={openingBalanceInput}
              onChange={(e) => setOpeningBalanceInput(e.target.value)}
              className="border rounded-xl p-3 flex-1"
              placeholder="Opening Balance"
            />

            <button
              onClick={saveOpeningBalance}
              className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
            >
              Save
            </button>

            <button
              onClick={() => setEditOpeningBalance(false)}
              className="bg-slate-500 text-white px-5 py-3 rounded-xl font-bold"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
    {[
  ["summary", "Summary"],
  ["history", "Credit History"],
  ["deliveredOrders", "Delivered Orders"],
  ["transactions", "Transactions"],
].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-xl text-sm font-bold ${
              activeTab === key
                ? "bg-blue-700 text-white"
                : "bg-slate-100 text-slate-700 border"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "summary" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="bg-white border rounded-2xl p-4">
              <div className="text-sm font-bold text-slate-500">Total Outstanding</div>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(totalOutstanding)}
              </div>
            </div>

            <div className="bg-white border rounded-2xl p-4">
              <div className="text-sm font-bold text-slate-500">Opening Balance</div>
              <div className="text-2xl font-bold">{formatCurrency(openingBalance)}</div>
            </div>

            <div className="bg-white border rounded-2xl p-4">
              <div className="text-sm font-bold text-slate-500">Total Invoice Amount</div>
              <div className="text-2xl font-bold">{formatCurrency(totalInvoiceAmount)}</div>
            </div>

            <div className="bg-white border rounded-2xl p-4">
              <div className="text-sm font-bold text-slate-500">Total Payments</div>
              <div className="text-2xl font-bold text-green-700">
                {formatCurrency(totalPayments)}
              </div>
            </div>

            <div className="bg-white border rounded-2xl p-4">
              <div className="text-sm font-bold text-slate-500">Available Credit</div>
              <div className="text-2xl font-bold text-green-700">
                {formatCurrency(availableCredit)}
              </div>
            </div>
          </div>

          {branchSummaryRows.length > 0 && (
            <div className="bg-white border rounded-2xl p-4">
              <h3 className="font-bold text-lg mb-3">Branch Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {branchSummaryRows.map((branch) => (
                  <div
                    key={branch.id || branch.name}
                    className="border rounded-xl p-3 bg-slate-50"
                  >
                    <div className="text-sm font-bold text-slate-600">
                      {branch.label}
                    </div>
                    <div className="text-xl font-extrabold">
                      {formatCurrency(branch.outstanding)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-4">
          <div id="statement-print" className="overflow-auto border rounded-2xl bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-3 text-left">Date</th>
                  <th className="p-3 text-left">Reference</th>
                  <th className="p-3 text-left">Description</th>
                  <th className="p-3 text-right">Debit</th>
                  <th className="p-3 text-right">Credit</th>
                  <th className="p-3 text-right">Balance</th>
                </tr>
              </thead>

              <tbody>
                {currentHistoryPage === 1 && selectedBranch === "All Branches" && (
                  <tr className="border-t bg-blue-50">
                    <td className="p-3">-</td>
                    <td className="p-3">Opening Balance</td>
                    <td className="p-3">Opening Balance</td>
                    <td className="p-3 text-right">{formatCurrency(openingBalance)}</td>
                    <td className="p-3 text-right">-</td>
                    <td className="p-3 text-right font-bold">
                      {formatCurrency(openingBalance)}
                    </td>
                  </tr>
                )}

                {paginatedHistoryRows.map(({ row, debit, credit, balance }) => {
                  const description =
                    row.entry_type === "INVOICE"
                      ? "Invoice"
                      : row.entry_type === "PAYMENT"
                      ? `Payment${row.payment_type ? ` - ${row.payment_type}` : ""}`
                      : row.entry_type || "Transaction";

                  return (
                    <tr key={row.id} className="border-t">
                      <td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td>
                      <td className="p-3">{row.reference_no || "-"}</td>
                      <td className="p-3">{description}</td>
                      <td className="p-3 text-right">{debit ? formatCurrency(debit) : "-"}</td>
                      <td className="p-3 text-right">{credit ? formatCurrency(credit) : "-"}</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(balance)}</td>
                    </tr>
                  );
                })}

                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-5 text-center text-slate-500">
                      No credit history found for this customer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {historyPageCount > 1 && (
              <div className="flex items-center justify-end gap-2 p-3 text-sm border-t">
                <button
                  type="button"
                  onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}
                  disabled={currentHistoryPage === 1}
                  className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="font-bold">
                  Page {currentHistoryPage} / {historyPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryPage((page) => Math.min(historyPageCount, page + 1))
                  }
                  disabled={currentHistoryPage === historyPageCount}
                  className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "deliveredOrders" && (
        <div className="space-y-4">
          {filteredDeliveredOrders.length > 0 ? (
            <div className="border rounded-2xl bg-white p-4">
              <div className="space-y-2">
                {paginatedDeliveredOrders.map((order) => {
                  const orderTotals = calculateDocumentTotals(order.items || [], order);
                  const invoiceLedgerRow =
                    getInvoiceLedgerRowForDeliveredOrder(order);
                  const invoiceStatus = String(
                    invoiceLedgerRow?.invoice_status || "UNPAID"
                  ).toUpperCase();

                  return (
                    <div
                      key={order.dbId || order.orderId}
                      className="border rounded-xl p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"
                    >
                      <div>
                        <div className="font-bold">
                          {order.orderId || "-"}
                          {order.branchName ? ` | ${order.branchName}` : ""}
                        </div>
                        <div className="text-xs text-slate-500">
                          {formatDocumentDate(order.createdAt || order.created_at)} |{" "}
                          {String(order.priceMode || "-").toUpperCase()} |{" "}
                          {formatCurrency(orderTotals.grandTotal)} | Total Qty:{" "}
                          {orderTotals.totalQty}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {invoiceStatus === "PAID" ? (
                          <button
                            type="button"
                            onClick={() => openInvoiceDocument(order)}
                            className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                          >
                            Download Invoice
                          </button>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 px-3 py-2 rounded-lg text-xs font-bold">
                            Unpaid Invoice
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {deliveredOrdersPageCount > 1 && (
                <div className="flex items-center justify-end gap-2 mt-3 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveredOrdersPage((page) => Math.max(1, page - 1))
                    }
                    disabled={currentDeliveredOrdersPage === 1}
                    className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="font-bold">
                    Page {currentDeliveredOrdersPage} / {deliveredOrdersPageCount}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveredOrdersPage((page) =>
                        Math.min(deliveredOrdersPageCount, page + 1)
                      )
                    }
                    disabled={currentDeliveredOrdersPage === deliveredOrdersPageCount}
                    className="px-3 py-1 rounded-lg border font-bold disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="border rounded-2xl bg-white p-5 text-center text-slate-500">
              No delivered orders found for this customer.
            </div>
          )}
        </div>
      )}

      {activeTab === "transactions" && (
        <div className="space-y-3">
        {editingPayment && (
          <div className="border rounded-2xl bg-white p-4 space-y-3">
            <h3 className="font-bold text-lg">Edit Payment</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                type="number"
                step="0.01"
                value={paymentEditForm.amount}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    amount: e.target.value,
                  })
                }
                className="border rounded-xl p-3"
                placeholder="Payment Amount"
              />

              <select
                value={paymentEditForm.paymentType}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    paymentType: e.target.value,
                  })
                }
                className="border rounded-xl p-3 bg-white"
              >
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Card">Card</option>
                <option value="Cheque">Cheque</option>
                <option value="Account">Account</option>
              </select>

              <input
                type="date"
                value={paymentEditForm.paymentDate}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    paymentDate: e.target.value,
                  })
                }
                className="border rounded-xl p-3"
              />

              <select
                value={paymentEditForm.branchId}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    branchId: e.target.value,
                  })
                }
                className="border rounded-xl p-3 bg-white"
              >
                <option value="">No Branch</option>
                {customerBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.branch_name}
                    {branch.postcode ? ` - ${branch.postcode}` : ""}
                  </option>
                ))}
              </select>

              <input
                value={paymentEditForm.whoPaid}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    whoPaid: e.target.value,
                  })
                }
                className="border rounded-xl p-3"
                placeholder="Who Paid"
              />

              <input
                value={paymentEditForm.notes}
                onChange={(e) =>
                  setPaymentEditForm({
                    ...paymentEditForm,
                    notes: e.target.value,
                  })
                }
                className="border rounded-xl p-3"
                placeholder="Notes"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={saveEditedPayment}
                className="bg-green-700 text-white px-4 py-2 rounded-xl text-sm font-bold"
              >
                Save Payment
              </button>
              <button
                type="button"
                onClick={() => setEditingPayment(null)}
                className="bg-white border px-4 py-2 rounded-xl text-sm font-bold"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="overflow-auto border rounded-2xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Entered By</th>
                {(canEditPaymentTransactions || canRemovePaymentTransactions) && (
                  <th className="p-3 text-right">Actions</th>
                )}
              </tr>
            </thead>

            <tbody>
              {transactionRows.map((row) => {
                const type = String(row.entry_type || row.transaction_type || "")
                  .trim()
                  .toUpperCase();
                const isInvoice = type === "INVOICE";
                const isPayment = type === "PAYMENT";
                const amount = isInvoice
                  ? Number(row.debit || row.amount || row.invoice_amount || 0)
                  : Number(row.credit || row.amount || row.payment_amount || 0);

                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      {isInvoice
                        ? "Invoice"
                        : formatCollectionSource(row.collection_source) ||
                          row.payment_type ||
                          "Payment"}
                    </td>
                    <td className="p-3">{row.reference_no || "-"}</td>
                    <td
                      className={`p-3 text-right font-bold ${
                        isInvoice ? "text-red-700" : "text-green-700"
                      }`}
                    >
                      {isInvoice ? "" : "-"}
                      {formatCurrency(amount)}
                    </td>
                    <td className="p-3">
                      {row.received_by ||
                        row.collected_by_name ||
                        row.paid_by ||
                        row.confirmed_by ||
                        "-"}
                    </td>
                    {(canEditPaymentTransactions || canRemovePaymentTransactions) && (
                      <td className="p-3 text-right">
                        {isPayment && row.id && !String(row.id).startsWith("delivered-invoice-") ? (
                          <div className="flex justify-end gap-2">
                            {canEditPaymentTransactions && (
                              <button
                                type="button"
                                onClick={() => startEditPayment(row)}
                                className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                              >
                                Edit
                              </button>
                            )}
                            {canRemovePaymentTransactions && (
                              <button
                                type="button"
                                onClick={() => removePayment(row)}
                                className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}

              {transactionRows.length === 0 && (
                <tr>
                  <td
                    colSpan={
                      canEditPaymentTransactions || canRemovePaymentTransactions ? 6 : 5
                    }
                    className="p-5 text-center text-slate-500"
                  >
                    No transactions found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}
    </div>
  );
}
