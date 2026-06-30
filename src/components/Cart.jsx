import { useState } from "react";
import { formatCurrency } from "../utils/currency";
import { calculateCartTotals } from "../utils/orderTotals";
import { isVatPriceMode } from "../utils/pricing";

export default function Cart({
  cart,
  total,
  orderDiscountPercent,
  setOrderDiscountPercent,
  promotionDiscountAmount = 0,
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

  const paidCart = cart.filter((item) => !item.isPromotionFree);
  const promotionLines = cart.filter((item) => item.isPromotionFree);

  const totals = calculateCartTotals(cart, {
    priceMode,
    discountPercent: orderDiscountPercent,
    promotionDiscountAmount,
  });

  const itemCount = paidCart.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const vatMode = isVatPriceMode(priceMode);

  return (
    <div className="cart-panel bg-slate-50 border rounded-3xl p-3 md:p-4 sticky bottom-3 md:top-4 z-40 shadow-lg">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="cart-title font-bold text-xl">Cart</h3>

        {paidCart.length > 0 && (
          <button
            onClick={() => setEditing(!editing)}
            className="btn-secondary bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold text-sm"
          >
            {editing ? "Done" : "Edit Cart"}
          </button>
        )}
      </div>

      {editing && paidCart.length > 0 && (
        <div className="space-y-2 mb-3">
          {paidCart.map((item) => (
            <div key={item.id} className="bg-white border rounded-2xl p-3">
              <div className="flex justify-between gap-2">
                <div className="flex-1">
                  <p className="font-bold text-sm leading-tight">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    {item.qty} x {formatCurrency(item.selectedPrice)}
                  </p>
                </div>

                <p className="font-bold text-base whitespace-nowrap">
                  {formatCurrency(Number(item.qty || 0) * Number(item.selectedPrice || 0))}
                </p>
              </div>

              <div className="flex items-center gap-2 mt-3">
                <button onClick={() => onDecrease(item.id)} className="w-8 h-8 bg-slate-100 rounded-lg font-bold">-</button>

                <input
                  type="number"
                  min="1"
                  value={item.qty}
                  onChange={(e) => onChangeQty(item.id, e.target.value)}
                  className="w-16 border rounded-lg p-1 text-center font-bold"
                />

                <button onClick={() => onIncrease(item.id)} className="btn-primary w-8 h-8 bg-blue-600 text-white rounded-lg font-bold">+</button>

                <button onClick={() => onRemove(item.id)} className="ml-auto text-red-600 text-sm font-bold">Remove</button>
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

        <div className="flex justify-between text-sm text-slate-600 mb-2">
          <span>Subtotal</span>
          <span>{formatCurrency(totals.subtotal)}</span>
        </div>

        {promotionLines.map((line) => (
          <div key={line.id || line.promotionRuleId} className="flex justify-between text-sm font-bold text-blue-700 mb-2">
            <span>
              {String(line.promotionDisplayLabel || line.promotionName || "")
                .trim()
                .toLowerCase()
                .startsWith("promotion")
                ? line.promotionDisplayLabel || line.promotionName
                : `Promotion ${line.promotionDisplayLabel || line.promotionName || "Free Item"}`}
            </span>
            <span>-{formatCurrency(line.promotionDiscountAmount)}</span>
          </div>
        ))}

        {Number(orderDiscountPercent || 0) > 0 && (
          <div className="flex justify-between text-sm text-red-600 mb-2">
            <span>Discount</span>
            <span>-{formatCurrency(totals.discountAmount)}</span>
          </div>
        )}

        {vatMode && (
          <div className="flex justify-between text-sm text-slate-600 mb-2">
            <span>VAT Total</span>
            <span>{formatCurrency(totals.vatTotal)}</span>
          </div>
        )}

        <div className="flex justify-between font-bold text-2xl border-t pt-2 mt-2">
          <span>Total</span>
          <span>{formatCurrency(totals.totalAmount)}</span>
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
          </div>
        )}

        <button
          onClick={() => {
            if (window.confirm("Submit this order?")) {
              onSubmit();
            }
          }}
          disabled={paidCart.length === 0 || isSubmitting}
          className="submit-order-btn checkout-btn w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl font-bold mt-4 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isSubmitting ? "Submitting..." : "Submit Order"}
        </button>
      </div>
    </div>
  );
}
