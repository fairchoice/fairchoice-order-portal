import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase.js";
import { getFcSessionState } from "../../services/fcSession.js";

const today = () => new Date().toISOString().slice(0, 10);
const n = (v) => Number(v || 0).toLocaleString("en-GB");
const money = (v) => `£${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TABS = [
  ["series", "Series Performance"],
  ["reps", "Sales Rep Promotion Performance"],
  ["claims", "Supplier Claim Reconciliation"],
  ["promotions", "Promotion Reconciliation"],
  ["customers", "Customer Detail"],
];

function Pager({ meta, onPage }) {
  if (!meta) return null;
  const p = Number(meta.page || 1), t = Number(meta.total_pages || 1), rows = Number(meta.total_rows || 0), size = 30;
  return <div className="bp-pager"><span>Showing {rows ? ((p - 1) * size) + 1 : 0}–{Math.min(p * size, rows)} of {rows}</span><div><button disabled={p <= 1} onClick={() => onPage(p - 1)}>← Previous</button><b>Page {p} of {t}</b><button disabled={p >= t} onClick={() => onPage(p + 1)}>Next →</button></div></div>;
}

function Table({ columns, rows = [] }) {
  return <div className="bp-table-wrap"><table><thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r, i) => <tr key={r.id || r.order_id || r.product_id || `${i}`}>{columns.map((c) => <td key={c.key}>{c.render ? c.render(r) : r[c.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} className="bp-empty">No records for this selection.</td></tr>}</tbody></table></div>;
}

function Kpi({ label, value, note, alert }) {
  return <div className={`bp-kpi ${alert ? "alert" : ""}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</div>;
}

function SelectFilter({ label, value, onChange, options = [], allLabel = "All" }) {
  return <label className="bp-control"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="All">{allLabel}</option>{options.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>;
}

function DateControls({ filters, setFilter }) {
  return <><label className="bp-control"><span>Date From</span><input type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom")(e.target.value)} /></label><label className="bp-control"><span>Date To</span><input type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo")(e.target.value)} /></label></>;
}

export default function BrandPerformanceReport({ currentUser }) {
  const [activeTab, setActiveTab] = useState("series");
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: today(),
    series: "All",
    promotion: "All",
    rep: "All",
    country: "All",
    location: "",
    customerSearch: "",
    productSearch: "",
  });
  const [pages, setPages] = useState({ customers: 1, products: 1, reps: 1, claims: 1 });
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [assignedTeam, setAssignedTeam] = useState([]);

  async function load(nextPages = pages) {
    setLoading(true);
    setError("");
    try {
      const s = getFcSessionState(currentUser);
      if (!s.valid) throw new Error("A valid Fair Choice staff session is required.");
      const [{ data: result, error: e }, { data: teamResult, error: teamError }] = await Promise.all([
        supabase.rpc("fc_brand_partner_dashboard_v3", {
        p_username: s.username,
        p_session_token: s.token,
        p_date_from: filters.dateFrom || null,
        p_date_to: filters.dateTo,
        p_series: filters.series === "All" ? null : filters.series,
        p_promotion_type: filters.promotion === "All" ? null : filters.promotion,
        p_sales_rep: filters.rep === "All" ? null : filters.rep,
        p_country: filters.country === "All" ? null : filters.country,
        p_location_search: filters.location.trim() || null,
        p_customer_search: filters.customerSearch.trim() || null,
        p_product_search: filters.productSearch.trim() || null,
        p_customer_page: nextPages.customers,
        p_product_page: nextPages.products,
        p_rep_page: nextPages.reps,
        p_claim_page: nextPages.claims,
        }),
        supabase.rpc("fc_brand_partner_assigned_staff_v1", {
          p_username: s.username,
          p_session_token: s.token,
          p_brand: "Lost Mary",
        }),
      ]);
      if (e) throw e;
      if (teamError && !String(teamError.message || "").toLowerCase().includes("could not find the function")) throw teamError;
      setAssignedTeam(Array.isArray(teamResult) ? teamResult : []);
      setData(result || {});
    } catch (e) {
      setError(e.message || "Could not load Brand Performance.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const summary = data.summary || {}, rows = data.rows || {}, opts = data.filters || {}, pg = data.pagination || {};
  const assignedTeamNames = useMemo(() => assignedTeam.map((row) => row.staff_name).filter(Boolean), [assignedTeam]);
  const repOptions = assignedTeamNames.length ? [...assignedTeamNames, "Unassigned"] : (opts.sales_reps || []).filter((rep) => String(rep).toLowerCase() !== "system admin");
  const assignedRepRows = assignedTeamNames.length ? (rows.sales_reps || []).filter((row) => row.sales_rep === "Unassigned" || assignedTeamNames.includes(row.sales_rep)) : (rows.sales_reps || []).filter((row) => String(row.sales_rep || "").toLowerCase() !== "system admin");
  const setFilter = (key) => (value) => setFilters((f) => ({ ...f, [key]: value }));
  const apply = () => { const p = { customers: 1, products: 1, reps: 1, claims: 1 }; setPages(p); load(p); };
  const go = (key) => (page) => { const p = { ...pages, [key]: page }; setPages(p); load(p); };

  const customerCols = useMemo(() => [
    { key: "customer_name", label: "Customer" }, { key: "branch_name", label: "Branch" }, { key: "postcode", label: "Postcode" }, { key: "country", label: "Area" },
    { key: "orders", label: "Orders" }, { key: "paid_units", label: "Paid Units" }, { key: "free_units", label: "Free Given" },
    { key: "is_new_customer", label: "Customer Type", render: (r) => <b>{r.is_new_customer ? "NEW" : "Existing"}</b> }, { key: "last_sale_date", label: "Last Sale" },
  ], []);

  const runButton = <button className="bp-run" onClick={apply} disabled={loading}>{loading ? "Loading…" : "Filter"}</button>;

  return <div className="bp-page"><style>{css}</style>
    <section className="bp-hero"><div><h1>Lost Mary Performance</h1><p>Nationwide UK distribution, customer growth and promotion recovery.</p></div><div className="bp-readonly">● READ ONLY</div></section>

    {error && <div className="bp-error">{error}</div>}

    <section className="bp-kpis">
      <Kpi label="Paid Units Sold" value={n(summary.paid_units)} />
      <Kpi label="Free Units Given" value={n(summary.free_given)} note="Calculated from promotion rules" />
      <Kpi label="Total Distributed" value={n(summary.total_distributed)} />
      <Kpi label="Customers Buying" value={n(summary.customers)} />
      <Kpi label="New Lost Mary Customers" value={n(summary.new_customers)} />
      <Kpi label="Free Received Back" value={n(summary.received_qty)} />
      <Kpi label="Outstanding From Lost Mary" value={n(summary.claim_outstanding)} alert note="Free entitlement less received" />
    </section>

    <section className="bp-tabs-shell">
      <div className="bp-tabs" role="tablist" aria-label="Brand performance analysis">
        {TABS.map(([key, label]) => <button key={key} type="button" className={activeTab === key ? "active" : ""} onClick={() => setActiveTab(key)}>{label}</button>)}
      </div>
      <div className="bp-swipe-note">Swipe left or right to see more analysis sections</div>
    </section>

    {activeTab === "series" && <section className="bp-card">
      <div className="bp-title"><div><h2>Series Performance</h2><p>Lost Mary sales and free promotional distribution by series.</p></div></div>
      <div className="bp-section-filters"><DateControls filters={filters} setFilter={setFilter} /><label className="bp-control bp-search"><span>Product / Series Search</span><input type="search" placeholder="Product code, product name or series" value={filters.productSearch} onChange={(e) => setFilter("productSearch")(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label><SelectFilter label="Series" value={filters.series} onChange={setFilter("series")} options={opts.series || []} />{runButton}</div>
      <Table rows={rows.series || []} columns={[{ key: "series", label: "Series" }, { key: "products", label: "Products" }, { key: "paid_units", label: "Paid Units" }, { key: "free_units", label: "Free Units" }, { key: "customers", label: "Customers" }, { key: "new_customers", label: "New Customers" }, { key: "orders", label: "Orders" }]} />
      <div className="bp-subsection"><h3>Product Detail</h3><Table rows={rows.products || []} columns={[{ key: "product_name", label: "Product" }, { key: "product_code", label: "Code" }, { key: "series", label: "Series" }, { key: "paid_units", label: "Paid Units" }, { key: "customers", label: "Customers" }, { key: "orders", label: "Orders" }, { key: "net_sales", label: "Net Sales", render: (r) => money(r.net_sales) }]} /><Pager meta={pg.products} onPage={go("products")} /></div>
    </section>}

    {activeTab === "reps" && <section className="bp-card">
      <h2>Sales Rep Promotion Performance</h2><p>Analyse Lost Mary performance by assigned sales representative.</p>
      <div className="bp-section-filters"><DateControls filters={filters} setFilter={setFilter} /><SelectFilter label="Sales Rep" value={filters.rep} onChange={setFilter("rep")} options={repOptions} /><SelectFilter label="Promotion Type" value={filters.promotion} onChange={setFilter("promotion")} options={opts.promotion_types || []} />{runButton}</div>
      <Table rows={assignedRepRows} columns={[{ key: "sales_rep", label: "Sales Rep" }, { key: "paid_units", label: "Paid Units" }, { key: "customers", label: "Customers" }, { key: "new_customers", label: "New Customers" }, { key: "promotion_orders", label: "Promotion Orders" }, { key: "free_units", label: "Free Units" }, { key: "orders", label: "All Orders" }]} /><Pager meta={pg.sales_reps} onPage={go("reps")} />
    </section>}

    {activeTab === "claims" && <section className="bp-card">
      <h2>Supplier Claim Reconciliation</h2><p className="bp-note">Claim/receipt records are audit data. This partner dashboard cannot create, edit or delete them.</p>
      <div className="bp-section-filters"><DateControls filters={filters} setFilter={setFilter} /><SelectFilter label="Country" value={filters.country} onChange={setFilter("country")} options={opts.countries || []} />{runButton}</div>
      <Table rows={rows.claims || []} columns={[{ key: "claim_date", label: "Claim Date" }, { key: "claim_reference", label: "Claim Ref" }, { key: "claimed_qty", label: "Claimed" }, { key: "received_qty", label: "Received" }, { key: "outstanding_qty", label: "Outstanding" }, { key: "status", label: "Status" }]} /><Pager meta={pg.claims} onPage={go("claims")} />
    </section>}

    {activeTab === "promotions" && <section className="bp-card">
      <h2>Promotion Reconciliation</h2><p>Each qualifying delivered order is calculated from the saved promotion rule.</p>
      <div className="bp-section-filters"><DateControls filters={filters} setFilter={setFilter} /><SelectFilter label="Promotion Type" value={filters.promotion} onChange={setFilter("promotion")} options={opts.promotion_types || []} /><SelectFilter label="Sales Rep" value={filters.rep} onChange={setFilter("rep")} options={repOptions} />{runButton}</div>
      <Table rows={rows.promotion_orders || []} columns={[{ key: "sale_date", label: "Date" }, { key: "order_number", label: "Order" }, { key: "customer_name", label: "Customer" }, { key: "branch_name", label: "Branch" }, { key: "sales_rep", label: "Sales Rep" }, { key: "promotion_name", label: "Promotion" }, { key: "paid_qty", label: "Paid Qty" }, { key: "free_given_qty", label: "Free Qty" }]} />
    </section>}

    {activeTab === "customers" && <section className="bp-card">
      <h2>Customer Detail</h2><p>Search customers and narrow the report by city, branch, postcode or area.</p>
      <div className="bp-section-filters"><DateControls filters={filters} setFilter={setFilter} /><label className="bp-control bp-search"><span>Customer Search</span><input type="search" placeholder="Customer or branch name" value={filters.customerSearch} onChange={(e) => setFilter("customerSearch")(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label><label className="bp-control bp-search"><span>City / Location</span><input type="search" placeholder="City, postcode, branch or area" value={filters.location} onChange={(e) => setFilter("location")(e.target.value)} onKeyDown={(e) => e.key === "Enter" && apply()} /></label><SelectFilter label="Country" value={filters.country} onChange={setFilter("country")} options={opts.countries || []} />{runButton}</div>
      <Table rows={rows.customers || []} columns={customerCols} /><Pager meta={pg.customers} onPage={go("customers")} />
    </section>}
  </div>;
}

const css = `.bp-page{padding:20px;background:#f5f7fb;min-height:100%;color:#172033;font-family:inherit}.bp-hero{background:linear-gradient(120deg,#101827,#222f45);color:white;border-radius:14px;padding:11px 14px;display:flex;justify-content:space-between;gap:12px;align-items:center}.bp-hero h1{margin:0;font-size:25px;line-height:1.1;white-space:nowrap}.bp-hero p{margin:2px 0 0;font-size:11px;color:#c9d3e3}.bp-readonly{border:1px solid #5d718e;border-radius:999px;padding:4px 7px;font-size:10px;font-weight:800;white-space:nowrap}.bp-kpis{display:grid;grid-template-columns:repeat(7,minmax(120px,1fr));gap:10px;margin-top:14px}.bp-kpi,.bp-card,.bp-tabs-shell{background:white;border:1px solid #e0e5ed;border-radius:14px}.bp-kpi{padding:15px}.bp-kpi span{font-size:11px;text-transform:uppercase;color:#687991;font-weight:800}.bp-kpi strong{display:block;font-size:25px;margin-top:5px}.bp-kpi small{display:block;color:#718198;margin-top:3px}.bp-kpi.alert{border-color:#efb3b3;background:#fff8f8}.bp-tabs-shell{margin-top:14px;overflow:hidden}.bp-tabs{display:flex;overflow-x:auto;scrollbar-width:auto;scrollbar-color:#2f6fcb #d9e2ef}.bp-tabs::-webkit-scrollbar{height:8px}.bp-tabs::-webkit-scrollbar-track{background:#d9e2ef}.bp-tabs::-webkit-scrollbar-thumb{background:#2f6fcb;border-radius:999px}.bp-tabs button{flex:0 0 auto;min-width:190px;border:0;border-right:1px solid #d9e1ec;padding:15px 16px;font-size:14px;line-height:1.2;font-weight:850;color:#243247;cursor:pointer;transition:filter .15s ease,box-shadow .15s ease,transform .15s ease}.bp-tabs button:nth-child(1){background:#eaf2ff;color:#1559b7}.bp-tabs button:nth-child(2){background:#eaf8ef;color:#16784a}.bp-tabs button:nth-child(3){background:#f5ecff;color:#7838a8}.bp-tabs button:nth-child(4){background:#fff1e5;color:#b85b13}.bp-tabs button:nth-child(5){background:#e9f7fb;color:#116b85}.bp-tabs button:hover{filter:brightness(.97)}.bp-tabs button.active{font-weight:900;box-shadow:inset 0 -4px currentColor, inset 0 0 0 2px currentColor;position:relative;z-index:1}.bp-tabs button.active:nth-child(1){background:#d8e8ff;color:#0b56c9}.bp-tabs button.active:nth-child(2){background:#d9f3e3;color:#0b7a43}.bp-tabs button.active:nth-child(3){background:#ecdafe;color:#7221ad}.bp-tabs button.active:nth-child(4){background:#ffe3cc;color:#b84d00}.bp-tabs button.active:nth-child(5){background:#d9f0f8;color:#006f91}.bp-swipe-note{padding:8px 14px;color:#718198;font-size:11px;border-top:1px solid #edf0f4}.bp-card{margin-top:14px;padding:16px}.bp-card h2{margin:0 0 4px;font-size:19px;font-weight:800;color:#0f4f8a}.bp-card h3{margin:0 0 10px;font-size:16px;font-weight:800;color:#f97316}.bp-card p{margin:0 0 12px;color:#718198;font-size:13px}.bp-section-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:12px 0 14px;padding:12px;background:#f7f9fc;border:1px solid #e4e9f1;border-radius:12px}.bp-control{min-width:150px;flex:0 1 190px}.bp-control.bp-search{flex:1 1 260px}.bp-control span{display:block;font-size:10px;font-weight:800;color:#60708a;margin-bottom:4px;text-transform:uppercase}.bp-control input,.bp-control select{width:100%;box-sizing:border-box;border:1px solid #d7deea;border-radius:9px;padding:9px;background:white}.bp-run{border:0;border-radius:9px;padding:10px 18px;background:#172033;color:white;font-weight:800;min-width:92px}.bp-subsection{margin-top:18px;padding-top:16px;border-top:1px solid #e6ebf2}.bp-table-wrap{overflow:auto;scrollbar-width:auto;scrollbar-color:#2f6fcb #d9e2ef}.bp-table-wrap::-webkit-scrollbar{height:10px}.bp-table-wrap::-webkit-scrollbar-track{background:#d9e2ef;border-radius:999px}.bp-table-wrap::-webkit-scrollbar-thumb{background:#2f6fcb;border-radius:999px;border:2px solid #d9e2ef}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;background:#f1f4f8;padding:9px;white-space:nowrap;border-bottom:1px solid #dce3ed}td{padding:9px;border-bottom:1px solid #edf0f4;white-space:nowrap}.bp-empty{text-align:center;color:#7a8798;padding:25px}.bp-pager{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px;color:#65758b}.bp-pager div{display:flex;gap:10px;align-items:center}.bp-pager button{border:1px solid #d4dce7;background:white;border-radius:7px;padding:6px 10px}.bp-pager button:disabled{opacity:.4}.bp-error{background:#fff0f0;border:1px solid #f1b8b8;padding:12px;border-radius:10px;margin:12px 0}.bp-note{margin-top:4px!important}@media(max-width:1200px){.bp-kpis{grid-template-columns:repeat(3,1fr)}}@media(max-width:700px){.bp-page{padding:8px}.bp-hero{padding:8px 10px;border-radius:9px}.bp-hero h1{font-size:22px}.bp-hero p{font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:75vw}.bp-readonly{padding:3px 6px;font-size:8px}.bp-kpis{grid-template-columns:1fr 1fr}.bp-tabs button{min-width:175px;padding:13px 12px}.bp-section-filters{display:grid;grid-template-columns:1fr 1fr}.bp-control,.bp-control.bp-search{min-width:0;max-width:none;flex:none}.bp-run{width:100%}.bp-pager{gap:10px;align-items:flex-start;flex-direction:column}}`;
