// src/pages/WeeklyAccount.jsx

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabase";

 import { saveHandover, getHandoverHistory } from "../services/handovers";

export default function WeeklyAccount() {

   const [savingHandover, setSavingHandover] = useState(false);
   const [startDate, setStartDate] = useState("");
const [endDate, setEndDate] = useState("");

const [handoverHistoryEndDate, setHandoverHistoryEndDate] = useState("");
const [handoverHistory, setHandoverHistory] = useState([]);

const [activeTab, setActiveTab] = useState("unpaid");

const [unpaidInvoices, setUnpaidInvoices] = useState([]);
const [payments, setPayments] = useState([]);
const [drivers, setDrivers] = useState([]);

const [collectorType, setCollectorType] = useState("Driver");
const [collectorName, setCollectorName] = useState("");
const [cashReceived, setCashReceived] = useState("");
const [handoverReason, setHandoverReason] = useState("");

const [handoverDate, setHandoverDate] = useState(
  new Date().toISOString().split("T")[0]
);

const [handoverHistoryStartDate, setHandoverHistoryStartDate] = useState("");


 

  useEffect(() => {
    loadWeeklyAccountData();
  }, []);

  useEffect(() => {
  async function loadHistory() {
    try {
      const history = await getHandoverHistory();
      setHandoverHistory(history);
    } catch (err) {
      console.error("Load handover history error:", err);
    }
  }

  loadHistory();
}, []);

  async function loadWeeklyAccountData() {
    
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const { data: unpaidData, error: unpaidError } = await supabase
      .from("customer_ledger")
      .select("*")
      .eq("entry_type", "INVOICE")
      .eq("invoice_status", "UNPAID")
      .gte("created_at", startOfWeek.toISOString())
      .order("created_at", { ascending: false });

    if (unpaidError) console.error("Unpaid report error:", unpaidError);

    const { data: paymentData, error: paymentError } = await supabase
  .from("orders")
  .select("*")
  .eq("payment_collected", "Yes")
  .gt("payment_amount", 0)
  .order("created_at", { ascending: false });

    if (paymentError) console.error("Payment report error:", paymentError);

    const { data: driverData, error: driverError } = await supabase
    .from("drivers")
    .select("*");

    if (driverError) {
      console.error("Driver loading error:", driverError);
    }

   

console.log("DRIVERS LOADED:", driverData);


    setUnpaidInvoices(unpaidData || []);
    setPayments(
    (paymentData || []).map((o) => ({
    id: o.id,
    customer_name: o.company_name,
    invoice_no: o.order_number,
    order_number: o.order_number,

    invoice_total: Number(o.final_total || o.order_total || 0),

    amount: Number(o.payment_amount || 0),
    payment_amount: Number(o.payment_amount || 0),

    payment_type: o.payment_type || "",
    paid_by: o.paid_by || "",
    received_by: o.received_by || "",

    collected_by: o.driver_name || o.received_by || "",

driver_name: o.driver_name || "",

collection_type: o.driver_name ? "Driver" : "Office",

    created_at: o.created_at,
  }))
);
console.log("ORDER PAYMENTS", paymentData);
    setDrivers(driverData || []);
  }

async function handleSaveHandover() {
  try {
    
    if (!collectorName) {
      alert(`Please select ${collectorType} before saving handover.`);
      return;
    }

    setSavingHandover(true);

const payload = {
  collectorType,
  collectorName,
  handoverDate,

  periodStart: handoverPeriodStart.toISOString(),
  periodEnd: handoverPeriodEnd.toISOString(),

  systemCollection: selectedCollectorSystemTotalSinceLastHandover,
  cashReceived: Number(cashReceived || 0),
  difference: handoverDifferenceSinceLastHandover,

  reason: handoverReason,
};

    console.log("HANDOVER PAYLOAD:", payload);

    const confirmed = window.confirm(
  `Save handover for ${collectorName}?\n\n` +
  `System Collection: ${money(selectedCollectorSystemTotalSinceLastHandover)}\n` +
  `Cash Received: ${money(cashReceived)}\n` +
  `Difference: ${money(handoverDifferenceSinceLastHandover)}`
);

if (!confirmed) {
  setSavingHandover(false);
  return;
}

    await saveHandover(payload);

    alert("Handover saved successfully.");

    setCashReceived("");
    setHandoverReason("");

    const history = await getHandoverHistory();
    setHandoverHistory(history);
  } catch (err) {
    console.error("Save handover error:", err);
    alert(err.message || "Failed to save handover.");
  } finally {
    setSavingHandover(false);
  }
}



  function money(value) {
    return `£${Number(value || 0).toFixed(2)}`;
  }

  function formatDate(date) {
    if (!date) return "-";
    return new Date(date).toLocaleDateString("en-GB");
  }

  function daysOutstanding(date) {
    const diff = new Date() - new Date(date);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  function invoiceTotal(row) {
    return Number(
      row.invoice_total ||
        row.order_total ||
        row.total_amount ||
        row.invoice_amount ||
        row.amount ||
        0
    );
  }

  function paidAmount(row) {
    return Number(row.payment_amount || row.paid_amount || row.amount || 0);
  }

  function balance(row) {
    return Math.max(0, invoiceTotal(row) - paidAmount(row));
  }

  function collectionType(row) {
    if (row.name) return "Driver";
    if (row.sales_rep_name) return "Sales Rep";
    return row.collection_type || row.collected_by_role || "Office";
  }

    function collectedBy(row) {
     return (
    row.collected_by ||
    row.driver_name ||
      row.sales_rep_name ||
      row.confirmed_by ||
      "-"
    );
  }

  function editPayment(row) {
    alert(`Edit Payment coming next for ${row.invoice_no || row.order_number}`);
  }

  function getDriverName(driver) {
  return (
    driver.name ||
    driver.name ||
    driver.full_name ||
    driver.driverName ||
    ""
  );
}

  const unpaidCustomers = new Set(
    unpaidInvoices.map((i) => i.customer_name)
  ).size;

  const unpaidValue = unpaidInvoices.reduce(
    (sum, i) => sum + Number(i.amount || 0),
    0
  );

  const totalCollectionValue = payments.reduce(
    (sum, p) => sum + paidAmount(p),
    0
  );

  const driverPayments = payments.filter(
  (p) =>
    p.driver_name ||
      String(p.collected_by_role || "").toLowerCase() === "driver" ||
      String(p.collection_type || "").toLowerCase() === "driver"
  );

  const salesRepPayments = payments.filter(
    (p) =>
      p.sales_rep_name ||
      String(p.collected_by_role || "").toLowerCase() === "sales rep" ||
      String(p.collected_by_role || "").toLowerCase() === "salesrep" ||
      String(p.collection_type || "").toLowerCase() === "sales rep" ||
      String(p.collection_type || "").toLowerCase() === "salesrep"
  );

  const driverTotals = useMemo(() => {
    const grouped = {};
    driverPayments.forEach((p) => {
     const driver = p.driver_name || p.collected_by || "Unknown Driver";
      if (!grouped[driver]) grouped[driver] = 0;
      grouped[driver] += paidAmount(p);
    });
    return grouped;
  }, [driverPayments]);

  const salesRepTotals = useMemo(() => {
    const grouped = {};
    salesRepPayments.forEach((p) => {
      const rep = p.sales_rep_name || p.collected_by || "Unknown Sales Rep";
      if (!grouped[rep]) grouped[rep] = 0;
      grouped[rep] += paidAmount(p);
    });
    return grouped;
  }, [salesRepPayments]);

  const selectedCollectorPayments = payments.filter((p) => {
  if (!collectorName) return false;

  const selected = collectorName.toLowerCase().trim();

  if (collectorType === "Driver") {
    return (
      String(p.driver_name || "")
        .toLowerCase()
        .trim() === selected
    );
  }

  return (
    String(p.sales_rep_name || "")
      .toLowerCase()
      .trim() === selected
  );
});

function getMondayStart() {
  const today = new Date();
  const day = today.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  const monday = new Date(today);
  monday.setDate(today.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  return monday;
}

function getLastHandoverForCollector() {
  return handoverHistory
    .filter(
      (h) =>
        h.collector_type === collectorType &&
        h.collector_name === collectorName
    )
    .sort(
      (a, b) =>
        new Date(b.period_end || b.created_at) -
        new Date(a.period_end || a.created_at)
    )[0];
}

const lastHandover = getLastHandoverForCollector();

const handoverPeriodStart = lastHandover
  ? new Date(lastHandover.period_end || lastHandover.created_at)
  : getMondayStart();

const handoverPeriodEnd = new Date();

const selectedCollectorPaymentsSinceLastHandover =
  selectedCollectorPayments.filter((p) => {
    const paymentDate = new Date(p.created_at);
    return paymentDate >= handoverPeriodStart && paymentDate <= handoverPeriodEnd;
  });

const selectedCollectorSystemTotalSinceLastHandover =
  selectedCollectorPaymentsSinceLastHandover.reduce(
    (sum, p) => sum + paidAmount(p),
    0
  );

const handoverDifferenceSinceLastHandover =
  Number(cashReceived || 0) -
  Number(selectedCollectorSystemTotalSinceLastHandover || 0);

console.log("COLLECTOR NAME:", collectorName);
console.log("PAYMENTS:", payments);
console.log("MATCHED PAYMENTS:", selectedCollectorPayments);

const selectedCollectorSystemTotal = selectedCollectorPayments.reduce(
  (sum, p) => sum + paidAmount(p),
  0
);

const filteredPayments = payments.filter((p) => {
  const paymentDate = p.created_at?.slice(0, 10);

  if (startDate && paymentDate < startDate) return false;
  if (endDate && paymentDate > endDate) return false;

  return true;
});

  const handoverDifference =
    Number(cashReceived || 0) - Number(selectedCollectorSystemTotal || 0);

const tabs = [
  { key: "total", label: "Total Collection" },
  { key: "driver", label: "Driver Collection" },
  { key: "salesrep", label: "Sales Rep Collection" },
  { key: "holding", label: "Cash Holding" },
  { key: "handover", label: "Driver / Sales Rep Handover" },
  { key: "unpaid", label: "Customers Didn’t Pay" },
];

    const filteredHandoverHistory = handoverHistory.filter((row) => {
  const rowDate =
    row.handover_date ||
    row.created_at?.slice(0, 10);

  if (
    handoverHistoryStartDate &&
    rowDate < handoverHistoryStartDate
  )
    return false;

  if (
    handoverHistoryEndDate &&
    rowDate > handoverHistoryEndDate
  )
    return false;

  return true;
});

const cashHoldingRows = drivers.map((driver) => {
  const driverName = getDriverName(driver);

  const lastHandover = handoverHistory
    .filter(
      (h) =>
        h.collector_type === "Driver" &&
        h.collector_name === driverName
    )
    .sort(
      (a, b) =>
        new Date(b.period_end || b.created_at) -
        new Date(a.period_end || a.created_at)
    )[0];

 const weekStart = getMondayStart();

  const driverPaymentsSinceLastHandover = payments.filter((p) => {
    const paymentDate = new Date(p.created_at);

    return (
      p.driver_name === driverName &&
      paymentDate >= weekStart
    );
  });

  const collected = driverPaymentsSinceLastHandover.reduce(
    (sum, p) => sum + paidAmount(p),
    0
  );

  const handedOver = handoverHistory
    .filter(
      (h) =>
        h.collector_type === "Driver" &&
        h.collector_name === driverName &&
        new Date(h.created_at) >= weekStart
    )
    .reduce(
      (sum, h) => sum + Number(h.cash_received || 0),
      0
    );

  const holding = collected - handedOver;

  const daysHolding = Math.floor(
    (new Date() - startDate) /
      (1000 * 60 * 60 * 24)
  );

  const lastCollectionDate =
    driverPaymentsSinceLastHandover
      .sort(
        (a, b) =>
          new Date(b.created_at) -
          new Date(a.created_at)
      )[0]?.created_at || null;

  return {
    driverName,
    lastHandoverDate: lastHandover?.handover_date || "-",
    lastCollectionDate,
    collected,
    handedOver,
    holding,
    daysHolding,
  };
});

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-bold">Weekly Account</h1>

      {activeTab !== "handover" && (
  <div className="flex flex-wrap gap-3 items-end">
    <div>
      <label className="text-xs font-bold">Start Date</label>
      <input
        type="date"
        className="border rounded-lg px-3 py-2"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
      />
    </div>

    <div>
      <label className="text-xs font-bold">End Date</label>
      <input
        type="date"
        className="border rounded-lg px-3 py-2"
        value={endDate}
        onChange={(e) => setEndDate(e.target.value)}
      />
    </div>

    <button
      type="button"
      onClick={() => {
        setStartDate("");
        setEndDate("");
      }}
      className="bg-slate-600 text-white px-4 py-2 rounded-lg font-bold"
    >
      Clear
    </button>
  </div>
)}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 rounded-xl font-bold ${
              activeTab === tab.key
                ? "bg-blue-700 text-white"
                : "bg-white text-blue-800 border border-blue-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "total" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryCard
              title="Paid Customers"
              value={new Set(payments.map((p) => p.customer_name)).size}
            />
            <SummaryCard title="Payments" value={payments.length} />
            <SummaryCard
              title="Total Collection"
              value={money(totalCollectionValue)}
            />
          </div>

          <PaymentTable
            rows={filteredPayments}
            editPayment={editPayment}
            money={money}
            formatDate={formatDate}
            invoiceTotal={invoiceTotal}
            paidAmount={paidAmount}
            balance={balance}
            collectionType={collectionType}
            collectedBy={collectedBy}
          />
        </>
      )}

      {activeTab === "driver" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(driverTotals).map(([driver, total]) => (
              <SummaryCard key={driver} title={driver} value={money(total)} />
            ))}
          </div>

          <PaymentTable
            rows={driverPayments}
            editPayment={editPayment}
            money={money}
            formatDate={formatDate}
            invoiceTotal={invoiceTotal}
            paidAmount={paidAmount}
            balance={balance}
            collectionType={collectionType}
            collectedBy={collectedBy}
          />
        </>
      )}

      {activeTab === "salesrep" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(salesRepTotals).map(([rep, total]) => (
              <SummaryCard key={rep} title={rep} value={money(total)} />
            ))}
          </div>

          <PaymentTable
            rows={salesRepPayments}
            editPayment={editPayment}
            money={money}
            formatDate={formatDate}
            invoiceTotal={invoiceTotal}
            paidAmount={paidAmount}
            balance={balance}
            collectionType={collectionType}
            collectedBy={collectedBy}
          />
        </>
      )}

      {activeTab === "holding" && (
  <div className="bg-white rounded shadow overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-blue-700 text-white">
          <th className="p-3 text-left">Collector</th>
          <th className="p-3 text-left">Last Handover</th>
          <th className="p-3 text-right">Collected</th>
          <th className="p-3 text-right">Handed Over</th>
          <th className="p-3 text-right">Holding</th>
          <th className="p-3 text-right">Days Holding</th>
        </tr>
      </thead>

      <tbody>
        {cashHoldingRows.map((row) => (
          <tr key={row.driverName} className="border-b">
            <td className="p-3 font-semibold">
              {row.driverName}
            </td>

            <td className="p-3">
              {row.lastHandoverDate}
            </td>

            <td className="p-3 text-right">
              {money(row.collected)}
            </td>

            <td className="p-3 text-right">
              {money(row.handedOver)}
            </td>

            <td
              className={`p-3 text-right font-bold ${
                row.holding > 200
                  ? "text-red-600"
                  : row.holding > 0
                  ? "text-orange-600"
                  : "text-green-600"
              }`}
            >
              {money(row.holding)}
            </td>

            <td className="p-3 text-right">
              {row.daysHolding}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}

      {activeTab === "handover" && (

        
        <div className="bg-white rounded shadow p-4 space-y-3">
          <h2 className="font-bold text-lg">Driver / Sales Rep Handover</h2>         

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">            
          <div>
          <label className="text-sm font-bold block mb-1">
            Collector Type
          </label>
          <select
            className="border rounded-xl p-3 w-full"
            value={collectorType}
            onChange={(e) => {
              setCollectorType(e.target.value);
              setCollectorName("");
            }}      
          >               
              <option value="Driver">Driver</option>
              <option value="Sales Rep">Sales Rep</option>
            </select>  

            <div>
            <label className="text-sm font-bold block mb-1">
              Handover Date
            </label>

            <input
              type="date"
              className="border rounded-xl p-3 w-full"
              value={handoverDate}
              onChange={(e) => setHandoverDate(e.target.value)}
            />
</div>          
        </div>        

  <div>
    <label className="text-sm font-bold block mb-1">
      Collector Name
    </label>
    <select
      className="border rounded-xl p-3 w-full"
      value={collectorName}
      onChange={(e) => setCollectorName(e.target.value)}
    >
      <option value="">Select {collectorType}</option>

      {collectorType === "Driver" &&
        drivers.map((driver) => {
          const name = getDriverName(driver);

          if (!name) return null;

          return (
            <option key={driver.id || name} value={name}>
              {name}
            </option>
          );
        })}

      {collectorType === "Sales Rep" &&
        [...new Set(salesRepPayments.map((p) => collectedBy(p)))]
          .filter(Boolean)
          .map((rep) => (
            <option key={rep} value={rep}>
              {rep}
            </option>
          ))}
    </select>
  </div>
          
  <div>
    <label className="text-sm font-bold block mb-1">
      System Collection
    </label>
    <input
      className="border rounded-xl p-3 bg-slate-100 w-full"
      value={money(selectedCollectorSystemTotalSinceLastHandover)}
      readOnly
    />
  </div>

  <div>
    <label className="text-sm font-bold block mb-1">
      Cash Received
    </label>
    <input
      className="border rounded-xl p-3 w-full"
      placeholder="Cash Received"
      value={cashReceived}
      onChange={(e) => setCashReceived(e.target.value)}
    />
  </div>

  <div>
    <label className="text-sm font-bold block mb-1">
      Difference
    </label>
    <input
      className="border rounded-xl p-3 bg-slate-100 w-full"
      value={money(handoverDifferenceSinceLastHandover)}
      readOnly
    />
  </div>

  <div className="mt-4">
  <button
    type="button"
    onClick={handleSaveHandover}
    disabled={savingHandover}
    className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
  >
    {savingHandover ? "Saving..." : "Save Handover"}
  </button>
</div>
    </div>

    <div className="mt-5 bg-white rounded-xl border shadow overflow-hidden">
  <div className="px-4 py-3 border-b bg-gray-50">
    <h2 className="font-bold text-lg">Handover History</h2>
  </div>

  <div className="overflow-x-auto">

    <div className="flex gap-3 p-4 border-b">
  <div>
    <label className="text-xs font-bold">Start Date</label>
    <input
      type="date"
      className="border rounded-lg px-3 py-2"
      value={handoverHistoryStartDate}
      onChange={(e) => setHandoverHistoryStartDate(e.target.value)}
    />
  </div>

  <div>
    <label className="text-xs font-bold">End Date</label>
    <input
      type="date"
      className="border rounded-lg px-3 py-2"
      value={handoverHistoryEndDate}
      onChange={(e) => setHandoverHistoryEndDate(e.target.value)}
    />
  </div>
</div>
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="bg-blue-700 text-white text-left">
          <th className="p-3">Date</th>
          <th className="p-3">Collector Type</th>
          <th className="p-3">Collector Name</th>
          <th className="p-3 text-right">System Collection</th>
          <th className="p-3 text-right">Cash Received</th>
          <th className="p-3 text-right">Difference</th>
          <th className="p-3">Reason</th>
        </tr>
      </thead>

      <tbody>
        {filteredHandoverHistory.map((row) => (
          <tr key={row.id} className="border-b hover:bg-blue-50">
            <td className="p-3 whitespace-nowrap">
              {new Date(row.created_at).toLocaleString("en-GB")}
            </td>
            <td className="p-3">{row.collector_type}</td>
            <td className="p-3 font-semibold">{row.collector_name}</td>
            <td className="p-3 text-right">
              £{Number(row.system_collection || 0).toFixed(2)}
            </td>
            <td className="p-3 text-right">
              £{Number(row.cash_received || 0).toFixed(2)}
            </td>
            <td
              className={`p-3 text-right font-bold ${
                Number(row.difference || 0) < 0
                  ? "text-red-600"
                  : Number(row.difference || 0) > 0
                  ? "text-green-600"
                  : "text-gray-700"
              }`}
            >
              £{Number(row.difference || 0).toFixed(2)}
            </td>
            <td className="p-3">{row.reason || "-"}</td>
          </tr>
        ))}

        {handoverHistory.length === 0 && (
          <tr>
            <td className="p-5 text-center text-gray-500" colSpan="7">
              No handover history found.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
      </div>
        </div>        
      )}

      

      {activeTab === "unpaid" && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SummaryCard title="Unpaid Customers" value={unpaidCustomers} />
            <SummaryCard
              title="Unpaid Invoices"
              value={unpaidInvoices.length}
            />
            <SummaryCard
              title="Outstanding Value"
              value={money(unpaidValue)}
            />
          </div>

          <div className="overflow-x-auto bg-white rounded shadow">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="p-2">Customer</th>
                  <th className="p-2">Invoice No</th>
                  <th className="p-2">Invoice Date</th>
                  <th className="p-2">Invoice Total</th>
                  <th className="p-2">Driver / Sales Rep</th>
                  <th className="p-2">Confirmed By</th>
                  <th className="p-2">Days</th>
                  <th className="p-2">Action</th>
                </tr>
              </thead>

              <tbody>
                {unpaidInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t">
                    <td className="p-2">{invoice.customer_name}</td>
                    <td className="p-2">
                      {invoice.invoice_no || invoice.order_number}
                    </td>
                    <td className="p-2">{formatDate(invoice.created_at)}</td>
                    <td className="p-2">{money(invoice.amount)}</td>
                    <td className="p-2">
                      {invoice.name ||
                        invoice.sales_rep_name ||
                        invoice.collected_by ||
                        "-"}
                    </td>
                    <td className="p-2">{invoice.confirmed_by || "-"}</td>
                    <td className="p-2">
                      {daysOutstanding(invoice.created_at)} Days
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => editPayment(invoice)}
                        className="bg-blue-600 text-white px-3 py-2 rounded-lg font-bold"
                      >
                        Edit Payment
                      </button>
                    </td>
                  </tr>
                ))}

                {unpaidInvoices.length === 0 && (
                  <tr>
                    <td className="p-4 text-center text-gray-500" colSpan="8">
                      No unpaid customers this week.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ title, value }) {
  return (
    <div className="bg-white rounded shadow p-4">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function PaymentTable({
  rows,
  editPayment,
  money,
  formatDate,
  invoiceTotal,
  paidAmount,
  balance,
  collectionType,
  collectedBy,
}) {
  return (
    <div className="overflow-x-auto bg-white rounded shadow">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-100 text-left">
            <th className="p-2">Customer</th>
            <th className="p-2">Order No</th>
            <th className="p-2">Invoice Total</th>
            <th className="p-2">Paid Amount</th>
            <th className="p-2">Balance</th>
            <th className="p-2">Payment Date</th>
            <th className="p-2">Payment Type</th>
            <th className="p-2">Collected By</th>
            <th className="p-2">Collection Type</th>
            <th className="p-2">Action</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="p-2">{row.customer_name}</td>
              <td className="p-2">{row.invoice_no || row.order_number}</td>
              <td className="p-2">{money(invoiceTotal(row))}</td>
              <td className="p-2">{money(paidAmount(row))}</td>
              <td className="p-2">{money(balance(row))}</td>
              <td className="p-2">{formatDate(row.created_at)}</td>
              <td className="p-2">{row.payment_type || "-"}</td>
              <td className="p-2">{collectedBy(row)}</td>
              <td className="p-2">{collectionType(row)}</td>
              <td className="p-2">
                <button
                  onClick={() => editPayment(row)}
                  className="bg-blue-600 text-white px-3 py-2 rounded-lg font-bold"
                >
                  Edit Payment
                </button>
              </td>
            </tr>
          ))}

          {rows.length === 0 && (
            <tr>
              <td className="p-4 text-center text-gray-500" colSpan="10">
                No records found for this week.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}