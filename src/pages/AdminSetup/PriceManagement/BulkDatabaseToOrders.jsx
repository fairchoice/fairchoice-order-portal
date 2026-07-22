import { formatDisplayOrderId } from "../../../utils/orderDisplay";

export default function BulkDatabaseToOrders({
  brand,
  setBrand,
  series,
  setSeries,
  search,
  setSearch,
  brands,
  seriesList,
  filteredProducts,
  pagedProducts,
  selectedIds,
  safePage,
  totalPages,
  setPage,
  toggleProduct,
  toggleAllOnPage,
  previewRows,
  loading,
  onPreview,
  onUpdate,
  onRefreshPrices,
  onReset,
  getProductId,
  productCode,
  productName,
  vatPrice,
}) {
  const orderCount = new Set(previewRows.map((row) => row.orderId)).size;
  const changedCount = previewRows.filter(
    (row) => Number(row.oldPrice || 0) !== Number(row.newPrice || 0)
  ).length;

  return (
    <div className="mt-6 border rounded-2xl p-5">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-extrabold">Sensitive update: Database to Received Orders only</div>
        <div className="mt-1">
          This updates only matching order items inside orders with status <b>Received</b>.
          It never adds products, removes products, or updates Warehouse Packing, Delivered, or Cancelled orders.
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          className="border rounded-xl px-4 py-3"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        <select
          className="border rounded-xl px-4 py-3"
          value={series}
          onChange={(e) => setSeries(e.target.value)}
        >
          <option value="">All series</option>
          {seriesList.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product..."
          className="border rounded-xl px-4 py-3"
        />

        <button
          type="button"
          onClick={onRefreshPrices}
          disabled={loading}
          className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50"
        >
          Refresh Current Prices
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="border rounded-xl p-4 bg-slate-50">
          <div className="text-xs font-bold text-slate-500 uppercase">Products selected</div>
          <div className="text-2xl font-extrabold text-slate-800">{selectedIds.length}</div>
        </div>
        <div className="border rounded-xl p-4 bg-slate-50">
          <div className="text-xs font-bold text-slate-500 uppercase">Received orders affected</div>
          <div className="text-2xl font-extrabold text-slate-800">{orderCount}</div>
        </div>
        <div className="border rounded-xl p-4 bg-slate-50">
          <div className="text-xs font-bold text-slate-500 uppercase">Matching items</div>
          <div className="text-2xl font-extrabold text-slate-800">{previewRows.length}</div>
        </div>
        <div className="border rounded-xl p-4 bg-slate-50">
          <div className="text-xs font-bold text-slate-500 uppercase">Price changes</div>
          <div className="text-2xl font-extrabold text-slate-800">{changedCount}</div>
        </div>
      </div>

      <div className="mt-6 text-sm font-bold text-slate-700">
        {filteredProducts.length} product(s) found. Showing 20 per page.
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="border p-3"><input type="checkbox" onChange={toggleAllOnPage} /></th>
              <th className="border p-3 text-left">Code</th>
              <th className="border p-3 text-left">Product Name</th>
              <th className="border p-3">Database VAT Price</th>
            </tr>
          </thead>
          <tbody>
            {pagedProducts.map((product) => {
              const id = getProductId(product);
              return (
                <tr key={id}>
                  <td className="border p-3 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(id)}
                      onChange={() => toggleProduct(id)}
                    />
                  </td>
                  <td className="border p-3 font-bold">{productCode(product)}</td>
                  <td className="border p-3">{productName(product)}</td>
                  <td className="border p-3 text-right">£{vatPrice(product).toFixed(2)}</td>
                </tr>
              );
            })}
            {pagedProducts.length === 0 && (
              <tr><td colSpan="4" className="border p-6 text-center text-slate-500">No products found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex justify-between items-center">
        <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="border px-4 py-2 rounded-lg disabled:opacity-40">Previous</button>
        <div className="font-bold">Page {safePage} of {totalPages}</div>
        <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="border px-4 py-2 rounded-lg disabled:opacity-40">Next</button>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={onPreview} disabled={loading || !selectedIds.length} className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50">
          {loading ? "Checking..." : "Preview Updates"}
        </button>
        <button onClick={onUpdate} disabled={loading || !previewRows.length} className="bg-purple-700 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50">
          Update Received Orders
        </button>
        <button onClick={onReset} className="bg-slate-600 text-white font-bold px-5 py-3 rounded-xl">Reset Form</button>
      </div>

      {previewRows.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <div className="mb-2 font-extrabold text-slate-700">Preview: {previewRows.length} matching order item(s)</div>
          <table className="w-full border-collapse border text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="border p-3 text-left">Order</th>
                <th className="border p-3 text-left">Product</th>
                <th className="border p-3">Qty</th>
                <th className="border p-3">Current Price</th>
                <th className="border p-3">New Price</th>
                <th className="border p-3">Difference</th>
                <th className="border p-3">New Line Total</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => {
                const diff = Number(row.newPrice || 0) - Number(row.oldPrice || 0);
                return (
                  <tr key={row.itemId}>
                    <td className="border p-3 font-bold">{formatDisplayOrderId(row.orderNumber)}</td>
                    <td className="border p-3">{row.productName}</td>
                    <td className="border p-3 text-right">{row.qty}</td>
                    <td className="border p-3 text-right">£{Number(row.oldPrice || 0).toFixed(2)}</td>
                    <td className="border p-3 text-right font-bold">£{Number(row.newPrice || 0).toFixed(2)}</td>
                    <td className="border p-3 text-right">{diff >= 0 ? "+" : "-"}£{Math.abs(diff).toFixed(2)}</td>
                    <td className="border p-3 text-right">£{Number(row.lineTotal || 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
