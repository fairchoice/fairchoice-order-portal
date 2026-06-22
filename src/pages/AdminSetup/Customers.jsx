import { useEffect, useMemo, useState } from "react";
import { getCustomerAccounts } from "../../services/customerManagement";
import CustomerForm from "./CustomerForm";

const inputClass =
  "h-9 rounded border border-slate-400 px-2 text-sm outline-none focus:border-green-700";
const buttonClass =
  "h-9 rounded-full border border-slate-500 bg-white px-4 text-sm font-bold hover:bg-slate-100";

const displayPriceMode = (mode) => {
  if (mode === "Super" || mode === "super") return "Admin Offer";
  return mode || "VAT";
};

const displayStatus = (status) => (status === "Stopped" ? "Closed" : status || "Active");

const statusClass = (status) => {
  const currentStatus = displayStatus(status);

  if (currentStatus === "Active") {
    return "bg-green-100 text-green-800";
  }

  if (currentStatus === "On Hold") {
    return "bg-yellow-100 text-yellow-800";
  }

  return "bg-slate-200 text-slate-700";
};

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [countryFilter, setCountryFilter] = useState("All");
  const [cityFilter, setCityFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);

  const [page, setPage] = useState(1);
  const rowsPerPage = 10;

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const data = await getCustomerAccounts();
      setCustomers(data || []);
    } catch (error) {
      console.error("Customer load error:", error);
      alert("Could not load customers.");
    } finally {
      setLoading(false);
    }
  };

  const countries = useMemo(() => {
    return ["All", ...new Set(customers.map((c) => c.country).filter(Boolean))];
  }, [customers]);

  const cities = useMemo(() => {
    return [
      "All",
      ...new Set(customers.map((c) => c.town_city || c.city || "").filter(Boolean)),
    ];
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return customers.filter((c) => {
      const name = String(c.account_name || "").toLowerCase();
      const contact = String(c.contact_name || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const email = String(c.email || "").toLowerCase();
      const townCity = c.town_city || c.city || "";
      const status = displayStatus(c.status);

      return (
        (keyword === "" ||
          name.includes(keyword) ||
          contact.includes(keyword) ||
          phone.includes(keyword) ||
          email.includes(keyword)) &&
        (countryFilter === "All" || c.country === countryFilter) &&
        (cityFilter === "All" || townCity === cityFilter) &&
        (statusFilter === "All" || status === statusFilter)
      );
    });
  }, [customers, search, countryFilter, cityFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredCustomers.length / rowsPerPage));

  const pagedCustomers = filteredCustomers.slice(
    (page - 1) * rowsPerPage,
    page * rowsPerPage
  );

  const resetFilters = () => {
    setSearch("");
    setCountryFilter("All");
    setCityFilter("All");
    setStatusFilter("All");
    setPage(1);
  };

  return (
    <div className="p-4">
      <div className="rounded-md border border-slate-300 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold">Customer Management</h2>
            <p className="text-sm text-slate-600">
              Manage customer accounts, branches, pricing and payment setup.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingCustomer(null);
              setShowCustomerForm(true);
            }}
            className="h-9 rounded-full bg-green-700 px-4 text-sm font-bold text-white hover:bg-green-800"
          >
            + New Customer
          </button>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-5">
          <input
            placeholder="Search customer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className={`${inputClass} md:col-span-2`}
          />

          <select
            value={countryFilter}
            onChange={(e) => {
              setCountryFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            {countries.map((country) => (
              <option key={country} value={country}>
                {country === "All" ? "All Countries" : country}
              </option>
            ))}
          </select>

          <select
            value={cityFilter}
            onChange={(e) => {
              setCityFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            {cities.map((city) => (
              <option key={city} value={city}>
                {city === "All" ? "All Towns / Cities" : city}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className={inputClass}
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="On Hold">On Hold</option>
            <option value="Closed">Closed</option>
          </select>
        </div>

        <button type="button" onClick={resetFilters} className={`${buttonClass} mb-3`}>
          Clear Filters
        </button>

        {loading ? (
          <div className="p-4 text-sm font-bold">Loading customers...</div>
        ) : (
          <div className="overflow-x-auto rounded border border-slate-300">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-700 text-white">
                <tr>
                  <th className="px-2 py-2 text-left">Account Name</th>
                  <th className="px-2 py-2 text-left">Contact</th>
                  <th className="px-2 py-2 text-left">Phone</th>
                  <th className="px-2 py-2 text-left">Town / City</th>
                  <th className="px-2 py-2 text-left">Country</th>
                  <th className="px-2 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-right">Credit Limit</th>
                  <th className="px-2 py-2 text-left">Price Mode</th>
                  <th className="px-2 py-2 text-center">Actions</th>
                </tr>
              </thead>

              <tbody>
                {pagedCustomers.map((customer) => (
                  <tr key={customer.id} className="border-t border-slate-300">
                    <td className="px-2 py-2 font-bold">{customer.account_name || "-"}</td>
                    <td className="px-2 py-2">{customer.contact_name || "-"}</td>
                    <td className="px-2 py-2">{customer.phone || "-"}</td>
                    <td className="px-2 py-2">
                      {customer.town_city || customer.city || "-"}
                    </td>
                    <td className="px-2 py-2">{customer.country || "-"}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${statusClass(
                          customer.status
                        )}`}
                      >
                        {displayStatus(customer.status)}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right font-bold">
                      £{Number(customer.credit_limit || 0).toFixed(2)}
                    </td>
                    <td className="px-2 py-2">{displayPriceMode(customer.default_price_mode)}</td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCustomer(customer);
                          setShowCustomerForm(true);
                        }}
                        className="h-8 rounded bg-blue-700 px-3 text-sm font-bold text-white hover:bg-blue-800"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}

                {pagedCustomers.length === 0 && (
                  <tr>
                    <td colSpan="9" className="p-4 text-center text-sm text-slate-500">
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between text-sm">
          <div>
            Showing {pagedCustomers.length} of {filteredCustomers.length} records
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 rounded border border-slate-400 px-3 font-bold disabled:opacity-40"
            >
              Previous
            </button>

            <span className="font-bold">
              Page {page} of {totalPages}
            </span>

            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 rounded border border-slate-400 px-3 font-bold disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {showCustomerForm && (
        <CustomerForm
          editingCustomer={editingCustomer}
          onClose={() => {
            setShowCustomerForm(false);
            setEditingCustomer(null);
          }}
          onSaved={() => {
            loadCustomers();
            setShowCustomerForm(false);
            setEditingCustomer(null);
          }}
        />
      )}
    </div>
  );
}
