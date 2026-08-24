import { useEffect, useMemo, useState } from "react";
import {
  emptyReceivedOrderActivityFilters,
  emptyWarehouseActivityFilters,
  filterReceivedOrderActivity,
  filterWarehouseActivity,
  getReceivedOrderActivityFilterOptions,
  getWarehouseActivityFilterOptions,
  loadReceivedOrderActivityReport,
  loadWarehouseActivityReport,
  sumWarehouseActivityQuantity,
  summarizeReceivedOrderActivity,
  summarizeWarehouseActivity,
} from "../../services/warehouseActivity.js";

const dateTime = (value) => {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString("en-GB");
};

function SelectFilter({ label, value, options, onChange }) {
  return <label><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="All">All</option>
    {options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select></label>;
}

export default function WarehouseActivityReport({ currentUser }) {
  const [activeTab, setActiveTab] = useState("warehouse");
  const [rows, setRows] = useState([]);
  const [receivedRows, setReceivedRows] = useState([]);
  const [filters, setFilters] = useState({ ...emptyWarehouseActivityFilters });
  const [receivedFilters, setReceivedFilters] = useState({ ...emptyReceivedOrderActivityFilters });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [warehouseActivity, receivedActivity] = await Promise.all([
        loadWarehouseActivityReport(currentUser, filters),
        loadReceivedOrderActivityReport(currentUser, receivedFilters),
      ]);
      setRows(warehouseActivity);
      setReceivedRows(receivedActivity);
    } catch (loadError) {
      setError(loadError?.message || "Activity could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
    // Initial load uses the current signed-in staff session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.staff_id]);

  const filteredRows = useMemo(() => filterWarehouseActivity(rows, filters), [rows, filters]);
  const options = useMemo(() => getWarehouseActivityFilterOptions(rows), [rows]);
  const summary = useMemo(() => summarizeWarehouseActivity(filteredRows), [filteredRows]);
  const filteredQuantityTotal = useMemo(() => sumWarehouseActivityQuantity(filteredRows), [filteredRows]);

  const filteredReceivedRows = useMemo(
    () => filterReceivedOrderActivity(receivedRows, receivedFilters),
    [receivedRows, receivedFilters],
  );
  const receivedOptions = useMemo(() => getReceivedOrderActivityFilterOptions(receivedRows), [receivedRows]);
  const receivedSummary = useMemo(() => summarizeReceivedOrderActivity(filteredReceivedRows), [filteredReceivedRows]);
  const receivedQuantityTotal = useMemo(() => sumWarehouseActivityQuantity(filteredReceivedRows), [filteredReceivedRows]);

  const setFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const setReceivedFilter = (field, value) => setReceivedFilters((current) => ({ ...current, [field]: value }));

  const cards = [
    ["Total Status Changes", summary.total],
    ["In Stock → Pre-Order", summary.inStockToPreOrder],
    ["In Stock → Cannot Supply", summary.inStockToCannotSupply],
    ["Pre-Order → In Stock", summary.preOrderToInStock],
    ["Pre-Order → Cannot Supply", summary.preOrderToCannotSupply],
    ["Cannot Supply → In Stock", summary.cannotSupplyToInStock],
    ["Recalls", summary.recalls],
  ];

  return <div className="war-shell">
    <style>{styles}</style>
    <header><div><h2>Activity Monitor</h2><p>Permanent operational audit activity.</p></div>
      <button type="button" onClick={refresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button></header>

    <nav className="war-tabs" aria-label="Activity monitor sections">
      <button type="button" className={activeTab === "warehouse" ? "active" : ""} onClick={() => setActiveTab("warehouse")}>Warehouse Activity</button>
      <button type="button" className={activeTab === "received" ? "active" : ""} onClick={() => setActiveTab("received")}>Received Order Activities</button>
    </nav>

    {error && <div className="war-error" role="alert">{error}</div>}

    {activeTab === "warehouse" ? <>
      <div className="war-section-title"><h3>Warehouse Activity Monitor</h3><p>Warehouse status and supplier workflow activity.</p></div>
      <section className="war-summary">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
      <section className="war-filters">
        <label><span>Date From</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
        <label><span>Date To</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
        <SelectFilter label="England / Wales" value={filters.country} options={options.countries} onChange={(value) => setFilter("country", value)} />
        <SelectFilter label="Staff" value={filters.staff} options={options.staff} onChange={(value) => setFilter("staff", value)} />
        <SelectFilter label="Product" value={filters.product} options={options.products} onChange={(value) => setFilter("product", value)} />
        <SelectFilter label="Customer" value={filters.customer} options={options.customers} onChange={(value) => setFilter("customer", value)} />
        <label><span>Order Number</span><input value={filters.orderNumber} onChange={(event) => setFilter("orderNumber", event.target.value)} /></label>
        <SelectFilter label="Action" value={filters.action} options={options.actions} onChange={(value) => setFilter("action", value)} />
        <SelectFilter label="Old Status" value={filters.oldStatus} options={options.oldStatuses} onChange={(value) => setFilter("oldStatus", value)} />
        <SelectFilter label="New Status" value={filters.newStatus} options={options.newStatuses} onChange={(value) => setFilter("newStatus", value)} />
        <SelectFilter label="Supplier" value={filters.supplier} options={options.suppliers} onChange={(value) => setFilter("supplier", value)} />
      </section>
      <div className="war-results-total" aria-live="polite"><span>Filtered Quantity Total:</span> <strong>{filteredQuantityTotal}</strong></div>
      <div className="war-table"><table><thead><tr><th>Date/Time</th><th>Order</th><th>Customer</th><th>Product</th><th>Qty</th><th>From</th><th>To</th><th>Action</th><th>Supplier</th><th>Staff</th><th>Reason</th></tr></thead>
        <tbody>{filteredRows.map((row) => <tr key={`${row.sourceModule}:${row.id}`}><td>{dateTime(row.timestamp)}</td><td>{row.orderNumber}</td><td>{[row.customerName,row.branchName].filter(Boolean).join(" · ")}</td><td>{row.productName}</td><td>{row.quantity}</td><td>{row.oldStatus}</td><td>{row.newStatus}</td><td>{row.actionType}</td><td>{row.supplierName || "—"}</td><td>{row.staffName || "—"}</td><td>{row.reason || "—"}</td></tr>)}</tbody></table>
        {!loading && filteredRows.length === 0 && <div className="war-empty">No Warehouse activity matches the filters.</div>}
      </div>
    </> : <>
      <div className="war-section-title"><h3>Received Order Activities</h3><p>Permanent picking mismatch audit: expected system status versus the picker&apos;s physical warehouse decision.</p></div>
      <section className="war-summary received-summary">
        <article><span>Total Picking Mismatches</span><strong>{receivedSummary.total}</strong></article>
        <article><span>In Stock → Pre-Order</span><strong>{receivedSummary.inStockToPreOrder}</strong></article>
        <article><span>Pre-Order → In Stock</span><strong>{receivedSummary.preOrderToInStock}</strong></article>
        <article><span>Mismatch Quantity</span><strong>{receivedQuantityTotal}</strong></article>
      </section>
      <section className="war-filters received-filters">
        <label><span>Date From</span><input type="date" value={receivedFilters.dateFrom} onChange={(event) => setReceivedFilter("dateFrom", event.target.value)} /></label>
        <label><span>Date To</span><input type="date" value={receivedFilters.dateTo} onChange={(event) => setReceivedFilter("dateTo", event.target.value)} /></label>
        <SelectFilter label="England / Wales" value={receivedFilters.country} options={receivedOptions.countries} onChange={(value) => setReceivedFilter("country", value)} />
        <SelectFilter label="Staff" value={receivedFilters.staff} options={receivedOptions.staff} onChange={(value) => setReceivedFilter("staff", value)} />
        <SelectFilter label="Product" value={receivedFilters.product} options={receivedOptions.products} onChange={(value) => setReceivedFilter("product", value)} />
        <SelectFilter label="Customer" value={receivedFilters.customer} options={receivedOptions.customers} onChange={(value) => setReceivedFilter("customer", value)} />
        <label><span>Order Number</span><input value={receivedFilters.orderNumber} onChange={(event) => setReceivedFilter("orderNumber", event.target.value)} /></label>
        <label><span>Mismatch Type</span><select value={receivedFilters.mismatchType} onChange={(event) => setReceivedFilter("mismatchType", event.target.value)}><option value="All">All</option><option value="In Stock → Pre-Order">In Stock → Pre-Order</option><option value="Pre-Order → In Stock">Pre-Order → In Stock</option></select></label>
      </section>
      <div className="war-results-total" aria-live="polite"><span>Filtered Mismatch Quantity:</span> <strong>{receivedQuantityTotal}</strong></div>
      <div className="war-table"><table><thead><tr><th>Date/Time</th><th>Order</th><th>Customer</th><th>Product</th><th>Qty</th><th>From</th><th>To</th><th>Activity</th><th>Staff</th><th>Country / Location</th><th>Reason</th></tr></thead>
        <tbody>{filteredReceivedRows.map((row) => <tr key={`received:${row.id}`}><td>{dateTime(row.timestamp)}</td><td>{row.orderNumber}</td><td>{[row.customerName,row.branchName].filter(Boolean).join(" · ")}</td><td>{[row.productCode,row.productName].filter(Boolean).join(" · ")}</td><td>{row.quantity}</td><td>{row.oldStatus}</td><td>{row.newStatus}</td><td>{row.actionType}</td><td>{row.staffName || "—"}</td><td>{[row.country,row.warehouseLocation].filter(Boolean).join(" · ") || "—"}</td><td>{row.reason || "—"}</td></tr>)}</tbody></table>
        {!loading && filteredReceivedRows.length === 0 && <div className="war-empty">No Received Order picking mismatches match the filters.</div>}
      </div>
    </>}
  </div>;
}

const styles = `
.war-shell{display:grid;gap:14px;color:#102033}.war-shell header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.war-shell h2{margin:0;font-size:26px}.war-shell p{margin:4px 0;color:#64748b}.war-shell header button{min-height:40px;border:0;border-radius:9px;background:#073763;color:#fff;padding:0 16px;font-weight:800}.war-tabs{display:flex;gap:8px;padding:5px;border:1px solid #dbe5ef;border-radius:11px;background:#fff;width:max-content;max-width:100%}.war-tabs button{border:0;border-radius:8px;background:#eef4fa;color:#334155;padding:9px 14px;font-weight:800;cursor:pointer}.war-tabs button.active{background:#073763;color:#fff}.war-section-title h3{margin:0;font-size:18px}.war-section-title p{margin:3px 0 0}.war-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.war-summary article{display:grid;gap:4px;padding:12px;border:1px solid #dbe5ef;border-radius:11px;background:#fff}.war-summary span,.war-filters span{font-size:11px;font-weight:800;color:#64748b}.war-summary strong{font-size:23px;color:#073763}.war-filters{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:9px;padding:12px;border:1px solid #dbe5ef;border-radius:11px;background:#fff}.war-filters label{display:grid;gap:4px}.war-filters input,.war-filters select{height:38px;min-width:0;border:1px solid #cbd5e1;border-radius:8px;padding:0 9px;background:#fff}.war-results-total{justify-self:start;border:1px solid #bfd1e2;border-radius:9px;background:#eef4fa;padding:9px 12px;color:#334155}.war-results-total span{font-size:12px;font-weight:800}.war-results-total strong{color:#073763;font-size:17px}.war-table{overflow:auto;border:1px solid #dbe5ef;border-radius:11px;background:#fff}.war-table table{width:100%;min-width:1250px;border-collapse:collapse}.war-table th,.war-table td{padding:9px;border-bottom:1px solid #e7edf4;text-align:left;font-size:12px}.war-table th{position:sticky;top:0;background:#eef4fa;text-transform:uppercase;font-size:10px}.war-empty,.war-error{padding:22px;text-align:center}.war-error{border:1px solid #efaaaa;border-radius:9px;background:#fff0f0;color:#8b1b1b}@media(max-width:900px){.war-summary,.war-filters{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.war-summary,.war-filters{grid-template-columns:1fr}.war-shell header{display:grid}.war-tabs{width:100%;display:grid;grid-template-columns:1fr}.war-tabs button{width:100%}}
`;
