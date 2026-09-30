import ProductTable from "./ProductTable";

export default function BulkToDatabase({
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
  bulkNewPrice,
  setBulkNewPrice,
  bulkCostPrice,
  setBulkCostPrice,
  bulkCostVatMode,
  setBulkCostVatMode,
  bulkSavedExVatCost,
  bulkPreview,
  safePage,
  totalPages,
  setPage,
  toggleProduct,
  toggleAllOnPage,
  handleBulkUpdate,
  resetBulkEdit,
  refreshProducts,
  getProductId,
  productCode,
  productName,
  vatPrice,
  costPrice,
  pricingSettings,
}) {
  return (
    <div className="mt-6 border rounded-2xl p-5">
      <div className="flex flex-wrap gap-3">
        <select
          className="border rounded-xl px-4 py-3 min-w-[180px]"
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
        >
          <option value="">All brands</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          className="border rounded-xl px-4 py-3 min-w-[220px]"
          value={series}
          onChange={(e) => setSeries(e.target.value)}
        >
          <option value="">All series</option>
          {seriesList.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product..."
          className="border rounded-xl px-4 py-3 min-w-[220px]"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 font-extrabold text-slate-800">Selling Price</div>
          <input
            value={bulkNewPrice}
            onChange={(e) => setBulkNewPrice(e.target.value)}
            placeholder="New Ex.VAT Selling Price"
            type="number"
            step="0.01"
            className="w-full border rounded-xl px-4 py-3 bg-white"
          />
          <div className="mt-2 text-sm font-bold text-slate-700">
            Inc.VAT Selling Price: £{Number(bulkPreview.server || 0).toFixed(2)}
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 font-extrabold text-slate-800">Supplier Cost Price</div>
          <div className="flex flex-wrap gap-2">
            <select
              value={bulkCostVatMode}
              onChange={(e) => setBulkCostVatMode(e.target.value)}
              className="border rounded-xl px-4 py-3 min-w-[170px] bg-white"
            >
              <option value="ex">Ex.VAT Cost</option>
              <option value="inc">Inc.VAT Cost</option>
            </select>
            <input
              value={bulkCostPrice}
              onChange={(e) => setBulkCostPrice(e.target.value)}
              placeholder={bulkCostVatMode === "inc" ? "Inc.VAT Cost Price" : "Ex.VAT Cost Price"}
              type="number"
              step="0.01"
              className="flex-1 border rounded-xl px-4 py-3 min-w-[220px] bg-white"
            />
          </div>
          {bulkCostVatMode === "inc" && bulkCostPrice !== "" && (
            <div className="mt-2 text-sm font-bold text-slate-700">
              Saved Ex.VAT Cost: £{Number(bulkSavedExVatCost || 0).toFixed(2)}
            </div>
          )}
        </div>

        <div className="font-bold text-slate-700 lg:col-span-2">
          New Margin: {bulkPreview.exVatMargin}%
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          onClick={refreshProducts}
          className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl"
        >
          Refresh Products
        </button>

        <button
          onClick={handleBulkUpdate}
          className="bg-purple-700 text-white font-bold px-5 py-3 rounded-xl"
        >
          Bulk Update
        </button>

        <button
          onClick={resetBulkEdit}
          className="bg-slate-600 text-white font-bold px-5 py-3 rounded-xl"
        >
          Reset Form
        </button>
      </div>

      <ProductTable
        pagedProducts={pagedProducts}
        filteredProducts={filteredProducts}
        selectedIds={selectedIds}
        toggleProduct={toggleProduct}
        toggleAllOnPage={toggleAllOnPage}
        safePage={safePage}
        totalPages={totalPages}
        setPage={setPage}
        getProductId={getProductId}
        productCode={productCode}
        productName={productName}
        vatPrice={vatPrice}
        costPrice={costPrice}
        pricingSettings={pricingSettings}
      />
    </div>
  );
}
