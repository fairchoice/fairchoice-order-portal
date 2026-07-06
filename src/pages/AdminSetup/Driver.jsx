import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import { calculateDocumentTotals } from "../../utils/documentTotals";
import {
  allocateCustomerPaymentToInvoices,
  createOrUpdateInvoiceForDeliveredOrder,
  loadCustomerOutstandingSnapshot,
  printThermalReceipt,
} from "../../services/centralInvoiceEngine";
import { saveConfirmedServerManagerOrderToProcessingQueue } from "../../services/orders";
import ReturnRequestModal from "../../components/ReturnRequestModal";

export default function Driver({
  orders = [],
  changeOrderStatus = () => {},
  updateOrderExtraFields = () => {},
  refreshOrders = async () => {},
}) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState("All");
  const [cashCollectionOrder, setCashCollectionOrder] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState("");
  const [selectedCreditBranchId, setSelectedCreditBranchId] = useState("");

  const [creditCustomers, setCreditCustomers] = useState([]);


const [savingPayment, setSavingPayment] = useState(false);
const [previousBalanceOutstanding, setPreviousBalanceOutstanding] = useState({
  totalOutstanding: 0,
  branchOutstanding: {},
});
const [cashCollectionOutstanding, setCashCollectionOutstanding] = useState({
  totalOutstanding: 0,
  branchOutstanding: {},
});

const loggedInUser = JSON.parse(
  localStorage.getItem("loggedInUser") || "{}"
);

const legacyTestTextValues = new Set(["nisstaj", "test", "test user", "test receiver"]);
const isLegacyTestText = (value) =>
  legacyTestTextValues.has(String(value || "").trim().toLowerCase());
const isLegacyTestAmount = (value) => Number(value || 0) === 500;
const cleanLegacyTestText = (value) => (isLegacyTestText(value) ? "" : value || "");
const cleanLegacyTestAmount = (value, order = {}) => {
  const hasLegacyName =
    isLegacyTestText(order.paidBy || order.paid_by) ||
    isLegacyTestText(order.receivedBy || order.received_by);
  return isLegacyTestAmount(value) && hasLegacyName ? "" : value || "";
};

  const getDriverTotals = (order) =>
    calculateDocumentTotals(order.items || [], order);

  const getDriverItems = (order) => getDriverTotals(order).invoiceItems;

  const [showPreviousBalance, setShowPreviousBalance] = useState(false);

  const [previousBalanceForm, setPreviousBalanceForm] = useState({
  amount: "",
  paymentType: "Cash",
  whoPaid: "",
  notes: "",
  });
 
  const [paymentForm, setPaymentForm] = useState({
  paymentType: "Cash",
  paymentAmount: "",
  paymentCollected: "Yes",
  paidBy: "",  
  receivedBy: "",
  paymentAppliesTo: "Today Invoice",
});

useEffect(() => {
  refreshOrders();
}, []);

useEffect(() => {
  loadCreditCustomers();
}, []);

const loadCreditCustomers = async () => {
  const { data, error } = await supabase
    .from("customer_accounts")
  .select("id, account_name, customer_branches(*)")
    .order("account_name");

  if (error) {
    console.error(error);
    alert("Could not load customers.");
    return;
  }

  setCreditCustomers(data || []);
};

const selectedCreditCustomer = creditCustomers.find(
  (customer) => String(customer.id) === String(selectedCreditCustomerId)
);

const selectedCreditBranches =
  selectedCreditCustomer?.customer_branches?.filter(
    (branch) => branch.active !== false
  ) || [];

const selectedCreditBranch = selectedCreditBranches.find(
  (branch) => String(branch.id) === String(selectedCreditBranchId)
);

useEffect(() => {
  let active = true;

  const loadOutstanding = async () => {
    if (!selectedCreditCustomer) {
      setPreviousBalanceOutstanding({ totalOutstanding: 0, branchOutstanding: {} });
      return;
    }

    try {
      const snapshot = await loadCustomerOutstandingSnapshot({
        customerAccountId: selectedCreditCustomer.id,
        customerName: selectedCreditCustomer.account_name,
      });

      if (active) setPreviousBalanceOutstanding(snapshot);
    } catch (error) {
      console.error("Driver outstanding load error:", error);
      if (active) {
        setPreviousBalanceOutstanding({ totalOutstanding: 0, branchOutstanding: {} });
      }
    }
  };

  loadOutstanding();

  return () => {
    active = false;
  };
}, [selectedCreditCustomer?.id]);

  const driverNames = [
    "All",
    ...new Set(
      orders
        .filter((order) =>
          ["Ready For Driver", "Delivered"].includes(order.status)
        )
        .map((order) => order.driverName || order.driver_name)
        .filter(Boolean)
    ),
  ];

      const driverOrders = orders.filter((order) => {
  const driverName = order.driverName || order.driver_name;

  const isReadyForDriver = order.status === "Ready For Driver";

  const isDeliveredWaitingPayment =
    order.status === "Delivered" &&
    !order.paymentType &&
    !order.payment_type &&
    order.paymentCollected !== "Yes" &&
    order.payment_collected !== "Yes" &&
    order.paymentCollected !== true &&
    order.payment_collected !== true;

  const matchesDriver =
    selectedDriver === "All" || driverName === selectedDriver;

  return (isReadyForDriver || isDeliveredWaitingPayment) && matchesDriver;
  });

        const openCashCollection = async (order) => {
          setCashCollectionOrder(order.orderId);
          setCashCollectionOutstanding({ totalOutstanding: 0, branchOutstanding: {} });

          setPaymentForm({
      paymentType: order.paymentType || "Cash",
      paymentAmount: cleanLegacyTestAmount(order.paymentAmount || order.payment_amount, order),
      paymentCollected: order.paymentCollected || "Yes",
      paidBy: cleanLegacyTestText(order.paidBy || order.paid_by),
      receivedBy: cleanLegacyTestText(order.receivedBy || order.received_by),
      paymentAppliesTo: order.paymentAppliesTo || "Today Invoice",
    });

    try {
      const snapshot = await loadCustomerOutstandingSnapshot({
        customerAccountId: order.customerAccountId || order.customer_account_id,
        customerName: order.companyName || order.company_name,
      });
      setCashCollectionOutstanding(snapshot);
    } catch (error) {
      console.error("Cash collection outstanding load error:", error);
    }
        };

  const savePreviousBalancePayment = async () => {
  const paymentAmount = Number(previousBalanceForm.amount || 0);

  if (!selectedCreditCustomer) {
    alert("Please select customer.");
    return;
  }

  if (selectedCreditBranches.length > 0 && !selectedCreditBranch) {
    alert("Please select branch / shop.");
    return;
  }

  if (!paymentAmount || paymentAmount <= 0) {
    alert("Please enter amount.");
    return;
  }

  if (!previousBalanceForm.whoPaid.trim()) {
    alert("Please enter who paid.");
    return;
  }

  if (isLegacyTestText(previousBalanceForm.whoPaid)) {
    alert("Please replace the test payer name before saving.");
    return;
  }

  const selectedOutstanding = selectedCreditBranch
    ? Number(
        previousBalanceOutstanding.branchOutstanding[selectedCreditBranch.id] ??
          previousBalanceOutstanding.branchOutstanding[
            selectedCreditBranch.branch_name
          ] ??
          0
      )
    : Number(previousBalanceOutstanding.totalOutstanding || 0);

  if (
    selectedOutstanding > 0 &&
    paymentAmount > selectedOutstanding &&
    !window.confirm(
      "Payment is higher than selected branch outstanding. Continue?"
    )
  ) {
    return;
  }

  const { error } = await supabase.from("customer_ledger").insert({
    customer_account_id: selectedCreditCustomer.id,
    customer_branch_id: selectedCreditBranch?.id || null,
    branch_id: selectedCreditBranch?.id || null,
    branch_name: selectedCreditBranch?.branch_name || null,
    customer_name: selectedCreditCustomer.account_name,
    entry_type: "PAYMENT",
    transaction_type: "PAYMENT",
    description: "Payment",
    reference_no: "PREVIOUS_BALANCE",

    debit: 0,
    credit: paymentAmount,
    amount: paymentAmount,
    payment_amount: paymentAmount,

    payment_type: previousBalanceForm.paymentType,
    payment_applies_to: "PREVIOUS_BALANCE",
    paid_by: previousBalanceForm.whoPaid || null,
    who_paid: previousBalanceForm.whoPaid || null,
       collection_source: "DRIVER_PREVIOUS_BALANCE",

    received_by: loggedInUser.name || loggedInUser.username || null,
    received_by_username: loggedInUser.username || null,
    received_by_role: loggedInUser.role || null,
    received_by_staff_id: loggedInUser.id || loggedInUser.staff_id || null,

    notes:
      previousBalanceForm.notes ||
      `Driver previous balance collection - ${previousBalanceForm.paymentType}`,
  });

  if (error) {
    alert("Could not save previous balance payment: " + error.message);
    return;
  }

  await allocateCustomerPaymentToInvoices({
    customerAccountId: selectedCreditCustomer.id,
    customerName: selectedCreditCustomer.account_name,
  });

  alert("Previous Balance Payment saved successfully.");

  setPreviousBalanceForm({
    amount: "",
    paymentType: "Cash",
    whoPaid: "",
    notes: "",
  });

  setSelectedCreditCustomerId("");
  setSelectedCreditBranchId("");
  setShowPreviousBalance(false);
};

  const confirmDelivery = async (order, confirmedBy) => {
  try {
    await updateOrderExtraFields(order.orderId, {
      delivered_confirmed_by: confirmedBy,
    });

    const getInvoiceStatusClass = (status) => {
  if (status === "PAID") return "status-paid";
  if (status === "PART PAID") return "status-part-paid";
  return "status-unpaid";
  };

    await changeOrderStatus(order.orderId, "Delivered");

    await createOrUpdateInvoiceForDeliveredOrder({
      order,
      confirmedBy,
      currentUser: loggedInUser,
    });

    openCashCollection(order);
  } catch (error) {
    console.error("Delivery confirmation error:", error);
    alert("Could not confirm delivery: " + error.message);
  }
};

const moveBackToWarehouse = async (order) => {
  if (order.status === "Delivered") return;
  if (!window.confirm("Move this order back to Warehouse?")) return;

  await changeOrderStatus(order.orderId, "Warehouse Packing");
  await refreshOrders();
};

const printDeliveryNoteDocument = (order) => {
  const items = getDriverItems(order);
  const html = `
    <html>
      <head>
        <title>Delivery Note - ${order.orderId || order.order_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
          h1 { margin: 0 0 12px; }
          table { width: 100%; border-collapse: collapse; margin-top: 18px; }
          th, td { border-bottom: 1px solid #ddd; padding: 8px; text-align: left; }
          th:last-child, td:last-child { text-align: right; }
        </style>
      </head>
      <body>
        <h1>Delivery Note</h1>
        <div><strong>Order Number:</strong> ${order.orderId || order.order_number || "-"}</div>
        <div><strong>Customer:</strong> ${order.companyName || order.company_name || "-"}</div>
        <div><strong>Date:</strong> ${order.createdAt || order.created_at || "-"}</div>
        <table>
          <thead><tr><th>Product</th><th>Qty</th></tr></thead>
          <tbody>
            ${items
              .map(
                (item) =>
                  `<tr><td>${item.name || item.productName || item.product_name || ""}</td><td>${item.pickedQty ?? item.qty ?? 0}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
        <script>window.print();</script>
      </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=800,height=700");
  if (!win) {
    alert("Popup blocked. Please allow popups to print the delivery note.");
    return;
  }

  win.document.write(html);
  win.document.close();
};

  const saveCashCollection = async (order) => {

      if (savingPayment) return;
    setSavingPayment(true);
  try {

  
    const paymentType = paymentForm.paymentType;
    const paymentCollected = paymentForm.paymentCollected;
    const paymentAmount = Number(paymentForm.paymentAmount || 0);

    // Only require amount + paid by when money was actually collected
   if (paymentCollected === "Yes") {
      if (!paymentAmount || paymentAmount <= 0) {
        alert("Please enter payment amount.");
        return;
      }

      if (!paymentForm.paidBy.trim()) {
        alert("Please enter who paid.");
        return;
      }

      if (isLegacyTestText(paymentForm.paidBy) || isLegacyTestText(paymentForm.receivedBy)) {
        alert("Please replace test payer/receiver names before saving.");
        return;
      }

      if (isLegacyTestAmount(paymentAmount) && isLegacyTestText(order.paidBy || order.paid_by)) {
        alert("Please replace the old test payment amount before saving.");
        return;
      }
    }

    const orderBranchKey =
      order.customerBranchId || order.customer_branch_id || order.branchName || order.branch_name;
    const orderBranchOutstanding = orderBranchKey
      ? Number(
          cashCollectionOutstanding.branchOutstanding[orderBranchKey] ??
            cashCollectionOutstanding.branchOutstanding[
              order.branchName || order.branch_name
            ] ??
            0
        )
      : Number(cashCollectionOutstanding.totalOutstanding || 0);

    if (
      paymentCollected === "Yes" &&
      paymentAmount > 0 &&
      orderBranchOutstanding > 0 &&
      paymentAmount > orderBranchOutstanding &&
      !window.confirm(
        "Payment is higher than selected branch outstanding. Continue?"
      )
    ) {
      return;
    }

    const cashCollectionPayload = {
      payment_type: paymentType,

      payment_amount:
        paymentType === "Credit" || paymentCollected === "No"
          ? 0
          : paymentAmount,

      payment_collected:
        paymentType === "Credit" ? "No" : paymentCollected,

      paid_by:
        paymentType === "Credit" || paymentCollected === "No"
          ? ""
          : paymentForm.paidBy,

      received_by:
        paymentType === "Credit" || paymentCollected === "No"
          ? ""
          : paymentForm.receivedBy,
    };

    console.log("[Driver] saveCashCollection updateOrderExtraFields", {
      orderNumber: order.orderId || order.order_number,
      priceMode: order.priceMode || order.price_mode,
      status: order.status,
      payload: cashCollectionPayload,
    });

    await updateOrderExtraFields(order.orderId, cashCollectionPayload);

    console.log("[Driver] saveCashCollection calling ProcessingQueue save", {
      orderNumber: order.orderId || order.order_number,
      priceMode: order.priceMode || order.price_mode,
      itemCount: (order.items || order.order_items || []).length,
    });

    const processingQueueResult =
      await saveConfirmedServerManagerOrderToProcessingQueue({
        orderNumber: order.orderId || order.order_number,
        confirmedAt:
          order.deliveredAt ||
          order.delivered_at ||
          order.delivery_confirmed_at ||
          order.confirmed_at ||
          new Date().toISOString(),
        fallbackOrder: {
          ...order,
          ...cashCollectionPayload,
          order_number: order.order_number || order.orderId,
          price_mode: order.price_mode || order.priceMode,
          order_items: order.order_items || order.items || [],
        },
      });

    console.log("[Driver] ProcessingQueue save result", {
      orderNumber: order.orderId || order.order_number,
      result: processingQueueResult,
    });

    // Ledger payment only if money collected
    if (paymentCollected === "Yes" && paymentAmount > 0) {
      

  const { error: ledgerError } = await supabase
  .from("customer_ledger")
  .insert({
    customer_account_id: order.customerAccountId || order.customer_account_id || null,
    customer_branch_id: order.customerBranchId || order.customer_branch_id || null,
    branch_id: order.customerBranchId || order.customer_branch_id || null,
    branch_name: order.branchName || order.branch_name || null,
    customer_name: order.companyName || "Unknown Customer",

    entry_type: "PAYMENT",
    transaction_type: "PAYMENT",
    description: "Payment",
    created_at: new Date().toISOString(),

    reference_no: order.orderId,

    debit: 0,
    credit: paymentAmount,
    amount: paymentAmount,
    payment_amount: paymentAmount,

    payment_type: paymentType,
    payment_applies_to: paymentForm.paymentAppliesTo,
   
    collection_source: "DRIVER_DELIVERY_COLLECTION",
    who_paid: paymentForm.paidBy || null,
    paid_by: paymentForm.paidBy || null,
    received_by: paymentForm.receivedBy || loggedInUser.name || loggedInUser.username || null,
    received_by_username: loggedInUser.username || null,
    received_by_role: loggedInUser.role || null,
    received_by_staff_id: loggedInUser.id || null,
    collected_by: loggedInUser.id || loggedInUser.staff_id || null,
    collected_by_name: loggedInUser.name || loggedInUser.username || null,
    collected_by_username: loggedInUser.username || null,
    collected_by_role: loggedInUser.role || null,

    notes: `Driver cash collection - ${paymentType}`,
  });


if (ledgerError) throw ledgerError;

await allocateCustomerPaymentToInvoices({
  customerAccountId: order.customerAccountId || order.customer_account_id,
  customerName: order.companyName || order.company_name || "Unknown Customer",
});
    }

        alert("Cash collection saved.");
    setCashCollectionOrder(null);
    await refreshOrders();
  } catch (error) {
    console.error("Cash collection error:", error);
    alert("Could not save cash collection: " + error.message);
  } finally {
    setSavingPayment(false);
  }
};

  return (
    <div className="p-4">
      <div className="mb-4 text-center">
        <h2 className="text-2xl font-bold">Driver Portal</h2>
      </div>

      <div className="mb-4 flex justify-end">
  <button
   onClick={() => setShowPreviousBalance(!showPreviousBalance)}
    className="bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold"
  >
    Previous Balance
  </button>
</div>

                {showPreviousBalance && (
  <div className="mb-4 border rounded-2xl p-4 bg-slate-50 space-y-3">
    <h3 className="font-bold text-center">Previous Balance Collection</h3>

      <select
        value={selectedCreditCustomerId}
        onChange={(e) => setSelectedCreditCustomerId(e.target.value)}
        className="w-full border rounded-xl p-3 bg-white"
      >
        <option value="">Select Customer</option>

        {creditCustomers.map((customer) => (
          <option
            key={customer.id}
            value={customer.id}
          >
            {customer.account_name}
          </option>
        ))}
      </select>

      <select
  value={selectedCreditBranchId}
  onChange={(e) => setSelectedCreditBranchId(e.target.value)}
  className="w-full border rounded-xl p-3 bg-white"
  disabled={!selectedCreditCustomerId}
>
  <option value="">Select Branch / Shop</option>

  {selectedCreditBranches.map((branch) => (
    <option key={branch.id} value={branch.id}>
      {branch.branch_name}
      {branch.postcode ? ` - ${branch.postcode}` : ""}
    </option>
  ))}
  
</select>

{selectedCreditCustomer && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
    <div className="border rounded-xl p-3 bg-white">
      <div className="text-xs font-bold text-slate-500">Customer outstanding</div>
      <div className="text-xl font-extrabold text-red-700">
        {formatCurrency(previousBalanceOutstanding.totalOutstanding || 0)}
      </div>
    </div>

    {selectedCreditBranch && (
      <div className="border rounded-xl p-3 bg-white">
        <div className="text-xs font-bold text-slate-500">
          Selected branch outstanding
        </div>
        <div className="text-xl font-extrabold text-red-700">
          {formatCurrency(
            previousBalanceOutstanding.branchOutstanding[selectedCreditBranch.id] ??
              previousBalanceOutstanding.branchOutstanding[
                selectedCreditBranch.branch_name
              ] ??
              0
          )}
        </div>
      </div>
    )}
  </div>
)}

    <input
      type="number"
      placeholder="Amount Collected"
      value={previousBalanceForm.amount}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          amount: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

    <select
      value={previousBalanceForm.paymentType}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          paymentType: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3 bg-white"
    >
      <option value="Cash">Cash</option>
      <option value="Bank Transfer">Bank Transfer</option>
      <option value="Card">Card</option>
      <option value="Cheque">Cheque</option>
    </select>

    <input
      placeholder="Who paid / shop staff name"
      value={previousBalanceForm.whoPaid}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          whoPaid: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

    <textarea
      placeholder="Notes"
      value={previousBalanceForm.notes}
      onChange={(e) =>
        setPreviousBalanceForm({
          ...previousBalanceForm,
          notes: e.target.value,
        })
      }
      className="w-full border rounded-xl p-3"
    />

      <button
        type="button"
        onClick={savePreviousBalancePayment}
        className="w-full bg-green-700 text-white py-3 rounded-xl font-bold"
      >
        Save Previous Balance Payment
      </button>
          </div>
        )}

      <div className="mb-4">
        <label className="block text-xs font-bold text-slate-500 mb-1">
          Driver Filter
        </label>

        <select
          value={selectedDriver}
          onChange={(e) => setSelectedDriver(e.target.value)}
          className="w-full border rounded-xl px-3 py-3 text-sm font-bold bg-white"
        >
          {driverNames.map((driver) => (
            <option key={driver} value={driver}>
              {driver}
            </option>
          ))}
        </select>
      </div>

      {driverOrders.length === 0 && (
        <div className="border rounded-2xl p-4 text-sm text-center">
          No driver orders.
        </div>
      )}

      <div className="space-y-3">
        {driverOrders.map((order) => (
          <div key={order.orderId} className="bg-white border rounded-2xl p-3">
            <div className="flex flex-col gap-3">
              <div className="text-center">
                <h3 className="font-bold">
                  {order.orderId || order.order_number} |{" "}
                  {order.companyName || order.company_name || "No company"}
                </h3>

                <div className="text-base font-extrabold text-red-600">
                  Order Value: {formatCurrency(getDriverTotals(order).grandTotal)}
                <p className="text-xs text-slate-500">
                  {order.createdAt || order.created_at || "-"} | Total Items: {getDriverItems(order).length}
                </p>
              </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  onClick={() =>
                    setExpandedOrder(
                      expandedOrder === order.orderId ? null : order.orderId
                    )
                  }
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                >
                  {expandedOrder === order.orderId ? "Hide Order" : "View Order"}
                </button>

                <button
                  onClick={() => printThermalReceipt(order)}
                  className="bg-black text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[145px]"
                >
                  Print Thermal Receipt
                </button>

                {order.status === "Ready For Driver" && (
                  <button
                    onClick={() => {
                    const confirmedBy = window.prompt(
                      "Who confirmed the order?"
                    );

                    if (!confirmedBy?.trim()) {
                      alert("Please enter who confirmed the order.");
                      return;
                    }

                    confirmDelivery(order, confirmedBy.trim());
                  }}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Delivered
                  </button>
                )}

                {order.status === "Ready For Driver" && (
                  <>
                    <button
                      onClick={() => moveBackToWarehouse(order)}
                      className="bg-slate-700 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[130px]"
                    >
                      Back To Warehouse
                    </button>
                  </>
                )}

                {order.status === "Delivered" &&
                    order.payment_collected !== "Yes" &&
                    order.payment_collected !== true && (
                  <button
                    onClick={() => openCashCollection(order)}
                    className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Cash Collection
                  </button>
                )}

                {order.status === "Delivered" && (
                  <button
                    onClick={() => setReturnOrder(order)}
                    className="bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Return
                  </button>
                )}
              </div>
            </div>


            {expandedOrder === order.orderId && (
              <div className="mt-3 space-y-2">
                {getDriverItems(order).map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between border rounded-xl p-2 text-sm"
                  >
                    <span>{item.name}</span>
                    <strong>{item.pickedQty ?? item.qty}</strong>
                  </div>
                ))}
              </div>
            )}

            {cashCollectionOrder === order.orderId && (
              <div className="mt-4 border rounded-2xl p-3 bg-slate-50 space-y-3">
                <h4 className="font-bold text-center">Cash Collection</h4>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => printThermalReceipt(order)}
                    className="w-full bg-black text-white py-2 rounded-xl text-sm font-bold"
                  >
                    Print Thermal Receipt
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="border rounded-xl p-3 bg-white">
                    <div className="text-xs font-bold text-slate-500">
                      Customer outstanding
                    </div>
                    <div className="text-xl font-extrabold text-red-700">
                      {formatCurrency(cashCollectionOutstanding.totalOutstanding || 0)}
                    </div>
                  </div>

                  {(order.customerBranchId ||
                    order.customer_branch_id ||
                    order.branchName ||
                    order.branch_name) && (
                    <div className="border rounded-xl p-3 bg-white">
                      <div className="text-xs font-bold text-slate-500">
                        Selected branch outstanding
                      </div>
                      <div className="text-xl font-extrabold text-red-700">
                        {formatCurrency(
                          cashCollectionOutstanding.branchOutstanding[
                            order.customerBranchId || order.customer_branch_id
                          ] ??
                            cashCollectionOutstanding.branchOutstanding[
                              order.branchName || order.branch_name
                            ] ??
                            0
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <select
                  value={paymentForm.paymentType}
                  onChange={(e) =>
                    setPaymentForm({
                      ...paymentForm,
                      paymentType: e.target.value,
                    })
                  }
                  className="w-full border rounded-xl p-3 font-bold bg-white"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer</option>
                  <option value="Account">Account</option>
                  <option value="Credit">Credit</option>
                </select>

                  <select
                    value={paymentForm.paymentAppliesTo}
                    onChange={(e) =>
                      setPaymentForm({
                        ...paymentForm,
                        paymentAppliesTo: e.target.value,
                      })
                    }
                    className="w-full border rounded-xl p-3 bg-white"
                  >
                    <option value="Today Invoice">
                      Today's Invoice
                    </option>

                    <option value="Previous Credit Balance">
                      Previous Credit Balance
                    </option>

                    
                  </select>
                    <input
                      type="number"
                      placeholder="Amount Collected"
                      value={paymentForm.paymentAmount}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          paymentAmount: e.target.value,
                        })
                      }
                      className="w-full border rounded-xl p-3"
                    />

                    <select
                      value={paymentForm.paymentCollected}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          paymentCollected: e.target.value,
                        })
                      }
                      className="w-full border rounded-xl p-3 bg-white"
                    >
                      <option value="Yes">Payment Collected</option>
                      <option value="No">Payment Not Collected</option>
                    </select>

                    <input
                      placeholder="Who paid / shop staff name"
                      value={paymentForm.paidBy}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          paidBy: e.target.value,
                        })
                      }
                      className="w-full border rounded-xl p-3"
                    />

                    <input
                      placeholder="Who received payment"
                      value={paymentForm.receivedBy || ""}
                      onChange={(e) =>
                        setPaymentForm({
                          ...paymentForm,
                          receivedBy: e.target.value,
                        })
                      }
                      className="w-full border rounded-xl p-3"
                    />
             
                 <button
                disabled={savingPayment}
                onClick={() => saveCashCollection(order)}
                className="w-full bg-green-700 text-white py-3 rounded-xl font-bold disabled:bg-slate-400"
              >
                {savingPayment ? "Saving..." : "Save Payment Status"}
              </button>
              </div>             
            )}
          </div>
        ))}
      </div>

      {returnOrder && (
        <ReturnRequestModal
          order={returnOrder}
          source="DELIVERY_PORTAL"
          currentUser={loggedInUser}
          onClose={() => setReturnOrder(null)}
          onSaved={refreshOrders}
        />
      )}
    </div>
  );
}
