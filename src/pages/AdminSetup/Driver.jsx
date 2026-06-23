import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../Utils/currency";

export default function Driver({
  orders = [],
  changeOrderStatus = () => {},
  updateOrderExtraFields = () => {},
  refreshOrders = async () => {},
}) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState("All");
  const [cashCollectionOrder, setCashCollectionOrder] = useState(null);

  const [creditCustomers, setCreditCustomers] = useState([]);
const [selectedCreditCustomerId, setSelectedCreditCustomerId] = useState("");

const [savingPayment, setSavingPayment] = useState(false);

const loggedInUser = JSON.parse(
  localStorage.getItem("loggedInUser") || "{}"
);

  const getDriverItems = (order) =>
  (order.items || []).filter(
    (item) => item.includeInPicking !== false
  );

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
    .select("id, account_name")
    .order("account_name");

  if (error) {
    console.error(error);
    alert("Could not load customers.");
    return;
  }

  setCreditCustomers(data || []);
};

const savePreviousBalancePayment = async () => {
  try {
    const selectedCustomer = creditCustomers.find(
      (customer) => String(customer.id) === String(selectedCreditCustomerId)
    );

    const paymentAmount = Number(previousBalanceForm.amount || 0);

    if (!selectedCustomer) {
      alert("Please select customer.");
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

    const { error } = await supabase
  .from("customer_ledger")
  .insert({
    customer_name: selectedCustomer.account_name,

    entry_type: "PAYMENT",
    transaction_type: "PAYMENT",

    reference_no: "PREVIOUS_BALANCE",

    debit: 0,
    credit: paymentAmount,

    payment_type: previousBalanceForm.paymentType,
    payment_applies_to: "PREVIOUS_BALANCE",

    paid_by: previousBalanceForm.whoPaid || null,
    who_paid: previousBalanceForm.whoPaid || null,

    received_by: loggedInUser.name || null,
    received_by_username: loggedInUser.username || null,
    received_by_role: loggedInUser.role || null,
    received_by_staff_id: loggedInUser.id || null,

    notes:
      previousBalanceForm.notes ||
      `Previous Balance Payment - ${previousBalanceForm.paymentType}`,
  });

    if (error) throw error;

    alert("Previous Balance Payment saved successfully.");

    setPreviousBalanceForm({
      amount: "",
      paymentType: "Cash",
      whoPaid: "",
      notes: "",
    });

    setSelectedCreditCustomerId("");
    setShowPreviousBalance(false);

  } catch (error) {
    console.error("Previous balance payment error:", error);
    alert(
      "Could not save previous balance payment: " +
        (error.message || JSON.stringify(error))
    );
  }
};

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

        const openCashCollection = (order) => {
          setCashCollectionOrder(order.orderId);

          setPaymentForm({
      paymentType: order.paymentType || "Cash",
      paymentAmount: order.paymentAmount || "",
      paymentCollected: order.paymentCollected || "Yes",
      paidBy: order.paidBy || "",
      receivedBy: order.receivedBy || "",
      paymentAppliesTo: order.paymentAppliesTo || "Today Invoice",
    });
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

    const orderTotal = Number(
      order.finalTotal ||
      order.final_total ||
      order.total ||
      order.totalAmount ||
      0
    );

const { error } = await supabase.from("customer_ledger").insert({
  customer_name: order.companyName || "Unknown Customer",

  entry_type: "INVOICE",
  reference_no: order.orderId,

  debit: orderTotal,
  credit: 0,

  confirmed_by: confirmedBy,

  driver_name: loggedInUser.name || null,
  driver_username: loggedInUser.username || null,
  driver_role: loggedInUser.role || null,
  driver_staff_id: loggedInUser.id || null,

  notes: "Delivery confirmed",
  invoice_status: "UNPAID",
});

    if (error) throw error;

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

const moveBackToReceivedOrders = async (order) => {
  if (order.status === "Delivered") return;
  if (!window.confirm("Move this order back to Received Orders for correction?")) {
    return;
  }

  await changeOrderStatus(order.orderId, "In Progress");
  await refreshOrders();
};

const printDeliveryNote = (order) => {
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
    }

      await updateOrderExtraFields(order.orderId, {
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
});

    // Ledger payment only if money collected
    if (paymentCollected === "Yes" && paymentAmount > 0) {
      

  const { error: ledgerError } = await supabase
  .from("customer_ledger")
  .insert({
    customer_name: order.companyName || "Unknown Customer",

    entry_type: "PAYMENT",
    transaction_type: "PAYMENT",

    reference_no: order.orderId,

    debit: 0,
    credit: paymentAmount,

    payment_type: paymentType,
    payment_applies_to: paymentForm.paymentAppliesTo,

    who_paid: paymentForm.paidBy || null,
    paid_by: paymentForm.paidBy || null,
    received_by: loggedInUser.name || null,
    received_by_username: loggedInUser.username || null,
    received_by_role: loggedInUser.role || null,
    received_by_staff_id: loggedInUser.id || null,

    notes: `Driver cash collection - ${paymentType}`,
  });


if (ledgerError) throw ledgerError;
    }

        alert("Cash collection saved.");
    setCashCollectionOrder(null);
    await refreshOrders();
  } catch (error) {
    console.error("Cash collection error:", error);
    alert("Could not save cash collection: " + error.message);
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
                  Order Value: {formatCurrency(
                    order.finalTotal ||
                    order.final_total ||
                    order.total ||
                    order.orderTotal ||
                    order.order_total ||
                    0
                  )}
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
                  onClick={() => printDeliveryNote(order)}
                  className="bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[130px]"
                >
                  Print Delivery Note
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

                    <button
                      onClick={() => moveBackToReceivedOrders(order)}
                      className="bg-orange-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                    >
                      Modify Order
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
    </div>
  );
}
