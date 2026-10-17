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

const getPromotionText = (product) => product?.promotionDisplay || product?.promotionDisplayLabel || product?.promotionName || product?.promotion_text || "";
const getProductSize = (product) => product?.productSize || product?.product_size || product?.packageSize || product?.package_size || product?.packSize || product?.pack_size || product?.size || product?.weight || "";
const hasDisplayValue = (value) => { const text = String(value || "").trim(); return text !== "" && text !== "-"; };
const getDisplayMessage = (product) => {
  if (typeof product?.displayMessage === "string") return { text: product.displayMessage, color: "red" };
  if (product?.displayMessage?.text) return product.displayMessage;
  if (product?.display_message) return { text: product.display_message, color: "red" };
  return null;
};

const getRibbonLabel = (product) =>
  product?.comingSoon ? "COMING SOON" :
  product?.isNew ? "NEW" :
  product?.isPromotion ? "Promotion" :
  product?.isReduced ? "REDUCED" :
  product?.recommended ? "RECOMMENDED" :
  product?.topSeller ? "TOP SELLER" : "";

function ProductRibbon({ label }) {
  if (!label) return null;

  const isPromotion = label === "Promotion";

  if (isPromotion) {
    return (
      <div
        className="pointer-events-none absolute right-[-35px] top-[12px] z-20 w-[116px] rotate-45 bg-red-500 py-[3px] text-center text-[9px] font-black leading-none text-white shadow-sm"
        aria-label="Promotion"
      >
        Promotion
      </div>
    );
  }

  return (
    <div className="product-card-ribbon z-10" aria-label={label}>
      {label}
    </div>
  );
}

function ProductDisplayMessage({ message }) {
  if (!message?.text) return null;
  const colorClass = message.color === "navy" ? "text-blue-950 bg-blue-50" : "text-red-700 bg-red-50";
  return <div className={`mt-1 rounded px-2 py-1 text-[10px] font-bold leading-snug ${colorClass}`}>{message.text}</div>;
}

function QuantityAddControls({ productId, quantity, setQuantity, onAdd, compact = false }) {
  const [isAdding, setIsAdding] = useState(false);
  const [addMessage, setAddMessage] = useState("");
  const addLockRef = useRef(false);
  const addReleaseTimerRef = useRef(null);
  const inputId = `product-quantity-${productId}`;

  useEffect(() => () => addReleaseTimerRef.current && clearTimeout(addReleaseTimerRef.current), []);

  const getValidQuantity = (value = quantity) => {
    const text = String(value ?? "").trim();
    if (!/^\d+$/.test(text)) return 1;
    const number = Number(text);
    return Number.isSafeInteger(number) && number >= 1 ? number : 1;
  };

  const handleQuantityChange = (value) => {
    if (value === "") return setQuantity("");
    if (!/^\d+$/.test(value)) return;
    const next = Number(value);
    if (Number.isSafeInteger(next) && next >= 1) setQuantity(next);
  };

  const handleAdd = async () => {
    if (addLockRef.current) return;
    const amount = getValidQuantity();
    addLockRef.current = true;
    setIsAdding(true);
    setAddMessage("");
    try {
      await Promise.resolve(onAdd?.(amount));
      setAddMessage(`Added ${amount}`);
    } catch (error) {
      console.error("Product add failed:", error);
      setAddMessage("Try again");
    } finally {
      addReleaseTimerRef.current = setTimeout(() => {
        addLockRef.current = false;
        setIsAdding(false);
      }, 350);
    }
  };

  return (
    <div>
      <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
        <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, getValidQuantity() - 1))} className={`${compact ? "h-9 w-10" : "h-11 w-11"} shrink-0 text-xl font-black text-slate-800 hover:bg-slate-50 sm:h-9 sm:w-9 sm:text-lg`}>−</button>
        <input id={inputId} type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(event) => handleQuantityChange(event.target.value)} onBlur={() => setQuantity(getValidQuantity())} className={`${compact ? "h-9" : "h-11"} min-w-0 flex-1 border-x border-slate-200 px-1 text-center text-base font-bold outline-none sm:h-9 sm:text-sm`} />
        <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(getValidQuantity() + 1)} className={`${compact ? "h-9 w-10" : "h-11 w-11"} shrink-0 text-xl font-black text-slate-800 hover:bg-slate-50 sm:h-9 sm:w-9 sm:text-lg`}>+</button>
      </div>
      <button type="button" onClick={handleAdd} disabled={isAdding} className={`product-add-btn ${compact ? "mt-1 h-9" : "mt-2 h-11"} w-full rounded-lg bg-orange-400 px-2 text-sm font-black text-slate-950 transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-1.5 sm:h-9 sm:text-xs`}>
        {isAdding ? "Adding..." : `Add ${getValidQuantity()} to Cart`}
      </button>
      <div className={`${compact ? "min-h-0" : "min-h-3"} pt-0.5 text-center text-[9px] font-bold ${addMessage === "Try again" ? "text-red-700" : "text-emerald-700"}`} aria-live="polite">{addMessage}</div>
    </div>
  );
}

export function ProductListRow({ product, addToCart, onImageClick, price, cartQty = 0, onAdd }) {
  const [quantity, setQuantity] = useState(1);
  const handleAdd = onAdd || addToCart;
  const productPrice = Number(price ?? product?.vatPrice ?? product?.cashPrice ?? 0);
  const promotionText = getPromotionText(product);
  const displayMessage = getDisplayMessage(product);
  const productSize = getProductSize(product);
  const productImage = getDisplayProductImage(product);
  const ribbonLabel = getRibbonLabel(product);

  return (
    <div data-product-id={product.id} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm transition hover:shadow-md">
      <ProductRibbon label={ribbonLabel} />
      <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 min-[640px]:grid-cols-[82px_minmax(0,1fr)_160px] min-[640px]:gap-3">
        <button type="button" className="h-[76px] w-[72px] rounded-lg bg-white p-1 min-[640px]:h-[96px] min-[640px]:w-[82px]" onClick={() => onImageClick?.(product)}>
          <img src={productImage} alt={product?.name || "Product"} className="h-full w-full object-contain" onError={(event) => { event.currentTarget.src = getDisplayProductImage({}); }} />
        </button>
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-extrabold leading-5 text-slate-900 sm:text-base">{product?.name}</h3>
          {promotionText && <div className="mt-0.5 text-[11px] font-black leading-snug text-red-600">{promotionText}</div>}
          {hasDisplayValue(productSize) && <div className="mt-1 text-[11px] text-slate-500">Size: {productSize}</div>}
          <div className="product-price mt-0.5 text-xl font-black text-slate-950">{formatCurrency(productPrice)}</div>
          <div className="text-[11px] font-bold text-slate-600">{getStockText(product)} · Carton: {product?.cartonSize || "-"}</div>
          {cartQty > 0 && <div className="text-[11px] font-black text-orange-700">{cartQty} in cart</div>}
          <ProductDisplayMessage message={displayMessage} />
        </div>
        <div className="col-span-2 w-[160px] justify-self-end min-[640px]:col-span-1">
          <QuantityAddControls productId={product.id} quantity={quantity} setQuantity={setQuantity} onAdd={(amount) => handleAdd?.(product, amount)} compact />
        </div>
      </div>
    </div>
  );
}

export default function ProductCard({ product, addToCart, onImageClick, price, cartQty = 0, onAdd }) {
  const [quantity, setQuantity] = useState(1);
  const productPrice = Number(price ?? product?.vatPrice ?? product?.cashPrice ?? 0);
  const stockText = getStockText(product);
  const inStock = stockText.startsWith("In Stock");
  const handleAdd = onAdd || addToCart;
  const promotionText = getPromotionText(product);
  const displayMessage = getDisplayMessage(product);
  const productSize = getProductSize(product);
  const productImage = getDisplayProductImage(product);
  const ribbonLabel = getRibbonLabel(product);

  return (
    <div data-product-id={product.id} className="product-card group relative flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md sm:p-2.5">
      <ProductRibbon label={ribbonLabel} />
      <button type="button" className="mb-2 block h-32 w-full rounded-lg bg-white p-1 sm:h-32" onClick={() => onImageClick?.(product)}>
        <img src={productImage} alt={product?.name || "Product"} className="h-full w-full object-contain transition group-hover:scale-[1.02]" onError={(event) => { event.currentTarget.src = getDisplayProductImage({}); }} />
      </button>
      <div className="flex flex-1 flex-col">
        <h3 className="line-clamp-2 min-h-[42px] text-[15px] font-extrabold leading-5 text-slate-900 sm:min-h-[38px] sm:text-sm sm:leading-[19px]">{product?.name}</h3>
        {promotionText && <div className="mt-1 line-clamp-2 text-xs font-black leading-4 text-red-600 sm:text-[10px] sm:leading-3">{promotionText}</div>}
        {hasDisplayValue(productSize) && <div className="mt-1 text-xs leading-4 text-slate-500 sm:text-[10px] sm:leading-3">{productSize}</div>}
        <div className="product-price mt-1 text-xl font-black leading-6 text-slate-950 sm:text-xl sm:leading-5">{formatCurrency(productPrice)}</div>
        <div className={inStock ? "mt-1 text-xs font-black text-emerald-700 sm:text-[10px]" : "mt-1 text-xs font-black text-red-600 sm:text-[10px]"}>{stockText}</div>
        <div className="mt-auto pt-1.5">
          <div className="mb-1 text-[11px] font-medium text-slate-500 sm:text-[9px]">Carton: {product?.cartonSize || "-"}</div>
          <QuantityAddControls productId={product.id} quantity={quantity} setQuantity={setQuantity} onAdd={(amount) => handleAdd?.(product, amount)} />
          {cartQty > 0 && <div className="text-center text-xs font-black text-orange-700 sm:text-[10px]">{cartQty} in cart</div>}
          <ProductDisplayMessage message={displayMessage} />
        </div>
      </div>
    </div>
  );
}
