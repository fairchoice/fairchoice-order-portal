import PricePreview from "./PricePreview";
import ActionButtons from "./ActionButtons";

export default function BulkToDatabase({
  selectedProducts,
  bulkPreview,
  bulkCostPrice,
  setBulkCostPrice,
  bulkVatPrice,
  setBulkVatPrice,
  onPreview,
  onUpdate,
  loading,
}) {
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      <h2 className="text-lg font-semibold">Bulk to Database</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium">New VAT Price</label>
          <input
            type="number"
            value={bulkVatPrice}
            onChange={(e) => setBulkVatPrice(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="Enter VAT price"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Cost Price</label>
          <input
            type="number"
            value={bulkCostPrice}
            onChange={(e) => setBulkCostPrice(e.target.value)}
            className="w-full border rounded px-3 py-2"
            placeholder="Enter cost price"
          />
        </div>
      </div>

      {bulkPreview && (
        <PricePreview
          preview={bulkPreview}
          title="Bulk Price Preview"
        />
      )}

      <ActionButtons
        onPreview={onPreview}
        onUpdate={onUpdate}
        loading={loading}
        disabled={!selectedProducts?.length}
      />
    </div>
  );
}