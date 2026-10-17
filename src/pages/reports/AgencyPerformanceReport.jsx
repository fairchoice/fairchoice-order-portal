import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../../services/supabase.js";
import { getFcSessionState } from "../../services/fcSession.js";
import "./AgencyPerformanceReport.css";
import { PERFORMANCE_GROUPS } from "../../utils/performanceGroups.js";

const money = (v) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(v || 0));
const number = (v) => Number(v || 0).toLocaleString("en-GB");
const londonDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function AgencyPerformanceReport({ currentUser }) {
  const [filters, setFilters] = useState(() => ({ from: `${londonDate().slice(0, 7)}-01`, to: londonDate(), prefix: "", city: "", group: "Middleton England" }));
  const [report, setReport] = useState(null);
  const [applied, setApplied] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const selectionRef = useRef(filters);
  const session = getFcSessionState(currentUser);
  const { username, token, valid } = session;

  const load = useCallback(async (selection, credentials) => {
    selectionRef.current = selection;
    const id = ++request.current;
    setLoading(true); setError(""); setReport(null);
    try {
      if (!credentials.valid) throw new Error("Please sign in again to view Agency Performance.");
      if (selection.from && selection.to && selection.from > selection.to) throw new Error("Date From must be before Date To.");
      const { data, error: rpcError } = await supabase.rpc("fc_agency_performance_v2", {
        p_username: credentials.username, p_session_token: credentials.token,
        p_date_from: selection.from || null, p_date_to: selection.to || null,
        p_postcode_prefix: selection.prefix.trim() || null, p_city: selection.city.trim() || null, p_performance_group: selection.group,
      });
      if (rpcError) throw rpcError;
      if (!data || typeof data !== "object") throw new Error("Agency Performance returned no report. Please refresh.");
      if (id === request.current) { setReport(data); setApplied({ ...selection }); }
    } catch (e) { if (id === request.current) setError(e.message || "Could not load Agency Performance."); }
    finally { if (id === request.current) setLoading(false); }
  }, []);

  useEffect(() => {
    const tracker = request;
    const timer = window.setTimeout(() => load(selectionRef.current, { username, token, valid }), 0);
    return () => { window.clearTimeout(timer); tracker.current++; };
  }, [username, token, valid, load]);

  const country = report?.country || (filters.group === "Wales" ? "Wales" : "England");
  const chooseGroup = (group) => { const next = { ...filters, group, prefix: "", city: "" }; setFilters(next); load(next, session); };
  const change = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value }));
  const cities = [...new Set([...(filters.group === "Middleton England" ? ["Bedford"] : []), ...(report?.cities || [])])].sort();
  const cards = report ? [
    ["Total sales", money(report.sales), "Issued invoices / older delivered orders including VAT · selected dates and area"],
    ["Collections", money(report.collections), "Confirmed payments · selected dates and area; excludes Wallet and discounts"],
    ["Customer outstanding", money(report.outstanding), "Current account balance · selected area, including opening balances and applied Wallet credit; previous-paid status alone is not a new payment"],
    [`${country} stock level`, `${number(report.stock_units)} units`, `Current ${country} location stock · shared across Performance Groups`],
    ["Shared business expenses", money(report.shared_expenses), "Posted expenses · selected dates, all business locations; country/city not recorded"],
  ] : [];

  return <main className="agency-performance">
    <header className="agency-header"><div><p>Reports / Agency Performance</p><h1>Agency Performance</h1><p>Sales, collections and current balances by Performance Group.</p></div><span>Read only · All staff</span></header>
    <div className="agency-tabs" role="tablist" aria-label="Performance Group">{PERFORMANCE_GROUPS.map((group) => <button key={group} id={`agency-tab-${group.replaceAll(" ", "-")}`} role="tab" aria-selected={filters.group === group} aria-controls="agency-panel" type="button" onClick={() => chooseGroup(group)}>{group} Performance</button>)}</div>
    <section id="agency-panel" role="tabpanel" aria-labelledby={`agency-tab-${filters.group.replaceAll(" ", "-")}`}>
      <form className="agency-filters" onSubmit={(e) => { e.preventDefault(); load(filters, session); }}>
        <label>Date From<input type="date" value={filters.from} onChange={change("from")} /></label>
        <label>Date To<input type="date" value={filters.to} onChange={change("to")} /></label>
        <label>Postcode prefix<input maxLength={8} placeholder="All group postcodes, e.g. MK or LU" value={filters.prefix} onChange={change("prefix")} /></label>
        <label>Customer city<select value={filters.city} onChange={change("city")}><option value="">All cities</option>{cities.map((city) => <option key={city}>{city}</option>)}</select></label>
        <button type="submit" disabled={loading}>{loading ? "Loading…" : "Filter / Refresh"}</button>
      </form>
      <p className="agency-note">Customers are included by their saved compulsory Performance Group. Middleton England excludes South England, West England, East England and Wales. Postcode and city filters narrow the selected group. Shared expenses and country stock are shown separately because these are not allocated to Performance Groups.</p>
      {error && <p className="agency-error" role="alert">{error}</p>}
      {loading && <p role="status">Loading Performance Group…</p>}
      {report && <>
        <p className="agency-period">{applied.from || "All dates"} to {applied.to || "today"} · {applied.prefix || "All group postcodes"} · {applied.city || "All cities"} · {number(report.customers)} customer accounts<br />Current balances and stock as at {new Date(report.as_of).toLocaleString("en-GB", { timeZone: "Europe/London" })} (UK time)</p>
        <div className="agency-cards">{cards.map(([label, value, note]) => <article key={label}><h2>{label}</h2><strong>{value}</strong><p>{note}</p></article>)}</div>
        <section className="agency-section"><h2>Sales and collections by postcode area</h2><p>Selected dates and filters. Add a postcode prefix or choose a saved customer city above to monitor another area.</p><div className="agency-table"><table><thead><tr><th>Area</th><th>Sales</th><th>Collections</th></tr></thead><tbody>{report.areas?.length ? report.areas.map((row) => <tr key={row.area}><th scope="row">{row.area}</th><td>{money(row.sales)}</td><td>{money(row.collections)}</td></tr>) : <tr><td colSpan={3}>No sales or collections for this selection.</td></tr>}</tbody></table></div></section>
        <section className="agency-section"><h2>Current {country} stock</h2><p>Shared country location inventory. Global stock without a country allocation is excluded. Performance Group, postcode and city filters do not allocate these quantities to an agency.</p><div className="agency-table"><table><thead><tr><th>Location</th><th>Units</th><th>Products</th><th>At/below stock alert</th></tr></thead><tbody>{report.stock_locations?.length ? report.stock_locations.map((row) => <tr key={row.location_name}><th scope="row">{row.location_name}</th><td>{number(row.units)}</td><td>{number(row.products)}</td><td>{number(row.low_stock)}</td></tr>) : <tr><td colSpan={4}>No active country location stock recorded.</td></tr>}</tbody></table></div></section>
      </>}
    </section>
  </main>;
}
