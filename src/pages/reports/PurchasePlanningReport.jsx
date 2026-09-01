import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  bookPurchaseStockIn,
  emptyPurchasePlanningFilters,
  filterPurchasePlanningRows,
  getPurchasePlanningFilterOptions,
  loadPurchasePlanningReport,
  PURCHASE_PLANNING_COUNTRIES,
  reconcilePurchasePlanningFilters,
  updatePurchasePlanningHierarchy,
} from "../../services/purchasePlanningReport.js";

const PAGE_SIZE = 30;
const PURCHASE_CYCLE_DAYS = 7;
const FAST_LINE_14D_THRESHOLD = 14;
const FAST_LINE_BUFFER = 2;
const qty = (value) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(Number(value || 0));
const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));
const normalize = (value) => String(value || "").trim().toLowerCase();

function FilterSelect({ label, value, options, onChange }) {
  return <label className="pp-filter"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}><option value="All">All</option>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>;
}

function suggestion(row, leadDays, safetyDays) {
  const soldLast14 = Math.max(0, Number(row.soldLast14 ?? (Number(row.soldLast7 || 0) + Number(row.soldPrevious7 || 0))));
  const daily = soldLast14 / 14;
  const incoming = Math.max(0, Number(row.incomingQty || 0));
  const current = Math.max(0, Number(row.currentStock || 0));
  const outstanding = Math.max(0, Number(row.preOrderOutstandingQty || 0));
  const topups = Math.max(Number(row.preOrderBoughtQty || 0), Number(row.topUpReceived30 || 0));
  const targetDays = PURCHASE_CYCLE_DAYS + Number(leadDays) + Number(safetyDays);
  const fastLine = soldLast14 >= FAST_LINE_14D_THRESHOLD;
  const fastLineBuffer = fastLine ? FAST_LINE_BUFFER : 0;
  const target = Math.ceil(daily * targetDays + outstanding + fastLineBuffer);
  const available = current + incoming;
  const suggested = Math.max(0, Math.ceil(target - available));
  const daysCover = daily > 0 ? available / daily : null;
  let risk = "Covered";
  if (!daily) risk = current > 0 ? "Excess Stock" : "Learning";
  else if (daysCover < Number(leadDays)) risk = "Buy Now";
  else if (daysCover < targetDays) risk = "Buy Soon";
  else if (daysCover > Math.max(targetDays * 2, targetDays + 14)) risk = "Excess Stock";
  let quality = "Balanced";
  if (!daily) quality = current > 0 ? "Over Ordered" : "Learning";
  else if (topups > 0 && (daysCover == null || daysCover < targetDays)) quality = "Under Ordered";
  else if (daysCover > Math.max(targetDays * 2, targetDays + 14)) quality = "Over Ordered";
  return {
    ...row,
    soldLast14,
    daily,
    targetDays,
    target,
    available,
    suggested,
    daysCover,
    risk,
    quality,
    topups,
    fastLine,
    fastLineBuffer,
  };
}

function Pill({ children }) { return <span className={`pp-pill pp-${normalize(children).replace(/[^a-z]+/g, "-")}`}>{children}</span>; }

export default function PurchasePlanningReport({ products = [], currentUser = null, fetchProducts }) {
  const [rows, setRows] = useState([]);
  const [locations, setLocations] = useState([]);
  const [filters, setFilters] = useState({ ...emptyPurchasePlanningFilters });
  const [sortBy, setSortBy] = useState("sales_desc");
  const [riskFilter, setRiskFilter] = useState("All");
  const [leadDays, setLeadDays] = useState(3);
  const [safetyDays, setSafetyDays] = useState(2);
  const [tab, setTab] = useState("plan");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [plan, setPlan] = useState({});
  const [removed, setRemoved] = useState({});
  const [stockIn, setStockIn] = useState({ rowKey: "", locationId: "", quantity: "", supplierName: "", invoiceNumber: "", costPrice: "" });
  const [savingStock, setSavingStock] = useState(false);
  const requestId = useRef(0);

  const refresh = async () => {
    const id = ++requestId.current;
    setLoading(true); setError("");
    try {
      const result = await loadPurchasePlanningReport({ products, user: currentUser });
      if (requestId.current !== id) return;
      setRows(result.rows || []); setLocations(result.locations || []); setWarning(result.preOrderWarning || "");
      setFilters((f) => reconcilePurchasePlanningFilters(result.rows || [], f));
      setPlan((current) => {
        const next = { ...current };
        for (const row of result.rows || []) if (next[row.rowKey] == null) next[row.rowKey] = "";
        return next;
      });
      setPage(1);
    } catch (e) { if (requestId.current === id) setError(e?.message || "Purchase Planning could not load."); }
    finally { if (requestId.current === id) setLoading(false); }
  };
  useEffect(() => { refresh(); return () => { requestId.current += 1; }; }, [products, currentUser?.id, currentUser?.staff_id]);

  const options = useMemo(() => getPurchasePlanningFilterOptions(rows, filters), [rows, filters]);
  const planned = useMemo(() => filterPurchasePlanningRows(rows, filters).map((r) => suggestion(r, leadDays, safetyDays)), [rows, filters, leadDays, safetyDays]);
  useEffect(() => {
    setPlan((current) => {
      const next = { ...current };
      for (const row of planned) if (next[row.rowKey] === "") next[row.rowKey] = row.suggested;
      return next;
    });
  }, [planned]);

  const visible = useMemo(() => {
    let list = planned.filter((r) => !removed[r.rowKey] && (riskFilter === "All" || r.risk === riskFilter));
    const sales = (r) => Number(r.soldLast14 || 0);
    const plannedQty = (r) => Number(plan[r.rowKey] ?? r.suggested ?? 0);
    const series = (r) => String(r.series || "").trim();
    const productName = (r) => String(r.productName || "");

    list = [...list].sort((a, b) => {
      const seriesA = series(a);
      const seriesB = series(b);

      // Keep every Series together. Products without a Series go last.
      if (seriesA && !seriesB) return -1;
      if (!seriesA && seriesB) return 1;

      const seriesOrder = seriesA.localeCompare(seriesB, "en-GB", {
        numeric: true,
        sensitivity: "base",
      });
      if (seriesOrder !== 0) return seriesOrder;

      // Apply the selected view order only inside the same Series.
      if (sortBy === "sales_asc") return sales(a) - sales(b) || productName(a).localeCompare(productName(b));
      if (sortBy === "qty_desc") return plannedQty(b) - plannedQty(a) || sales(b) - sales(a) || productName(a).localeCompare(productName(b));
      if (sortBy === "stock_asc") return Number(a.currentStock || 0) - Number(b.currentStock || 0) || productName(a).localeCompare(productName(b));
      return sales(b) - sales(a) || plannedQty(b) - plannedQty(a) || productName(a).localeCompare(productName(b));
    });
    return list;
  }, [planned, removed, riskFilter, sortBy, plan]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const purchaseRows = visible.filter((r) => Number(plan[r.rowKey] || 0) > 0);
  const totalUnits = purchaseRows.reduce((s, r) => s + Number(plan[r.rowKey] || 0), 0);
  const totalPos = visible.reduce((s, r) => s + Number(r.topUpReceived30 || 0) + Number(r.preOrderBoughtQty || 0), 0);
  const totalSupplier = visible.reduce((s, r) => s + Number(r.supplierPurchased30 || 0), 0);

  const setFilter = (field, value) => { setFilters((f) => ["mainCategory", "subCategory", "brand"].includes(field) ? updatePurchasePlanningHierarchy(f, field, value) : { ...f, [field]: value }); setPage(1); };
  const changeQty = (rowKey, value) => setPlan((p) => ({ ...p, [rowKey]: Math.max(0, Number(value) || 0) }));
  const adjust = (rowKey, delta) => changeQty(rowKey, Number(plan[rowKey] || 0) + delta);
  const restoreAll = () => setRemoved({});

  const downloadWeeklyPlan = () => {
    if (!window.confirm(`Download this weekly purchase plan with ${purchaseRows.length} products / ${qty(totalUnits)} units?`)) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Product Code", "Product", "Quantity", "Preferred Supplier", "Country"]];
    for (const row of purchaseRows) lines.push([row.productCode, row.productName, Number(plan[row.rowKey] || 0), row.supplierName || "", row.country || ""]);
    const csv = lines.map((line) => line.map(esc).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `FairChoice_Weekly_Purchase_Plan_${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const selectedStockRow = rows.find((r) => r.rowKey === stockIn.rowKey);
  const openStockIn = (row) => {
    const exact = locations.find((l) => String(l.id) === String(row.stockLocationId));
    const sameCountry = locations.find((l) => normalize(l.country) === normalize(row.country));
    setStockIn({ rowKey: row.rowKey, locationId: exact?.id || sameCountry?.id || "", quantity: String(plan[row.rowKey] || row.suggested || ""), supplierName: row.supplierName === "Not assigned" ? "" : row.supplierName || "", invoiceNumber: "", costPrice: "" });
    setTab("stockin");
  };
  const saveStockIn = async () => {
    if (!selectedStockRow) return;
    if (!window.confirm(`Book ${stockIn.quantity || 0} units of ${selectedStockRow.productName} into stock?`)) return;
    setSavingStock(true);
    try {
      await bookPurchaseStockIn({ productId: selectedStockRow.productId, locationId: stockIn.locationId, quantity: stockIn.quantity, supplierName: stockIn.supplierName, invoiceNumber: stockIn.invoiceNumber, costPrice: stockIn.costPrice, purchaseType: "Supplier Invoice", notes: "Booked from Purchase Planning" });
      alert("Stock booked in and inventory updated.");
      setStockIn({ rowKey: "", locationId: "", quantity: "", supplierName: "", invoiceNumber: "", costPrice: "" });
      await fetchProducts?.();
      await refresh();
      setTab("plan");
    } catch (e) { alert(e?.message || "Stock In failed."); }
    finally { setSavingStock(false); }
  };

  return <div className="pp-shell"><style>{styles}</style>
    <header className="pp-head"><div><h2>Purchase Planning</h2><p>Weekly buying plan based on demand, current stock, incoming stock and previous top-up purchasing.</p></div><div className="pp-actions"><button onClick={refresh}>Refresh</button><button className="primary" onClick={downloadWeeklyPlan}>Download This Week</button></div></header>
    {error && <div className="pp-error">{error}</div>}{warning && <div className="pp-warning">{warning}</div>}
    <section className="pp-summary"><article><span>Plan Products</span><strong>{purchaseRows.length}</strong></article><article><span>Planned Units</span><strong>{qty(totalUnits)}</strong></article><article><span>Supplier Purchases 30d</span><strong>{qty(totalSupplier)}</strong></article><article><span>POS / Top-up 30d</span><strong>{qty(totalPos)}</strong></article><article><span>Buy Now</span><strong>{visible.filter((r) => r.risk === "Buy Now").length}</strong></article><article><span>Under Ordered</span><strong>{visible.filter((r) => r.quality === "Under Ordered").length}</strong></article></section>
    <section className="pp-model"><div><strong>Planning target</strong><span>14-day demand × (7-day buying cycle + lead + safety), less current/incoming stock. Fast lines (14+ sold in 14 days) keep an extra +2 buffer.</span></div><label>Lead days<input type="number" min="1" max="30" value={leadDays} onChange={(e) => setLeadDays(Math.max(1, Number(e.target.value) || 1))}/></label><label>Safety days<input type="number" min="0" max="30" value={safetyDays} onChange={(e) => setSafetyDays(Math.max(0, Number(e.target.value) || 0))}/></label></section>
    <nav className="pp-tabs"><button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>Weekly Purchase Plan</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Purchase History</button><button className={tab === "stockin" ? "active" : ""} onClick={() => setTab("stockin")}>Quick Stock In</button></nav>

    {tab !== "stockin" && <section className="pp-filters"><label><span>Search</span><input value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Product / code"/></label><FilterSelect label="Supplier" value={filters.supplier} options={options.suppliers} onChange={(v) => setFilter("supplier", v)}/><FilterSelect label="Brand" value={filters.brand} options={options.brands} onChange={(v) => setFilter("brand", v)}/><FilterSelect label="Series" value={filters.series} options={options.series} onChange={(v) => setFilter("series", v)}/><FilterSelect label="Country" value={filters.country} options={PURCHASE_PLANNING_COUNTRIES} onChange={(v) => setFilter("country", v)}/><FilterSelect label="Stock Risk" value={riskFilter} options={["Buy Now","Buy Soon","Covered","Excess Stock","Learning"]} onChange={(v) => { setRiskFilter(v); setPage(1); }}/><label><span>View order</span><select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="sales_desc">Highest sales → lowest</option><option value="sales_asc">Lowest sales → highest</option><option value="qty_desc">Highest planned quantity</option><option value="stock_asc">Lowest stock first</option></select></label></section>}

    {loading ? <div className="pp-empty">Loading…</div> : tab === "stockin" ? <section className="pp-stockin">
      <div className="pp-stock-head"><div><h3>Quick Stock In</h3><p>Mobile-friendly receiving. Booking stock updates the selected warehouse inventory.</p></div></div>
      <label><span>Product</span><select value={stockIn.rowKey} onChange={(e) => { const row = rows.find((r) => r.rowKey === e.target.value); if (row) openStockIn(row); else setStockIn((s) => ({ ...s, rowKey: "" })); }}><option value="">Select product</option>{rows.filter((r) => r.productId).sort((a,b) => a.productName.localeCompare(b.productName)).map((r) => <option key={r.rowKey} value={r.rowKey}>{r.productCode} · {r.productName} · {r.country}</option>)}</select></label>
      {selectedStockRow && <><div className="pp-stock-card"><strong>{selectedStockRow.productName}</strong><span>{selectedStockRow.productCode} · Current {qty(selectedStockRow.currentStock)} · 14d sold {qty(selectedStockRow.soldLast14 ?? (Number(selectedStockRow.soldLast7 || 0) + Number(selectedStockRow.soldPrevious7 || 0)))}</span></div>
      <label><span>Warehouse / Location</span><select value={stockIn.locationId} onChange={(e) => setStockIn((s) => ({ ...s, locationId: e.target.value }))}><option value="">Select warehouse</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.location_name} · {l.country}</option>)}</select></label>
      <div className="pp-stock-grid"><label><span>Qty received</span><input type="number" min="0" value={stockIn.quantity} onChange={(e) => setStockIn((s) => ({ ...s, quantity: e.target.value }))}/></label><label><span>Unit cost</span><input type="number" min="0" step="0.01" value={stockIn.costPrice} onChange={(e) => setStockIn((s) => ({ ...s, costPrice: e.target.value }))}/></label></div>
      <label><span>Supplier</span><input value={stockIn.supplierName} onChange={(e) => setStockIn((s) => ({ ...s, supplierName: e.target.value }))}/></label><label><span>Invoice / Reference</span><input value={stockIn.invoiceNumber} onChange={(e) => setStockIn((s) => ({ ...s, invoiceNumber: e.target.value }))}/></label>
      <div className="pp-stock-total">Receipt value: <strong>{money(Number(stockIn.quantity || 0) * Number(stockIn.costPrice || 0))}</strong></div><button className="pp-book" disabled={savingStock} onClick={saveStockIn}>{savingStock ? "Booking…" : "Confirm Stock In"}</button></>}
    </section> : tab === "history" ? <div className="pp-table"><table><thead><tr><th>Product</th><th>14d Sales</th><th>Main Supplier 30d</th><th>POS / Top-up 30d</th><th>Main Supplier 90d</th><th>POS / Top-up 90d</th><th>Current Stock</th><th>Quality</th></tr></thead><tbody>{pageRows.map((r) => <tr key={r.rowKey}><td><strong>{r.productName}</strong><small>{r.productCode} · {r.country}</small></td><td>{qty(r.soldLast14)}</td><td>{qty(r.supplierPurchased30)}</td><td>{qty(Number(r.topUpReceived30 || 0) + Number(r.preOrderBoughtQty || 0))}</td><td>{qty(r.supplierPurchased90)}</td><td>{qty(r.topUpReceived90)}</td><td>{qty(r.currentStock)}</td><td><Pill>{r.quality}</Pill></td></tr>)}</tbody></table></div> : <div className="pp-table"><table><thead><tr><th>Product</th><th>14d Sales</th><th>Stock</th><th>Incoming</th><th>Days Cover</th><th>POS / Top-up</th><th>Suggested</th><th>This Week Qty</th><th>Risk</th><th>Action</th></tr></thead><tbody>{pageRows.map((r, index) => { const seriesName = String(r.series || "").trim() || "Not assigned"; const previousSeries = index > 0 ? (String(pageRows[index - 1].series || "").trim() || "Not assigned") : null; return <Fragment key={r.rowKey}>{seriesName !== previousSeries && <tr className="pp-series-row"><td colSpan="10">Series: {seriesName}</td></tr>}<tr><td><strong>{r.productName}</strong><small>{r.productCode} · {r.country} · {r.supplierName}</small></td><td>{qty(r.soldLast14)}</td><td>{qty(r.currentStock)}</td><td>{qty(r.incomingQty)}</td><td>{r.daysCover == null ? "—" : r.daysCover.toFixed(1)}</td><td>{qty(Number(r.topUpReceived30 || 0) + Number(r.preOrderBoughtQty || 0))}</td><td><div className="pp-suggested"><strong>{qty(r.suggested)}</strong>{r.fastLineBuffer > 0 && <small>Fast +{qty(r.fastLineBuffer)}</small>}</div></td><td><div className="pp-step"><button onClick={() => adjust(r.rowKey,-1)}>−</button><input type="number" min="0" value={plan[r.rowKey] ?? 0} onChange={(e) => changeQty(r.rowKey,e.target.value)}/><button onClick={() => adjust(r.rowKey,1)}>+</button></div></td><td><Pill>{r.risk}</Pill></td><td><div className="pp-row-actions"><button onClick={() => openStockIn(r)}>Stock In</button><button className="remove" onClick={() => setRemoved((x) => ({ ...x, [r.rowKey]: true }))}>Remove</button></div></td></tr></Fragment>; })}</tbody></table></div>}

    {tab !== "stockin" && <footer className="pp-page"><span>Showing {visible.length ? (safePage-1)*PAGE_SIZE+1 : 0}–{Math.min(safePage*PAGE_SIZE,visible.length)} of {visible.length} · max 30</span>{Object.keys(removed).some((k) => removed[k]) && <button onClick={restoreAll}>Restore removed</button>}<button disabled={safePage<=1} onClick={() => setPage((p) => Math.max(1,p-1))}>Previous</button><strong>Page {safePage} / {pageCount}</strong><button disabled={safePage>=pageCount} onClick={() => setPage((p) => Math.min(pageCount,p+1))}>Next</button></footer>}
  </div>;
}

const styles = `
.pp-shell{display:grid;gap:13px;color:#102033}.pp-head{display:flex;justify-content:space-between;gap:14px}.pp-head h2{margin:0}.pp-head p{margin:4px 0;color:#64748b}.pp-actions{display:flex;gap:8px}.pp-actions button,.pp-tabs button,.pp-page button,.pp-row-actions button{border:1px solid #b9c8d8;background:#fff;color:#073763;border-radius:8px;padding:9px 12px;font-weight:800;cursor:pointer}.pp-actions .primary,.pp-tabs .active{background:#073763;color:#fff}.pp-summary{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.pp-summary article{background:#fff;border:1px solid #dbe5ef;border-radius:11px;padding:11px}.pp-summary span{display:block;font-size:10px;text-transform:uppercase;color:#64748b;font-weight:800}.pp-summary strong{font-size:22px;color:#073763}.pp-model{display:grid;grid-template-columns:1fr 130px 130px;gap:10px;background:#eaf3ff;border:1px solid #bdd6ef;border-radius:11px;padding:11px}.pp-model>div{display:grid}.pp-model span{font-size:11px;color:#55708b}.pp-model label,.pp-stockin label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#475569;text-transform:uppercase}.pp-model input,.pp-stockin input,.pp-stockin select{height:40px;border:1px solid #cbd5e1;border-radius:8px;padding:0 9px;background:#fff}.pp-tabs{display:flex;gap:6px}.pp-filters{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;background:#fff;border:1px solid #dbe5ef;border-radius:11px;padding:10px}.pp-filters label,.pp-filter{display:grid;gap:4px}.pp-filters span,.pp-filter span{font-size:10px;font-weight:800;text-transform:uppercase;color:#475569}.pp-filters input,.pp-filters select,.pp-filter select{height:38px;width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:7px;padding:0 8px;background:#fff}.pp-table{overflow:auto;max-height:65vh;background:#fff;border:1px solid #dbe5ef;border-radius:11px}.pp-table table{width:100%;min-width:1100px;border-collapse:separate;border-spacing:0}.pp-table th{position:sticky;top:0;background:#eef4fa;z-index:2;font-size:10px;text-transform:uppercase}.pp-table th,.pp-table td{padding:9px;border-bottom:1px solid #e7edf4;vertical-align:middle}.pp-table th:first-child,.pp-table td:first-child{text-align:left}.pp-table th:not(:first-child),.pp-table td:not(:first-child){text-align:center}.pp-table td:first-child strong,.pp-table td:first-child small{display:block}.pp-table small{color:#64748b;margin-top:2px}.pp-table .pp-series-row td{text-align:left;background:#e8f0f8;color:#073763;font-weight:900;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:7px 9px;border-bottom:1px solid #cbd8e5}.pp-suggested{display:grid;justify-items:center;gap:1px}.pp-suggested strong{font-size:14px}.pp-suggested small{margin:0;color:#0f766e;font-size:9px;font-weight:900}.pp-step{display:flex;justify-content:center;gap:3px}.pp-step input{width:64px;height:34px;text-align:center;border:1px solid #aebfd0;border-radius:6px}.pp-step button{width:34px;height:34px;border:1px solid #b9c8d8;background:#fff;border-radius:6px;font-weight:900}.pp-row-actions{display:flex;justify-content:center;gap:5px}.pp-row-actions .remove{color:#a21a1a}.pp-pill{display:inline-block;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:900;background:#eef2f7}.pp-buy-now,.pp-under-ordered{background:#fee2e2;color:#991b1b}.pp-buy-soon{background:#ffedd5;color:#9a3412}.pp-covered,.pp-balanced{background:#dcfce7;color:#166534}.pp-excess-stock,.pp-over-ordered{background:#dbeafe;color:#1e40af}.pp-learning{background:#f1f5f9;color:#475569}.pp-page{display:flex;align-items:center;justify-content:flex-end;gap:7px}.pp-page span{margin-right:auto;color:#64748b;font-size:12px}.pp-page button:disabled{opacity:.45}.pp-warning,.pp-error{padding:10px 12px;border-radius:9px}.pp-warning{background:#fff7d6;border:1px solid #efd36b;color:#704d00}.pp-error{background:#fff0f0;border:1px solid #efaaaa;color:#8b1b1b}.pp-empty{padding:30px;text-align:center;background:#fff;border:1px solid #dbe5ef;border-radius:11px}.pp-stockin{max-width:680px;width:100%;margin:0 auto;background:#fff;border:1px solid #dbe5ef;border-radius:14px;padding:14px;display:grid;gap:12px}.pp-stock-head h3{margin:0}.pp-stock-head p{margin:3px 0;color:#64748b}.pp-stock-card{display:grid;gap:3px;padding:12px;background:#eef7ff;border-radius:10px}.pp-stock-card span{color:#64748b;font-size:12px}.pp-stock-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pp-stock-total{padding:12px;border-radius:9px;background:#f8fafc}.pp-book{min-height:48px;border:0;border-radius:9px;background:#078645;color:#fff;font-weight:900;font-size:15px;cursor:pointer}.pp-book:disabled{opacity:.5}
@media(max-width:1100px){.pp-summary{grid-template-columns:repeat(3,1fr)}.pp-filters{grid-template-columns:repeat(3,1fr)}}
@media(max-width:700px){.pp-head,.pp-model{display:grid;grid-template-columns:1fr}.pp-actions button{flex:1}.pp-summary{grid-template-columns:repeat(2,1fr)}.pp-filters{grid-template-columns:1fr}.pp-tabs{overflow:auto}.pp-table{max-height:none}.pp-table table{min-width:920px}.pp-stockin{box-sizing:border-box}.pp-stock-grid{grid-template-columns:1fr}.pp-page span{width:100%;margin:0}.pp-page{justify-content:center;flex-wrap:wrap}}
`;
