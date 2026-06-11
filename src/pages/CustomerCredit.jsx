import { useEffect, useState } from "react";
import { supabase } from "../services/supabase";

export default function CustomerCredit() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [openingBalance, setOpeningBalance] = useState(0);
  const [statementRows, setStatementRows] = useState([]);

  const [editOpeningBalance, setEditOpeningBalance] = useState(false);
  const [openingBalanceInput, setOpeningBalanceInput] = useState("");

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
      .from("customer_opening_balances")
      .select("*")
      .order("customer_name");

    if (error) {
      alert("Could not load customers.");
      return;
    }

    setCustomers(data || []);

    if (data?.length && !selectedCustomer) {
      setSelectedCustomer(data[0].customer_name);
    }
  };

  const loadStatement = async (customerName) => {
    const customer = customers.find(
      (c) => c.customer_name === customerName
    );

    setOpeningBalance(Number(customer?.opening_balance || 0));

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

  let runningBalance = Number(openingBalance || 0);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="text-2xl font-bold">Customer Credit Accounts</h2>

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
                key={customer.customer_name}
                value={customer.customer_name}
              >
                {customer.customer_name}
              </option>
            ))}
          </select>

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
        </div>

        <div className="font-bold text-lg mt-4">
          Opening Balance: £{Number(openingBalance || 0).toFixed(2)}
        </div>

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
                <th className="p-3 text-right">Amount</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>

            <tbody>
              <tr className="border-t bg-blue-50">
                <td className="p-3 font-bold">Opening Balance</td>
                <td className="p-3"></td>
                <td className="p-3"></td>
                <td className="p-3 text-right"></td>
                <td className="p-3 text-right font-bold">
                  £{runningBalance.toFixed(2)}
                </td>
              </tr>

              {statementRows.map((row) => {
                const isInvoice = row.entry_type === "INVOICE";
                const isPayment = row.entry_type === "PAYMENT";

                const amount = isInvoice
                  ? Number(row.debit || 0)
                  : -Number(row.credit || 0);

                runningBalance += amount;

                return (
                  <tr key={row.id} className="border-t">
                    <td className="p-3">
                      {new Date(row.created_at).toLocaleDateString()}
                    </td>

                    <td className="p-3 font-bold">
                      {isInvoice
                        ? "Invoice"
                        : isPayment
                        ? "Payment"
                        : row.entry_type}
                    </td>

                    <td className="p-3">{row.reference_no || ""}</td>

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
                  </tr>
                );
              })}

              {statementRows.length === 0 && (
                <tr>
                  <td colSpan="5" className="p-5 text-center text-slate-500">
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