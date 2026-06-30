import { getProductPricePreview } from "../../../utils/pricing";

export default function ProductTable({
  pagedProducts,
  filteredProducts,
  selectedIds,
  toggleProduct,
  toggleAllOnPage,
  safePage,
  totalPages,
  setPage,
  getProductId,
  productCode,
  productName,
  vatPrice,
  costPrice,
  pricingSettings,
}) {
  return (
    <>
      <div className="mt-6 text-sm font-bold text-slate-700">
        {filteredProducts.length} product(s) found. Showing 20 per page.
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="border p-3">
                <input type="checkbox" onChange={toggleAllOnPage} />
              </th>
              <th className="border p-3 text-left">Code</th>
              <th className="border p-3 text-left">Product Name</th>
              <th className="border p-3">Cost</th>
              <th className="border p-3">Current Price VAT</th>
              <th className="border p-3">Current Server</th>
              <th className="border p-3">Current Margin</th>
            </tr>
          </thead>

          <tbody>
            {pagedProducts.map((product) => {
              const id = getProductId(product);
              const currentPreview = getProductPricePreview(
                product,
                "",
                pricingSettings
              );

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
                  <td className="border p-3 text-right">
                    £{costPrice(product).toFixed(2)}
                  </td>
                  <td className="border p-3 text-right">
                    £{vatPrice(product).toFixed(2)}
                  </td>
                  <td className="border p-3 text-right font-bold">
                    £{Number(currentPreview.server || 0).toFixed(2)}
                  </td>
                  <td className="border p-3 text-right">
                    {currentPreview.serverMargin}%
                  </td>
                </tr>
              );
            })}

            {pagedProducts.length === 0 && (
              <tr>
                <td colSpan="7" className="border p-6 text-center text-slate-500">
                  No products found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 flex justify-between items-center">
        <button
          type="button"
          disabled={safePage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="border px-4 py-2 rounded-lg disabled:opacity-40"
        >
          Previous
        </button>

        <div className="font-bold">
          Page {safePage} of {totalPages}
        </div>

        <button
          type="button"
          disabled={safePage >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="border px-4 py-2 rounded-lg disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </>
  );
}
