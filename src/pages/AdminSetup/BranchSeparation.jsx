import { useEffect, useMemo, useState } from "react";
import {
  applyBranchSeparation,
  loadCentralPaymentCustomers,
  previewBranchSeparation,
} from "../../services/centralPaymentService";

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

const isSuperAdmin = (user) =>
  String(user?.role || user?.access_level || "").toLowerCase().includes("super admin");

const customerMatches = (customer, search) =>
  String(customer.account_name || "").toLowerCase().includes(String(search || "").toLowerCase());

export default function BranchSeparation() {
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState("");
  const [sourceCustomerId, setSourceCustomerId] = useState("");
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationCustomerId, setDestinationCustomerId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const currentUser = getLoggedInUser();
  const allowed = isSuperAdmin(currentUser);
  const sourceCustomer = customers.find((customer) => String(customer.id) === String(sourceCustomerId));
  const sourceBranches = (sourceCustomer?.customer_branches || []).filter((branch) => branch.active !== false);
  const filteredCustomers = useMemo(
    () => customers.filter((customer) => customerMatches(customer, search)),
    [customers, search]
  );

  useEffect(() => {
    loadCentralPaymentCustomers()
      .then((rows) => {
        setCustomers(rows);
        if (rows.length) {
          setSourceCustomerId(rows[0].id);
          setDestinationCustomerId(rows[1]?.id || "");
        }
      })
      .catch((loadError) => setError(loadError.message || "Could not load customers."));
  }, []);

  if (!allowed) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border bg-white p-6 font-bold text-red-700 shadow-sm">
          Super Admin access is required for branch separation.
        </div>
      </div>
    );
  }

  const generatePreview = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const data = await previewBranchSeparation({
        sourceCustomerAccountId: sourceCustomerId,
        sourceBranchId,
        destinationCustomerAccountId: destinationCustomerId,
        reason,
      });
      setPreview(data);
    } catch (previewError) {
      setError(previewError.message || "Could not generate preview.");
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const data = await applyBranchSeparation({
        sourceCustomerAccountId: sourceCustomerId,
        sourceBranchId,
        destinationCustomerAccountId: destinationCustomerId,
        reason,
        confirmation,
        currentUser,
      });
      setSuccess(`Branch separation applied. Request ${data?.request_id || "recorded"}.`);
      setPreview(null);
      setConfirmation("");
    } catch (applyError) {
      setError(applyError.message || "Could not apply branch separation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="text-2xl font-extrabold text-slate-900">Branch Separation</h2>
        <p className="text-sm text-slate-500">
          Super Admin workflow for previewing and atomically relinking one branch to a standalone customer account.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search customers"
            className="rounded-xl border p-3 lg:col-span-2"
          />
          <select
            value={sourceCustomerId}
            onChange={(event) => {
              setSourceCustomerId(event.target.value);
              setSourceBranchId("");
              setPreview(null);
            }}
            className="rounded-xl border p-3"
          >
            {filteredCustomers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.account_name}</option>
            ))}
          </select>
          <select
            value={sourceBranchId}
            onChange={(event) => setSourceBranchId(event.target.value)}
            className="rounded-xl border p-3"
          >
            <option value="">Select source branch</option>
            {sourceBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.branch_name}</option>
            ))}
          </select>
          <select
            value={destinationCustomerId}
            onChange={(event) => setDestinationCustomerId(event.target.value)}
            className="rounded-xl border p-3 lg:col-span-2"
          >
            <option value="">Select destination customer account</option>
            {customers
              .filter((customer) => String(customer.id) !== String(sourceCustomerId))
              .map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.account_name}</option>
              ))}
          </select>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Mandatory reason"
            className="min-h-24 rounded-xl border p-3 lg:col-span-2"
          />
        </div>

        <button
          type="button"
          onClick={generatePreview}
          disabled={loading || !sourceCustomerId || !sourceBranchId || !destinationCustomerId || !reason.trim()}
          className="mt-4 rounded-xl bg-blue-700 px-4 py-3 font-bold text-white disabled:bg-slate-300"
        >
          {loading ? "Working..." : "Generate preview"}
        </button>
      </section>

      {error && <div className="rounded-xl bg-red-50 p-3 font-bold text-red-700">{error}</div>}
      {success && <div className="rounded-xl bg-green-50 p-3 font-bold text-green-700">{success}</div>}

      {preview && (
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-lg font-extrabold">Dry Run Preview</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Object.entries(preview.counts || preview || {})
              .filter(([, value]) => typeof value === "number")
              .map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs font-bold uppercase text-slate-500">{label.replaceAll("_", " ")}</div>
                  <div className="text-2xl font-extrabold">{value}</div>
                </div>
              ))}
          </div>

          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Applying this action uses the Supabase RPC transaction. The browser does not perform multiple unprotected row updates.
          </div>

          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="Type SEPARATE BRANCH"
            className="mt-4 w-full rounded-xl border p-3"
          />
          <button
            type="button"
            onClick={apply}
            disabled={loading || confirmation !== "SEPARATE BRANCH"}
            className="mt-3 rounded-xl bg-red-700 px-4 py-3 font-bold text-white disabled:bg-slate-300"
          >
            Apply branch separation
          </button>
        </section>
      )}
    </div>
  );
}
