import React, { useMemo, useState } from "react";

import { supabase } from "../../supabaseClient";
import { getProductPriceForMode, getProductPricePreview, getVatRate, isVatPriceMode, roundMoney } from "../../utils/pricing";
import BulkToDatabase from "./PriceManagement/BulkToDatabase";
import BulkDatabaseToOrders from "./PriceManagement/BulkDatabaseToOrders";
import SingleDatabaseToOrder from "./PriceManagement/SingleDatabaseToOrder";

const PRICE_PAGE_SIZE = 20;

export default function PriceManagement({
  products = [],
  fetchProducts,
  pricingSettings = {},
}) {
  const safeProducts = Array.isArray(products) ? products : [];

  const [activeTab, setActiveTab] = useState("bulkPrice");

  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkNewPrice, setBulkNewPrice] = useState("");
  const [bulkCostPrice, setBulkCostPrice] = useState("");

  const [singleSearch, setSingleSearch] = useState("");
  const [singleProductId, setSingleProductId] = useState("");
  const [singleNewPrice, setSingleNewPrice] = useState("");
  const [singleCostPrice, setSingleCostPrice] = useState("");
  const [singleViewProduct, setSingleViewProduct] = useState(null);

  const [orderBrand, setOrderBrand] = useState("");
  const [orderSeries, setOrderSeries] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderPage, setOrderPage] = useState(1);
  const [orderSelectedIds, setOrderSelectedIds] = useState([]);
  const [bulkOrderPreviewRows, setBulkOrderPreviewRows] = useState([]);
  const [bulkOrderLoading, setBulkOrderLoading] = useState(false);

  const [singleOrderSearch, setSingleOrderSearch] = useState("");
  const [singleOrderProductId, setSingleOrderProductId] = useState("");
  const [singleOrderPreviewRows, setSingleOrderPreviewRows] = useState([]);
  const [singleOrderLoading, setSingleOrderLoading] = useState(false);

  const brands = useMemo(() => {
    return [...new Set(safeProducts.map((p) => p.brand).filter(Boolean))].sort();
  }, [safeProducts]);

  const seriesList = useMemo(() => {
    return [...new Set(safeProducts.map((p) => p.series).filter(Boolean))].sort();
  }, [safeProducts]);

  function getProductId(product) {
    return product.id || product.product_id || product.code || product.product_code;
  }

  function productName(product) {
    return product.product_name || product.name || "";
  }

  function productCode(product) {
    return product.code || product.product_code || "";
  }

  function vatPrice(product) {
    return Number(product.vat_price || 0);
  }

  function costPrice(product) {
    return Number(product.cost_price || 0);
  }

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return safeProducts.filter((p) => {
      const matchBrand = !brand || String(p.brand || "") === brand;
      const matchSeries = !series || String(p.series || "") === series;

      const matchSearch =
        !q ||
        String(productName(p)).toLowerCase().includes(q) ||
        String(productCode(p)).toLowerCase().includes(q);

      return matchBrand && matchSeries && matchSearch;
    });
  }, [safeProducts, brand, series, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PRICE_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pagedProducts = filteredProducts.slice(
    (safePage - 1) * PRICE_PAGE_SIZE,
    safePage * PRICE_PAGE_SIZE
  );

  const bulkPreviewProduct = {
    vat_price: Number(bulkNewPrice || 0),
    cost_price: Number(bulkCostPrice || 0),
    vat_type: "20",
  };

  const bulkPreview = getProductPricePreview(
    bulkPreviewProduct,
    "",
    pricingSettings
  );

  const singleProducts = useMemo(() => {
    const q = singleSearch.trim().toLowerCase();

    return safeProducts.filter((p) => {
      return (
        !q ||
        String(productName(p)).toLowerCase().includes(q) ||
        String(productCode(p)).toLowerCase().includes(q)
      );
    });
  }, [safeProducts, singleSearch]);

  const selectedSingleProduct = safeProducts.find(
    (p) => String(getProductId(p)) === String(singleProductId)
  );

  const selectedSingleCurrent = selectedSingleProduct
    ? getProductPricePreview(selectedSingleProduct, "", pricingSettings)
    : null;

  const singlePreviewProduct = {
    ...(selectedSingleProduct || {}),
    vat_price:
      singleNewPrice !== ""
        ? Number(singleNewPrice)
        : Number(selectedSingleProduct?.vat_price || 0),
    cost_price:
      singleCostPrice !== ""
        ? Number(singleCostPrice)
        : Number(selectedSingleProduct?.cost_price || 0),
  };

  const singlePreview = getProductPricePreview(
    singlePreviewProduct,
    "",
    pricingSettings
  );

  const filteredOrderProducts = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();

    return safeProducts.filter((p) => {
      const matchBrand = !orderBrand || String(p.brand || "") === orderBrand;
      const matchSeries = !orderSeries || String(p.series || "") === orderSeries;

      const matchSearch =
        !q ||
        String(productName(p)).toLowerCase().includes(q) ||
        String(productCode(p)).toLowerCase().includes(q);

      return matchBrand && matchSeries && matchSearch;
    });
  }, [safeProducts, orderBrand, orderSeries, orderSearch]);

  const orderTotalPages = Math.max(
    1,
    Math.ceil(filteredOrderProducts.length / PRICE_PAGE_SIZE)
  );
  const orderSafePage = Math.min(orderPage, orderTotalPages);

  const pagedOrderProducts = filteredOrderProducts.slice(
    (orderSafePage - 1) * PRICE_PAGE_SIZE,
    orderSafePage * PRICE_PAGE_SIZE
  );

  const singleOrderProducts = useMemo(() => {
    const q = singleOrderSearch.trim().toLowerCase();

    return safeProducts.filter((p) => {
      return (
        !q ||
        String(productName(p)).toLowerCase().includes(q) ||
        String(productCode(p)).toLowerCase().includes(q)
      );
    });
  }, [safeProducts, singleOrderSearch]);

  const selectedSingleOrderProduct = safeProducts.find(
    (p) => String(getProductId(p)) === String(singleOrderProductId)
  );

  function toggleProduct(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function toggleAllOnPage() {
    const pageIds = pagedProducts.map(getProductId);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));

    if (allSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
    }
  }

  function toggleOrderProduct(id) {
    setOrderSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setBulkOrderPreviewRows([]);
  }

  function toggleAllOrderProductsOnPage() {
    const pageIds = pagedOrderProducts.map(getProductId);
    const allSelected = pageIds.every((id) => orderSelectedIds.includes(id));

    if (allSelected) {
      setOrderSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setOrderSelectedIds((prev) => [...new Set([...prev, ...pageIds])]);
    }
    setBulkOrderPreviewRows([]);
  }

  async function refreshProducts() {
    if (typeof fetchProducts === "function") {
      await fetchProducts();
    }
  }

  async function handleBulkUpdate() {
    if (!selectedIds.length) {
      alert("Please select products first.");
      return;
    }

    if (!bulkNewPrice && !bulkCostPrice) {
      alert("Enter new price or cost price.");
      return;
    }

    const updateData = {};

    if (bulkNewPrice !== "") {
      updateData.vat_price = Number(bulkNewPrice);
    }

    if (bulkCostPrice !== "") {
      updateData.cost_price = Number(bulkCostPrice);
    }

    const { error } = await supabase
      .from("products")
      .update(updateData)
      .in("id", selectedIds);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Bulk price updated in database.");
    resetBulkEdit();
    await refreshProducts();
  }

  function getOrderItemQty(item = {}) {
    return Number(item.picked_qty ?? item.qty ?? item.quantity ?? 0);
  }

  async function loadFreshPricingSettings() {
    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      console.warn("Could not load latest pricing settings for order price refresh:", error.message);
      return pricingSettings;
    }

    return data || pricingSettings;
  }

  function buildOrderItemPricingUpdate(product, order, item, activePricingSettings = pricingSettings) {
    const priceMode = order?.price_mode || order?.priceMode || "vat";
    const country = order?.customer_country || order?.country || "";
    const qty = getOrderItemQty(item);
    const newPrice = getProductPriceForMode(product, priceMode, country, activePricingSettings);
    const lineTotal = roundMoney(qty * newPrice);
    const vatRate = getVatRate(product?.vat_type ?? product?.vatType);
    const grossTotal = isVatPriceMode(priceMode)
      ? roundMoney(lineTotal * (1 + vatRate / 100))
      : lineTotal;

    return {
      price: newPrice,
      line_total: lineTotal,
      net_total: lineTotal,
      gross_total: grossTotal,
    };
  }

  async function loadReceivedOrderMatches(productIds) {
    const ids = [...new Set((productIds || []).filter(Boolean).map(String))];

    if (!ids.length) {
      return [];
    }

    const productMap = new Map(
      safeProducts.map((product) => [String(getProductId(product)), product])
    );
    const activePricingSettings = await loadFreshPricingSettings();

    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, price_mode, customer_country, order_items(*)")
      .eq("status", "Received");

    if (error) {
      throw error;
    }

    const rows = [];

    (data || []).forEach((order) => {
      (order.order_items || []).forEach((item) => {
        const productId = String(item.product_id || "");

        if (!ids.includes(productId)) {
          return;
        }

        const product = productMap.get(productId);

        if (!product) {
          return;
        }

        const update = buildOrderItemPricingUpdate(
          product,
          order,
          item,
          activePricingSettings
        );

        rows.push({
          itemId: item.id,
          orderId: order.id,
          orderNumber: order.order_number || order.id,
          orderStatus: order.status,
          productId,
          productName: item.product_name || productName(product),
          qty: getOrderItemQty(item),
          oldPrice: Number(item.price || 0),
          newPrice: update.price,
          lineTotal: update.line_total,
          netTotal: update.net_total,
          grossTotal: update.gross_total,
          update,
        });
      });
    });

    return rows;
  }

  async function updateReceivedOrderRows(rows) {
    const changedRows = (rows || []).filter(
      (row) => Number(row.oldPrice || 0) !== Number(row.newPrice || 0)
    );
    const confirmed = window.confirm(
      `Refresh ${rows.length} received order line(s) from the current product database?\n\n` +
        `This will overwrite saved order item prices for ${changedRows.length} changed line(s).`
    );

    if (!confirmed) return false;

    for (const row of rows) {
      const { error } = await supabase
        .from("order_items")
        .update(row.update)
        .eq("id", row.itemId)
        .eq("order_id", row.orderId);

      if (error) {
        throw error;
      }
    }

    return true;
  }

  async function handleBulkOrderPreview() {
    if (!orderSelectedIds.length) {
      alert("Please select products first.");
      return;
    }

    setBulkOrderLoading(true);
    try {
      const rows = await loadReceivedOrderMatches(orderSelectedIds);
      setBulkOrderPreviewRows(rows);

      if (!rows.length) {
        alert("No matching products found in Received orders.");
      }
    } catch (error) {
      alert(error.message || "Failed to preview matching orders.");
    } finally {
      setBulkOrderLoading(false);
    }
  }

  async function handleBulkOrderUpdate() {
    if (!bulkOrderPreviewRows.length) {
      alert("Preview matching orders first.");
      return;
    }

    setBulkOrderLoading(true);
    try {
      const updated = await updateReceivedOrderRows(bulkOrderPreviewRows);
      if (!updated) return;
      alert(`${bulkOrderPreviewRows.length} received order item(s) updated.`);
      setBulkOrderPreviewRows([]);
      setOrderSelectedIds([]);
    } catch (error) {
      alert(error.message || "Failed to update received orders.");
    } finally {
      setBulkOrderLoading(false);
    }
  }

  async function handleSingleOrderPreview() {
    if (!selectedSingleOrderProduct) {
      alert("Please select a product first.");
      return;
    }

    setSingleOrderLoading(true);
    try {
      const rows = await loadReceivedOrderMatches([getProductId(selectedSingleOrderProduct)]);
      setSingleOrderPreviewRows(rows);

      if (!rows.length) {
        alert("No matching product found in Received orders.");
      }
    } catch (error) {
      alert(error.message || "Failed to preview matching orders.");
    } finally {
      setSingleOrderLoading(false);
    }
  }

  async function handleSingleOrderUpdate() {
    if (!singleOrderPreviewRows.length) {
      alert("Preview matching orders first.");
      return;
    }

    setSingleOrderLoading(true);
    try {
      const updated = await updateReceivedOrderRows(singleOrderPreviewRows);
      if (!updated) return;
      alert(`${singleOrderPreviewRows.length} received order item(s) updated.`);
      setSingleOrderPreviewRows([]);
    } catch (error) {
      alert(error.message || "Failed to update received orders.");
    } finally {
      setSingleOrderLoading(false);
    }
  }

  async function handleSingleUpdate(showView = false) {
    if (!selectedSingleProduct) {
      alert("Please select a product first.");
      return;
    }

    if (!singleNewPrice && !singleCostPrice) {
      alert("Enter new price or cost price.");
      return;
    }

    const oldProduct = { ...selectedSingleProduct };
    const updateData = {};

    if (singleNewPrice !== "") {
      updateData.vat_price = Number(singleNewPrice);
    }

    if (singleCostPrice !== "") {
      updateData.cost_price = Number(singleCostPrice);
    }

    const { error } = await supabase
      .from("products")
      .update(updateData)
      .eq("id", selectedSingleProduct.id);

    if (error) {
      alert(error.message);
      return;
    }

    const updatedProduct = {
      ...oldProduct,
      ...updateData,
    };

    if (showView) {
      setSingleViewProduct({
        oldProduct,
        updatedProduct,
      });
    }

    alert("Product updated.");
    await refreshProducts();
  }

  function resetBulkEdit() {
    setBulkNewPrice("");
    setBulkCostPrice("");
    setSelectedIds([]);
    setBrand("");
    setSeries("");
    setSearch("");
    setPage(1);
  }

  function resetSingleForm() {
    setSingleSearch("");
    setSingleProductId("");
    setSingleNewPrice("");
    setSingleCostPrice("");
    setSingleViewProduct(null);
  }

  function resetBulkOrderForm() {
    setOrderBrand("");
    setOrderSeries("");
    setOrderSearch("");
    setOrderPage(1);
    setOrderSelectedIds([]);
    setBulkOrderPreviewRows([]);
  }

  function resetSingleOrderForm() {
    setSingleOrderSearch("");
    setSingleOrderProductId("");
    setSingleOrderPreviewRows([]);
  }

  return (
    <div className="bg-white rounded-2xl p-4 text-slate-900">
      <div className="mb-3">
        <div style={{ color: "#102033", fontSize: "26px", fontWeight: 800 }}>
          Price Management
        </div>
        <div style={{ color: "#64748b", fontSize: "14px", marginTop: "4px" }}>
          Manage and update product prices, margins and apply bulk updates.
        </div>
      </div>

      <div className="flex flex-wrap border rounded-xl overflow-hidden">
        {[
          ["bulkPrice", "Bulk to DB"],
          ["individualPrice", "Single to DB"],
          ["bulkOrder", "DB to Order Bulk"],
          ["individualOrder", "Single to Order"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-6 py-4 font-bold border-r ${
              activeTab === key
                ? "bg-blue-50 text-blue-700 border-b-4 border-blue-600"
                : "bg-white text-slate-600"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "bulkPrice" && (
  <BulkToDatabase
    brand={brand}
    setBrand={setBrand}
    series={series}
    setSeries={setSeries}
    search={search}
    setSearch={setSearch}
    brands={brands}
    seriesList={seriesList}
    filteredProducts={filteredProducts}
    pagedProducts={pagedProducts}
    selectedIds={selectedIds}
    bulkNewPrice={bulkNewPrice}
    setBulkNewPrice={setBulkNewPrice}
    bulkCostPrice={bulkCostPrice}
    setBulkCostPrice={setBulkCostPrice}
    bulkPreview={bulkPreview}
    safePage={safePage}
    totalPages={totalPages}
    setPage={setPage}
    toggleProduct={toggleProduct}
    toggleAllOnPage={toggleAllOnPage}
    handleBulkUpdate={handleBulkUpdate}
    resetBulkEdit={resetBulkEdit}
    refreshProducts={refreshProducts}
    getProductId={getProductId}
    productCode={productCode}
    productName={productName}
    vatPrice={vatPrice}
    costPrice={costPrice}
    pricingSettings={pricingSettings}
  />
)}

      {activeTab === "bulkOrder" && (
        <BulkDatabaseToOrders
          brand={orderBrand}
          setBrand={setOrderBrand}
          series={orderSeries}
          setSeries={setOrderSeries}
          search={orderSearch}
          setSearch={setOrderSearch}
          brands={brands}
          seriesList={seriesList}
          filteredProducts={filteredOrderProducts}
          pagedProducts={pagedOrderProducts}
          selectedIds={orderSelectedIds}
          safePage={orderSafePage}
          totalPages={orderTotalPages}
          setPage={setOrderPage}
          toggleProduct={toggleOrderProduct}
          toggleAllOnPage={toggleAllOrderProductsOnPage}
          previewRows={bulkOrderPreviewRows}
          loading={bulkOrderLoading}
          onPreview={handleBulkOrderPreview}
          onUpdate={handleBulkOrderUpdate}
          onRefreshPrices={async () => {
            await refreshProducts();
            setBulkOrderPreviewRows([]);
          }}
          onReset={resetBulkOrderForm}
          getProductId={getProductId}
          productCode={productCode}
          productName={productName}
          vatPrice={vatPrice}
        />
      )}

      {activeTab === "individualOrder" && (
        <SingleDatabaseToOrder
          search={singleOrderSearch}
          setSearch={setSingleOrderSearch}
          productId={singleOrderProductId}
          setProductId={(value) => {
            setSingleOrderProductId(value);
            setSingleOrderPreviewRows([]);
          }}
          products={singleOrderProducts}
          selectedProduct={selectedSingleOrderProduct}
          previewRows={singleOrderPreviewRows}
          loading={singleOrderLoading}
          onPreview={handleSingleOrderPreview}
          onUpdate={handleSingleOrderUpdate}
          onRefreshPrices={async () => {
            await refreshProducts();
            setSingleOrderPreviewRows([]);
          }}
          onReset={resetSingleOrderForm}
          getProductId={getProductId}
          productCode={productCode}
          productName={productName}
          vatPrice={vatPrice}
        />
      )}

      {activeTab === "individualPrice" && (
        <div className="mt-6 border rounded-2xl p-5">
          <div className="flex flex-wrap gap-3">
            <input
              value={singleSearch}
              onChange={(e) => setSingleSearch(e.target.value)}
              placeholder="Search product..."
              className="border rounded-xl px-4 py-3 min-w-[260px]"
            />

            <select
              value={singleProductId}
              onChange={(e) => setSingleProductId(e.target.value)}
              className="border rounded-xl px-4 py-3 min-w-[320px]"
            >
              <option value="">Select product</option>
              {singleProducts.map((p) => (
                <option key={getProductId(p)} value={getProductId(p)}>
                  {productCode(p)} - {productName(p)}
                </option>
              ))}
            </select>
          </div>

          {selectedSingleProduct && (
            <div className="mt-4 font-bold text-slate-700">
              Current Price: £{vatPrice(selectedSingleProduct).toFixed(2)}
              {" "} | Current Margin: {selectedSingleCurrent?.serverMargin}%
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-3 items-center">
            <input
              value={singleNewPrice}
              onChange={(e) => setSingleNewPrice(e.target.value)}
              placeholder="New Price"
              type="number"
              step="0.01"
              className="border rounded-xl px-4 py-3 min-w-[220px]"
            />

            <input
              value={singleCostPrice}
              onChange={(e) => setSingleCostPrice(e.target.value)}
              placeholder="Cost Price"
              type="number"
              step="0.01"
              className="border rounded-xl px-4 py-3 min-w-[220px]"
            />

            <div className="font-bold text-slate-700">
              New Inc.VAT Price: £{Number(singlePreview.server || 0).toFixed(2)}
            </div>

            <div className="font-bold text-slate-700">
              New Margin: {singlePreview.serverMargin}%
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => handleSingleUpdate(false)}
              className="bg-purple-700 text-white font-bold px-5 py-3 rounded-xl"
            >
              Update
            </button>

            <button
              onClick={() => handleSingleUpdate(true)}
              className="bg-green-700 text-white font-bold px-5 py-3 rounded-xl"
            >
              Update and View
            </button>

            <button
              onClick={resetSingleForm}
              className="bg-slate-600 text-white font-bold px-5 py-3 rounded-xl"
            >
              Reset Form
            </button>

            <button
              onClick={refreshProducts}
              className="bg-blue-600 text-white font-bold px-5 py-3 rounded-xl"
            >
              Refresh Products
            </button>
          </div>

          {singleViewProduct && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full border-collapse border text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border p-3 text-left">Product Name</th>
                    <th className="border p-3">Cost</th>
                    <th className="border p-3">Old Price</th>
                    <th className="border p-3">Current Price</th>
                    <th className="border p-3">Current Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const updatedPreview = getProductPricePreview(
                      singleViewProduct.updatedProduct,
                      "",
                      pricingSettings
                    );

                    return (
                      <tr>
                        <td className="border p-3">
                          {productName(singleViewProduct.updatedProduct)}
                        </td>
                        <td className="border p-3 text-right">
                          £{costPrice(singleViewProduct.updatedProduct).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right">
                          £{vatPrice(singleViewProduct.oldProduct).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right font-bold">
                          £{vatPrice(singleViewProduct.updatedProduct).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right">
                          {updatedPreview.serverMargin}%
                        </td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
