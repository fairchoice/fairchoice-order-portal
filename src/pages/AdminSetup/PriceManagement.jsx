import React, { useEffect, useMemo, useState } from "react";

import { supabase } from "../../supabaseClient";
import { getProductPriceForMode, getProductPricePreview, getVatRate, isVatPriceMode, roundMoney } from "../../utils/pricing";
import BulkToDatabase from "./PriceManagement/BulkToDatabase";
import BulkDatabaseToOrders from "./PriceManagement/BulkDatabaseToOrders";
import SingleDatabaseToOrder from "./PriceManagement/SingleDatabaseToOrder";
import {
  loadSupplierSetup,
  loadSupplierProductPricing,
  saveSupplierProductPricing,
} from "../../services/suppliers";

const PRICE_PAGE_SIZE = 20;

export default function PriceManagement({
  products = [],
  fetchProducts,
  pricingSettings = {},
}) {
  const safeProducts = Array.isArray(products) ? products : [];

  const [activeTab, setActiveTab] = useState("bulkPrice");

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(
        localStorage.getItem("loggedInUser") ||
          localStorage.getItem("fairchoice_user") ||
          "null"
      );
    } catch {
      return null;
    }
  }, []);

  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierPricingRows, setSupplierPricingRows] = useState([]);
  const [supplierPricingLoading, setSupplierPricingLoading] = useState(false);

  const [brand, setBrand] = useState("");
  const [series, setSeries] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkNewPrice, setBulkNewPrice] = useState("");
  const [bulkCostPrice, setBulkCostPrice] = useState("");
  const [bulkCostVatMode, setBulkCostVatMode] = useState("ex");

  const [singleSearch, setSingleSearch] = useState("");
  const [singleProductId, setSingleProductId] = useState("");
  const [singleNewPrice, setSingleNewPrice] = useState("");
  const [singleCostPrice, setSingleCostPrice] = useState("");
  const [singleCostVatMode, setSingleCostVatMode] = useState("ex");
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
    return [
      ...new Set(
        safeProducts
          .filter((p) => !brand || String(p.brand || "") === brand)
          .map((p) => p.series)
          .filter(Boolean)
      ),
    ].sort();
  }, [safeProducts, brand]);

  const orderSeriesList = useMemo(() => {
    return [
      ...new Set(
        safeProducts
          .filter((p) => !orderBrand || String(p.brand || "") === orderBrand)
          .map((p) => p.series)
          .filter(Boolean)
      ),
    ].sort();
  }, [safeProducts, orderBrand]);

  function getProductId(product) {
    if (!product) return "";
    return product.id || product.product_id || product.code || product.product_code || "";
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
    if (supplierId) {
      return Number(supplierCostRow(getProductId(product))?.unit_cost || 0);
    }
    return Number(product.cost_price || 0);
  }

  function normalizeVatInput(value, vatMode) {
    const amount = Number(value || 0);
    return vatMode === "inc" ? roundMoney(amount / 1.2) : amount;
  }

  useEffect(() => {
    let active = true;
    if (!currentUser) return undefined;

    loadSupplierSetup(currentUser, { includeInactive: false })
      .then((rows) => {
        if (!active) return;
        setSuppliers((rows || []).filter((supplier) => supplier.active !== false));
      })
      .catch((error) => console.error("Supplier list loading error:", error));

    return () => {
      active = false;
    };
  }, [currentUser]);

  const refreshSelectedSupplierPricing = async (selectedSupplierId = supplierId) => {
    if (!selectedSupplierId || !currentUser) {
      setSupplierPricingRows([]);
      return [];
    }

    setSupplierPricingLoading(true);
    try {
      const data = await loadSupplierProductPricing(currentUser, selectedSupplierId, false);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      setSupplierPricingRows(rows);
      return rows;
    } finally {
      setSupplierPricingLoading(false);
    }
  };

  useEffect(() => {
    void refreshSelectedSupplierPricing(supplierId).catch((error) =>
      console.error("Supplier pricing loading error:", error)
    );
  }, [supplierId, currentUser]);

  function supplierCostRow(productId) {
    return supplierPricingRows
      .filter(
        (row) =>
          String(row.product_id || row.productId || "") === String(productId || "") &&
          row.active !== false &&
          !row.effective_to
      )
      .sort((a, b) =>
        String(b.effective_from || "").localeCompare(String(a.effective_from || ""))
      )
      .find((row) => String(row.pricing_basis || "").toUpperCase() === "STANDARD") || null;
  }

  async function requireAdminPassword(actionLabel) {
    const username = String(
      currentUser?.username ||
        currentUser?.staff_username ||
        currentUser?.login ||
        ""
    ).trim().toLowerCase();

    if (!username) {
      alert("Admin verification failed: current username is unavailable.");
      return false;
    }

    const password = window.prompt(`Admin password required for ${actionLabel}.`);
    if (password === null) return false;
    if (!password) {
      alert("Admin password is required.");
      return false;
    }

    const { data, error } = await supabase.rpc("fc_login_v2", {
      p_username: username,
      p_password: password,
    });

    if (error || data?.ok === false) {
      alert(data?.error || error?.message || "Invalid admin password.");
      return false;
    }

    const role = String(data?.profile?.role || data?.profile?.access_level || "")
      .trim()
      .toLowerCase();
    if (!["admin", "administrator", "super admin"].includes(role)) {
      alert("An Admin or Super Admin password is required.");
      return false;
    }

    return true;
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

  const bulkSavedExVatCost = normalizeVatInput(bulkCostPrice, bulkCostVatMode);

  const bulkPreviewProduct = {
    vat_price: Number(bulkNewPrice || 0),
    cost_price: bulkSavedExVatCost,
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

  useEffect(() => {
    if (!singleProductId || !supplierId) return;
    const row = supplierCostRow(singleProductId);
    setSingleCostPrice(row ? String(row.unit_cost ?? "") : "");
  }, [singleProductId, supplierId, supplierPricingRows]);

  const selectedSingleCurrent = selectedSingleProduct
    ? getProductPricePreview(
        {
          ...selectedSingleProduct,
          cost_price: supplierId
            ? Number(supplierCostRow(getProductId(selectedSingleProduct))?.unit_cost || 0)
            : Number(selectedSingleProduct?.cost_price || 0),
        },
        "",
        pricingSettings
      )
    : null;

  const singlePreviewProduct = {
    ...(selectedSingleProduct || {}),
    vat_price:
      singleNewPrice !== ""
        ? Number(singleNewPrice)
        : Number(selectedSingleProduct?.vat_price || 0),
    cost_price:
      singleCostPrice !== ""
        ? normalizeVatInput(singleCostPrice, singleCostVatMode)
        : supplierId
        ? Number(supplierCostRow(getProductId(selectedSingleProduct))?.unit_cost || 0)
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

    if (bulkCostPrice !== "" && !supplierId) {
      alert("Select a supplier before saving a cost price.");
      return;
    }

    if (bulkNewPrice !== "") {
      const { error } = await supabase
        .from("products")
        .update({ vat_price: Number(bulkNewPrice) })
        .in("id", selectedIds);

      if (error) {
        alert(error.message);
        return;
      }
    }

    if (bulkCostPrice !== "") {
      for (const productId of selectedIds) {
        await saveSupplierProductPricing(
          {
            supplierId,
            productId,
            pricingBasis: "STANDARD",
            unitCost: bulkSavedExVatCost,
            effectiveFrom: new Date().toISOString().slice(0, 10),
            note: "Price Management",
          },
          currentUser
        );
      }
      await refreshSelectedSupplierPricing();
    }

    alert(
      bulkNewPrice !== "" && bulkCostPrice !== ""
        ? "Selling price and supplier cost updated."
        : bulkCostPrice !== ""
        ? "Supplier cost updated."
        : "Selling price updated in database."
    );
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

    if (!(await requireAdminPassword("DB to Order Bulk"))) return;

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

    if (singleCostPrice !== "" && !supplierId) {
      alert("Select a supplier before saving a cost price.");
      return;
    }

    if (!(await requireAdminPassword("Single to DB"))) return;

    const oldProduct = {
      ...selectedSingleProduct,
      ...(supplierId
        ? { cost_price: Number(supplierCostRow(selectedSingleProduct.id)?.unit_cost || 0) }
        : {}),
    };
    const updateData = {};

    if (singleNewPrice !== "") {
      updateData.vat_price = Number(singleNewPrice);
      const { error } = await supabase
        .from("products")
        .update(updateData)
        .eq("id", selectedSingleProduct.id);

      if (error) {
        alert(error.message);
        return;
      }
    }

    if (singleCostPrice !== "") {
      await saveSupplierProductPricing(
        {
          supplierId,
          productId: selectedSingleProduct.id,
          pricingBasis: "STANDARD",
          unitCost: normalizeVatInput(singleCostPrice, singleCostVatMode),
          effectiveFrom: new Date().toISOString().slice(0, 10),
          note: "Price Management",
        },
        currentUser
      );
      await refreshSelectedSupplierPricing();
    }

    const updatedProduct = {
      ...oldProduct,
      ...updateData,
      ...(singleCostPrice !== "" ? { cost_price: normalizeVatInput(singleCostPrice, singleCostVatMode) } : {}),
    };

    alert(
      singleNewPrice !== "" && singleCostPrice !== ""
        ? "Selling price and supplier cost updated."
        : singleCostPrice !== ""
        ? "Supplier cost updated."
        : "Product selling price updated."
    );

    await refreshProducts();

    if (showView) {
      setSingleViewProduct({
        oldProduct,
        updatedProduct,
      });
    }
  }

  function resetBulkEdit() {
    setBulkNewPrice("");
    setBulkCostPrice("");
    setBulkCostVatMode("ex");
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
    setSingleCostVatMode("ex");
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
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
            <label className="text-sm font-bold text-slate-700">
              Supplier for cost price
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="ml-3 min-w-[260px] rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.supplier_name}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xs font-semibold text-slate-600">
              {supplierPricingLoading
                ? "Loading supplier costs..."
                : "Cost is stored per supplier. Selling price can be saved without a cost price."}
            </span>
          </div>
          <BulkToDatabase
    brand={brand}
    setBrand={(value) => { setBrand(value); setSeries(""); setPage(1); }}
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
    bulkCostVatMode={bulkCostVatMode}
    setBulkCostVatMode={setBulkCostVatMode}
    bulkSavedExVatCost={bulkSavedExVatCost}
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
        </>
)}

      {activeTab === "bulkOrder" && (
        <BulkDatabaseToOrders
          brand={orderBrand}
          setBrand={(value) => { setOrderBrand(value); setOrderSeries(""); setOrderPage(1); }}
          series={orderSeries}
          setSeries={setOrderSeries}
          search={orderSearch}
          setSearch={setOrderSearch}
          brands={brands}
          seriesList={orderSeriesList}
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
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="border rounded-xl px-4 py-3 min-w-[280px]"
            >
              <option value="">Supplier for cost price</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.supplier_name}
                </option>
              ))}
            </select>

            <input
              value={singleSearch}
              onChange={(e) => setSingleSearch(e.target.value)}
              placeholder="Search product..."
              className="border rounded-xl px-4 py-3 min-w-[260px]"
            />

            <select
              value={singleProductId}
              onChange={(e) => { setSingleProductId(e.target.value); setSingleCostPrice(""); }}
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
              {" "} | Current Supplier Cost: £{Number(
                supplierId
                  ? supplierCostRow(getProductId(selectedSingleProduct))?.unit_cost || 0
                  : selectedSingleProduct?.cost_price || 0
              ).toFixed(2)}
              {" "} | Current Margin: {selectedSingleCurrent?.exVatMargin}%
            </div>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
              <div className="mb-2 font-extrabold text-slate-800">Selling Price</div>
              <input value={singleNewPrice} onChange={(e) => setSingleNewPrice(e.target.value)} placeholder="New Ex.VAT Selling Price" type="number" step="0.01" className="w-full border rounded-xl px-4 py-3" />
              <div className="mt-2 text-sm font-bold text-slate-700">Inc.VAT Selling Price: £{Number(singlePreview.server || 0).toFixed(2)}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="mb-2 font-extrabold text-slate-800">Supplier Cost Price</div>
              <div className="flex flex-wrap gap-2">
                <select value={singleCostVatMode} onChange={(e) => setSingleCostVatMode(e.target.value)} className="border rounded-xl px-4 py-3 min-w-[170px] bg-white"><option value="ex">Ex.VAT Cost</option><option value="inc">Inc.VAT Cost</option></select>
                <input value={singleCostPrice} onChange={(e) => setSingleCostPrice(e.target.value)} placeholder={singleCostVatMode === "inc" ? "Inc.VAT Cost Price" : "Ex.VAT Cost Price"} type="number" step="0.01" className="flex-1 border rounded-xl px-4 py-3 min-w-[220px] bg-white" />
              </div>
              {singleCostVatMode === "inc" && singleCostPrice !== "" && (<div className="mt-2 text-sm font-bold text-slate-700">Saved Ex.VAT Cost: £{normalizeVatInput(singleCostPrice, singleCostVatMode).toFixed(2)}</div>)}
            </div>
            <div className="font-bold text-slate-700 lg:col-span-2">New Margin: {singlePreview.exVatMargin}%</div>
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
                          £{Number(singleViewProduct.updatedProduct?.cost_price || 0).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right">
                          £{vatPrice(singleViewProduct.oldProduct).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right font-bold">
                          £{vatPrice(singleViewProduct.updatedProduct).toFixed(2)}
                        </td>
                        <td className="border p-3 text-right">
                          {updatedPreview.exVatMargin}%
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
