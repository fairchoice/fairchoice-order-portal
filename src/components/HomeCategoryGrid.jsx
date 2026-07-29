import { PRODUCT_PLACEHOLDER_IMAGE } from "../utils/productImages";

const targetLabels = {
  main_category: "Category",
  sub_category: "Sub category",
  brand: "Brand",
  custom_link: "Link",
  promotion: "Promotion",
};

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
  children,
}) {
  const searchingProducts = Boolean(String(search || "").trim());

  return (
    <section className="min-w-0">
      <div className="rounded-2xl bg-[#0b2f5b] p-3 text-white shadow-md sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-300">
              Welcome to Fair Choice
            </p>
            <h2 className="mt-0.5 text-2xl font-extrabold sm:text-3xl">
              Find Products
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-blue-100 sm:text-sm">
              Search every available product or browse a category
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onHome}
              aria-label="Go to home"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-blue-950 bg-blue-950 px-4 py-2 text-sm font-extrabold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
            >
              <span aria-hidden="true">⌂</span> Home
            </button>
            <button
              type="button"
              onClick={onCartClick}
              aria-label={`Open cart, ${cartItemCount} items`}
              className="min-h-10 rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white hover:bg-orange-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <span aria-hidden="true">🛒</span> {cartItemCount}
            </button>
          </div>
        </div>

        <label htmlFor="home-category-search" className="sr-only">
          Search all products
        </label>
        <input
          id="home-category-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search all products…"
          className="mt-3 min-h-10 w-full rounded-xl border border-white/30 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:outline-none focus:ring-4 focus:ring-orange-300/50"
        />
      </div>

      {loading && (
        <div
          className="mt-5 rounded-2xl border bg-white p-5"
          role="status"
          aria-live="polite"
        >
          Loading products…
        </div>
      )}
      {!loading && searchingProducts && productResultCount === 0 && (
        <div className="mt-5 rounded-2xl border bg-white p-5 text-slate-600">
          No products match your search.
        </div>
      )}
      {!loading && searchingProducts && productResultCount > 0 && (
        <div className="mt-5">
          <div className="mb-3 text-sm font-bold text-slate-700">
            {productResultCount} product
            {productResultCount === 1 ? "" : "s"} found
          </div>
          {children}
        </div>
      )}

      {!loading && !searchingProducts && (
        <div className="mt-5 grid grid-cols-1 gap-4 min-[400px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onBrowse(item)}
              className="group flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-300"
            >
              <div className="relative aspect-[4/3] w-full bg-slate-50 p-3">
                <img
                  src={item.image || PRODUCT_PLACEHOLDER_IMAGE}
                  alt={`${item.title || item.description} home page item`}
                  loading={index < 4 ? "eager" : "lazy"}
                  className="h-full w-full object-contain"
                  onError={(event) => {
                    event.currentTarget.src = PRODUCT_PLACEHOLDER_IMAGE;
                  }}
                />
                <span className="absolute left-3 top-3 rounded-full bg-blue-950 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
                  {targetLabels[item.categoryType] || "Category"}
                </span>
              </div>
              <div className="flex flex-1 flex-col p-3 sm:p-4">
                <h3 className="text-base font-extrabold leading-5 text-slate-900 sm:text-lg">
                  {item.title || item.description}
                </h3>
                {item.subDescription && (
                  <p className="mt-1 hidden text-sm leading-5 text-slate-600 sm:line-clamp-2">
                    {item.subDescription}
                  </p>
                )}
                {item.categoryType !== "custom_link" && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                    <span>{item.productCount} products</span>
                    <span aria-hidden="true">•</span>
                    <span>{item.brandCount} brands</span>
                  </div>
                )}
                <span className="mt-auto pt-4 font-extrabold text-orange-700 group-hover:text-orange-800">
                  {item.categoryType === "custom_link"
                    ? "Open Link"
                    : "Browse Products"}{" "}
                  <span aria-hidden="true">→</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
