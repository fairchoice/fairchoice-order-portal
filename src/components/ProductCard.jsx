import { useState } from "react";
import { formatCurrency } from "../Utils/currency";

const getProductStatus = (product) => {
  const sourceStatus = String(product?.sourceStatus || "").trim();
  const productStatus = String(product?.status || "").trim().toLowerCase();

  if (product?.comingSoon) return "Coming Soon";
  if (sourceStatus && sourceStatus.toLowerCase() !== "active") return sourceStatus;
  if (Number(product?.stock || 0) > 0) return "In Stock";
  if (product?.availableFromSupplier) return "Need Supplier";
  if (productStatus && productStatus !== "active") return product.status;
  return "Out of Stock";
};

const getStockText = (product) => {
  const status = getProductStatus(product);
  const stockQty = Number(product?.stock || 0);

  if (status === "In Stock") return `In Stock: ${stockQty}`;
  return status;
};

const getPromotionText = (product) =>
  product?.promotionDisplay ||
  product?.promotionDisplayLabel ||
  product?.promotionName ||
  product?.promotion_text ||
  "";

const getDescription = (product) =>
  product?.description ||
  product?.productDescription ||
  product?.flavour ||
  product?.name ||
  "";

const getProductSize = (product) =>
  product?.productSize ||
  product?.product_size ||
  product?.packageSize ||
  product?.package_size ||
  product?.packSize ||
  product?.pack_size ||
  product?.size ||
  product?.weight ||
  "";

const hasDisplayValue = (value) => {
  const text = String(value || "").trim();
  return text !== "" && text !== "-";
};

function QuantityAddControls({ quantity, setQuantity, onAdd }) {
  const handleQuantityChange = (value) => {
    setQuantity(Math.max(1, Number(value || 1)));
  };

  return (
    <div className="flex items-center gap-2 pt-1">
      <input
        type="number"
        min="1"
        value={quantity}
        onChange={(event) => handleQuantityChange(event.target.value)}
        className="h-9 w-16 rounded-md border border-slate-300 px-2 text-center text-sm font-bold"
      />
      <button
        type="button"
        onClick={onAdd}
        className="product-add-btn h-9 w-20 rounded-md bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
      >
        Add
      </button>
    </div>
  );
}

export function ProductListRow({ product, addToCart, onImageClick, price, cartQty = 0, onAdd }) {
  const [quantity, setQuantity] = useState(1);
  const handleAdd = onAdd || addToCart;
  const productPrice = Number(price ?? product?.vatPrice ?? product?.cashPrice ?? 0);
  const stockQty = Number(product?.stock || 0);
  const status = getProductStatus(product);
  const promotionText = getPromotionText(product);
  const productSize = getProductSize(product);
  const ribbonLabel =
    product?.comingSoon ? "COMING SOON" :
    product?.isNew ? "NEW" :
    product?.isPromotion ? "PROMOTION" :
    product?.isReduced ? "REDUCED" :
    product?.recommended ? "RECOMMENDED" :
    product?.topSeller ? "TOP SELLER" :
    "";

  return (
    <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {ribbonLabel && <div className="product-card-ribbon" aria-label={ribbonLabel}>{ribbonLabel}</div>}
      <div className="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-3 min-[560px]:grid-cols-[70px_minmax(0,1fr)_150px]">
        <button
          type="button"
          className="h-[90px] w-[70px] rounded-md bg-white"
          onClick={() => onImageClick?.(product)}
        >
          <img
            src={product?.image || "https://placehold.co/400x300?text=Product"}
            alt={product?.name || "Product"}
            className="h-full w-full object-contain"
          />
        </button>

        <div className="min-w-0">
          <h3 className="line-clamp-2 text-base font-bold leading-5 text-slate-900">
            {product?.name}
          </h3>
          {promotionText && (
            <div className="text-xs font-bold leading-snug text-blue-700">
              {promotionText}
            </div>
          )}
          <div className="text-xs leading-snug text-slate-600">
            {hasDisplayValue(productSize) && <div>Size: {productSize}</div>}
            <div className="product-price text-lg font-bold text-slate-900">{formatCurrency(productPrice)}</div>
            <div>{getStockText(product)}</div>
            <div>Carton: {product?.cartonSize || "-"}</div>
            {cartQty > 0 && <div className="font-bold text-blue-700">{cartQty} in cart</div>}
          </div>
        </div>

        <div className="col-span-2 flex w-[150px] flex-shrink-0 flex-col items-end gap-1 justify-self-end min-[560px]:col-span-1">
          <QuantityAddControls
            quantity={quantity}
            setQuantity={setQuantity}
            onAdd={() => handleAdd?.(product, quantity)}
          />
        </div>
      </div>
    </div>
  );
}

export default function ProductCard({ product, addToCart, onImageClick, price, cartQty = 0, onAdd }) {
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
  const status = getProductStatus(product);
  const stockText = getStockText(product);
  const inStock = stockText.startsWith("In Stock");
  const handleAdd = onAdd || addToCart;
  const promotionText = getPromotionText(product);
  const productSize = getProductSize(product);

  return (
    <div className="product-card relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
      {ribbonLabel && <div className="product-card-ribbon" aria-label={ribbonLabel}>{ribbonLabel}</div>}
      <button
        type="button"
        className="mb-2 block h-32 w-full rounded-md bg-white"
        onClick={() => onImageClick?.(product)}
      >
        <img
          src={product?.image || "https://placehold.co/400x300?text=Product"}
          alt={product?.name || "Product"}
          className="h-full w-full object-contain"
        />
      </button>
      <div className="flex flex-1 flex-col space-y-1">
        <h3 className="line-clamp-2 min-h-[40px] text-base font-semibold leading-5 text-slate-900">{product?.name}</h3>
        {promotionText && (
          <div className="text-[11px] font-bold leading-snug text-blue-700">
            {promotionText}
          </div>
        )}
        <div className="text-[11px] leading-snug text-slate-600">
          {hasDisplayValue(productSize) && <div>Size: {productSize}</div>}
        </div>
        <div className="product-price text-lg font-bold text-slate-900">{formatCurrency(productPrice)}</div>
        <div className="text-[11px] leading-snug text-slate-600">
          <div className={inStock ? "font-bold text-green-700" : "font-bold text-red-600"}>
            {stockText}
          </div>
        </div>
        <div className="mt-auto">
          <div className="text-[11px] leading-snug text-slate-600">Carton: {product?.cartonSize || "-"}</div>
          <QuantityAddControls
            quantity={quantity}
            setQuantity={setQuantity}
            onAdd={() => handleAdd?.(product, quantity)}
          />
          {cartQty > 0 && <div className="text-center text-[11px] font-bold text-blue-700">{cartQty} in cart</div>}
        </div>
      </div>
    </div>
  );
}
