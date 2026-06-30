export default function SingleDatabaseToOrder({
  search,
  setSearch,
  productId,
  setProductId,
  products,
  selectedProduct,
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
        <div className="font-extrabold">Single product to Received Orders only</div>
        <div className="mt-1">
          Select one product, preview matching order items in Received orders, then refresh only those existing items.
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product..."
          className="border rounded-xl px-4 py-3"
        />

        <select
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          className="border rounded-xl px-4 py-3"
        >
          <option value="">Select product</option>
          {products.map((p) => (
            <option key={getProductId(p)} value={getProductId(p)}>
              {productCode(p)} - {productName(p)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={onRefreshPrices}
          disabled={loading}
          className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50"
        >
          Refresh Current Prices
        </button>
      </div>

      {selectedProduct && (
        <div className="mt-4 font-bold text-slate-700">
          Database VAT Price: £{vatPrice(selectedProduct).toFixed(2)}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
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

      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={onPreview} disabled={loading || !selectedProduct} className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl disabled:opacity-50">
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
                    <td className="border p-3 font-bold">{row.orderNumber}</td>
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
