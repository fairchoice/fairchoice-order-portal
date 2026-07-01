export default function ProductFilters({
  search,
  setSearch,
  categories,
  selectedCategory,
  setSelectedCategory,
  subCategories,
  selectedSubCategory,
  setSelectedSubCategory,
  brands,
  selectedBrand,
  setSelectedBrand,
  seriesList,
  selectedSeries,
  setSelectedSeries,
  showHomeLink = false,
  onHomeClick,
  showSearch = true,
  showCategoryFilter = true,
  showSubCategoryFilter = true,
  showBrandFilter = true,
  showSeriesFilter = true,
}) {
  return (
    <div className="mt-3 bg-white rounded-2xl p-3">
      {showSearch && (
          <h3 className="font-bold text-lg mb-2">
  {showSearch ? "Find Products" : "Browse Categories"}
</h3>
        )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {showHomeLink && (
          <button
            type="button"
            onClick={onHomeClick}
            className="border rounded-lg p-2 text-sm w-full font-bold text-blue-700 bg-blue-50"
          >
            Home
          </button>
        )}

        {showCategoryFilter && (
          <select
            className="border rounded-lg p-2 text-sm w-full"
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setSelectedSubCategory("All Sub Categories");
              setSelectedBrand("All Brands");
              setSelectedSeries("All Series");
            }}
          >
            {categories.map((cat) => (
              <option key={cat}>{cat}</option>
            ))}
          </select>
        )}

        {showSubCategoryFilter && (
          <select
            className="border rounded-lg p-2 text-sm w-full"
            value={selectedSubCategory}
            onChange={(e) => {
              setSelectedSubCategory(e.target.value);
              setSelectedBrand("All Brands");
              setSelectedSeries("All Series");
            }}
          >
            {subCategories.map((sub) => (
              <option key={sub}>{sub}</option>
            ))}
          </select>
        )}

        {showBrandFilter && (
          <select
            className="border rounded-lg p-2 text-sm w-full"
            value={selectedBrand}
            onChange={(e) => {
              setSelectedBrand(e.target.value);
              setSelectedSeries("All Series");
            }}
          >
            {brands.map((brand) => (
              <option key={brand}>{brand}</option>
            ))}
          </select>
        )}

        {showSeriesFilter && (
          <select
            className="border rounded-lg p-2 text-sm w-full"
            value={selectedSeries}
            onChange={(e) => setSelectedSeries(e.target.value)}
          >
            {seriesList.map((series) => (
              <option key={series}>{series}</option>
            ))}
          </select>
        )}

        {showSearch && (
          <input
            className="border rounded-lg p-2 text-sm w-full md:col-span-1"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}