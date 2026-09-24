import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyPurchasePlanningFilters,
  filterPurchasePlanningRows,
  getPurchasePlanningFilterOptions,
  loadPurchasePlanningReport,
  PURCHASE_PLANNING_COUNTRIES,
  reconcilePurchasePlanningFilters,
  sortPurchasePlanningRows,
  updatePurchasePlanningHierarchy,
} from "../../services/purchasePlanningReport.js";

const PAGE_SIZE = 30;
const quantity = (value) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(Number(value || 0));
const dateTime = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};
const reportValue = (available, value) => available ? value : "Unavailable";

function FilterSelect({ label, value, options, onChange }) {
  return <label className="ppr-filter"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="All">All</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function planningFor(row, leadDays, safetyDays) {
  const sold30 = Number(row.soldLast30 || 0);
  const dailyDemand = sold30 / 30;
  const currentStock = Math.max(0, Number(row.currentStock || 0));
  const incomingQty = Math.max(0, Number(row.incomingQty ?? row.preOrderIncomingQty ?? 0));
  const outstanding = Math.max(0, Number(row.preOrderOutstandingQty || 0));
  const topUpQty = Math.max(0, Number(row.preOrderBoughtQty || 0));
  const topUpEvents = Array.isArray(row.preOrderPurchases) ? row.preOrderPurchases.length : 0;
  const learningBufferDays = dailyDemand > 0 && topUpQty > 0 ? Math.min(2, Math.max(0.5, (topUpQty / dailyDemand) * 0.1)) : 0;
  const targetDays = Number(leadDays) + Number(safetyDays) + learningBufferDays;
  const targetStock = Math.ceil((dailyDemand * targetDays) + outstanding);
  const availableStock = currentStock + incomingQty;
  const suggestedBuy = Math.ceil(Math.max(0, targetStock - availableStock));
  const daysCover = dailyDemand > 0 ? availableStock / dailyDemand : null;

  let quality = "Balanced";
  if (sold30 <= 0) quality = currentStock > 0 ? "Over Ordered" : "Learning";
  else if (topUpQty > 0 && (daysCover === null || daysCover < targetDays)) quality = "Under Ordered";
  else if (daysCover !== null && daysCover > Math.max(targetDays * 2, targetDays + 14)) quality = "Over Ordered";

  let risk = "Covered";
  if (sold30 <= 0) risk = currentStock > 0 ? "Excess Stock" : "Learning";
  else if (daysCover !== null && daysCover < Number(leadDays)) risk = "Buy Now";
  else if (daysCover !== null && daysCover < targetDays) risk = "Buy Soon";
  else if (daysCover !== null && daysCover > Math.max(targetDays * 2, targetDays + 14)) risk = "Excess Stock";

  const dependency = topUpEvents >= 3 || topUpQty >= sold30 * 0.25 ? "High" : topUpEvents >= 1 || topUpQty > 0 ? "Medium" : "Low";
  const nextAction = quality === "Under Ordered" ? "Increase the next main order modestly" : quality === "Over Ordered" ? "Reduce / pause the next purchase" : quality === "Learning" ? "Collect more sales history" : "Maintain current buying pattern";
  return { ...row, dailyDemand, currentStock, incomingQty, outstanding, topUpQty, topUpEvents, learningBufferDays, targetDays, targetStock, availableStock, suggestedBuy, daysCover, quality, risk, dependency, nextAction };
}

function StatusPill({ value }) {
  return <span className={`ppr-pill ppr-${String(value || "").toLowerCase().replace(/[^a-z]+/g, "-")}`}>{value}</span>;
}

function ProductMeta({ row }) {
  return <button type="button" className="ppr-product-button"><strong>{row.productName}</strong><span>{[row.productCode, row.brand, row.series, row.country].filter(Boolean).join(" · ")}</span></button>;
}

function PurchaseDetails({ row, leadDays, safetyDays }) {
  return <div className="ppr-details">
    <section><h4>Demand</h4><dl>
      <div><dt>Last 7 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast7))}</dd></div>
      <div><dt>Last 30 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast30))}</dd></div>
      <div><dt>Average / Day</dt><dd>{reportValue(row.salesAvailable, row.dailyDemand.toFixed(2))}</dd></div>
      <div><dt>Current Days Cover</dt><dd>{row.daysCover == null ? "—" : row.daysCover.toFixed(1)}</dd></div>
    </dl></section>
    <section><h4>Stock Position</h4><dl>
      <div><dt>Current Stock</dt><dd>{quantity(row.currentStock)}</dd></div>
      <div><dt>Incoming</dt><dd>{quantity(row.incomingQty)}</dd></div>
      <div><dt>Outstanding Customer Demand</dt><dd>{quantity(row.outstanding)}</dd></div>
      <div><dt>Warehouse / Country</dt><dd>{row.stockLocationName || row.country || "—"}</dd></div>
    </dl></section>
    <section><h4>Planning Target</h4><dl>
      <div><dt>Supplier Lead Time</dt><dd>{leadDays} days</dd></div>
      <div><dt>Safety Cover</dt><dd>{safetyDays} days</dd></div>
      <div><dt>Learning Buffer</dt><dd>+{row.learningBufferDays.toFixed(1)} days</dd></div>
      <div><dt>Target Stock</dt><dd>{quantity(row.targetStock)}</dd></div>
    </dl></section>
    <section className="ppr-decision"><h4>Recommendation</h4><div className="ppr-big">Buy {quantity(row.suggestedBuy)}</div><div><StatusPill value={row.risk} /> <StatusPill value={row.quality} /></div><p>{row.suggestedBuy > 0 ? `Target ${quantity(row.targetStock)} − stock/incoming ${quantity(row.availableStock)} = ${quantity(row.suggestedBuy)} units.` : `Current stock plus incoming stock already covers the ${row.targetDays.toFixed(1)}-day operating target.`}</p></section>
    <section className="ppr-purchases"><h4>Why / Top-up Learning</h4>{row.topUpQty > 0 ? <p className="ppr-warning-text">The system found {quantity(row.topUpQty)} units bought through the current top-up / Pre-Order Supply flow ({row.topUpEvents} event{row.topUpEvents === 1 ? "" : "s"}). This marks the product as an under-order risk and adds only a small capped learning buffer, so the planner learns without double-counting incoming stock.</p> : <p>No additional top-up buying is currently recorded for this product.</p>}
      {row.preOrderPurchases?.length > 0 && <div className="ppr-purchase-list">{row.preOrderPurchases.map((purchase) => <article key={purchase.id || `${purchase.orderNumber}-${purchase.date}`}><strong>{purchase.action}</strong> · {quantity(purchase.quantity)} units<div>{purchase.supplierName || "Supplier not recorded"}</div><div>{dateTime(purchase.date)}</div><div>Order {purchase.orderNumber || "—"}</div></article>)}</div>}
      <p className="ppr-advisory"><strong>Advisory only:</strong> this report does not create or change purchase orders automatically.</p>
    </section>
  </div>;
}

function pageNumbers(page, count) {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const values = new Set([1, count, page - 1, page, page + 1]);
  return [...values].filter((v) => v >= 1 && v <= count).sort((a, b) => a - b);
}

function Row({ row, cells, open, onToggle, colSpan, leadDays, safetyDays }) {
  return <><tr onClick={onToggle} className="ppr-click-row">{cells.map((cell, i) => <td key={i} className={i > 0 && typeof cell !== "object" ? "ppr-number" : ""}>{cell}</td>)}</tr>{open && <tr className="ppr-detail-row"><td colSpan={colSpan}><PurchaseDetails row={row} leadDays={leadDays} safetyDays={safetyDays}/></td></tr>}</>;
}

function Table({ rows, tab, expanded, toggle, leadDays, safetyDays }) {
  const headers = tab === "quality"
    ? ["Product", "30d Sold", "Stock", "Top-up Qty", "Top-up Events", "Days Cover", "Quality", "Next Action"]
    : tab === "dependency"
      ? ["Product", "Supplier", "30d Sold", "Top-up Qty", "Top-up Events", "Dependency", "Quality", "Suggested Buy"]
      : tab === "risk"
        ? ["Product", "Stock", "Incoming", "Avg/Day", "Days Cover", "Target Days", "Risk", "Suggested Buy"]
        : ["Product", "Stock", "Incoming", "30d Sold", "Avg/Day", "Days Cover", "Top-up", "Suggested Buy", "Risk", "Quality"];
  const cells = (r) => tab === "quality"
    ? [<ProductMeta row={r}/>, quantity(r.soldLast30), quantity(r.currentStock), quantity(r.topUpQty), r.topUpEvents, r.daysCover == null ? "—" : r.daysCover.toFixed(1), <StatusPill value={r.quality}/>, r.nextAction]
    : tab === "dependency"
      ? [<ProductMeta row={r}/>, r.supplierName || "—", quantity(r.soldLast30), quantity(r.topUpQty), r.topUpEvents, <StatusPill value={r.dependency}/>, <StatusPill value={r.quality}/>, quantity(r.suggestedBuy)]
      : tab === "risk"
        ? [<ProductMeta row={r}/>, quantity(r.currentStock), quantity(r.incomingQty), r.dailyDemand.toFixed(2), r.daysCover == null ? "—" : r.daysCover.toFixed(1), r.targetDays.toFixed(1), <StatusPill value={r.risk}/>, quantity(r.suggestedBuy)]
        : [<ProductMeta row={r}/>, quantity(r.currentStock), quantity(r.incomingQty), quantity(r.soldLast30), r.dailyDemand.toFixed(2), r.daysCover == null ? "—" : r.daysCover.toFixed(1), quantity(r.topUpQty), quantity(r.suggestedBuy), <StatusPill value={r.risk}/>, <StatusPill value={r.quality}/>];
  return <div className="ppr-table-wrap"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row) => <Row key={row.rowKey} row={row} cells={cells(row)} open={expanded.has(row.rowKey)} onToggle={() => toggle(row.rowKey)} colSpan={headers.length} leadDays={leadDays} safetyDays={safetyDays}/>)}</tbody></table></div>;
}

export default function PurchasePlanningReport({ products = [], currentUser = null }) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ ...emptyPurchasePlanningFilters });
  const [riskFilter, setRiskFilter] = useState("All");
  const [qualityFilter, setQualityFilter] = useState("All");
  const [leadDays, setLeadDays] = useState(3);
  const [safetyDays, setSafetyDays] = useState(2);
  const [tab, setTab] = useState("plan");
  const [expanded, setExpanded] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preOrderWarning, setPreOrderWarning] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [page, setPage] = useState(1);
  const requestIdRef = useRef(0);

  const refreshReport = async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true); setError("");
    try {
      const result = await loadPurchasePlanningReport({ products, user: currentUser });
      if (requestIdRef.current !== requestId) return;
      setRows(result.rows || []);
      setFilters((current) => reconcilePurchasePlanningFilters(result.rows || [], current));
      setPreOrderWarning(result.preOrderWarning || "");
      setLoadedAt(result.loadedAt || "");
      setPage(1); setExpanded(new Set());
    } catch (e) {
      if (requestIdRef.current === requestId) setError(e?.message || "Purchase Planning could not be loaded.");
    } finally { if (requestIdRef.current === requestId) setLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(refreshReport, 0); return () => { window.clearTimeout(timer); requestIdRef.current += 1; }; }, [products, currentUser?.id, currentUser?.staff_id]);

  const options = useMemo(() => getPurchasePlanningFilterOptions(rows, filters), [rows, filters]);
  const plannedRows = useMemo(() => sortPurchasePlanningRows(filterPurchasePlanningRows(rows, filters)).map((row) => planningFor(row, leadDays, safetyDays)), [rows, filters, leadDays, safetyDays]);
  const visibleRows = useMemo(() => plannedRows.filter((r) => (riskFilter === "All" || r.risk === riskFilter) && (qualityFilter === "All" || r.quality === qualityFilter)), [plannedRows, riskFilter, qualityFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRows = visibleRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const summary = useMemo(() => ({
    reviewed: visibleRows.length,
    buyNow: visibleRows.filter((r) => r.risk === "Buy Now").length,
    buySoon: visibleRows.filter((r) => r.risk === "Buy Soon").length,
    under: visibleRows.filter((r) => r.quality === "Under Ordered").length,
    over: visibleRows.filter((r) => r.quality === "Over Ordered").length,
    suggestedUnits: visibleRows.reduce((sum, r) => sum + r.suggestedBuy, 0),
  }), [visibleRows]);

  const setFilter = (field, value) => { setFilters((current) => ["mainCategory", "subCategory", "brand"].includes(field) ? updatePurchasePlanningHierarchy(current, field, value) : { ...current, [field]: value }); setPage(1); setExpanded(new Set()); };
  const toggle = (key) => setExpanded((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const exportCsv = () => {
    if (!window.confirm("Download the current Purchase Planning report?")) return;
    const headers = ["Product Code","Product","Country","Stock","Incoming","30 Day Sales","Average Per Day","Days Cover","Top-up Qty","Top-up Events","Target Days","Suggested Buy","Risk","Purchase Quality"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...visibleRows.map((r) => [r.productCode,r.productName,r.country,r.currentStock,r.incomingQty,r.soldLast30,r.dailyDemand.toFixed(2),r.daysCover == null ? "" : r.daysCover.toFixed(1),r.topUpQty,r.topUpEvents,r.targetDays.toFixed(1),r.suggestedBuy,r.risk,r.quality])].map((line) => line.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `fairchoice-purchase-planning-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const tabs = [["plan","Purchase Plan"],["quality","Purchase Quality"],["dependency","POS Dependency"],["risk","Stock Risk"]];
  return <div className="ppr-shell"><style>{styles}</style>
    <header className="ppr-heading"><div><h2>Purchase Planning</h2><p>Keep stock moving: buy enough for demand, supplier lead time and a small safety buffer — not simply because a product is marked low stock.</p>{loadedAt && <small>Last refreshed {dateTime(loadedAt)}</small>}</div><div className="ppr-actions"><button onClick={refreshReport} disabled={loading}>{loading ? "Refreshing..." : "Refresh Report"}</button><button onClick={exportCsv} disabled={!visibleRows.length}>Export CSV</button></div></header>
    {error && <div className="ppr-error">{error}</div>}{preOrderWarning && <div className="ppr-warning">{preOrderWarning}</div>}
    <section className="ppr-model"><div><strong>Operating model</strong><span>Expected demand × (lead time + safety + small learned top-up buffer) − current stock − incoming stock</span></div><label>Lead time (days)<input type="number" min="1" max="30" value={leadDays} onChange={(e) => { setLeadDays(Math.max(1, Number(e.target.value) || 1)); setPage(1); }}/></label><label>Safety cover (days)<input type="number" min="0" max="30" value={safetyDays} onChange={(e) => { setSafetyDays(Math.max(0, Number(e.target.value) || 0)); setPage(1); }}/></label></section>
    <section className="ppr-summary"><article><span>Products Reviewed</span><strong>{summary.reviewed}</strong></article><article><span>Buy Now</span><strong>{summary.buyNow}</strong></article><article><span>Buy Soon</span><strong>{summary.buySoon}</strong></article><article><span>Under Ordered</span><strong>{summary.under}</strong></article><article><span>Over Ordered</span><strong>{summary.over}</strong></article><article><span>Suggested Units</span><strong>{quantity(summary.suggestedUnits)}</strong></article></section>
    <section className="ppr-filter-bar"><label className="ppr-filter ppr-search"><span>Search</span><input type="search" value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Code, product, brand or series"/></label><FilterSelect label="Supplier" value={filters.supplier} options={options.suppliers} onChange={(v) => setFilter("supplier", v)}/><FilterSelect label="Brand" value={filters.brand} options={options.brands} onChange={(v) => setFilter("brand", v)}/><FilterSelect label="Series" value={filters.series} options={options.series} onChange={(v) => setFilter("series", v)}/><FilterSelect label="Country" value={filters.country} options={PURCHASE_PLANNING_COUNTRIES} onChange={(v) => setFilter("country", v)}/><FilterSelect label="Stock Risk" value={riskFilter} options={["Buy Now","Buy Soon","Covered","Excess Stock","Learning"]} onChange={(v) => { setRiskFilter(v); setPage(1); }}/><FilterSelect label="Purchase Quality" value={qualityFilter} options={["Under Ordered","Balanced","Over Ordered","Learning"]} onChange={(v) => { setQualityFilter(v); setPage(1); }}/></section>
    <nav className="ppr-tabs">{tabs.map(([key,label]) => <button key={key} onClick={() => { setTab(key); setPage(1); setExpanded(new Set()); }} className={tab === key ? "active" : ""}>{label}</button>)}</nav>
    {loading ? <div className="ppr-empty">Loading Purchase Planning…</div> : !visibleRows.length ? <div className="ppr-empty">No products match the current filters.</div> : <><Table rows={pagedRows} tab={tab} expanded={expanded} toggle={toggle} leadDays={leadDays} safetyDays={safetyDays}/><nav className="ppr-pagination"><span>Showing {visibleRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0}–{Math.min(currentPage * PAGE_SIZE, visibleRows.length)} of {visibleRows.length} · Max 30 per page</span><button disabled={currentPage <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}>Previous</button>{pageNumbers(currentPage, pageCount).map((n) => <button key={n} className={n === currentPage ? "active" : ""} onClick={() => setPage(n)}>{n}</button>)}<button disabled={currentPage >= pageCount} onClick={() => setPage((v) => Math.min(pageCount, v + 1))}>Next</button></nav></>}
  </div>;
}

const styles = `
.ppr-shell{display:grid;gap:14px;color:#102033}.ppr-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.ppr-heading h2{margin:0;font-size:26px}.ppr-heading p{margin:4px 0;color:#64748b;max-width:850px}.ppr-heading small{color:#64748b}.ppr-actions{display:flex;gap:8px}.ppr-actions button,.ppr-pagination button,.ppr-tabs button{min-height:38px;border:1px solid #b8c7d9;border-radius:8px;background:#fff;color:#073763;padding:0 13px;font-weight:800;cursor:pointer}.ppr-actions button:first-child,.ppr-tabs button.active,.ppr-pagination button.active{background:#073763;color:#fff;border-color:#073763}.ppr-model{display:grid;grid-template-columns:1fr 150px 150px;gap:12px;align-items:end;background:#eaf3ff;border:1px solid #b9d5f4;border-radius:12px;padding:12px}.ppr-model>div{display:grid;gap:3px}.ppr-model span{font-size:12px;color:#48617d}.ppr-model label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#475569;text-transform:uppercase}.ppr-model input{height:38px;border:1px solid #b8c7d9;border-radius:8px;padding:0 9px}.ppr-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:9px}.ppr-summary article{background:#fff;border:1px solid #dbe5ef;border-radius:11px;padding:12px}.ppr-summary span{display:block;font-size:11px;color:#64748b;font-weight:800;text-transform:uppercase}.ppr-summary strong{font-size:22px;color:#073763}.ppr-filter-bar{display:grid;grid-template-columns:repeat(7,minmax(125px,1fr));gap:9px;background:#fff;border:1px solid #dbe5ef;border-radius:12px;padding:11px}.ppr-filter{display:grid;gap:4px}.ppr-filter span{font-size:10px;font-weight:800;color:#475569;text-transform:uppercase}.ppr-filter input,.ppr-filter select{height:38px;min-width:0;width:100%;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 8px}.ppr-tabs{display:flex;gap:6px;flex-wrap:wrap}.ppr-warning,.ppr-error{border-radius:9px;padding:11px 13px}.ppr-warning{background:#fff7d6;border:1px solid #f0d36b;color:#714f00}.ppr-error{background:#fff0f0;border:1px solid #efaaaa;color:#8b1b1b}.ppr-empty{padding:28px;text-align:center;background:#fff;border:1px solid #dbe5ef;border-radius:12px;color:#64748b}.ppr-table-wrap{overflow:auto;max-height:68vh;background:#fff;border:1px solid #dbe5ef;border-radius:12px}.ppr-table-wrap table{width:100%;border-collapse:separate;border-spacing:0;min-width:1100px}.ppr-table-wrap th{position:sticky;top:0;z-index:2;background:#eef4fa;color:#334155;font-size:10px;text-transform:uppercase;text-align:left}.ppr-table-wrap th,.ppr-table-wrap td{padding:9px;border-bottom:1px solid #e7edf4;vertical-align:top}.ppr-click-row{cursor:pointer}.ppr-click-row:hover{background:#f8fbff}.ppr-number{text-align:right;font-variant-numeric:tabular-nums}.ppr-product-button{display:grid;gap:2px;border:0;background:transparent;padding:0;text-align:left;color:#102033;pointer-events:none}.ppr-product-button span{font-size:10px;color:#64748b;font-weight:500}.ppr-detail-row td{background:#f8fafc;padding:13px}.ppr-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ppr-details section{background:#fff;border:1px solid #dbe5ef;border-radius:10px;padding:11px}.ppr-details h4{margin:0 0 8px;color:#073763;text-transform:uppercase;font-size:11px}.ppr-details dl{margin:0;display:grid;gap:6px}.ppr-details dl div{display:flex;justify-content:space-between;gap:10px}.ppr-details dt{color:#64748b}.ppr-details dd{margin:0;font-weight:800;text-align:right}.ppr-decision .ppr-big{font-size:24px;font-weight:900;color:#075985;margin-bottom:8px}.ppr-decision p,.ppr-purchases p{font-size:12px;line-height:1.5}.ppr-purchases{grid-column:1/-1}.ppr-purchase-list{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.ppr-purchase-list article{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:11px;line-height:1.45}.ppr-advisory{color:#64748b}.ppr-warning-text{color:#714f00}.ppr-pill{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:900;white-space:nowrap;background:#eef2f7;color:#334155}.ppr-buy-now,.ppr-under-ordered,.ppr-high{background:#fee2e2;color:#991b1b}.ppr-buy-soon,.ppr-medium{background:#ffedd5;color:#9a3412}.ppr-covered,.ppr-balanced,.ppr-low{background:#dcfce7;color:#166534}.ppr-excess-stock,.ppr-over-ordered{background:#dbeafe;color:#1e40af}.ppr-learning{background:#f1f5f9;color:#475569}.ppr-pagination{display:flex;gap:5px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.ppr-pagination>span{margin-right:auto;font-size:12px;color:#64748b}.ppr-pagination button:disabled,.ppr-actions button:disabled{opacity:.5;cursor:not-allowed}
@media(max-width:1100px){.ppr-summary{grid-template-columns:repeat(3,1fr)}.ppr-filter-bar{grid-template-columns:repeat(3,1fr)}.ppr-details{grid-template-columns:repeat(2,1fr)}.ppr-purchase-list{grid-template-columns:repeat(2,1fr)}}
@media(max-width:700px){.ppr-heading,.ppr-model{grid-template-columns:1fr;display:grid}.ppr-summary{grid-template-columns:repeat(2,1fr)}.ppr-filter-bar{grid-template-columns:1fr}.ppr-details{grid-template-columns:1fr}.ppr-purchase-list{grid-template-columns:1fr}.ppr-purchases{grid-column:auto}.ppr-actions button{flex:1}}
`;
