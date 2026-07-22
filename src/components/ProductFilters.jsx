import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ALL_SUB_CATEGORIES = "All Sub Categories";
const ALL_BRANDS = "All Brands";
const ALL_SERIES = "All Series";
const VISIBLE_OPTION_LIMIT = 4;

const uniqueLabels = (values) => [
  ...new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
];

const sortLabels = (values) =>
  uniqueLabels(values).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" })
  );

function SelectorChip({ active, children, onClick }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        active
          ? "min-h-10 shrink-0 rounded-xl border border-orange-600 bg-orange-500 px-3 py-2 text-xs font-extrabold text-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 focus-visible:ring-offset-2 sm:text-sm"
          : "min-h-10 shrink-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:border-orange-400 hover:bg-orange-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 sm:text-sm"
      }
    >
      {active && <span aria-hidden="true">✓ </span>}
      {children}
    </button>
  );
}

function getVisibleOptions({ options, preferredOptions, selectedValue, allValue }) {
  const fullOptions = uniqueLabels(options.filter((option) => option !== allValue));
  const preferred = uniqueLabels(preferredOptions).filter((option) =>
    fullOptions.includes(option)
  );
  return uniqueLabels([
    selectedValue !== allValue ? selectedValue : "",
    ...preferred,
    ...fullOptions,
  ]).slice(0, VISIBLE_OPTION_LIMIT);
}

function CompactSelectorRow({
  label,
  options,
  preferredOptions = [],
  selectedValue,
  allValue,
  allLabel,
  onSelect,
  onMore,
}) {
  const fullOptions = options.filter((option) => option !== allValue);
  if (!fullOptions.length) return null;

  const visibleOptions = getVisibleOptions({
    options,
    preferredOptions,
    selectedValue,
    allValue,
  });

  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-sm font-extrabold text-slate-800">{label}</h3>
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {selectedValue === allValue && (
            <SelectorChip active onClick={() => onSelect(allValue)}>
              {allLabel}
            </SelectorChip>
          )}
          {visibleOptions.map((option) => (
            <SelectorChip
              key={option}
              active={selectedValue === option}
              onClick={() => onSelect(option)}
            >
              {option}
            </SelectorChip>
          ))}
          {selectedValue !== allValue && (
            <SelectorChip active={false} onClick={() => onSelect(allValue)}>
              {allLabel}
            </SelectorChip>
          )}
        </div>
        <button
          type="button"
          onClick={onMore}
          aria-label={`More ${label.toLowerCase()}`}
          className="min-h-10 shrink-0 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-extrabold text-orange-800 hover:bg-orange-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 sm:text-sm"
        >
          More &gt;
        </button>
      </div>
    </div>
  );
}

function MoreOptionsPanel({
  label,
  options,
  selectedValue,
  allValue,
  allLabel,
  onClose,
  onSelect,
}) {
  const [optionSearch, setOptionSearch] = useState("");
  const closeButtonRef = useRef(null);
  const titleId = `more-${label.toLowerCase().replace(/\s+/g, "-")}-title`;

  useEffect(() => {
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  const filteredOptions = useMemo(() => {
    const keyword = optionSearch.trim().toLowerCase();
    const alphabeticOptions = sortLabels(options.filter((option) => option !== allValue));
    const selectedFirst =
      selectedValue !== allValue && alphabeticOptions.includes(selectedValue)
        ? [selectedValue, ...alphabeticOptions.filter((option) => option !== selectedValue)]
        : alphabeticOptions;
    return selectedFirst.filter(
      (option) => option.toLowerCase().includes(keyword)
    );
  }, [allValue, optionSearch, options, selectedValue]);

  const selectAndClose = (value) => {
    onSelect(value);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/55 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[82vh] w-full max-w-xl flex-col rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h3 id={titleId} className="text-xl font-extrabold text-slate-900">
              More {label}
            </h3>
            <p className="truncate text-sm text-slate-500">
              Selected: {selectedValue === allValue ? allLabel : selectedValue}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={`Close ${label.toLowerCase()} options`}
            className="min-h-11 shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            Close
          </button>
        </div>

        <div className="border-b p-4 sm:p-5">
          <label htmlFor={`${titleId}-search`} className="mb-1 block text-sm font-bold text-slate-700">
            Search {label.toLowerCase()}
          </label>
          <input
            id={`${titleId}-search`}
            type="search"
            value={optionSearch}
            onChange={(event) => setOptionSearch(event.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
        </div>

        <div className="overflow-y-auto p-4 sm:p-5" aria-live="polite">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {selectedValue === allValue && (
              <SelectorChip active onClick={() => selectAndClose(allValue)}>
                {allLabel}
              </SelectorChip>
            )}
            {filteredOptions.map((option) => (
              <SelectorChip
                key={option}
                active={selectedValue === option}
                onClick={() => selectAndClose(option)}
              >
                {option}
              </SelectorChip>
            ))}
            {selectedValue !== allValue && (
              <SelectorChip active={false} onClick={() => selectAndClose(allValue)}>
                {allLabel}
              </SelectorChip>
            )}
          </div>

          {!filteredOptions.length && (
            <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">
              No {label.toLowerCase()} found
            </p>
          )}
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
  onBackToCategories,
  onClearAll,
}) {
  const [searchInput, setSearchInput] = useState(search);
  const [openPanel, setOpenPanel] = useState("");
  const searchTimerRef = useRef(null);
  const panelTriggerRef = useRef(null);
  const closePanel = useCallback(() => {
    setOpenPanel("");
    requestAnimationFrame(() => panelTriggerRef.current?.focus());
  }, []);

  const openMorePanel = (panelName, event) => {
    panelTriggerRef.current = event.currentTarget;
    setOpenPanel(panelName);
  };

  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    },
    []
  );

  const subCategoryOptions = uniqueLabels(
    subCategories.filter((option) => option !== ALL_SUB_CATEGORIES)
  );
  const brandOptions = uniqueLabels(
    brands.filter((option) => option !== ALL_BRANDS)
  );
  const seriesOptions = uniqueLabels(
    seriesList.filter((option) => option !== ALL_SERIES)
  );

  const updateSearch = (value) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setSearch(value), 250);
  };

  const clearBrowseSelections = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setSearchInput("");
    setSearch("");
    setSelectedSubCategory(ALL_SUB_CATEGORIES);
    setSelectedBrand(ALL_BRANDS);
    setSelectedSeries(ALL_SERIES);
    setOpenPanel("");
    onClearAll?.();
  };

  const hasSelection =
    searchInput.trim() ||
    selectedSubCategory !== ALL_SUB_CATEGORIES ||
    selectedBrand !== ALL_BRANDS ||
    selectedSeries !== ALL_SERIES;
  const contextTitle =
    selectedBrand !== ALL_BRANDS
      ? selectedBrand
      : browseTitle || selectedCategory || "Products";
  const contextHeading = /\bproducts$/i.test(contextTitle)
    ? contextTitle
    : `${contextTitle} Products`;

  const panelConfig = {
    subcategory: {
      label: "Subcategories",
      options: subCategoryOptions,
      selectedValue: selectedSubCategory,
      allValue: ALL_SUB_CATEGORIES,
      allLabel: "All",
      onSelect: setSelectedSubCategory,
    },
    brand: {
      label: "Brands",
      options: brandOptions,
      selectedValue: selectedBrand,
      allValue: ALL_BRANDS,
      allLabel: "All",
      onSelect: setSelectedBrand,
    },
    series: {
      label: "Product Families",
      options: seriesOptions,
      selectedValue: selectedSeries,
      allValue: ALL_SERIES,
      allLabel: "All Products",
      onSelect: setSelectedSeries,
    },
  };

  return (
    <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">{contextHeading}</h2>
          <p className="text-sm text-slate-500">
            {resultCount} {resultCount === 1 ? "product" : "products"} available
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onBackToCategories}
            aria-label="Go to home"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          >
            <span aria-hidden="true">⌂</span>
            Home Page
          </button>
          {hasSelection && (
            <button
              type="button"
              onClick={clearBrowseSelections}
              className="min-h-10 rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <CompactSelectorRow
          label="Subcategory"
          options={subCategoryOptions}
          selectedValue={selectedSubCategory}
          allValue={ALL_SUB_CATEGORIES}
          allLabel="All"
          onSelect={setSelectedSubCategory}
          onMore={(event) => openMorePanel("subcategory", event)}
        />
        <CompactSelectorRow
          label="Brand"
          options={brandOptions}
          selectedValue={selectedBrand}
          allValue={ALL_BRANDS}
          allLabel="All"
          onSelect={setSelectedBrand}
          onMore={(event) => openMorePanel("brand", event)}
        />
        <CompactSelectorRow
          label="Product Family"
          options={seriesOptions}
          selectedValue={selectedSeries}
          allValue={ALL_SERIES}
          allLabel="All Products"
          onSelect={setSelectedSeries}
          onMore={(event) => openMorePanel("series", event)}
        />
      </div>

      <label htmlFor="product-search" className="sr-only">
        Search products, brand or product code
      </label>
      <input
        id="product-search"
        type="search"
        value={searchInput}
        onChange={(event) => updateSearch(event.target.value)}
        placeholder="Search products, brand or product code"
        className="mt-3 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
      />

      {openPanel && panelConfig[openPanel] && (
        <MoreOptionsPanel
          {...panelConfig[openPanel]}
          onClose={closePanel}
        />
      )}
    </section>
  );
}
