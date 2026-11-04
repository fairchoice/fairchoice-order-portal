import { useEffect, useMemo, useState } from "react";
import { getCustomerAccounts } from "../../services/customerManagement";
import { loadSalesRouteAnalysis, SALES_ROUTE_DAYS } from "../../services/salesRouteService";

const PAGE_SIZE = 30;
const normalise = (value) => String(value || "").trim();
const customerCountry = (customer) => normalise(customer?.country || customer?.account_country || customer?.default_country || (customer?.customer_branches || []).find((b) => b?.active !== false)?.country) || "Unknown";
const customerName = (customer) => customer?.account_name || customer?.company_name || customer?.business_name || "Unknown customer";
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
const iso = (date) => { const d = new Date(date); const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 10); };
const weekStart = (value = new Date()) => { const d = new Date(value); d.setHours(0,0,0,0); const day = d.getDay(); d.setDate(d.getDate() - ((day + 6) % 7)); return d; };
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d; };
const displayDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("en-GB") : "—";
const orderAmount = (order) => Number(order?.order_total ?? order?.total_amount ?? 0);
const exceptionVisit = (visit) => /exception order/i.test(String(visit?.no_order_reason || "")) || /exception order/i.test(String(visit?.note || ""));

function Pagination({ total, page, setPage }) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  return <div className="flex flex-wrap items-center gap-2 text-sm"><span className="mr-auto text-slate-500">Showing {total ? (current - 1) * PAGE_SIZE + 1 : 0}–{Math.min(current * PAGE_SIZE, total)} of {total} · max 30 per page</span><button className="border rounded-lg px-3 py-1 disabled:opacity-40" disabled={current <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button><span className="font-bold">Page {current} / {pageCount}</span><button className="border rounded-lg px-3 py-1 disabled:opacity-40" disabled={current >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button></div>;
}

function WeeklyPerformance({ data, customers, countries }) {
  const [week, setWeek] = useState(iso(weekStart()));
  const [country, setCountry] = useState("All");
  const [rep, setRep] = useState("All");
  const [day, setDay] = useState("All");
  const [page, setPage] = useState(1);
  const customerById = useMemo(() => new Map(customers.map((c) => [String(c.id), c])), [customers]);
  const orderByNumber = useMemo(() => new Map((data.orders || []).map((o) => [String(o.order_number || ""), o])), [data.orders]);
  const start = useMemo(() => weekStart(`${week}T12:00:00`), [week]);
  const end = addDays(start, 6);
  const dateByDay = useMemo(() => Object.fromEntries(SALES_ROUTE_DAYS.map((name, index) => [name, iso(addDays(start, index))])), [start]);
  const reps = useMemo(() => [...new Set((data.visits || []).map((v) => normalise(v.staff_name)).filter(Boolean))].sort((a,b) => a.localeCompare(b)), [data.visits]);

  const filteredCustomers = (customerId) => {
    const c = customerById.get(String(customerId));
    return country === "All" || customerCountry(c) === country;
  };
  const repMatchesVisit = (visit) => rep === "All" || normalise(visit.staff_name) === rep;
  const repMatchesAssignment = (assignment) => {
    if (rep === "All") return true;
    const related = (data.visits || []).find((v) => String(v.route_assignment_id || "") === String(assignment.id) && normalise(v.staff_name) === rep);
    return Boolean(related) || !assignment.assigned_staff_id;
  };

  const weekVisits = useMemo(() => (data.visits || []).filter((v) => v.business_date >= iso(start) && v.business_date <= iso(end)), [data.visits, start, end]);
  const buildDay = (dayName) => {
    const dateKey = dateByDay[dayName];
    const assignments = (data.assignments || []).filter((a) => a.active !== false && a.day_of_week === dayName && filteredCustomers(a.customer_account_id) && repMatchesAssignment(a));
    const visits = weekVisits.filter((v) => v.business_date === dateKey && filteredCustomers(v.customer_account_id) && repMatchesVisit(v));
    const orderVisits = visits.filter((v) => v.outcome === "ORDER_PLACED");
    const noOrders = visits.filter((v) => v.outcome === "NO_ORDER");
    const exceptions = orderVisits.filter(exceptionVisit);
    const visitedAssignmentIds = new Set(visits.map((v) => String(v.route_assignment_id || "")).filter(Boolean));
    const visitedKeys = new Set(visits.map((v) => `${v.customer_account_id}::${v.customer_branch_id || ""}`));
    const missed = assignments.filter((a) => !visitedAssignmentIds.has(String(a.id)) && !visitedKeys.has(`${a.customer_account_id}::${a.customer_branch_id || ""}`));
    const sales = orderVisits.reduce((sum, v) => sum + orderAmount(orderByNumber.get(String(v.order_number || ""))), 0);
    const activities = [];
    assignments.forEach((a) => {
      const visit = visits.find((v) => String(v.route_assignment_id || "") === String(a.id)) || visits.find((v) => String(v.customer_account_id) === String(a.customer_account_id) && String(v.customer_branch_id || "") === String(a.customer_branch_id || ""));
      const order = visit?.order_number ? orderByNumber.get(String(visit.order_number)) : null;
      activities.push({ type: visit ? (exceptionVisit(visit) ? "Exception Order" : visit.outcome === "ORDER_PLACED" ? "Order" : visit.outcome === "NO_ORDER" ? "No Order" : visit.outcome) : "Missed", day: dayName, date: dateKey, customer: customerById.get(String(a.customer_account_id)), visit, order, scheduled: true, sequence: Number(a.visit_sequence || 0) });
    });
    visits.filter((v) => exceptionVisit(v) && !assignments.some((a) => String(a.id) === String(v.route_assignment_id || ""))).forEach((visit) => activities.push({ type: "Exception Order", day: dayName, date: dateKey, customer: customerById.get(String(visit.customer_account_id)), visit, order: orderByNumber.get(String(visit.order_number || "")), scheduled: false, sequence: 9999 }));
    return { dayName, dateKey, assignments, visits, orderVisits, noOrders, exceptions, missed, sales, activities: activities.sort((a,b) => a.sequence - b.sequence) };
  };
  const dayStats = useMemo(() => SALES_ROUTE_DAYS.map(buildDay), [data, customers, country, rep, week, weekVisits, orderByNumber]);
  const selected = day === "All" ? dayStats : dayStats.filter((d) => d.dayName === day);
  const totals = selected.reduce((a,d) => ({ route:a.route+d.assignments.length, visited:a.visited+d.visits.length, orders:a.orders+d.orderVisits.length, noOrder:a.noOrder+d.noOrders.length, missed:a.missed+d.missed.length, exception:a.exception+d.exceptions.length, sales:a.sales+d.sales }), { route:0, visited:0, orders:0, noOrder:0, missed:0, exception:0, sales:0 });
  const activities = selected.flatMap((d) => d.activities);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(activities.length / PAGE_SIZE)));
  const visible = activities.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  useEffect(() => setPage(1), [week, country, rep, day]);

  return <div className="space-y-4">
    <div className="border bg-white rounded-xl p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
      <label className="text-xs font-bold text-slate-600">Week commencing<input type="date" className="block mt-1 border rounded-lg px-3 py-2 w-full text-sm font-normal" value={week} onChange={(e) => setWeek(iso(weekStart(`${e.target.value}T12:00:00`)))}/></label>
      <label className="text-xs font-bold text-slate-600">Country<select className="block mt-1 border rounded-lg px-3 py-2 w-full text-sm font-normal" value={country} onChange={(e) => setCountry(e.target.value)}><option value="All">All countries</option>{countries.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Sales Rep<select className="block mt-1 border rounded-lg px-3 py-2 w-full text-sm font-normal" value={rep} onChange={(e) => setRep(e.target.value)}><option value="All">All sales reps</option>{reps.map((r) => <option key={r}>{r}</option>)}</select></label>
      <label className="text-xs font-bold text-slate-600">Day<select className="block mt-1 border rounded-lg px-3 py-2 w-full text-sm font-normal" value={day} onChange={(e) => setDay(e.target.value)}><option value="All">All days</option>{SALES_ROUTE_DAYS.map((d) => <option key={d}>{d}</option>)}</select></label>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">{[["Route Customers",totals.route],["Visited",totals.visited],["Orders",totals.orders],["No Order",totals.noOrder],["Missed",totals.missed],["Exception",totals.exception],["Sales",money(totals.sales)],["Avg Order",money(totals.orders ? totals.sales/totals.orders : 0)]].map(([l,v]) => <div key={l} className="border bg-white rounded-xl p-3"><span className="text-xs text-slate-500">{l}</span><strong className="block text-xl">{v}</strong></div>)}</div>
    <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-7 gap-2">{dayStats.map((d) => <button key={d.dayName} onClick={() => setDay(day === d.dayName ? "All" : d.dayName)} className={`text-left border rounded-xl p-3 ${day === d.dayName ? "bg-blue-950 text-white" : "bg-white"}`}><strong>{d.dayName}</strong><span className="block text-xs opacity-70">{displayDate(d.dateKey)}</span><div className="text-xs mt-2">Route {d.assignments.length} · Visit {d.visits.length} · Order {d.orderVisits.length}</div><div className="text-xs">No order {d.noOrders.length} · Missed {d.missed.length} · Ex {d.exceptions.length}</div><div className="font-bold mt-1">{money(d.sales)}</div></button>)}</div>
    <div className="bg-white border rounded-xl overflow-auto"><table className="w-full text-sm min-w-[1100px]"><thead className="bg-slate-100"><tr><th className="p-2 text-left">Day</th><th className="text-left">Customer</th><th>Scheduled</th><th>Visit Time</th><th>Sales Rep</th><th>Outcome</th><th>Order</th><th>Value</th><th className="text-left">Reason / Note</th></tr></thead><tbody>{visible.map((r,i) => <tr className="border-t" key={`${r.date}-${r.customer?.id || i}-${r.type}-${i}`}><td className="p-2"><strong>{r.day}</strong><div className="text-xs text-slate-500">{displayDate(r.date)}</div></td><td className="font-bold">{customerName(r.customer)}</td><td className="text-center">{r.scheduled ? "Yes" : "No"}</td><td className="text-center">{r.visit?.visited_at ? new Date(r.visit.visited_at).toLocaleTimeString("en-GB", { hour:"2-digit", minute:"2-digit" }) : "—"}</td><td className="text-center">{r.visit?.staff_name || "—"}</td><td className="text-center"><span className={`px-2 py-1 rounded-full text-xs font-bold ${r.type === "Order" ? "bg-green-100 text-green-800" : r.type === "Exception Order" ? "bg-orange-100 text-orange-800" : r.type === "No Order" ? "bg-yellow-100 text-yellow-800" : "bg-red-100 text-red-800"}`}>{r.type}</span></td><td className="text-center">{r.visit?.order_number || "—"}</td><td className="text-right">{r.order ? money(orderAmount(r.order)) : "—"}</td><td>{[r.visit?.no_order_reason, r.visit?.note].filter(Boolean).join(" — ") || "—"}</td></tr>)}{!visible.length && <tr><td colSpan="9" className="p-8 text-center text-slate-500">No activity for the selected week/day/filter.</td></tr>}</tbody></table></div>
    <Pagination total={activities.length} page={page} setPage={setPage}/>
  </div>;
}

export default function SalesRouteAnalysisReport() {
  const [data, setData] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [tab, setTab] = useState("inactive");
  const [country, setCountry] = useState("All");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { const c = await getCustomerAccounts({ operationalOnly: true }); setCustomers(c || []); setData(await loadSalesRouteAnalysis({ customers: c || [] })); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const countries = useMemo(() => { const values = new Set(["Wales", "England"]); customers.forEach((c) => values.add(customerCountry(c))); return [...values].filter(Boolean).sort((a, b) => a.localeCompare(b)); }, [customers]);
  useEffect(() => { setPage(1); }, [tab, country]);
  if (loading) return <div className="p-6">Loading Sales Route Analysis…</div>;
  const tabs = [["inactive", "No Order 14+ Days"], ["missed", "Didn’t Visit Today"], ["new", "New Customers"], ["location", "Location Analysis"], ["weekly", "Weekly Rep Performance"]];
  const baseRows = tab === "inactive" ? data.inactive14 : tab === "new" ? data.newCustomers : tab === "missed" ? data.missedToday.map(({ customer, route }) => ({ customer, route, lastOrder: null, daysSinceOrder: null, visits: 0, noOrders: 0 })) : [];
  const rows = baseRows.filter((r) => country === "All" || customerCountry(r.customer) === country);
  const locations = data.locations.filter((r) => country === "All" || r.country === country);
  const activeRows = tab === "location" ? locations : rows;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE)));
  const visible = activeRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  return <div className="p-4 space-y-4">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold">Sales Route Analysis</h2><p className="text-sm text-slate-500">Customer activity, route coverage and growth opportunities.</p></div><div className="flex gap-2">{tab !== "weekly" && <select className="border rounded-xl px-3 py-2" value={country} onChange={(e) => setCountry(e.target.value)}><option value="All">All countries</option>{countries.map((c) => <option key={c} value={c}>{c}</option>)}</select>}<button onClick={load} className="border rounded-xl px-4 font-bold">Refresh</button></div></div>
    {tab !== "weekly" && <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[["14+ Days / Never Ordered", data.inactive14.filter((r) => country === "All" || customerCountry(r.customer) === country).length], ["Route Assignments", data.assignments.filter((a) => { const c = customers.find((x) => String(x.id) === String(a.customer_account_id)); return country === "All" || customerCountry(c) === country; }).length], ["Visits Recorded", data.visits.filter((v) => { const c = customers.find((x) => String(x.id) === String(v.customer_account_id)); return country === "All" || customerCountry(c) === country; }).length], ["New Customers 30d", data.newCustomers.filter((r) => country === "All" || customerCountry(r.customer) === country).length]].map(([l, v]) => <div className="border bg-white rounded-xl p-3" key={l}><span className="text-xs text-slate-500">{l}</span><strong className="block text-2xl">{v}</strong></div>)}</div>}
    <div className="flex gap-2 flex-wrap">{tabs.map(([k, l]) => <button className={`px-3 py-2 rounded-xl font-bold ${tab === k ? "bg-blue-950 text-white" : "border bg-white"}`} onClick={() => setTab(k)} key={k}>{l}</button>)}</div>
    {tab === "weekly" ? <WeeklyPerformance data={data} customers={customers} countries={countries}/> : <>
      {tab === "location" ? <div className="bg-white border rounded-xl overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2 text-left">Country</th><th className="p-2 text-left">Location</th><th>Customers</th><th>On Route</th><th>Visits</th><th>Order Visits</th><th>No Order</th></tr></thead><tbody>{visible.map((r) => <tr className="border-t" key={`${r.country}-${r.location}`}><td className="p-2">{r.country}</td><td className="p-2 font-bold">{r.location}</td><td className="text-center">{r.customers}</td><td className="text-center">{r.assigned}</td><td className="text-center">{r.visits}</td><td className="text-center">{r.orders}</td><td className="text-center">{r.noOrders}</td></tr>)}</tbody></table></div> : <div className="bg-white border rounded-xl overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-100"><tr><th className="p-2 text-left">Customer</th><th className="text-left">Country</th><th className="text-left">Location</th><th>Last Order</th><th>Days</th><th>Visits</th><th>No Order</th></tr></thead><tbody>{visible.map((r) => <tr className="border-t" key={r.customer.id}><td className="p-2 font-bold">{customerName(r.customer)}</td><td>{customerCountry(r.customer)}</td><td>{r.customer.town_city || r.customer.postcode || "—"}</td><td className="text-center">{r.lastOrder ? new Date(r.lastOrder.created_at).toLocaleDateString("en-GB") : "Never"}</td><td className="text-center">{r.daysSinceOrder ?? "—"}</td><td className="text-center">{r.visits}</td><td className="text-center">{r.noOrders}</td></tr>)}{!visible.length && <tr><td colSpan="7" className="p-8 text-center text-slate-500">No records.</td></tr>}</tbody></table></div>}
      <Pagination total={activeRows.length} page={page} setPage={setPage}/>
    </>}
  </div>;
}
