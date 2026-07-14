import { useEffect, useMemo, useRef, useState } from "react";
import {
  getActiveStockLocations,
  saveStockTakeCounts,
} from "../../services/locationStock";

const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

function uniqueSorted(values) {
  return [...new Set(values.map(clean).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

function getProductName(product) {
  return clean(product.flavour) || clean(product.name) || "Unnamed product";
}

function getSearchText(product) {
  return [
    product.name,
    product.flavour,
    product.productCode,
    product.product_code,
    product.barcode,
    product.ean,
    product.brand,
    product.series,
    product.subCategory,
  ]
    .map(lower)
    .join(" ");
}

export default function StockTaking({ products = [], fetchProducts }) {
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState({});
  const [confirmed, setConfirmed] = useState({});
  const [saving, setSaving] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [message, setMessage] = useState("");
  const inputRefs = useRef({});

  useEffect(() => {
    let active = true;

    async function loadLocations() {
      try {
        setLoadingLocations(true);
        const rows = await getActiveStockLocations();
        if (!active) return;
        setLocations(rows);
        setLocationId((current) => current || String(rows[0]?.id || ""));
      } catch (error) {
        console.error("Stock locations loading error:", error);
        if (active) setMessage(`Unable to load locations: ${error.message || error}`);
      } finally {
        if (active) setLoadingLocations(false);
      }
    }

    loadLocations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setCounts({});
    setConfirmed({});
    setMessage("");
  }, [locationId]);

  const activeProducts = useMemo(
    () => products.filter((product) => product.active !== false),
    [products]
  );

  const subCategories = useMemo(
    () => uniqueSorted(activeProducts.map((product) => product.subCategory)),
    [activeProducts]
  );

  const brandSource = useMemo(
    () =>
      activeProducts.filter(
        (product) => !subCategory || clean(product.subCategory) === subCategory
      ),
    [activeProducts, subCategory]
  );

  const brands = useMemo(
    () => uniqueSorted(brandSource.map((product) => product.brand)),
    [brandSource]
  );

  const seriesSource = useMemo(
    () =>
      brandSource.filter((product) => !brand || clean(product.brand) === brand),
    [brandSource, brand]
  );

  const seriesOptions = useMemo(
    () => uniqueSorted(seriesSource.map((product) => product.series)),
    [seriesSource]
  );

  useEffect(() => {
    if (brand && !brands.includes(brand)) setBrand("");
  }, [brand, brands]);

  useEffect(() => {
    if (series && !seriesOptions.includes(series)) setSeries("");
  }, [series, seriesOptions]);

  const visibleProducts = useMemo(() => {
    const query = lower(search);

    return activeProducts
      .filter((product) => !subCategory || clean(product.subCategory) === subCategory)
      .filter((product) => !brand || clean(product.brand) === brand)
      .filter((product) => !series || clean(product.series) === series)
      .filter((product) => !query || getSearchText(product).includes(query))
      .sort((a, b) => {
        const keysA = [a.subCategory, a.brand, a.series, a.name, a.flavour];
        const keysB = [b.subCategory, b.brand, b.series, b.name, b.flavour];
        return keysA
          .map(clean)
          .join("|")
          .localeCompare(keysB.map(clean).join("|"), undefined, {
            numeric: true,
            sensitivity: "base",
          });
      });
  }, [activeProducts, subCategory, brand, series, search]);

  const selectedLocation = locations.find(
    (location) => String(location.id) === String(locationId)
  );

  const getSystemQty = (product) => {
    const row = product.locationStocks?.[locationId];
    if (row) return Number(row.qty || 0);

    const sameLocation = Object.values(product.locationStocks || {}).find(
      (stock) => String(stock.locationId) === String(locationId)
    );
    return sameLocation ? Number(sameLocation.qty || 0) : 0;
  };

  const visibleProductIds = useMemo(
    () => new Set(visibleProducts.map((product) => String(product.id))),
    [visibleProducts]
  );

  const confirmedCount = visibleProducts.filter(
    (product) => confirmed[product.id]
  ).length;
  const remainingCount = Math.max(0, visibleProducts.length - confirmedCount);
  const unsavedCount = visibleProducts.filter(
    (product) => confirmed[product.id]
  ).length;

  const groupLimit = series ? 60 : 99;
  const groupLabel = [subCategory, brand, series].filter(Boolean).join(" / ");

  const updateCount = (productId, value) => {
    const numericOnly = String(value).replace(/[^0-9]/g, "");
    setCounts((current) => ({ ...current, [productId]: numericOnly }));
    setConfirmed((current) => ({ ...current, [productId]: false }));
    setMessage("");
  };

  const confirmRow = (product, index) => {
    const value = counts[product.id];
    if (value === undefined || value === "") {
      inputRefs.current[product.id]?.focus();
      return;
    }

    setConfirmed((current) => ({ ...current, [product.id]: true }));
    const nextProduct = visibleProducts[index + 1];
    if (nextProduct) {
      requestAnimationFrame(() => inputRefs.current[nextProduct.id]?.focus());
    }
  };

  const handleKeyDown = (event, product, index) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmRow(product, index);
  };

  const saveAll = async () => {
    if (!locationId) {
      setMessage("Select a stock location first.");
      return;
    }

    if (!subCategory && !brand) {
      setMessage("Select a Subcategory or Brand before saving.");
      return;
    }

    if (seriesOptions.length > 0 && !series) {
      setMessage("Select a Series and save one series at a time.");
      return;
    }

    if (visibleProducts.length > groupLimit) {
      setMessage(
        `This shelf group has ${visibleProducts.length} products. Narrow the filters to ${groupLimit} or fewer before saving.`
      );
      return;
    }

    const rows = Object.entries(confirmed)
      .filter(([productId, isConfirmed]) =>
        isConfirmed && visibleProductIds.has(String(productId))
      )
      .map(([productId]) => ({
        productId,
        qty: Number(counts[productId]),
      }))
      .filter((row) => Number.isFinite(row.qty) && row.qty >= 0);

    if (!rows.length) {
      setMessage("Enter a count and press ✓ before saving.");
      return;
    }

    if (rows.length > groupLimit) {
      setMessage(`Save no more than ${groupLimit} products at once.`);
      return;
    }

    const locationName = selectedLocation?.location_name || "selected location";
    const approved = window.confirm(
      `Update ${rows.length} product${rows.length === 1 ? "" : "s"} in ${locationName}?\n\nShelf group: ${groupLabel || "Current filters"}\nOnly the currently visible confirmed rows will be updated.`
    );
    if (!approved) return;

    try {
      setSaving(true);
      setMessage("");
      await saveStockTakeCounts(locationId, rows);
      if (typeof fetchProducts === "function") await fetchProducts();
      setCounts({});
      setConfirmed({});
      setMessage(`Saved ${rows.length} stock count${rows.length === 1 ? "" : "s"}.`);
    } catch (error) {
      console.error("Stock take save error:", error);
      setMessage(`Save failed: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stock-take-page">
      <style>{styles}</style>

      <div className="stock-take-head">
        <div>
          <h2>Stock Taking</h2>
          <p>Count shelf stock, confirm each row, then save all.</p>
        </div>
        <div className="stock-take-location-name">
          {selectedLocation?.location_name || "Select location"}
        </div>
      </div>

      <div className="stock-take-toolbar">
        <select
          aria-label="Location"
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
          disabled={loadingLocations}
        >
          <option value="">Location</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.location_name}
            </option>
          ))}
        </select>

        <select
          aria-label="Subcategory"
          value={subCategory}
          onChange={(event) => {
            setSubCategory(event.target.value);
            setBrand("");
            setSeries("");
          }}
        >
          <option value="">Sub</option>
          {subCategories.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>

        <select
          aria-label="Brand"
          value={brand}
          onChange={(event) => {
            setBrand(event.target.value);
            setSeries("");
          }}
        >
          <option value="">Brand</option>
          {brands.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>

        <select
          aria-label="Series"
          value={series}
          onChange={(event) => setSeries(event.target.value)}
        >
          <option value="">Series</option>
          {seriesOptions.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>

        <input
          className="stock-take-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search / Scan"
          inputMode="search"
          autoComplete="off"
        />
      </div>

      <div className="stock-take-summary">
        <span>{visibleProducts.length}/{groupLimit} Products</span>
        <span>{confirmedCount} {"\u2713"}</span>
        <span>{remainingCount} Left</span>
        {unsavedCount > 0 && <span>{unsavedCount} Unsaved</span>}
      </div>

      <div className="stock-take-table" role="table" aria-label="Stock count products">
        <div className="stock-take-row stock-take-labels" role="row">
          <span>Description</span>
          <span>Sys</span>
          <span>Count</span>
          <span aria-hidden="true">{"\u2713"}</span>
        </div>

        {!locationId && (
          <div className="stock-take-empty">Select a location to begin.</div>
        )}

        {locationId && visibleProducts.length === 0 && (
          <div className="stock-take-empty">No products match these filters.</div>
        )}

        {locationId && visibleProducts.map((product, index) => {
          const isConfirmed = Boolean(confirmed[product.id]);
          const countValue = counts[product.id] ?? "";
          const systemQty = getSystemQty(product);

          return (
            <div
              className={`stock-take-row ${isConfirmed ? "is-confirmed" : ""}`}
              role="row"
              key={product.id}
            >
              <div className="stock-take-product" title={getProductName(product)}>
                <span className="stock-take-product-name">{getProductName(product)}</span>
              </div>

              <strong className="stock-take-system">{systemQty}</strong>

              <input
                ref={(element) => {
                  inputRefs.current[product.id] = element;
                }}
                aria-label={`Count for ${getProductName(product)}`}
                className="stock-take-count"
                value={countValue}
                onChange={(event) => updateCount(product.id, event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, product, index)}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="0"
                autoComplete="off"
              />

              <button
                type="button"
                className="stock-take-tick"
                onClick={() => confirmRow(product, index)}
                aria-label={`Confirm ${getProductName(product)}`}
              >
                {"\u2713"}
              </button>
            </div>
          );
        })}
      </div>

      <div className="stock-take-footer">
        <div className={`stock-take-message ${message.startsWith("Save failed") ? "is-error" : ""}`}>
          {message}
        </div>
        <button
          type="button"
          className="stock-take-save"
          onClick={saveAll}
          disabled={saving || unsavedCount === 0}
        >
          {saving ? "Saving..." : `Save All${unsavedCount ? ` (${unsavedCount})` : ""}`}
        </button>
      </div>
    </section>
  );
}

const styles = `
.stock-take-page{max-width:980px;margin:0 auto;padding:10px 10px 76px;color:#0f172a}
.stock-take-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
.stock-take-head h2{font-size:20px;line-height:1.1;margin:0;font-weight:900}
.stock-take-head p{font-size:11px;color:#64748b;margin:3px 0 0}
.stock-take-location-name{font-size:11px;font-weight:800;background:#dbeafe;color:#1e3a8a;border-radius:999px;padding:5px 8px;white-space:nowrap}
.stock-take-toolbar{position:sticky;top:0;z-index:12;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:6px;background:#fff;border:1px solid #cbd5e1;border-radius:10px 10px 0 0}
.stock-take-toolbar select,.stock-take-toolbar input{min-width:0;height:32px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;padding:0 5px;font-size:11px;font-weight:700;color:#1e293b}
.stock-take-search{grid-column:1/-1}
.stock-take-summary{display:flex;align-items:center;gap:10px;min-height:28px;padding:4px 8px;background:#eff6ff;border-left:1px solid #cbd5e1;border-right:1px solid #cbd5e1;font-size:11px;font-weight:900;color:#1e3a8a}
.stock-take-table{border:1px solid #cbd5e1;border-radius:0 0 10px 10px;overflow:hidden;background:#fff}
.stock-take-row{display:grid;grid-template-columns:minmax(0,1fr) 40px 54px 30px;align-items:center;gap:4px;min-height:35px;padding:2px 5px;border-bottom:1px solid #e2e8f0;font-size:12px}
.stock-take-row:last-child{border-bottom:0}
.stock-take-labels{min-height:25px;background:#f8fafc;color:#64748b;font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.04em}
.stock-take-labels span:not(:first-child){text-align:center}
.stock-take-product{min-width:0;display:flex;align-items:baseline;gap:5px;overflow:hidden}
.stock-take-product-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750}
.stock-take-system{text-align:center;font-size:12px}
.stock-take-count{width:100%;height:28px;border:1px solid #94a3b8;border-radius:5px;text-align:center;font-size:13px;font-weight:900;padding:0 2px;background:#fff}
.stock-take-count:focus{outline:2px solid #2563eb;outline-offset:0;border-color:#2563eb}
.stock-take-tick{width:28px;height:28px;border:0;border-radius:5px;background:#e2e8f0;color:#334155;font-size:15px;font-weight:900;cursor:pointer}
.stock-take-tick:active{transform:scale(.96)}
.stock-take-row.is-confirmed{background:#f0fdf4}
.stock-take-row.is-confirmed .stock-take-tick{background:#16a34a;color:#fff}
.stock-take-row.is-confirmed .stock-take-count{border-color:#86efac;background:#f0fdf4}
.stock-take-empty{padding:28px 10px;text-align:center;color:#64748b;font-size:12px;font-weight:700}
.stock-take-footer{position:sticky;bottom:0;z-index:14;display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:8px;padding:7px;background:rgba(255,255,255,.96);border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 -4px 18px rgba(15,23,42,.08)}
.stock-take-message{min-width:0;flex:1;font-size:11px;font-weight:800;color:#166534}
.stock-take-message.is-error{color:#b91c1c}
.stock-take-save{height:36px;border:0;border-radius:7px;background:#1d4ed8;color:#fff;padding:0 18px;font-size:12px;font-weight:900;white-space:nowrap;cursor:pointer}
.stock-take-save:disabled{cursor:not-allowed;opacity:.45}
@media(min-width:700px){.stock-take-page{padding:16px 16px 84px}.stock-take-toolbar{grid-template-columns:repeat(4,minmax(110px,1fr)) minmax(220px,2fr)}.stock-take-search{grid-column:auto}.stock-take-row{grid-template-columns:minmax(0,1fr) 60px 76px 36px;min-height:38px;font-size:13px;padding:3px 8px}}
@media(max-width:380px){.stock-take-page{padding-left:4px;padding-right:4px}.stock-take-row{grid-template-columns:minmax(0,1fr) 34px 48px 28px;gap:2px;padding-left:3px;padding-right:3px;font-size:11px}.stock-take-toolbar{gap:3px;padding:4px}.stock-take-toolbar select,.stock-take-toolbar input{font-size:10px;padding:0 3px}.stock-take-summary{gap:7px;padding-left:5px;padding-right:5px}.stock-take-product-name{font-weight:700}}
`;
