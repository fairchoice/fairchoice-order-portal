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

      <div className="mt-4 flex flex-wrap gap-3 items-center">
        <input
          value={bulkNewPrice}
          onChange={(e) => setBulkNewPrice(e.target.value)}
          placeholder="New Ex.VAT Price"
          type="number"
          step="0.01"
          className="border rounded-xl px-4 py-3 min-w-[220px]"
        />

        <input
          value={bulkCostPrice}
          onChange={(e) => setBulkCostPrice(e.target.value)}
          placeholder="Cost Price"
          type="number"
          step="0.01"
          className="border rounded-xl px-4 py-3 min-w-[220px]"
        />

        <div className="font-bold text-slate-700">
          New Inc.VAT Price: £{Number(bulkPreview.server || 0).toFixed(2)}
        </div>

        <div className="font-bold text-slate-700">
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
