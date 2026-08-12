import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildPurchasePlanningCsv,
  emptyPurchasePlanningFilters,
  filterPurchasePlanningRows,
  getPurchasePlanningFilterOptions,
  loadPurchasePlanningReport,
  paginatePurchasePlanningRows,
  PURCHASE_PLANNING_COUNTRIES,
  PURCHASE_STATUSES,
  reconcilePurchasePlanningFilters,
  sortPurchasePlanningRows,
  summarizePurchasePlanningRows,
  updatePurchasePlanningHierarchy,
} from "../../services/purchasePlanningReport.js";

const quantity = (value) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(Number(value || 0));

const dateTime = (value) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const trendDisplay = (row) => {
  const arrow = row.trendDirection === "up" ? "↑" : row.trendDirection === "down" ? "↓" : "→";
  return `${arrow} ${row.trendQty >= 0 ? "+" : ""}${quantity(row.trendQty)}`;
};

const reportValue = (available, value) => available ? value : "Unavailable";

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="ppr-filter">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="All">All</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function PurchaseDetails({ row }) {
  return (
    <div className="ppr-details">
      <section>
        <h4>Sales</h4>
        <dl>
          <div><dt>Last 7 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast7))}</dd></div>
          <div><dt>Previous 7 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldPrevious7))}</dd></div>
          <div><dt>Last 30 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast30))}</dd></div>
          <div><dt>Weekly Average</dt><dd>{reportValue(row.salesAvailable, row.weeklyAverage.toFixed(1))}</dd></div>
        </dl>
      </section>
      <section>
        <h4>Inventory</h4>
        <dl>
          <div><dt>Current Stock</dt><dd>{quantity(row.currentStock)}</dd></div>
          <div><dt>Country</dt><dd>{row.country}</dd></div>
          <div><dt>Location</dt><dd>{row.stockLocationName || "No canonical location row"}</dd></div>
        </dl>
        {row.inventoryCompatibility && (
          <p className="ppr-compatibility">Legacy inventory compatibility value; location migration remains pending.</p>
        )}
      </section>
      <section>
        <h4>Pre-Order Supply</h4>
        <dl>
          <div><dt>Bought</dt><dd>{reportValue(row.preorderHistoryAvailable, quantity(row.preOrderBoughtQty))}</dd></div>
          <div><dt>Outstanding</dt><dd>{reportValue(row.preorderOutstandingAvailable, quantity(row.preOrderOutstandingQty))}</dd></div>
        </dl>
      </section>
      <section>
        <h4>Purchase Calculation</h4>
        <dl>
          <div><dt>Target Stock</dt><dd>{row.targetStock.toFixed(1)}</dd></div>
          <div><dt>Current Stock</dt><dd>{quantity(row.currentStock)}</dd></div>
          <div><dt>Incoming Quantity</dt><dd>{quantity(row.incomingQty)}</dd></div>
          <div><dt>Suggested Order</dt><dd className="ppr-suggested">{reportValue(row.suggestionAvailable, quantity(row.suggestedOrderQty))}</dd></div>
        </dl>
        {row.productState !== "Active Product" && (
          <p className="ppr-inactive">{row.productState}</p>
        )}
        <p className="ppr-advisory">Suggested quantity is advisory only.</p>
      </section>

      <section className="ppr-purchases">
        <h4>Pre-Order Purchases</h4>
        {row.preOrderPurchases.length === 0 ? (
          <p>No active Buy or PartialBuy events.</p>
        ) : (
          <div className="ppr-purchase-list">
            {row.preOrderPurchases.map((purchase) => (
              <article key={purchase.id || `${purchase.orderNumber}-${purchase.date}`}>
                <div><strong>{purchase.action}</strong> · {quantity(purchase.quantity)} units</div>
                <div>{dateTime(purchase.date)} · {purchase.supplierName}</div>
                <div>Order {purchase.orderNumber || "Not recorded"}</div>
                {(purchase.customerName || purchase.branchName) && (
                  <div>{[purchase.customerName, purchase.branchName].filter(Boolean).join(" · ")}</div>
                )}
                <div>Changed by {purchase.changedBy}</div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ProductMeta({ row }) {
  return (
    <>
      <strong>{row.productName}</strong>
      <span className="ppr-product-meta">
        {[row.brand, row.series, row.country].filter(Boolean).join(" · ")}
      </span>
    </>
  );
}

export default function PurchasePlanningReport({ products = [], currentUser = null }) {
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({ ...emptyPurchasePlanningFilters });
  const [expanded, setExpanded] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preOrderWarning, setPreOrderWarning] = useState("");
  const [loadedAt, setLoadedAt] = useState("");
  const [sourceStatus, setSourceStatus] = useState({
    salesAvailable: true,
    preorderOutstandingAvailable: true,
    preorderHistoryAvailable: true,
    preorderIncomingAvailable: true,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const requestIdRef = useRef(0);
  const mobileLayout = useMediaQuery("(max-width: 700px)");

  const refreshReport = async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const result = await loadPurchasePlanningReport({ products, user: currentUser });
      if (requestIdRef.current !== requestId) return;
      setRows(result.rows);
      setFilters((current) => reconcilePurchasePlanningFilters(result.rows, current));
      setSourceStatus(result.sourceStatus);
      setPreOrderWarning(result.preOrderWarning || "");
      setLoadedAt(result.loadedAt || "");
      setPage(1);
      setExpanded(new Set());
    } catch (loadError) {
      if (requestIdRef.current !== requestId) return;
      console.error("Purchase Planning load error:", loadError);
      setError(loadError?.message || "Purchase Planning sales data could not be loaded.");
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  };

  useEffect(() => {
    const startLoad = window.setTimeout(() => refreshReport(), 0);
    return () => {
      window.clearTimeout(startLoad);
      requestIdRef.current += 1;
    };
    // Products are loaded once by the existing Back Office data pipeline.
    // The report itself refreshes only on demand after that initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, currentUser?.id, currentUser?.staff_id]);

  const options = useMemo(
    () => getPurchasePlanningFilterOptions(rows, filters),
    [rows, filters],
  );
  const filteredRows = useMemo(
    () => sortPurchasePlanningRows(filterPurchasePlanningRows(rows, filters)),
    [rows, filters],
  );
  const summary = useMemo(
    () => summarizePurchasePlanningRows(filteredRows),
    [filteredRows],
  );
  const pagination = useMemo(
    () => paginatePurchasePlanningRows(filteredRows, page, pageSize),
    [filteredRows, page, pageSize],
  );

  const setFilter = (field, value) => {
    setFilters((current) =>
      ["mainCategory", "subCategory", "brand"].includes(field)
        ? updatePurchasePlanningHierarchy(current, field, value)
        : { ...current, [field]: value },
    );
    setPage(1);
    setExpanded(new Set());
  };

  const changePage = (nextPage) => {
    setPage(nextPage);
    setExpanded(new Set());
  };

  const toggleExpanded = (rowKey) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const exportCsv = () => {
    const csv = buildPurchasePlanningCsv(filteredRows);
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fairchoice-purchase-planning-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ppr-shell">
      <style>{styles}</style>
      <header className="ppr-heading">
        <div>
          <h2>Purchase Planning</h2>
          <p>Sales history, stock position and Pre-Order Supply purchasing.</p>
          {loadedAt && <small>Last refreshed {dateTime(loadedAt)}</small>}
        </div>
        <div className="ppr-actions">
          <button type="button" onClick={refreshReport} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh Report"}
          </button>
          <button type="button" onClick={exportCsv} disabled={loading || filteredRows.length === 0}>
            Export CSV
          </button>
        </div>
      </header>

      {error ? (
        <div className="ppr-error" role="alert">
          <strong>Purchase Planning could not be loaded.</strong>
          <span>{error}</span>
          <button type="button" onClick={refreshReport}>Try Again</button>
        </div>
      ) : (
        <>
          {preOrderWarning && <div className="ppr-warning" role="status">{preOrderWarning}</div>}

          <section className="ppr-summary" aria-label="Purchase Planning summary">
            <article><span>Products Sold</span><strong>{summary.productsSold}</strong></article>
            <article><span>Units Sold – Last 7 Days</span><strong>{reportValue(sourceStatus.salesAvailable, quantity(summary.unitsSoldLast7))}</strong></article>
            <article><span>Pre-Order Units Bought</span><strong>{reportValue(sourceStatus.preorderHistoryAvailable, quantity(summary.preOrderUnitsBought))}</strong></article>
            <article><span>Products Needing Review</span><strong>{summary.productsNeedingReview}</strong></article>
          </section>

          <section className="ppr-filter-bar" aria-label="Purchase Planning filters">
            <label className="ppr-filter ppr-search">
              <span>Search</span>
              <input
                type="search"
                value={filters.search}
                onChange={(event) => setFilter("search", event.target.value)}
                placeholder="Code, product, brand or series"
              />
            </label>
            <FilterSelect label="Supplier" value={filters.supplier} options={options.suppliers} onChange={(value) => setFilter("supplier", value)} />
            <FilterSelect label="Main Category" value={filters.mainCategory} options={options.mainCategories} onChange={(value) => setFilter("mainCategory", value)} />
            <FilterSelect label="Sub Category" value={filters.subCategory} options={options.subCategories} onChange={(value) => setFilter("subCategory", value)} />
            <FilterSelect label="Brand" value={filters.brand} options={options.brands} onChange={(value) => setFilter("brand", value)} />
            <FilterSelect label="Series" value={filters.series} options={options.series} onChange={(value) => setFilter("series", value)} />
            <FilterSelect label="Country" value={filters.country} options={PURCHASE_PLANNING_COUNTRIES} onChange={(value) => setFilter("country", value)} />
            <FilterSelect label="Purchase Status" value={filters.purchaseStatus} options={PURCHASE_STATUSES.filter((value) => value !== "All")} onChange={(value) => setFilter("purchaseStatus", value)} />
          </section>

          {loading ? (
            <div className="ppr-loading">Loading Purchase Planning...</div>
          ) : filteredRows.length === 0 ? (
            <div className="ppr-empty">No products match the current filters.</div>
          ) : (
            <>
              {!mobileLayout ? <div className="ppr-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Code</th><th>Product</th><th>Stock</th><th>Last 7</th>
                      <th>Previous 7</th><th>30 Days</th><th>Weekly Avg</th><th>Trend</th>
                      <th>Pre-Order Bought</th><th>Outstanding</th><th>Suggested Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.rows.map((row) => (
                      <FragmentRow key={row.rowKey} row={row} open={expanded.has(row.rowKey)} onToggle={() => toggleExpanded(row.rowKey)} />
                    ))}
                  </tbody>
                </table>
              </div> : (

              <div className="ppr-mobile-list">
                {pagination.rows.map((row) => (
                  <article className="ppr-mobile-card" key={row.rowKey}>
                    <div className="ppr-mobile-title"><span>{row.productCode || "No code"}</span><ProductMeta row={row} /></div>
                    <dl>
                      <div><dt>Stock</dt><dd>{quantity(row.currentStock)}</dd></div>
                      <div><dt>Last 7</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast7))}</dd></div>
                      <div><dt>Previous 7</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldPrevious7))}</dd></div>
                      <div><dt>30 Days</dt><dd>{reportValue(row.salesAvailable, quantity(row.soldLast30))}</dd></div>
                      <div><dt>Pre-Order Bought</dt><dd>{reportValue(row.preorderHistoryAvailable, quantity(row.preOrderBoughtQty))}</dd></div>
                      <div><dt>Outstanding</dt><dd>{reportValue(row.preorderOutstandingAvailable, quantity(row.preOrderOutstandingQty))}</dd></div>
                      <div className="ppr-mobile-suggested"><dt>Suggested Order</dt><dd>{reportValue(row.suggestionAvailable, quantity(row.suggestedOrderQty))}</dd></div>
                    </dl>
                    <button type="button" onClick={() => toggleExpanded(row.rowKey)}>
                      {expanded.has(row.rowKey) ? "Hide Details" : "View Details"}
                    </button>
                    {expanded.has(row.rowKey) && <PurchaseDetails row={row} />}
                  </article>
                ))}
              </div>
              )}

              <nav className="ppr-pagination" aria-label="Purchase Planning pages">
                <span>Showing {pagination.start}–{pagination.end} of {pagination.total} products</span>
                <label>
                  <span>Rows per page</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value));
                      changePage(1);
                    }}
                  >
                    {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </label>
                <button type="button" disabled={pagination.page <= 1} onClick={() => changePage(pagination.page - 1)}>Previous</button>
                <span>Page {pagination.page} of {pagination.pageCount}</span>
                <button type="button" disabled={pagination.page >= pagination.pageCount} onClick={() => changePage(pagination.page + 1)}>Next</button>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}

function FragmentRow({ row, open, onToggle }) {
  return (
    <>
      <tr>
        <td>{row.productCode || "—"}</td>
        <td>
          <button type="button" className="ppr-product-button" onClick={onToggle} aria-expanded={open}>
            <ProductMeta row={row} /><span>{open ? "Hide details" : "View details"}</span>
          </button>
        </td>
        <td className="ppr-number">{quantity(row.currentStock)}</td>
        <td className="ppr-number">{reportValue(row.salesAvailable, quantity(row.soldLast7))}</td>
        <td className="ppr-number">{reportValue(row.salesAvailable, quantity(row.soldPrevious7))}</td>
        <td className="ppr-number">{reportValue(row.salesAvailable, quantity(row.soldLast30))}</td>
        <td className="ppr-number">{reportValue(row.salesAvailable, row.weeklyAverage.toFixed(1))}</td>
        <td className={`ppr-trend is-${row.trendDirection}`}>{reportValue(row.salesAvailable, trendDisplay(row))}</td>
        <td className="ppr-number">{reportValue(row.preorderHistoryAvailable, quantity(row.preOrderBoughtQty))}</td>
        <td className="ppr-number">{reportValue(row.preorderOutstandingAvailable, quantity(row.preOrderOutstandingQty))}</td>
        <td className="ppr-number ppr-suggested-cell">{reportValue(row.suggestionAvailable, quantity(row.suggestedOrderQty))}</td>
      </tr>
      {open && <tr className="ppr-detail-row"><td colSpan="11"><PurchaseDetails row={row} /></td></tr>}
    </>
  );
}

const styles = `
.ppr-shell{display:grid;gap:16px;color:#102033}.ppr-heading{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.ppr-heading h2{margin:0;font-size:26px}.ppr-heading p{margin:4px 0;color:#64748b}.ppr-heading small{color:#64748b}.ppr-actions{display:flex;gap:8px;flex-wrap:wrap}.ppr-actions button,.ppr-error button{min-height:40px;border:1px solid #b8c7d9;border-radius:9px;background:#fff;color:#073763;padding:0 14px;font-weight:800;cursor:pointer}.ppr-actions button:first-child{background:#073763;color:#fff;border-color:#073763}.ppr-actions button:disabled{opacity:.55;cursor:not-allowed}.ppr-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ppr-summary article{background:#fff;border:1px solid #dbe5ef;border-radius:12px;padding:14px;display:grid;gap:5px}.ppr-summary span{font-size:12px;color:#64748b;font-weight:700}.ppr-summary strong{font-size:24px;color:#073763}.ppr-filter-bar{display:grid;grid-template-columns:repeat(4,minmax(150px,1fr));gap:10px;background:#fff;border:1px solid #dbe5ef;border-radius:12px;padding:12px}.ppr-filter{display:grid;gap:4px;min-width:0}.ppr-filter span{font-size:11px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:.04em}.ppr-filter input,.ppr-filter select{width:100%;min-width:0;height:40px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 10px;color:#0f172a}.ppr-warning,.ppr-error{border-radius:10px;padding:12px 14px}.ppr-warning{background:#fff7d6;border:1px solid #f0d36b;color:#714f00}.ppr-error{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#fff0f0;border:1px solid #efaaaa;color:#8b1b1b}.ppr-loading,.ppr-empty{padding:28px;text-align:center;background:#fff;border:1px solid #dbe5ef;border-radius:12px;color:#64748b}.ppr-table-wrap{max-height:68vh;overflow:auto;background:#fff;border:1px solid #dbe5ef;border-radius:12px}.ppr-table-wrap table{width:100%;border-collapse:separate;border-spacing:0;min-width:1120px}.ppr-table-wrap th{position:sticky;top:0;z-index:2;background:#eef4fa;color:#334155;font-size:11px;text-transform:uppercase;letter-spacing:.03em;text-align:left}.ppr-table-wrap th,.ppr-table-wrap td{padding:10px;border-bottom:1px solid #e7edf4;vertical-align:top}.ppr-table-wrap tbody tr:hover:not(.ppr-detail-row){background:#f8fbff}.ppr-number{text-align:right;font-variant-numeric:tabular-nums}.ppr-product-button{display:grid;gap:2px;border:0;background:transparent;padding:0;text-align:left;color:#102033;cursor:pointer}.ppr-product-button>span:last-child{font-size:11px;color:#2563eb}.ppr-product-meta{display:block;font-size:11px;color:#64748b;font-weight:500}.ppr-suggested-cell{font-size:16px;font-weight:900;color:#075985;background:#ecfeff}.ppr-trend{font-weight:800;white-space:nowrap}.ppr-trend.is-up{color:#047857}.ppr-trend.is-down{color:#b91c1c}.ppr-trend.is-same{color:#475569}.ppr-detail-row td{background:#f8fafc;padding:14px}.ppr-details{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.ppr-details section{background:#fff;border:1px solid #dbe5ef;border-radius:10px;padding:12px;min-width:0}.ppr-details h4{margin:0 0 8px;color:#073763;text-transform:uppercase;font-size:12px;letter-spacing:.05em}.ppr-details dl,.ppr-mobile-card dl{margin:0;display:grid;gap:6px}.ppr-details dl div,.ppr-mobile-card dl div{display:flex;justify-content:space-between;gap:12px}.ppr-details dt,.ppr-mobile-card dt{color:#64748b}.ppr-details dd,.ppr-mobile-card dd{margin:0;font-weight:800;text-align:right}.ppr-suggested{color:#075985}.ppr-advisory,.ppr-compatibility{font-size:11px;color:#64748b;margin:8px 0 0}.ppr-purchases{grid-column:1/-1}.ppr-purchase-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.ppr-purchase-list article{padding:9px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;font-size:12px;line-height:1.5}.ppr-mobile-list{display:none}.ppr-mobile-card{background:#fff;border:1px solid #dbe5ef;border-radius:12px;padding:14px}.ppr-mobile-title{display:grid;gap:3px;margin-bottom:12px}.ppr-mobile-title>span:first-child{font-size:11px;color:#64748b}.ppr-mobile-card dl{grid-template-columns:1fr 1fr}.ppr-mobile-card dl div{padding:6px 0;border-bottom:1px solid #edf2f7}.ppr-mobile-suggested{grid-column:1/-1;color:#075985;font-size:16px}.ppr-mobile-card>button{width:100%;min-height:40px;margin-top:12px;border:1px solid #b8c7d9;border-radius:8px;background:#fff;color:#073763;font-weight:800}.ppr-mobile-card .ppr-details{margin-top:12px}
.ppr-mobile-list{display:grid;gap:10px}.ppr-inactive{font-size:12px;font-weight:900;color:#9f1239}.ppr-pagination{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap}.ppr-pagination>span:first-child{margin-right:auto}.ppr-pagination label{display:flex;align-items:center;gap:7px}.ppr-pagination select{width:74px;height:40px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:0 8px}.ppr-pagination button{min-height:40px;border:1px solid #b8c7d9;border-radius:9px;background:#fff;color:#073763;padding:0 14px;font-weight:800;cursor:pointer}.ppr-pagination button:disabled{opacity:.55;cursor:not-allowed}
@media(max-width:1000px){.ppr-summary{grid-template-columns:repeat(2,1fr)}.ppr-filter-bar{grid-template-columns:repeat(2,minmax(0,1fr))}.ppr-details{grid-template-columns:repeat(2,minmax(0,1fr))}.ppr-purchase-list{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:700px){.ppr-heading{display:grid}.ppr-actions{width:100%}.ppr-actions button{flex:1}.ppr-summary{grid-template-columns:1fr 1fr}.ppr-summary strong{font-size:20px}.ppr-filter-bar{grid-template-columns:1fr}.ppr-table-wrap{display:none}.ppr-mobile-list{display:grid;gap:10px}.ppr-details{grid-template-columns:1fr}.ppr-purchase-list{grid-template-columns:1fr}.ppr-purchases{grid-column:auto}}
`;
