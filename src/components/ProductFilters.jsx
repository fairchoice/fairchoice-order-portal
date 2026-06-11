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
}) {
  return (
    <div className="mt-3 bg-white rounded-2xl p-3">
      <h3 className="font-bold text-lg mb-2">Find Products</h3>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
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

        <select
          className="border rounded-lg p-2 text-sm w-full"
          value={selectedSeries}
          onChange={(e) => setSelectedSeries(e.target.value)}
        >
          {seriesList.map((series) => (
            <option key={series}>{series}</option>
          ))}
        </select>

        <input
          className="border rounded-lg p-2 text-sm w-full"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </div>
  );
}