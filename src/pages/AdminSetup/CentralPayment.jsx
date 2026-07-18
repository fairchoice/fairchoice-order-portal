import { useMemo, useState } from "react";
import CentralPaymentCore from "./CentralPaymentCore";
import GlobalFinancialLedger from "./GlobalFinancialLedger";
import { isOwnerUser } from "../../services/ownerFinancialSecurity";

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

export default function CentralPayment() {
  const currentUser = useMemo(() => getLoggedInUser(), []);
  const owner = isOwnerUser(currentUser);
  const [section, setSection] = useState("payments");
  const [ledgerPassword, setLedgerPassword] = useState("");

  return (
    <div className="space-y-4">
      {owner && (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-extrabold">Owner Finance Platform</h2>
              <p className="text-sm text-slate-600">
                Manage customer payments or inspect the permanent global ledger.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSection("payments")}
                className={`rounded-xl px-4 py-3 font-bold ${
                  section === "payments"
                    ? "bg-blue-800 text-white"
                    : "border bg-white text-slate-700"
                }`}
              >
                Central Payments
              </button>
              <button
                type="button"
                onClick={() => setSection("ledger")}
                className={`rounded-xl px-4 py-3 font-bold ${
                  section === "ledger"
                    ? "bg-blue-800 text-white"
                    : "border bg-white text-slate-700"
                }`}
              >
                Global Ledger & Archive
              </button>
            </div>
          </div>

          {section === "ledger" && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-bold text-slate-700">
                Owner Financial Password
              </label>
              <input
                type="password"
                value={ledgerPassword}
                onChange={(event) => setLedgerPassword(event.target.value)}
                placeholder="Required for global history and archive actions"
                className="w-full max-w-xl rounded-xl border border-blue-300 p-3"
                autoComplete="current-password"
              />
            </div>
          )}
        </div>
      )}

      {section === "ledger" && owner ? (
        <GlobalFinancialLedger
          currentUser={currentUser}
          ownerPassword={ledgerPassword}
        />
      ) : (
        <CentralPaymentCore />
      )}
    </div>
  );
}
