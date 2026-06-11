import { useState } from "react";
import { supabase } from "../services/supabase";

export default function Driver({
  orders = [],
  changeOrderStatus = () => {},
  updateOrderExtraFields = () => {},
}) {
  const [expandedOrder, setExpandedOrder] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState("All");
  const [cashCollectionOrder, setCashCollectionOrder] = useState(null);

  const [paymentForm, setPaymentForm] = useState({
    paymentType: "Cash",
    paymentAmount: "",
    paymentCollected: "Yes",
    paidBy: "",
  });

  const driverNames = [
    "All",
    ...new Set(
      orders
        .filter((order) =>
          ["Ready For Driver", "Delivered"].includes(order.status)
        )
        .map((order) => order.driverName)
        .filter(Boolean)
    ),
  ];

  const driverOrders = orders.filter((order) => {
    const driverName = order.driverName;

    const matchesStatus =
      order.status === "Ready For Driver" ||
      (order.status === "Delivered" && !order.paymentType);

    const matchesDriver =
      selectedDriver === "All" || driverName === selectedDriver;

    return matchesStatus && matchesDriver;
  });

  const openCashCollection = (order) => {
    setCashCollectionOrder(order.orderId);

    setPaymentForm({
      paymentType: order.paymentType || "Cash",
      paymentAmount: order.paymentAmount || "",
      paymentCollected: order.paymentCollected || "Yes",
      paidBy: order.paidBy || "",
    });
  };

  const saveCashCollection = async (order) => {
  try {
    const paymentType = paymentForm.paymentType;
    const paymentCollected = paymentForm.paymentCollected;
    const paymentAmount = Number(paymentForm.paymentAmount || 0);

    // Only require amount + paid by when money was actually collected
    if (paymentType !== "Credit" && paymentCollected === "Yes") {
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
    });

    // Ledger payment only if money collected
    if (
      paymentType !== "Credit" &&
      paymentCollected === "Yes" &&
      paymentAmount > 0
    ) {
      const { error: ledgerError } = await supabase
  .from("customer_ledger")
  .insert({
    customer_name: order.companyName || "Unknown Customer",
    entry_type: "PAYMENT",
    reference_no: order.orderId,
    debit: 0,
    credit: paymentAmount,
    notes: paymentType,
  });

      if (ledgerError) throw ledgerError;
    }

    alert("Cash collection saved.");
    setCashCollectionOrder(null);
  } catch (error) {
    console.error("Cash collection error:", error);
    alert("Could not save cash collection: " + error.message);
  }
};

  return (
    <div className="p-4">
      <div className="mb-4 text-center">
        <h2 className="text-2xl font-bold">Driver Portal</h2>
        <p className="text-sm text-slate-500">
          Ready For Driver deliveries.
        </p>
      </div>

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
                <div className="text-xs text-slate-500 font-bold">
                  Driver Name
                </div>
                <div className="text-lg font-bold">
                  {order.driverName || "No Driver Assigned"}
                </div>
              </div>

              <div className="text-center">
                <h3 className="font-bold">
                  {order.orderId} | {order.companyName || "No company"}
                </h3>
                <p className="text-xs text-slate-500">
                  {order.status} | {order.items?.length || 0} Items
                </p>
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

                {order.status === "Ready For Driver" && (
                  <button
                    onClick={async () => {
                      await changeOrderStatus(order.orderId, "Delivered");
                      openCashCollection(order);
                    }}
                    className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold min-w-[105px]"
                  >
                    Confirm Delivery
                  </button>
                )}

                {order.status === "Delivered" && !order.paymentType && (
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
                {(order.items || []).map((item) => (
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

                {paymentForm.paymentType !== "Credit" && (
                  <>
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
                  </>
                )}

                <button
                  onClick={() => saveCashCollection(order)}
                  className="w-full bg-green-700 text-white py-3 rounded-xl font-bold"
                >
                  Save Payment Status
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}