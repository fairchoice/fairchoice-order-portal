import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";

export default function CustomerCredit() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [statementRows, setStatementRows] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("All Branches");
  const [activeTab, setActiveTab] = useState("summary");

  const [editOpeningBalance, setEditOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");

  const isAdmin = true;

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

      const loadCustomers = async () => {
        const { data, error } = await supabase
          .from("customer_accounts")
          .select("*")
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

  const { data, error } = await supabase
    .from("customer_ledger")
    .select("*")
    .eq("customer_name", customerName)
    .order("created_at", { ascending: true });

  if (error) {
    alert("Could not load customer statement.");
    return;
  }

  setStatementRows(data || []);
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

  const downloadInvoice = async (referenceNo) => {
    if (!referenceNo) {
      alert("Invoice reference not found.");
      return;
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("order_number", referenceNo)
      .single();

    if (error || !order) {
      alert("Matching order not found.");
      return;
    }

    void order;
  };

  let runningBalance = Number(openingBalance || 0);

  const branches = [
    ...new Set(statementRows.map((row) => row.branch_name).filter(Boolean)),
  ];

  const totalOutstanding =
    Number(openingBalance || 0) +
    statementRows.reduce((total, row) => {
      if (row.entry_type === "INVOICE") {
        return total + Number(row.debit || 0);
      }

      if (row.entry_type === "PAYMENT") {
        return total - Number(row.credit || 0);
      }

      return total;
    }, 0);

  const filteredRows =
    selectedBranch === "All Branches"
      ? statementRows
      : statementRows.filter((row) => row.branch_name === selectedBranch);

  const selectedCustomerAccount = customers.find(
    (customer) => customer.account_name === selectedCustomer
  );
  const creditLimit = Number(selectedCustomerAccount?.credit_limit || 0);
  const availableCredit = creditLimit - totalOutstanding;
  const transactionRows = filteredRows.filter((row) => row.entry_type === "PAYMENT");

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

        {branches.length > 1 && (
          <select
            value={selectedBranch}
            onChange={(e) => setSelectedBranch(e.target.value)}
            className="border rounded-xl p-3 w-full"
          >
            <option value="All Branches">All Branches</option>
            {branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Outstanding Balance</div>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(totalOutstanding)}
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Credit Limit</div>
            <div className="text-2xl font-bold">{formatCurrency(creditLimit)}</div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="text-sm font-bold text-slate-500">Available Credit</div>
            <div className="text-2xl font-bold text-green-700">
              {formatCurrency(availableCredit)}
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
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
              {(() => {
                let historyBalance = Number(openingBalance || 0);
                return (
                  <>
                    <tr className="border-t bg-blue-50">
                      <td className="p-3">-</td>
                      <td className="p-3">Opening Balance</td>
                      <td className="p-3">Opening Balance</td>
                      <td className="p-3 text-right">{formatCurrency(openingBalance)}</td>
                      <td className="p-3 text-right">-</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(historyBalance)}</td>
                    </tr>

                    {filteredRows.map((row) => {
                      const debit = Number(row.debit || 0);
                      const credit = Number(row.credit || 0);
                      historyBalance += debit - credit;
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
                          <td className="p-3 text-right font-bold">{formatCurrency(historyBalance)}</td>
                        </tr>
                      );
                    })}
                  </>
                );
              })()}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan="6" className="p-5 text-center text-slate-500">
                    No credit history found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "transactions" && (
        <div className="overflow-auto border rounded-2xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-left">Entered By</th>
              </tr>
            </thead>

            <tbody>
              {transactionRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{new Date(row.created_at).toLocaleDateString()}</td>
                  <td className="p-3">{formatCollectionSource(row.collection_source) || row.payment_type || "Payment"}</td>
                  <td className="p-3">{row.reference_no || "-"}</td>
                  <td className="p-3 text-right font-bold text-green-700">
                    {formatCurrency(row.credit)}
                  </td>
                  <td className="p-3">{row.received_by || row.collected_by_name || row.paid_by || "-"}</td>
                </tr>
              ))}

              {transactionRows.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-5 text-center text-slate-500">
                    No transactions found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
