import { useState } from "react";

export default function ProductCard({
  product,
  addToCart,
  onImageClick,
  price,
  cartQty = 0,
  onAdd,
}) {
  const [quantity, setQuantity] = useState(1);

  const ribbonLabel =
    product?.comingSoon ? "COMING SOON" :
    product?.isNew ? "NEW" :
    product?.isPromotion ? "PROMOTION" :
    product?.isReduced ? "REDUCED" :
    product?.recommended ? "RECOMMENDED" :
    product?.topSeller ? "TOP SELLER" :
    "";

  const productPrice = Number(price ?? product?.vatPrice ?? product?.cashPrice ?? 0);
  const stockQty = Number(product?.stock || 0);
  const inStock = stockQty > 0;
  const handleAdd = onAdd || addToCart;

  const handleQuantityChange = (value) => {
    setQuantity(Math.max(1, Number(value || 1)));
  };

  return (
    <div className="product-card relative overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {ribbonLabel && <div className="product-card-ribbon">{ribbonLabel}</div>}

      <button
        type="button"
        className="mb-2 block h-28 w-full rounded-md bg-white"
        onClick={() => onImageClick?.(product)}
      >
        <img
          src={product?.image || "https://placehold.co/400x300?text=Product"}
          alt={product?.name || "Product"}
          className="h-full w-full object-contain"
        />
      </button>

      <div className="space-y-1">
        <h3 className="line-clamp-2 min-h-9 text-xs font-bold leading-snug text-slate-900">
          {product?.name}
        </h3>

        <div className="min-h-8 text-[11px] leading-snug text-slate-500">
          <div>{product?.brand || ""}</div>
          <div>{product?.series || ""}</div>
        </div>

        <div className="text-sm font-extrabold text-slate-900">
          &pound;{productPrice.toFixed(2)}
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={inStock ? "font-bold text-green-700" : "font-bold text-red-600"}>
            {inStock ? "In Stock" : "Out of Stock"}
          </span>
          <span className="text-slate-500">Stock: {stockQty}</span>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="number"
            min="1"
            value={quantity}
            onChange={(event) => handleQuantityChange(event.target.value)}
            className="h-8 w-14 rounded-md border border-slate-300 px-2 text-center text-sm font-bold"
          />

          <button
            type="button"
            onClick={() => handleAdd?.(product, quantity)}
            className="h-8 flex-1 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
          >
            Add
          </button>
        </div>

        {cartQty > 0 && (
          <div className="text-center text-[11px] font-bold text-blue-700">
            {cartQty} in cart
          </div>
        )}
      </div>
    </div>
  );
}
