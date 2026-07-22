import { useEffect, useRef, useState } from "react";
import { formatCurrency } from "../utils/currency";
import { getDisplayProductImage } from "../utils/productImages";

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

const getDisplayMessage = (product) => {
  if (typeof product?.displayMessage === "string") {
    return { text: product.displayMessage, color: "red" };
  }

  if (product?.displayMessage?.text) return product.displayMessage;
  if (product?.display_message) return { text: product.display_message, color: "red" };

  return null;
};

function ProductDisplayMessage({ message }) {
  if (!message?.text) return null;

  const colorClass =
    message.color === "navy" ? "text-blue-950 bg-blue-50" : "text-red-700 bg-red-50";

  return (
    <div className={`mt-1 rounded px-2 py-1 text-[11px] font-bold leading-snug ${colorClass}`}>
      {message.text}
    </div>
  );
}

function QuantityAddControls({ productId, quantity, setQuantity, onAdd }) {
  const [isAdding, setIsAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const addLockRef = useRef(false);
  const addReleaseTimerRef = useRef(null);
  const inputId = `product-quantity-${productId}`;

  useEffect(
    () => () => {
      if (addReleaseTimerRef.current) clearTimeout(addReleaseTimerRef.current);
    },
    []
  );

  const getValidQuantity = (value = quantity) => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return 1;
    const number = Number(text);
    return Number.isSafeInteger(number) && number >= 1 ? number : 1;
  };

  const handleQuantityChange = (value) => {
    if (value === "") {
      setQuantity("");
      return;
    }
    if (!/^\d+$/.test(value)) return;
    const nextQuantity = Number(value);
    if (Number.isSafeInteger(nextQuantity) && nextQuantity >= 1) {
      setQuantity(nextQuantity);
    }
  };

  const handleAdd = async () => {
    if (addLockRef.current) return;
    const quantityToAdd = getValidQuantity();
    addLockRef.current = true;
    setIsAdding(true);
    setAddMessage("");
    try {
      await Promise.resolve(onAdd?.(quantityToAdd));
      setAddMessage(`Added ${quantityToAdd} to cart.`);
    } catch (error) {
      console.error("Product add failed:", error);
      setAddMessage("Could not add this product. Please try again.");
    } finally {
      addReleaseTimerRef.current = setTimeout(() => {
        addLockRef.current = false;
        setIsAdding(false);
      }, 350);
    }
  };

  return (
    <div className="pt-1">
      <label htmlFor={inputId} className="mb-1 block text-[11px] font-bold text-slate-600">
        Quantity
      </label>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Decrease quantity"
          onClick={() => setQuantity(Math.max(1, getValidQuantity() - 1))}
          className="h-10 w-10 shrink-0 rounded-md border border-slate-300 bg-white text-lg font-black text-slate-800"
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min="1"
          step="1"
          value={quantity}
          onChange={(event) => handleQuantityChange(event.target.value)}
          onBlur={() => setQuantity(getValidQuantity())}
          className="h-10 min-w-0 flex-1 rounded-md border border-slate-300 px-1 text-center text-sm font-bold"
        />
        <button
          type="button"
          aria-label="Increase quantity"
          onClick={() => setQuantity(getValidQuantity() + 1)}
          className="h-10 w-10 shrink-0 rounded-md border border-slate-300 bg-white text-lg font-black text-slate-800"
        >
          +
        </button>
      </div>
      <button
        type="button"
        onClick={handleAdd}
        disabled={isAdding}
        className="product-add-btn mt-1 min-h-10 w-full rounded-md bg-blue-600 px-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isAdding ? "Adding..." : `Add ${getValidQuantity()} to Cart`}
      </button>
      <div className={`min-h-4 text-center text-[10px] font-bold ${addMessage.startsWith("Could") ? "text-red-700" : "text-emerald-700"}`} aria-live="polite">{addMessage}</div>
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
  const displayMessage = getDisplayMessage(product);
  const productSize = getProductSize(product);
  const productImage = getDisplayProductImage(product);
  const ribbonLabel =
    product?.comingSoon ? "COMING SOON" :
    product?.isNew ? "NEW" :
    product?.isPromotion ? "PROMOTION" :
    product?.isReduced ? "REDUCED" :
    product?.recommended ? "RECOMMENDED" :
    product?.topSeller ? "TOP SELLER" :
    "";

  return (
    <div data-product-id={product.id} className="relative overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-shadow">
      {ribbonLabel && <div className="product-card-ribbon z-10" aria-label={ribbonLabel}>{ribbonLabel}</div>}
      <div className="grid grid-cols-[70px_minmax(0,1fr)] items-center gap-3 min-[560px]:grid-cols-[70px_minmax(0,1fr)_150px]">
        <button
          type="button"
          className="h-[90px] w-[70px] rounded-md bg-white"
          onClick={() => onImageClick?.(product)}
        >
          <img
            src={productImage}
            alt={product?.name || "Product"}
            className="h-full w-full object-contain"
            onError={(event) => {
              event.currentTarget.src = getDisplayProductImage({});
            }}
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
            <ProductDisplayMessage message={displayMessage} />
          </div>
        </div>

        <div className="col-span-2 flex w-[150px] flex-shrink-0 flex-col items-end gap-1 justify-self-end min-[560px]:col-span-1">
          <QuantityAddControls
            productId={product.id}
            quantity={quantity}
            setQuantity={setQuantity}
            onAdd={(amount) => handleAdd?.(product, amount)}
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
  const displayMessage = getDisplayMessage(product);
  const productSize = getProductSize(product);
  const productImage = getDisplayProductImage(product);

  return (
    <div data-product-id={product.id} className="product-card relative flex h-full flex-col overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-sm transition-shadow">
      {ribbonLabel && <div className="product-card-ribbon z-10" aria-label={ribbonLabel}>{ribbonLabel}</div>}
      <button
        type="button"
        className="mb-2 block h-32 w-full rounded-md bg-white"
        onClick={() => onImageClick?.(product)}
      >
        <img
          src={productImage}
          alt={product?.name || "Product"}
          className="h-full w-full object-contain"
          onError={(event) => {
            event.currentTarget.src = getDisplayProductImage({});
          }}
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
            productId={product.id}
            quantity={quantity}
            setQuantity={setQuantity}
            onAdd={(amount) => handleAdd?.(product, amount)}
          />
          {cartQty > 0 && <div className="text-center text-[11px] font-bold text-blue-700">{cartQty} in cart</div>}
          <ProductDisplayMessage message={displayMessage} />
        </div>
      </div>
    </div>
  );
}
