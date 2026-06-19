import { useState } from "react";

export default function ProductCard({
  product,
  price,
  cartQty,
  onAdd,
  onImageClick,
}) {
  const [qty, setQty] = useState(1);

  const safeQty = Math.max(1, Number(qty || 1));
  const stockQty = Number(product.stock || 0);

  const availableFromSupplier =
    product.availableFromSupplier ?? product.available_from_supplier ?? true;

  const productStatus =
    stockQty > 0
      ? "In Stock"
      : availableFromSupplier
      ? "Different Supplier"
      : "Out of Stock";

  const canOrder = productStatus !== "Out of Stock";

  return (
    <div className="bg-white border rounded-2xl p-3 shadow-sm flex flex-col gap-2">
     <img
        src={product.image || "https://placehold.co/400x300?text=Product"}
        alt={product.name}
        onClick={() => onImageClick && onImageClick(product)}
        className="w-full max-h-[500px] object-contain hover:scale-105 transition duration-300"
      />

      <h3 className="font-bold text-sm leading-tight line-clamp-2">
        {product.name}
      </h3>

      <p className="text-xs text-slate-500">
        {product.brand} {product.flavour ? `• ${product.flavour}` : ""}
      </p>

      <p className="font-bold text-lg mt-auto">£{price.toFixed(2)}</p>

      <p
        className={`text-xs font-bold ${
          productStatus === "In Stock"
            ? "text-green-700"
            : productStatus === "Different Supplier"
            ? "text-orange-600"
            : "text-red-600"
        }`}
      >
        {productStatus}
      </p>

      <p className="text-xs text-slate-500">Stock: {stockQty}</p>

      {cartQty > 0 && (
        <p className="text-xs font-bold text-green-700">
          In cart: {cartQty}
        </p>
      )}

      <div className="flex items-center gap-2">
        <div className="flex items-center border rounded-xl h-10 overflow-hidden">
          <input
            type="number"
            min="1"
            value={qty}
            disabled={!canOrder}
            onChange={(e) => setQty(e.target.value)}
            className="w-14 h-10 text-center font-bold outline-none disabled:bg-slate-100"
          />

          <div className="flex flex-col border-l h-10">
            <button
              type="button"
              disabled={!canOrder}
              onClick={() => setQty(safeQty + 1)}
              className="w-7 h-5 text-xs leading-none disabled:text-slate-300"
            >
              ▲
            </button>

            <button
              type="button"
              disabled={!canOrder}
              onClick={() => setQty(Math.max(1, safeQty - 1))}
              className="w-7 h-5 text-xs leading-none border-t disabled:text-slate-300"
            >
              ▼
            </button>
          </div>
        </div>

        <button
          disabled={!canOrder}
          onClick={() => onAdd(product, safeQty)}
          className={`flex-1 h-10 rounded-xl font-bold text-white ${
            canOrder
              ? "bg-blue-600 hover:bg-blue-700"
              : "bg-slate-300 cursor-not-allowed"
          }`}
        >
          {canOrder ? "Add" : "Unavailable"}
        </button>
      </div>
    </div>
  );
}