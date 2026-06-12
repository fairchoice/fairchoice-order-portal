import { useState } from "react";

function getVatRate(vatType) {
  const cleaned = String(vatType || "20")
    .replace("%", "")
    .trim();

  const rate = Number(cleaned);

  if (rate === 20) return 20;
  if (rate === 5) return 5;
  if (rate === 0) return 0;

  return 20;
}

export default function Cart({
  cart,
  total,
  originalTotal,
  orderDiscountPercent,
  setOrderDiscountPercent,
  discountAmount,
  canDiscount,
  priceMode,
  onSubmit,
  isSubmitting,
  onIncrease,
  onDecrease,
  onRemove,
  onChangeQty,
}) {

  const [editing, setEditing] = useState(false);

  const itemCount = cart.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  const netTotal = cart.reduce((sum, item) => {
    const qty = Number(item.qty || 0);
    const exVatPrice = Number(item.exVatPrice || item.vatPrice || 0);

    return sum + exVatPrice * qty;
  }, 0);

  const vatTotal =
  priceMode === "vat"
    ? cart.reduce((sum, item) => {
        const qty = Number(item.qty || 0);
        const exVatPrice = Number(item.exVatPrice || item.vatPrice || 0);
        const vatRate = getVatRate(item.vatRate || item.vatType);

        return sum + exVatPrice * (vatRate / 100) * qty;
      }, 0)
    : 0;

  const grandTotal = priceMode === "vat" ? netTotal + vatTotal : total;

  return (
    <div className="bg-slate-50 border rounded-3xl p-3 md:p-4 sticky bottom-3 md:top-4 z-40 shadow-lg">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-bold text-xl">Cart</h3>

        {cart.length > 0 && (
          <button
            onClick={() => setEditing(!editing)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold text-sm"
          >
            {editing ? "Done" : "Edit Cart"}
          </button>
        )}
      </div>

      {editing && cart.length > 0 && (
        <div className="space-y-2 mb-3">
          {cart.map((item) => (
            <div key={item.id} className="bg-white border rounded-2xl p-3">
              <div className="flex justify-between gap-2">
                <div className="flex-1">
                  <p className="font-bold text-sm leading-tight">
                    {item.name}
                  </p>
                </div>

                <p className="font-bold text-base whitespace-nowrap">
                  £{(item.qty * item.selectedPrice).toFixed(2)}
                </p>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => onDecrease(item.id)}
                  className="w-8 h-8 bg-slate-100 rounded-lg font-bold"
                >
                  -
                </button>

                <input
                  type="number"
                  min="1"
                  value={item.qty}
                  onChange={(e) => onChangeQty(item.id, e.target.value)}
                  className="w-16 border rounded-lg p-1 text-center font-bold"
                />

                <button
                  onClick={() => onIncrease(item.id)}
                  className="w-8 h-8 bg-blue-600 text-white rounded-lg font-bold"
                >
                  +
                </button>

                <button
                  onClick={() => onRemove(item.id)}
                  className="ml-auto text-red-600 text-sm font-bold"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border rounded-2xl p-4 checkout-section">
        <div className="flex justify-between text-sm text-slate-600 mb-2">
          <span>Total Items</span>
          <span>{itemCount}</span>
        </div>

          {priceMode === "vat" ? (
          <>
            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span>Net Total</span>
              <span>£{netTotal.toFixed(2)}</span>
            </div>

            <div className="flex justify-between text-sm text-slate-600 mb-2">
              <span>VAT Total</span>
              <span>£{vatTotal.toFixed(2)}</span>
            </div>

            <div className="flex justify-between font-bold text-2xl border-t pt-2 mt-2">
              <span>Total</span>
              <span>£{Number(total || 0).toFixed(2)}</span>
            </div>

            {canDiscount && (
  <div className="border-t mt-3 pt-3">
    <div className="flex justify-between items-center mb-2">
      <span className="font-medium">Discount %</span>

      <input
        type="number"
        min="0"
        max="100"
        step="0.1"
        value={orderDiscountPercent}
        onChange={(e) => setOrderDiscountPercent(e.target.value)}
        className="w-20 border rounded-lg px-2 py-1 text-right"
      />
    </div>

    {Number(orderDiscountPercent || 0) > 0 && (
      <>
        <div className="flex justify-between text-sm text-red-600">
          <span>Discount</span>
          <span>-£{Number(discountAmount || 0).toFixed(2)}</span>
        </div>

        <div className="flex justify-between font-bold text-green-700 mt-1">
          <span>Final Total</span>
          <span>£{Number(originalTotal || 0).toFixed(2)}</span>
        </div>
      </>
    )}
  </div>
)}
          </>
        ) : (
          <div className="flex justify-between font-bold text-2xl">
            <span>Total</span>
            <span>£{total.toFixed(2)}</span>
          </div>
        )}

     <button
  onClick={onSubmit}
  disabled={cart.length === 0 || isSubmitting}
  className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
>
  {isSubmitting ? "Submitting..." : "Submit Order"}
</button>
      </div>
    </div>
  );
}