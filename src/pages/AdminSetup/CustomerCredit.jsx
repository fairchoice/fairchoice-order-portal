import { useEffect, useState } from "react";
import { supabase } from "../../services/supabase";

export default function CustomerCredit() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [statementRows, setStatementRows] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("All Branches");

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

    console.log("DOWNLOAD ORDER", order);
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

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-bold">Customer Credit Accounts</h2>

        <div className="bg-white border rounded-2xl p-4 mb-4">
          <div className="text-sm font-bold text-slate-500">
            Total Outstanding
          </div>

          <div className="text-3xl font-bold text-red-600">
            £{totalOutstanding.toFixed(2)}
          </div>
        </div>

        <button
          onClick={printStatement}
          className="bg-blue-600 text-white px-5 py-3 rounded-xl font-bold"
        >
          Print / Save PDF
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-4 mb-4">
        <label className="block text-sm font-bold mb-2">Select Customer</label>

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
              <option
                key={customer.id}
                value={customer.account_name}
              >
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
              Edit O/Balance
            </button>
          )}
        </div>


        <div className="font-bold text-lg mt-4">
          Opening Balance: £{Number(openingBalance || 0).toFixed(2)}
        </div>

        {branches.length > 1 && (
          <div className="mt-4">
            <label className="block text-sm font-bold mb-2">Branch</label>

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
          </div>
        )}

        {editOpeningBalance && (
          <div className="mt-4 flex flex-col md:flex-row gap-2">
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

      <div id="statement-print">
        <h3 className="text-xl font-bold mb-3">
          Statement: {selectedCustomer || "-"}
        </h3>

        <div className="overflow-auto border rounded-2xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Transaction</th>
                <th className="p-3 text-left">Reference</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Balance</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>

            <tbody>
              <tr className="border-t bg-blue-50">
                <td className="p-3 font-bold">Opening Balance</td>
                <td className="p-3">Opening Balance</td>
                <td className="p-3"></td>
                <td className="p-3 font-bold">Opening Balance</td>
                <td className="p-3 text-right"></td>
                <td className="p-3 text-right font-bold">
                  £{runningBalance.toFixed(2)}
                </td>
                <td className="p-3 text-center">-</td>
              </tr>

             {filteredRows.map((row) => {
                    const isInvoice = row.entry_type === "INVOICE";
                    const isPayment = row.entry_type === "PAYMENT";

                    const amount = isInvoice
                      ? Number(row.debit || 0)
                      : -Number(row.credit || 0);

                    const canDownloadInvoice =
                      isInvoice &&
                      row.invoice_status !== "PAID";

                    runningBalance += amount;

                    return (
                                    <tr key={row.id} className="border-t">
                    <td className="p-3">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>

                    <td className="p-3">
                    <div className="font-bold">
                      {isInvoice
                        ? "Invoice"
                        : isPayment
                        ? "Payment"
                        : row.entry_type}
                    </div>

                    {isPayment && (
                      <div className="text-xs text-slate-500 mt-1">
                        {row.payment_type && (
                          <div>Type: {row.payment_type}</div>
                        )}

                        {row.collected_by_role && (
                        <div>Role: {row.collected_by_role}</div>
                      )}

                      {row.who_paid && (
                        <div>Who Paid: {row.who_paid}</div>
                      )}

                        {row.payment_applies_to && (
                          <div>
                            Applies To:{" "}
                            {row.payment_applies_to === "PREVIOUS_BALANCE"
                              ? "Previous Balance"
                              : "Invoice"}
                          </div>
                        )}

                        {row.collected_by_name && (
                          <div>
                            Collected By: {row.collected_by_name}
                          </div>
                        )}

                        {row.collection_source && (
                          <div>
                            Source: {formatCollectionSource(row.collection_source)}
                          </div>
                        )}
                      </div>
                    )}
                  </td>

                    <td className="p-3">{row.reference_no || ""}</td>

                      <td className="p-3">
                      {isInvoice ? (
                        <span
                          className={`invoice-status ${
                            row.invoice_status === "PAID"
                              ? "status-paid"
                              : row.invoice_status === "PART PAID"
                              ? "status-part-paid"
                              : "status-unpaid"
                          }`}
                        >
                          {row.invoice_status || "UNPAID"}
                        </span>
                      ) : (
                        <span className="font-bold">
                          {getStatus(row, runningBalance)}
                        </span>
                      )}
                    </td>

                    <td
                      className={`p-3 text-right font-bold ${
                        amount < 0 ? "text-green-700" : "text-red-600"
                      }`}
                    >
                      {amount < 0
                        ? `-£${Math.abs(amount).toFixed(2)}`
                        : `£${amount.toFixed(2)}`}
                    </td>

                    <td className="p-3 text-right font-bold">
                      £{runningBalance.toFixed(2)}
                    </td>
                  
                    <td className="p-3 text-center">
                {canDownloadInvoice ? (
                  <button
                    onClick={() => downloadInvoice(row.reference_no)}
                    className="bg-blue-600 text-white px-3 py-1 rounded-lg font-bold"
                  >
                    Download Invoice
                  </button>
                ) : (
                  "-"
                )}
              </td>
                  </tr>
                );
              })}

              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan="7" className="p-5 text-center text-slate-500">
                    No transactions found for this customer.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}