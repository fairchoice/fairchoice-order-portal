import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ALL_SUB_CATEGORIES = "All Sub Categories";
const ALL_BRANDS = "All Brands";
const ALL_SERIES = "All Series";

const uniqueLabels = (values) => [
  ...new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
];

const sortLabels = (values) =>
  uniqueLabels(values).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );

function FilterChip({ active, children, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "shrink-0 rounded-xl border border-orange-500 bg-orange-500 px-3 py-2 text-xs font-black text-white shadow-sm sm:text-sm"
          : "shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 transition hover:border-orange-400 hover:bg-orange-50 sm:text-sm"
      }
    >
      {active ? <span aria-hidden="true">✓ </span> : null}
      {children}
    </button>
  );
}

const getMobilePreviewLabel = (label, option) => {
  const text = String(option || "").trim();
  if (!text) return "";

  if (label === "Subcategory") {
    const lower = text.toLowerCase();
    if (lower.includes("refill") && lower.includes("replacement") && lower.includes("pod")) {
      return "Refill Kit & Replacement Pod";
    }
    if (lower.includes("nicotine") && lower.includes("pouch")) return "Nicotine Pouch";
  }

  return text;
};

const getMobilePreviewOptions = (label, options) => {
  const source = uniqueLabels(options);
  if (label !== "Subcategory") return source.slice(0, 2);

  const preferredMatchers = [
    (value) => value.includes("refill") && value.includes("replacement") && value.includes("pod"),
    (value) => value.includes("nicotine") && value.includes("pouch"),
  ];

  const preferred = preferredMatchers
    .map((matches) => source.find((option) => matches(option.toLowerCase())))
    .filter(Boolean);

  return uniqueLabels([...preferred, ...source]).slice(0, 2);
};

function FilterRow({ label, allLabel, allValue, value, options, onSelect, onMore }) {
  const mobileOptions = getMobilePreviewOptions(label, options);

  return (
    <>
      <div className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-orange-300 px-2.5 py-2 md:hidden">
        <span className="shrink-0 text-xs font-black text-slate-900">{label} -</span>
        <button
          type="button"
          onClick={() => onSelect(allValue)}
          className={
            value === allValue
              ? "shrink-0 text-xs font-black text-orange-700"
              : "shrink-0 text-xs font-bold text-slate-800"
          }
        >
          {allLabel}
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {mobileOptions.map((option) => (
            <span key={`${label}-preview-${option}`} className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-slate-400">|</span>
              <button
                type="button"
                onClick={() => onSelect(option)}
                className={
                  value === option
                    ? "text-left text-xs font-black text-orange-700"
                    : "text-left text-xs font-bold text-slate-800"
                }
                title={option}
              >
                {getMobilePreviewLabel(label, option)}
              </button>
            </span>
          ))}
        </div>

        <span className="shrink-0 text-xs text-slate-400">|</span>
        <button
          type="button"
          onClick={onMore}
          className="shrink-0 rounded-md px-1.5 py-1 text-xs font-black text-slate-900"
        >
          More &gt;
        </button>
      </div>

      <div className="hidden gap-1.5 md:grid md:grid-cols-[120px_minmax(0,1fr)_72px] md:items-start">
        <div className="pt-1 text-sm font-black text-slate-900">{label}</div>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          <FilterChip active={value === allValue} onClick={() => onSelect(allValue)}>
            {allLabel}
          </FilterChip>
          {options.slice(0, 8).map((option) => (
            <FilterChip key={`${label}-${option}`} active={value === option} onClick={() => onSelect(option)}>
              {option}
            </FilterChip>
          ))}
        </div>
        <button
          type="button"
          onClick={onMore}
          className="min-h-10 rounded-xl border border-orange-300 bg-orange-50 px-3 text-xs font-black text-orange-800 transition hover:bg-orange-100"
        >
          More &gt;
        </button>
      </div>
    </>
  );
}

function MobileFilterPanel({ section, onClose }) {
  const [optionSearch, setOptionSearch] = useState("");
  const closeButtonRef = useRef(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const closeOnEscape = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  if (!section) return null;

  const keyword = optionSearch.trim().toLowerCase();
  const filtered = sortLabels(section.options).filter(
    (option) => !keyword || option.toLowerCase().includes(keyword)
  );

  const selectOption = (value) => {
    section.onSelect(value);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end bg-slate-950/60 sm:items-center sm:justify-center sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-product-filter-title"
        className="flex max-h-[86vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl sm:max-w-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h3 id="mobile-product-filter-title" className="text-xl font-black text-slate-900">
              {section.label}
            </h3>
            <p className="text-xs text-slate-500">Choose one {section.label.toLowerCase()}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700"
          >
            Close
          </button>
        </div>
        <div className="border-b p-4">
          <input
            type="search"
            value={optionSearch}
            onChange={(event) => setOptionSearch(event.target.value)}
            placeholder={`Search ${section.label.toLowerCase()}`}
            className="h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-200"
          />
        </div>
        <div className="overflow-y-auto p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => selectOption(section.allValue)}
              className={
                section.value === section.allValue
                  ? "rounded-xl border-2 border-orange-500 bg-orange-50 p-3 text-left text-base font-black text-orange-800"
                  : "rounded-xl border border-slate-200 p-3 text-left text-base font-bold text-slate-700"
              }
            >
              {section.allLabel}
            </button>
            {filtered.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => selectOption(option)}
                className={
                  section.value === option
                    ? "rounded-xl border-2 border-orange-500 bg-orange-50 p-3 text-left text-base font-black text-orange-800"
                    : "rounded-xl border border-slate-200 p-3 text-left text-base font-bold text-slate-700"
                }
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ProductFilters({
  search,
  setSearch,
  selectedCategory,
  browseTitle,
  subCategories,
  selectedSubCategory,
  setSelectedSubCategory,
  brands,
  selectedBrand,
  setSelectedBrand,
  seriesList,
  selectedSeries,
  setSelectedSeries,
  resultCount = 0,
  onClearAll,
}) {
  const [searchInput, setSearchInput] = useState(search);
  const [mobileFilterSection, setMobileFilterSection] = useState(null);
  const searchTimerRef = useRef(null);

  useEffect(() => setSearchInput(search), [search]);
  useEffect(() => () => searchTimerRef.current && clearTimeout(searchTimerRef.current), []);

  const subCategoryOptions = uniqueLabels(
    subCategories.filter((option) => option !== ALL_SUB_CATEGORIES)
  );
  const brandOptions = uniqueLabels(brands.filter((option) => option !== ALL_BRANDS));
  const seriesOptions = uniqueLabels(seriesList.filter((option) => option !== ALL_SERIES));

  const updateSearch = (value) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearch(value), 250);
  };

  const clearBrowseSelections = useCallback(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearchInput("");
    setSearch("");
    setSelectedSubCategory(ALL_SUB_CATEGORIES);
    setSelectedBrand(ALL_BRANDS);
    setSelectedSeries(ALL_SERIES);
    setMobileFilterSection(null);
    onClearAll?.();
  }, [onClearAll, setSearch, setSelectedBrand, setSelectedSeries, setSelectedSubCategory]);

  const contextTitle =
    selectedBrand !== ALL_BRANDS ? selectedBrand : browseTitle || selectedCategory || "Products";
  const contextHeading = /\bproducts$/i.test(contextTitle) ? contextTitle : `${contextTitle} Products`;

  const mobileConfig = useMemo(
    () => [
      {
        label: "Subcategory",
        options: subCategoryOptions,
        value: selectedSubCategory,
        allValue: ALL_SUB_CATEGORIES,
        allLabel: "All",
        onSelect: setSelectedSubCategory,
      },
      {
        label: "Brand",
        options: brandOptions,
        value: selectedBrand,
        allValue: ALL_BRANDS,
        allLabel: "All",
        onSelect: setSelectedBrand,
      },
      {
        label: "Series",
        options: seriesOptions,
        value: selectedSeries,
        allValue: ALL_SERIES,
        allLabel: "All Products",
        onSelect: setSelectedSeries,
      },
    ],
    [
      brandOptions,
      selectedBrand,
      selectedSeries,
      selectedSubCategory,
      seriesOptions,
      setSelectedBrand,
      setSelectedSeries,
      setSelectedSubCategory,
      subCategoryOptions,
    ]
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm sm:rounded-2xl sm:p-4">
      <div className="mb-2 flex items-start justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black text-slate-900 sm:text-2xl">{contextHeading}</h2>
          <p className="text-xs font-medium text-slate-500 sm:text-sm">
            {resultCount} {resultCount === 1 ? "product" : "products"} available
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={clearBrowseSelections}
            className="min-h-9 rounded-lg border border-orange-300 bg-orange-50 px-2.5 text-[11px] font-black text-orange-800 transition hover:bg-orange-100 sm:min-h-10 sm:rounded-xl sm:px-4 sm:text-sm"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="space-y-1.5 md:space-y-2.5">
        <FilterRow
          label="Subcategory"
          allLabel="All"
          allValue={ALL_SUB_CATEGORIES}
          value={selectedSubCategory}
          options={subCategoryOptions}
          onSelect={setSelectedSubCategory}
          onMore={() => setMobileFilterSection(mobileConfig[0])}
        />
        <FilterRow
          label="Brand"
          allLabel="All"
          allValue={ALL_BRANDS}
          value={selectedBrand}
          options={brandOptions}
          onSelect={setSelectedBrand}
          onMore={() => setMobileFilterSection(mobileConfig[1])}
        />
        <FilterRow
          label="Series"
          allLabel="All Products"
          allValue={ALL_SERIES}
          value={selectedSeries}
          options={seriesOptions}
          onSelect={setSelectedSeries}
          onMore={() => setMobileFilterSection(mobileConfig[2])}
        />
      </div>

      <div className="mt-2 border-t border-slate-200 pt-2 md:mt-3 md:pt-3">
        <label htmlFor="product-search" className="sr-only">
          Search products, brand or product code
        </label>
        <input
          id="product-search"
          type="search"
          value={searchInput}
          onChange={(event) => updateSearch(event.target.value)}
          placeholder="Search products, brand or product code"
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-200 md:h-11 md:rounded-xl md:px-4"
        />
      </div>

      {mobileFilterSection && (
        <MobileFilterPanel
          section={mobileFilterSection}
          onClose={() => setMobileFilterSection(null)}
        />
      )}
    </section>
  );
}
