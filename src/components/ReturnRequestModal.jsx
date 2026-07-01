import { useMemo, useState } from "react";
import { createReturnRequest, RETURN_REASONS, RETURN_TYPES } from "../services/centralReturnEngine";
import { formatCurrency } from "../utils/currency";
import { getOrderItemQty } from "../utils/orderTotals";

const getOrderItems = (order = {}) => order.items || order.order_items || [];
const getItemName = (item = {}) => item.name || item.productName || item.product_name || "Unnamed Product";
const getItemCode = (item = {}) => item.productCode || item.product_code || item.code || "";
const getItemPrice = (item = {}) => Number(item.price || item.unit_price || item.selectedPrice || 0);

export default function ReturnRequestModal({ order, source = "RETURN_PORTAL", currentUser, onClose, onSaved }) {
  const [returnType, setReturnType] = useState(RETURN_TYPES[0]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");

  const orderItems = getOrderItems(order);
  const filteredItems = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return orderItems.slice(0, 10);

    return orderItems.filter((item) => {
      const name = getItemName(item).toLowerCase();
      const code = getItemCode(item).toLowerCase();
      return name.includes(value) || code.includes(value);
    }).slice(0, 10);
  }, [orderItems, search]);

  if (!order) return null;

  const addProduct = (item) => {
    const productId = item.id || item.productId || item.product_id || getItemName(item);
    const exists = lines.some((line) => String(line.productKey) === String(productId));
    if (exists) return;

    setLines((old) => [
      ...old,
      {
        ...item,
        productKey: productId,
        returnQty: 1,
        reason: RETURN_REASONS[0],
      },
    ]);
  };

  const updateLine = (index, updates) => {
    setLines((old) => old.map((line, lineIndex) => (lineIndex === index ? { ...line, ...updates } : line)));
  };

  const removeLine = (index) => {
    setLines((old) => old.filter((_, lineIndex) => lineIndex !== index));
  };

  const total = lines.reduce((sum, line) => sum + Number(line.returnQty || 0) * getItemPrice(line), 0);

  const saveReturn = async () => {
    if (saving) return;
    if (!lines.length) {
      alert("Please add at least one product to return.");
      return;
    }

    setSaving(true);
    try {
      const savedReturn = await createReturnRequest({
        order,
        returnType,
        source,
        currentUser,
        notes,
        items: lines,
      });
      alert("Return request created. Warehouse can confirm the return next.");
      onSaved?.(savedReturn);
      onClose?.();
    } catch (error) {
      console.error("Return request error:", error);
      alert("Could not create return request: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold">Create Return</h3>
            <p className="text-sm text-slate-500">
              {order.orderId || order.order_number || "Order"} | {order.companyName || order.company_name || "Customer"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="bg-slate-200 px-3 py-2 rounded-lg text-sm font-bold">
            Close
          </button>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Return Type</label>
          <select value={returnType} onChange={(e) => setReturnType(e.target.value)} className="w-full border rounded-xl p-3 bg-white">
            {RETURN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Search Delivered Product</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name or code" className="w-full border rounded-xl p-3" />

          <div className="mt-2 border rounded-xl divide-y overflow-hidden">
            {filteredItems.map((item) => (
              <button
                type="button"
                key={`${item.id || item.product_id || getItemName(item)}-${getItemCode(item)}`}
                onClick={() => addProduct(item)}
                className="w-full text-left p-3 hover:bg-slate-50 flex justify-between gap-3"
              >
                <span>
                  <span className="font-bold">{getItemName(item)}</span>
                  <span className="block text-xs text-slate-500">{getItemCode(item) || "No code"} | Delivered Qty: {getOrderItemQty(item)}</span>
                </span>
                <span className="text-xs font-bold text-blue-700">Add</span>
              </button>
            ))}

            {filteredItems.length === 0 && (
              <div className="p-3 text-sm text-slate-500">No matching delivered products.</div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-bold">Return Products</h4>
          {lines.map((line, index) => {
            const deliveredQty = getOrderItemQty(line);
            return (
              <div key={`${line.productKey}-${index}`} className="border rounded-xl p-3 grid grid-cols-1 md:grid-cols-[1fr_90px_170px_auto] gap-2 md:items-center">
                <div>
                  <div className="font-bold">{getItemName(line)}</div>
                  <div className="text-xs text-slate-500">Delivered: {deliveredQty} | Price: {formatCurrency(getItemPrice(line))}</div>
                </div>
                <input
                  type="number"
                  min="1"
                  max={deliveredQty || undefined}
                  value={line.returnQty}
                  onChange={(e) => updateLine(index, { returnQty: Math.max(1, Number(e.target.value || 1)) })}
                  className="border rounded-lg p-2"
                />
                <select value={line.reason} onChange={(e) => updateLine(index, { reason: e.target.value })} className="border rounded-lg p-2 bg-white">
                  {RETURN_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
                <button type="button" onClick={() => removeLine(index)} className="bg-red-100 text-red-700 px-3 py-2 rounded-lg text-xs font-bold">
                  Remove
                </button>
              </div>
            );
          })}

          {lines.length === 0 && <div className="border rounded-xl p-4 text-center text-slate-500">No products added yet.</div>}
        </div>

        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="w-full border rounded-xl p-3" />

        <div className="border rounded-xl p-3 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm">
            <strong>Confirmation:</strong> {lines.length} product(s), estimated credit {formatCurrency(total)}
          </div>
          <button type="button" onClick={saveReturn} disabled={saving} className="bg-green-700 text-white px-5 py-3 rounded-xl font-bold disabled:bg-slate-300">
            {saving ? "Saving..." : "Confirm Return Request"}
          </button>
        </div>
      </div>
    </div>
  );
}
