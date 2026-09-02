import { useEffect, useRef, useState } from "react";
import fairchoiceLogo from "../assets/fairchoice-logo.png";
import { PRODUCT_PLACEHOLDER_IMAGE, getDisplayProductImage } from "../utils/productImages";
import { formatCurrency } from "../utils/currency";

const targetLabels = {
  main_category: "Category",
  sub_category: "Sub category",
  brand: "Brand",
  series: "Series",
  custom_link: "Link",
  promotion: "Promotion",
};

const isPromotionItem = (item = {}) =>
  item.categoryType === "promotion" ||
  /promotion|offer|deal/i.test(String(item.categoryType || ""));

function HomeTile({ item, index, onBrowse, compact = false }) {
  return (
    <button
      type="button"
      onClick={() => onBrowse(item)}
      className={
        compact
          ? "group w-[178px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300 sm:w-[205px]"
          : "group flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
      }
    >
      <div className={compact ? "relative h-32 bg-white p-2" : "relative aspect-[4/3] w-full bg-white p-3"}>
        <img
          src={item.image || PRODUCT_PLACEHOLDER_IMAGE}
          alt={`${item.title || item.description} home page item`}
          loading={index < 6 ? "eager" : "lazy"}
          className="h-full w-full object-contain"
          onError={(event) => {
            event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE;
          }}
        />
        <span className="absolute left-2 top-2 rounded-md bg-[#0f2942]/95 px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide text-white">
          {targetLabels[item.categoryType] || "Category"}
        </span>
      </div>
      <div className={compact ? "p-2.5" : "flex flex-1 flex-col p-3"}>
        <h3 className={compact ? "line-clamp-2 text-sm font-extrabold leading-4 text-slate-900" : "text-base font-extrabold leading-5 text-slate-900"}>
          {item.title || item.description}
        </h3>
        {!compact && item.subDescription && (
          <p className="mt-1 line-clamp-2 text-xs leading-4 text-slate-500">
            {item.subDescription}
          </p>
        )}
        {item.categoryType !== "custom_link" && !compact && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-bold text-slate-500">
            <span>{item.productCount} products</span>
            <span aria-hidden="true">•</span>
            <span>{item.brandCount} brands</span>
          </div>
        )}
        <span className={compact ? "mt-2 block text-xs font-extrabold text-orange-700" : "mt-auto block pt-3 text-sm font-extrabold text-orange-700"}>
          {item.categoryType === "custom_link" ? "Open" : "Shop now"} <span aria-hidden="true">›</span>
        </span>
      </div>
    </button>
  );
}


function SwipeProductCard({ product, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(product)}
      className="w-[38%] min-w-[132px] max-w-[180px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-[190px]"
    >
      <div className="h-32 bg-white p-2 sm:h-36">
        <img
          src={getDisplayProductImage(product)}
          alt={product?.name || "Product"}
          className="h-full w-full object-contain"
          loading="lazy"
          onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }}
        />
      </div>
      <div className="p-2.5">
        <h3 className="line-clamp-2 min-h-10 text-sm font-extrabold leading-5 text-slate-900">{product?.name}</h3>
        <div className="mt-1 text-base font-black text-slate-950">{formatCurrency(product?.displayPrice ?? product?.vatPrice ?? product?.cashPrice ?? 0)}</div>
        {product?.salesMetric && (Number(product.salesMetric.units30 || 0) > 0 || Number(product.salesMetric.units90 || 0) > 0) && (
          <div className="mt-1 text-[11px] font-bold text-slate-500">
            {Number(product.salesMetric.units30 || 0)} sold 30d • {Number(product.salesMetric.units90 || 0)} sold 90d
          </div>
        )}
        {product?.isPromotion && <div className="mt-1 text-xs font-black text-red-600">Limited time deal</div>}
      </div>
    </button>
  );
}

function SwipeFlavourCard({ entry, onBrowse }) {
  return (
    <button
      type="button"
      onClick={() => onBrowse?.({ id: `flavour-${entry.flavour}`, categoryType: "flavour", targetValue: entry.flavour, title: entry.flavour })}
      className="w-[38%] min-w-[132px] max-w-[180px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-[190px]"
    >
      <div className="h-28 bg-white p-2 sm:h-32">
        <img src={entry.image || PRODUCT_PLACEHOLDER_IMAGE} alt={entry.flavour} className="h-full w-full object-contain" loading="lazy" onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} />
      </div>
      <div className="p-2.5">
        <div className="line-clamp-2 text-sm font-black text-slate-900">{entry.flavour}</div>
        <div className="mt-1 text-[11px] font-bold text-slate-500">{Number(entry.units30 || 0)} sold 30d • {Number(entry.units90 || 0)} sold 90d</div>
      </div>
    </button>
  );
}

function SwipeBrandCard({ brand, image, onBrowse }) {
  return (
    <button
      type="button"
      onClick={() => onBrowse?.({ id: `brand-${brand}`, categoryType: "brand", targetValue: brand, title: brand })}
      className="w-[38%] min-w-[132px] max-w-[180px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md sm:w-[190px]"
    >
      <div className="h-28 bg-white p-2 sm:h-32">
        <img src={image || PRODUCT_PLACEHOLDER_IMAGE} alt={brand} className="h-full w-full object-contain" loading="lazy" onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} />
      </div>
      <div className="p-2.5 text-sm font-black text-slate-900">{brand}</div>
    </button>
  );
}

export default function HomeCategoryGrid({
  items,
  loading,
  search,
  productResultCount = 0,
  onSearchChange,
  onBrowse,
  onHome,
  cartItemCount,
  onCartClick,
  menuItems = [],
  headerOnly = false,
  hideHeader = false,
  children,
  products = [],
  salesMetrics = {},
  onProductClick,
  getProductPrice,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const promotionRef = useRef(null);
  const categoryRef = useRef(null);
  const topSellerRef = useRef(null);
  const hotSellerRef = useRef(null);
  const brandRef = useRef(null);
  const popularRef = useRef(null);
  const topVapeRef = useRef(null);
  const flavourRef = useRef(null);
  const newItemsRef = useRef(null);
  const searchingProducts = Boolean(String(search || "").trim());
  const promotionItems = (items || []).filter(isPromotionItem);
  const brandItems = (items || []).filter((item) => item.categoryType === "brand");
  const browseItems = (items || []).filter((item) => !isPromotionItem(item) && item.categoryType !== "brand");
  const displayBrowseItems = browseItems.length ? browseItems : (items || []).filter((item) => item.categoryType !== "brand");
  const visibleMenuItems = (menuItems || []).filter((item) => !item?.hidden);
  const activeProducts = (products || []).filter((product) => product?.active !== false);

  const getSalesMetric = (product = {}) => {
    const aliases = [
      product?.id ? `id:${String(product.id)}` : "",
      product?.productCode ? `code:${String(product.productCode).trim().toLowerCase()}` : "",
      product?.name ? `name:${String(product.name).trim().toLowerCase()}` : "",
    ].filter(Boolean);

    return aliases.map((key) => salesMetrics?.[key]).find(Boolean) || null;
  };

  const withSales = activeProducts.map((product) => ({
    ...product,
    salesMetric: getSalesMetric(product),
    displayPrice: getProductPrice?.(product) ?? product?.vatPrice ?? product?.cashPrice ?? 0,
  }));

  const byLifetimeSales = (left, right) =>
    Number(right?.salesMetric?.units90 || 0) - Number(left?.salesMetric?.units90 || 0) ||
    Number(right?.salesMetric?.units30 || 0) - Number(left?.salesMetric?.units30 || 0) ||
    Number(right?.salesMetric?.revenue90 || 0) - Number(left?.salesMetric?.revenue90 || 0) ||
    String(left?.name || "").localeCompare(String(right?.name || ""));

  const byRecentVelocity = (left, right) =>
    Number(right?.salesMetric?.velocityScore || 0) - Number(left?.salesMetric?.velocityScore || 0) ||
    Number(right?.salesMetric?.units7 || 0) - Number(left?.salesMetric?.units7 || 0) ||
    Number(right?.salesMetric?.units30 || 0) - Number(left?.salesMetric?.units30 || 0) ||
    byLifetimeSales(left, right);

  const soldProducts = withSales.filter((product) => Number(product?.salesMetric?.units90 || 0) > 0);
  const allTopSellers = [...soldProducts].sort(byLifetimeSales);
  const displayTopSellers = allTopSellers.slice(0, 10);
  const allHotSellers = withSales
    .filter((product) => Number(product?.salesMetric?.units7 || 0) > 0 || Number(product?.salesMetric?.units30 || 0) > 0)
    .sort(byRecentVelocity);
  const displayHotSellers = allHotSellers.slice(0, 10);
  const popularProducts = [...soldProducts].sort(byRecentVelocity).slice(0, 15);

  const isVapeProduct = (product = {}) => {
    const text = [
      product?.category,
      product?.subCategory,
      product?.series,
      product?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return /(vape|refill|replacement pod|\bpod\b|nic salt|e-liquid|eliquid|full kit|600 puff|10k|15k)/i.test(text);
  };

  const topVapeProducts = soldProducts
    .filter(isVapeProduct)
    .sort(byRecentVelocity)
    .slice(0, 10);

  const popularVapeFlavours = Object.values(
    soldProducts
      .filter((product) => isVapeProduct(product) && String(product?.flavour || "").trim())
      .reduce((acc, product) => {
        const flavour = String(product.flavour || "").trim();
        const key = flavour.toLowerCase();
        const metric = product.salesMetric || {};
        if (!acc[key]) {
          acc[key] = {
            flavour,
            image: getDisplayProductImage(product),
            units7: 0,
            units30: 0,
            units90: 0,
            velocityScore: 0,
          };
        }
        acc[key].units7 += Number(metric.units7 || 0);
        acc[key].units30 += Number(metric.units30 || 0);
        acc[key].units90 += Number(metric.units90 || 0);
        acc[key].velocityScore += Number(metric.velocityScore || 0);
        return acc;
      }, {})
  )
    .sort((a, b) =>
      Number(b.velocityScore || 0) - Number(a.velocityScore || 0) ||
      Number(b.units90 || 0) - Number(a.units90 || 0) ||
      a.flavour.localeCompare(b.flavour)
    )
    .slice(0, 10);

  const newItems = withSales
    .filter((product) => product?.isNew === true)
    .slice(0, 15);

  const automaticTopBrands = Object.values(
    withSales.reduce((acc, product) => {
      const brand = String(product?.brand || "").trim();
      if (!brand) return acc;
      const metric = product.salesMetric || {};
      if (!acc[brand]) {
        acc[brand] = {
          brand,
          units90: 0,
          velocityScore: 0,
          productCount: 0,
          image: getDisplayProductImage(product),
        };
      }
      acc[brand].units90 += Number(metric.units90 || 0);
      acc[brand].velocityScore += Number(metric.velocityScore || 0);
      acc[brand].productCount += 1;
      return acc;
    }, {})
  )
    .sort((a, b) =>
      Number(b.velocityScore || 0) - Number(a.velocityScore || 0) ||
      Number(b.units90 || 0) - Number(a.units90 || 0) ||
      Number(b.productCount || 0) - Number(a.productCount || 0) ||
      a.brand.localeCompare(b.brand)
    )
    .slice(0, 12);
  const topBrands = automaticTopBrands;
  const configuredTopPromotions = promotionItems.filter((item) => Number(item.sortOrder) < 0);
  const topPromotions = configuredTopPromotions.length ? configuredTopPromotions : promotionItems.slice(0, 1);
  const dealPromotion = promotionItems.find((item) => Number(item.sortOrder) >= 0) || promotionItems.find((item) => item.active !== false) || null;

  const scrollRow = (ref, direction) => {
    const node = ref?.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.82, 240), behavior: "smooth" });
  };

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeMenu = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const runMenuAction = async (item) => {
    if (item?.disabled) return;
    setMenuOpen(false);
    await Promise.resolve(item?.onClick?.());
  };

  return (
    <section className={headerOnly ? "min-w-0" : "min-w-0 bg-slate-100/70 pb-4"}>
      {!hideHeader && (
      <div className="sticky top-0 z-40 bg-[#102a43] text-white shadow-lg">
        <div className="mx-auto max-w-[1600px] px-3 py-2 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src={fairchoiceLogo}
                alt="FairChoice Cash and Carry"
                className="h-11 w-auto shrink-0 rounded-md bg-white object-contain sm:h-12"
              />
              <div className="min-w-0">
                <div className="truncate text-base font-black tracking-tight sm:text-lg">FairChoice Cash & Carry</div>
                <div className="hidden text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300 sm:block">Order Portal</div>
              </div>
            </div>

            {visibleMenuItems.length > 0 && (
              <div ref={menuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  aria-label="Order menu"
                  className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/20 text-2xl font-black hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
                >
                  ☰
                </button>
                {menuOpen && (
                  <div role="menu" className="absolute right-0 top-12 z-[80] w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-slate-900 shadow-2xl">
                    {visibleMenuItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        disabled={item.disabled}
                        onClick={() => runMenuAction(item)}
                        className={`flex w-full items-center px-4 py-3 text-left text-sm font-bold transition ${item.divider ? "border-t border-slate-200" : ""} ${item.danger ? "text-red-700 hover:bg-red-50" : "text-slate-800 hover:bg-slate-100"} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-white/10 bg-[#203b55]">
          <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:px-4">
            {(displayBrowseItems || []).slice(0, 12).map((item) => (
              <button
                key={`nav-${item.id}`}
                type="button"
                onClick={() => onBrowse(item)}
                className="shrink-0 rounded px-2.5 py-1.5 text-xs font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300"
              >
                {item.title || item.description}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      {!headerOnly && (
      <div className="mx-auto max-w-[1600px] px-2 sm:px-4">
        {loading && (
          <div className="mt-4 rounded-xl border bg-white p-5" role="status" aria-live="polite">Loading products…</div>
        )}

        {!loading && searchingProducts && productResultCount === 0 && (
          <div className="mt-4 rounded-xl border bg-white p-5 text-slate-600">No products match your search.</div>
        )}

        {!loading && searchingProducts && productResultCount > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-sm font-bold text-slate-700">
              {productResultCount} product{productResultCount === 1 ? "" : "s"} found
            </div>
            {children}
          </div>
        )}

        {!loading && !searchingProducts && (
          <>
            {topPromotions.length > 0 && (
              <section className="relative mt-3">
                <div ref={promotionRef} className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {topPromotions.map((promotion, index) => (
                    <button
                      key={promotion.id || `promotion-${index}`}
                      type="button"
                      onClick={() => onBrowse(promotion)}
                      className="group h-[380px] w-[270px] min-w-[270px] max-w-[270px] shrink-0 snap-start overflow-hidden rounded-xl border border-orange-200 bg-white text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
                    >
                      <div className="relative h-full w-full overflow-hidden bg-orange-50">
                        <img src={promotion.image || PRODUCT_PLACEHOLDER_IMAGE} alt={promotion.title || "Top promotion"} className="h-full w-full object-cover" loading={index === 0 ? "eager" : "lazy"} onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 to-transparent px-3 pb-3 pt-10 text-white">
                          <h2 className="line-clamp-2 text-lg font-black leading-tight">{promotion.title || promotion.description}</h2>
                          {promotion.subDescription && <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-white/90">{promotion.subDescription}</p>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {topPromotions.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous promotion" onClick={() => scrollRow(promotionRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-white/95 text-2xl font-black text-slate-800 shadow">‹</button>
                    <button type="button" aria-label="Next promotion" onClick={() => scrollRow(promotionRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border bg-white/95 text-2xl font-black text-slate-800 shadow">›</button>
                  </>
                )}
              </section>
            )}

            <section className="relative mt-4 bg-white py-3 sm:rounded-2xl sm:border sm:border-slate-200 sm:p-4 sm:shadow-sm">
              <div className="mb-2 flex items-center justify-between px-1 sm:px-0">
                <h2 className="text-xl font-black text-slate-900">Main Categories</h2>
                <span className="text-xs font-bold text-slate-500">Swipe or use arrows</span>
              </div>
              <div ref={categoryRef} className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {displayBrowseItems.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => onBrowse(item)} className="w-[42%] min-w-[150px] max-w-[230px] shrink-0 snap-start overflow-hidden rounded-xl bg-white text-left sm:w-[220px] sm:min-w-[220px] sm:max-w-[220px]">
                    <div className="aspect-square w-full overflow-hidden rounded-xl bg-slate-50 p-1">
                      <img src={item.image || PRODUCT_PLACEHOLDER_IMAGE} alt={item.title || item.description} loading={index < 4 ? "eager" : "lazy"} className="h-full w-full object-contain" onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} />
                    </div>
                    <div className="mt-1.5 line-clamp-2 px-1 text-[15px] font-black uppercase leading-[1.05rem] tracking-[0.01em] text-slate-900 sm:text-base sm:leading-5">{item.title || item.description}</div>
                  </button>
                ))}
              </div>
              {displayBrowseItems.length > 3 && (
                <>
                  <button type="button" aria-label="Previous categories" onClick={() => scrollRow(categoryRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next categories" onClick={() => scrollRow(categoryRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>
              )}
            </section>

            {displayTopSellers.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-orange-50 p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => onBrowse?.({ id: "top-sellers", categoryType: "product_set", title: "Top Sellers", productIds: allTopSellers.map((product) => product.id) })} className="text-left text-xl font-black text-slate-900 hover:text-orange-700">Top Sellers <span className="text-sm">View all ›</span></button>
                  <span className="text-xs font-bold text-slate-600">Swipe or use arrows</span>
                </div>
                <div ref={topSellerRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">{displayTopSellers.map((product) => <SwipeProductCard key={product.id} product={product} onClick={onProductClick} />)}</div>
                {displayTopSellers.length > 2 && (<>
                  <button type="button" aria-label="Previous top sellers" onClick={() => scrollRow(topSellerRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next top sellers" onClick={() => scrollRow(topSellerRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {displayHotSellers.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-rose-50 p-3 sm:p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <button type="button" onClick={() => onBrowse?.({ id: "hot-sellers", categoryType: "product_set", title: "Hot Sellers", productIds: allHotSellers.map((product) => product.id) })} className="text-left text-xl font-black text-slate-900 hover:text-rose-700">Hot Sellers <span className="text-sm">View all ›</span></button>
                  <span className="text-xs font-bold text-slate-600">Swipe or use arrows</span>
                </div>
                <div ref={hotSellerRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">{displayHotSellers.map((product) => <SwipeProductCard key={product.id} product={product} onClick={onProductClick} />)}</div>
                {displayHotSellers.length > 2 && (<>
                  <button type="button" aria-label="Previous hot sellers" onClick={() => scrollRow(hotSellerRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next hot sellers" onClick={() => scrollRow(hotSellerRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {dealPromotion && (
              <section className="mt-4 overflow-hidden rounded-2xl bg-[#102a43] text-white shadow-sm">
                <button type="button" onClick={() => onBrowse(dealPromotion)} className="grid w-full text-left sm:grid-cols-[1fr_1.4fr]">
                  <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-300">FairChoice promotion</p>
                    <h2 className="mt-1 text-xl font-black">{dealPromotion.title || "Special Offer"}</h2>
                    {dealPromotion.subDescription && <p className="mt-1 text-sm font-semibold text-white/85">{dealPromotion.subDescription}</p>}
                    <span className="mt-3 inline-flex rounded-lg bg-orange-500 px-3 py-2 text-xs font-black">View offer ›</span>
                  </div>
                  <div className="h-44 bg-white sm:h-48"><img src={dealPromotion.image || PRODUCT_PLACEHOLDER_IMAGE} alt={dealPromotion.title || "Promotion"} className="h-full w-full object-contain" onError={(event) => { event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE; }} /></div>
                </button>
              </section>
            )}

            {popularProducts.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-slate-50 p-3 shadow-sm sm:border sm:border-slate-200 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Popular Products</h2>
                  <span className="text-xs font-bold text-slate-500">15 items • Swipe or use arrows</span>
                </div>
                <div ref={popularRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {popularProducts.map((product) => (
                    <SwipeProductCard key={`popular-${product.id || product.productCode || product.name}`} product={product} onClick={onProductClick} />
                  ))}
                </div>
                {popularProducts.length > 2 && (<>
                  <button type="button" aria-label="Previous popular products" onClick={() => scrollRow(popularRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next popular products" onClick={() => scrollRow(popularRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {topVapeProducts.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-blue-50 p-3 shadow-sm sm:border sm:border-blue-100 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Top Vape Selling Products</h2>
                  <span className="text-xs font-bold text-slate-500">Top 10 • Actual sales</span>
                </div>
                <div ref={topVapeRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {topVapeProducts.map((product) => (
                    <SwipeProductCard key={`top-vape-${product.id || product.productCode || product.name}`} product={product} onClick={onProductClick} />
                  ))}
                </div>
                {topVapeProducts.length > 2 && (<>
                  <button type="button" aria-label="Previous top vape products" onClick={() => scrollRow(topVapeRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next top vape products" onClick={() => scrollRow(topVapeRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {popularVapeFlavours.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-violet-50 p-3 shadow-sm sm:border sm:border-violet-100 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">Popular Vape Flavours</h2>
                  <span className="text-xs font-bold text-slate-500">Top 10 • Actual sales</span>
                </div>
                <div ref={flavourRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {popularVapeFlavours.map((entry) => (
                    <SwipeFlavourCard key={`flavour-${entry.flavour}`} entry={entry} onBrowse={onBrowse} />
                  ))}
                </div>
                {popularVapeFlavours.length > 2 && (<>
                  <button type="button" aria-label="Previous popular vape flavours" onClick={() => scrollRow(flavourRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next popular vape flavours" onClick={() => scrollRow(flavourRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {newItems.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-emerald-50 p-3 shadow-sm sm:border sm:border-emerald-100 sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-xl font-black text-slate-900">New Items</h2>
                  <span className="text-xs font-bold text-slate-500">Swipe or use arrows</span>
                </div>
                <div ref={newItemsRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {newItems.map((product) => (
                    <SwipeProductCard key={`new-${product.id || product.productCode || product.name}`} product={product} onClick={onProductClick} />
                  ))}
                </div>
                {newItems.length > 2 && (<>
                  <button type="button" aria-label="Previous new items" onClick={() => scrollRow(newItemsRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next new items" onClick={() => scrollRow(newItemsRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}

            {topBrands.length > 0 && (
              <section className="relative mt-4 rounded-2xl bg-white p-3 shadow-sm sm:border sm:border-slate-200 sm:p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-xl font-black text-slate-900">Top Brands</h2><span className="text-xs font-bold text-slate-500">Swipe or use arrows</span></div>
                <div ref={brandRef} className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">{topBrands.map((entry) => <SwipeBrandCard key={entry.brand} {...entry} onBrowse={onBrowse} />)}</div>
                {topBrands.length > 2 && (<>
                  <button type="button" aria-label="Previous brands" onClick={() => scrollRow(brandRef, -1)} className="absolute left-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">‹</button>
                  <button type="button" aria-label="Next brands" onClick={() => scrollRow(brandRef, 1)} className="absolute right-1 top-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full border bg-white/95 text-2xl font-black shadow">›</button>
                </>)}
              </section>
            )}
          </>
        )}
      </div>
      )}
    </section>
  );
}
