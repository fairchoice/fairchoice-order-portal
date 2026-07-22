export default function CustomerSelector({
  companyName,
  setCompanyName,
  priceMode,
  setPriceMode,
}) {
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h2 className="text-lg md:text-xl font-bold">Customer</h2>

        <div className="bg-white border rounded-xl p-1 flex gap-1 w-fit">
          <button
            onClick={() => setPriceMode("cash")}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              priceMode === "cash" ? "bg-green-600 text-white" : "text-slate-700"
            }`}
          >
            Cash
          </button>

          <button
            onClick={() => setPriceMode("vat")}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
              priceMode === "vat" ? "bg-blue-600 text-white" : "text-slate-700"
            }`}
          >
            Ex.VAT
          </button>
        </div>
      </div>

      <input
        className="border rounded-lg p-2 text-sm w-full"
        placeholder="Enter company name"
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
      />
    </>
  );
}
