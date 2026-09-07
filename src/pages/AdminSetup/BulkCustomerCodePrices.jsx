import { useEffect, useMemo, useState } from "react";
import {
  buildProductPriceCodeMap,
  deleteProductPriceCodePrice,
  getCustomerPriceCodes,
  getProductPriceCodeRows,
  makePriceCodeMode,
  upsertProductPriceCodePrice,
} from "../../services/priceCodes";
import { getProductPriceForMode } from "../../utils/pricing";

const PAGE_SIZE = 40;

const money = (value) => `£${Number(value || 0).toFixed(2)}`;

export default function BulkCustomerCodePrices({ products = [], pricingSettings = {}, fetchProducts }) {
  const [codes, setCodes] = useState([]);
  const [selectedCodeId, setSelectedCodeId] = useState("");
  const [previewBaseMode, setPreviewBaseMode] = useState("inc vat");
  const [priceMap, setPriceMap] = useState({});
  const [drafts, setDrafts] = useState({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [brand, setBrand] = useState("All");
  const [series, setSeries] = useState("All");
  const [seriesExactPrice, setSeriesExactPrice] = useState("");
  const [seriesSaving, setSeriesSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");

  const loadData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const activeCodes = await getCustomerPriceCodes();
      setCodes(activeCodes || []);
      setSelectedCodeId((current) => current || activeCodes?.[0]?.id || "");

      const ids = products.map((product) => product.id).filter(Boolean);
      const rows = ids.length ? await getProductPriceCodeRows(ids) : [];
      setPriceMap(buildProductPriceCodeMap(rows));
    } catch (error) {
      setMessage(error?.message || "Could not load customer code prices.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [products.length]);

  useEffect(() => {
    setPage(1);
    setDrafts({});
    setMessage("");
  }, [selectedCodeId, previewBaseMode, search, category, brand, series]);

  const selectedCode = useMemo(
    () => codes.find((code) => String(code.id) === String(selectedCodeId)) || null,
    [codes, selectedCodeId]
  );

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category || product.main_category).filter(Boolean))].sort(),
    [products]
  );

  const brands = useMemo(
    () => [...new Set(products.map((product) => product.brand).filter(Boolean))].sort(),
    [products]
  );

  const seriesOptions = useMemo(
    () => [...new Set(products.map((product) => product.series || product.product_series).filter(Boolean))].sort(),
    [products]
  );

  const filteredProducts = useMemo(() => {
    const term = String(search || "").trim().toLowerCase();
    return products.filter((product) => {
      const productCategory = product.category || product.main_category || "";
      const productBrand = product.brand || "";
      const productSeries = product.series || product.product_series || "";
      if (category !== "All" && productCategory !== category) return false;
      if (brand !== "All" && productBrand !== brand) return false;
      if (series !== "All" && productSeries !== series) return false;
      if (!term) return true;
      return [product.productCode, product.product_code, product.name, product.product_name, productBrand]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [products, search, category, brand, series]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleProducts = filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const getExact = (product) => Number(priceMap?.[product.id]?.[selectedCodeId] || 0);

  const getCalculatedFallback = (product) => {
    if (!selectedCodeId) return 0;
    const currentMap = product.priceCodePrices || product.price_code_prices || {};
    const withoutSelectedCode = { ...currentMap };
    delete withoutSelectedCode[selectedCodeId];
    const previewProduct = {
      ...product,
      priceCodePrices: withoutSelectedCode,
      price_code_prices: withoutSelectedCode,
    };
    return getProductPriceForMode(
      previewProduct,
      makePriceCodeMode(selectedCodeId, previewBaseMode),
      "",
      { ...pricingSettings, price_codes: codes }
    );
  };

  const saveExact = async (product) => {
    if (!selectedCodeId) return;
    const draftValue = Object.prototype.hasOwnProperty.call(drafts, product.id)
      ? drafts[product.id]
      : getExact(product) || "";
    const numeric = Number(draftValue || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setMessage("Enter a valid exact price greater than £0.00, or use Clear Override.");
      return;
    }

    setSavingId(product.id);
    setMessage("");
    try {
      await upsertProductPriceCodePrice(product.id, selectedCodeId, numeric);
      setPriceMap((old) => ({
        ...old,
        [product.id]: { ...(old[product.id] || {}), [selectedCodeId]: numeric },
      }));
      setDrafts((old) => ({ ...old, [product.id]: numeric.toFixed(2) }));
      setMessage(`${product.name || product.product_name || "Product"} saved at ${money(numeric)}.`);
      if (typeof fetchProducts === "function") void fetchProducts();
    } catch (error) {
      setMessage(error?.message || "Could not save exact code price.");
    } finally {
      setSavingId("");
    }
  };


  const applyPriceToSeries = async () => {
    if (!selectedCodeId || series === "All") { setMessage("Select a customer price code and a Series first."); return; }
    const numeric = Number(seriesExactPrice || 0);
    if (!Number.isFinite(numeric) || numeric <= 0) { setMessage("Enter a valid Series exact price greater than £0.00."); return; }
    const targets = products.filter((product) => {
      const productSeries = product.series || product.product_series || "";
      const productCategory = product.category || product.main_category || "";
      const productBrand = product.brand || "";
      return product.id && productSeries === series && (category === "All" || productCategory === category) && (brand === "All" || productBrand === brand);
    });
    if (!targets.length) { setMessage("No products found for the selected Series."); return; }
    if (!window.confirm(`Apply ${money(numeric)} to ${targets.length} products in ${series} for ${selectedCode?.code || "this code"}?`)) return;
    setSeriesSaving(true); setMessage("");
    try {
      for (let i = 0; i < targets.length; i += 20) await Promise.all(targets.slice(i, i + 20).map((product) => upsertProductPriceCodePrice(product.id, selectedCodeId, numeric)));
      setPriceMap((old) => { const next = { ...old }; targets.forEach((product) => { next[product.id] = { ...(next[product.id] || {}), [selectedCodeId]: numeric }; }); return next; });
      setDrafts((old) => { const next = { ...old }; targets.forEach((product) => { next[product.id] = numeric.toFixed(2); }); return next; });
      setMessage(`${money(numeric)} applied to ${targets.length} products in ${series}.`);
      if (typeof fetchProducts === "function") void fetchProducts();
    } catch (error) { setMessage(error?.message || "Could not apply the Series price."); } finally { setSeriesSaving(false); }
  };

  const clearExact = async (product) => {
    if (!selectedCodeId) return;
    setSavingId(product.id);
    setMessage("");
    try {
      await deleteProductPriceCodePrice(product.id, selectedCodeId);
      setPriceMap((old) => {
        const next = { ...old, [product.id]: { ...(old[product.id] || {}) } };
        delete next[product.id][selectedCodeId];
        return next;
      });
      setDrafts((old) => ({ ...old, [product.id]: "" }));
      setMessage(`${product.name || product.product_name || "Product"} returned to percentage calculation.`);
      if (typeof fetchProducts === "function") void fetchProducts();
    } catch (error) {
      setMessage(error?.message || "Could not clear exact code price.");
    } finally {
      setSavingId("");
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 24 }}>Bulk Customer Code Prices</h2>
        <p style={{ margin: "5px 0 0", color: "#5b6b7f" }}>
          Exact Product + Customer Code price is used first. Blank exact price uses the code percentage calculation.
        </p>
      </div>

      <section style={cardStyle}>
        <div style={toolbarStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Customer Price Code</span>
            <select value={selectedCodeId} onChange={(e) => setSelectedCodeId(e.target.value)} style={inputStyle}>
              <option value="">Select code</option>
              {codes.map((code) => <option key={code.id} value={code.id}>{code.code} ({Number(code.discount_percent || 0)}%)</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Preview Price Mode</span>
            <select value={previewBaseMode} onChange={(e) => setPreviewBaseMode(e.target.value)} style={inputStyle}>
              <option value="inc vat">Inc.VAT</option>
              <option value="ex vat">Ex.VAT</option>
            </select>
          </label>
          <label style={{ ...fieldStyle, minWidth: 260, flex: "2 1 260px" }}>
            <span style={labelStyle}>Search Product</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Product name or code" style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              <option>All</option>{categories.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Brand</span>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle}>
              <option>All</option>{brands.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>Series</span>
            <select value={series} onChange={(e) => setSeries(e.target.value)} style={inputStyle}>
              <option>All</option>{seriesOptions.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #dbe4ee", display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12 }}>
          <label style={{ ...fieldStyle, maxWidth: 220 }}><span style={labelStyle}>Series Exact Price</span><input type="number" min="0" step="0.01" value={seriesExactPrice} onChange={(e) => setSeriesExactPrice(e.target.value)} placeholder="Exact price" style={inputStyle} /></label>
          <button type="button" onClick={applyPriceToSeries} disabled={!selectedCodeId || series === "All" || seriesSaving} style={{ ...saveButtonStyle, minHeight: 40, padding: "8px 18px" }}>{seriesSaving ? "Applying..." : "Apply to Series"}</button>
          <div style={{ color: "#64748b", fontSize: 13, paddingBottom: 10 }}>Applies the same exact price to every product in the selected Series. Category/Brand filters are respected.</div>
        </div>
      </section>

      {message && <div style={{ ...cardStyle, padding: 12, color: message.toLowerCase().includes("could not") ? "#b91c1c" : "#075985" }}>{message}</div>}

      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 930 }}>
            <thead>
              <tr style={{ background: "#edf3f9", textAlign: "left" }}>
                <th style={thStyle}>Product Code</th>
                <th style={thStyle}>Product</th>
                <th style={thStyle}>VAT Selling Price</th>
                <th style={thStyle}>Code %</th>
                <th style={thStyle}>Calculated Price</th>
                <th style={thStyle}>Exact Override</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleProducts.length === 0 && (
                <tr><td colSpan="8" style={{ padding: 28, textAlign: "center", color: "#64748b" }}>No products found.</td></tr>
              )}
              {loading && <tr><td colSpan="8" style={{ padding: 28, textAlign: "center" }}>Loading prices...</td></tr>}
              {!loading && visibleProducts.map((product) => {
                const exact = getExact(product);
                const calculated = selectedCodeId ? getCalculatedFallback(product) : 0;
                const draft = Object.prototype.hasOwnProperty.call(drafts, product.id) ? drafts[product.id] : (exact > 0 ? exact.toFixed(2) : "");
                return (
                  <tr key={product.id} style={{ borderTop: "1px solid #dbe4ee" }}>
                    <td style={tdStyle}>{product.productCode || product.product_code || "-"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{product.name || product.product_name || "Unnamed Product"}</td>
                    <td style={tdStyle}>{money(product.vatPrice ?? product.vat_price)}</td>
                    <td style={tdStyle}>{selectedCode ? `${Number(selectedCode.discount_percent || 0)}%` : "-"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{selectedCodeId ? money(calculated) : "-"}</td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft}
                        onChange={(e) => setDrafts((old) => ({ ...old, [product.id]: e.target.value }))}
                        placeholder="Blank = calculated"
                        style={{ ...inputStyle, minWidth: 150 }}
                        disabled={!selectedCodeId}
                      />
                    </td>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 800, color: exact > 0 ? "#166534" : "#475569" }}>
                        {exact > 0 ? "Exact Override" : "Calculated"}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 7 }}>
                        <button type="button" onClick={() => saveExact(product)} disabled={!selectedCodeId || savingId === product.id} style={saveButtonStyle}>
                          {savingId === product.id ? "Saving..." : "Save"}
                        </button>
                        {exact > 0 && <button type="button" onClick={() => clearExact(product)} disabled={savingId === product.id} style={clearButtonStyle}>Clear</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 14, borderTop: "1px solid #dbe4ee" }}>
          <div style={{ color: "#64748b", fontSize: 13 }}>{filteredProducts.length} products · Page {currentPage} of {pageCount}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} style={pagerButtonStyle}>Previous</button>
            <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} style={pagerButtonStyle}>Next</button>
          </div>
        </div>
      </section>
    </div>
  );
}

const cardStyle = { background: "#fff", border: "1px solid #b9c7d8", borderRadius: 14, padding: 16 };
const toolbarStyle = { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end" };
const fieldStyle = { display: "grid", gap: 6, minWidth: 175, flex: "1 1 175px" };
const labelStyle = { fontSize: 12, fontWeight: 800, color: "#16324f" };
const inputStyle = { width: "100%", minHeight: 40, border: "1px solid #b9c7d8", borderRadius: 9, padding: "8px 10px", background: "#fff", boxSizing: "border-box" };
const thStyle = { padding: "11px 10px", fontSize: 12, color: "#17324e", whiteSpace: "nowrap" };
const tdStyle = { padding: "10px", fontSize: 13, verticalAlign: "middle" };
const saveButtonStyle = { border: 0, borderRadius: 8, background: "#155eef", color: "white", fontWeight: 800, padding: "8px 13px", cursor: "pointer" };
const clearButtonStyle = { border: "1px solid #d0d9e5", borderRadius: 8, background: "white", color: "#9f1239", fontWeight: 800, padding: "8px 11px", cursor: "pointer" };
const pagerButtonStyle = { border: "1px solid #c9d5e3", borderRadius: 8, background: "#fff", padding: "8px 12px", fontWeight: 700 };
