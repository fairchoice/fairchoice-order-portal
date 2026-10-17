import { useEffect, useMemo, useRef, useState } from "react";
import { getFcSessionState, profileWithFcLoginSession, readStoredFcProfile } from "../../services/fcSession.js";

import { supabase } from "../../supabaseClient";
import { getProductPricePreview, roundMoney } from "../../utils/pricing";
import PriceApprovalDialog from "./PriceManagement/PriceApprovalDialog.jsx";
import { activePriceOrderStages, buildPriceOrderPreview } from "../../utils/priceManagementOrders.js";
import BulkToDatabase from "./PriceManagement/BulkToDatabase";
import BulkDatabaseToOrders from "./PriceManagement/BulkDatabaseToOrders";
import { mergePendingPriceUpdates, removePendingPriceUpdates, readPendingPriceUpdates, writePendingPriceUpdates } from "../../utils/priceUpdateQueue.js";
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
  user = null,
  onProfileRefresh,
}) {
  const safeProducts = Array.isArray(products) ? products : [];

  const [activeTab, setActiveTab] = useState("bulkPrice");
  const [orderStatus, setOrderStatus] = useState("both");
  const [approval, setApproval] = useState(null);
  const approvalResolve = useRef(null);
  const approvalBusy = useRef(false);
  const previewRequest = useRef(0);
  useEffect(() => () => { approvalResolve.current?.(false); approvalResolve.current = null; }, []);

  // Read the live FC profile rather than freezing a token when this page mounts.
  const userRef = useRef(user);
  userRef.current = user;
  const currentUser = readStoredFcProfile() || user;
  const { username: supplierUsername, token: supplierSessionToken } = getFcSessionState(currentUser);
  const pendingQueueKey = `fairchoice_pending_price_updates:${currentUser?.login_user_id || currentUser?.id || supplierUsername || "unknown"}`;
  const [pendingProductIds, setPendingProductIds] = useState(() => readPendingPriceUpdates(pendingQueueKey));
  const pendingIdsRef = useRef(pendingProductIds);
  const [pendingCatalogProducts, setPendingCatalogProducts] = useState([]);
  const [reviewMessage, setReviewMessage] = useState("");
  function savePendingProducts(ids) {
    // Save the pending decision before leaving the database update screen.
    writePendingPriceUpdates(pendingQueueKey, ids);
    pendingIdsRef.current = ids;
    setPendingProductIds(ids);
  }
  useEffect(() => {
    const ids = readPendingPriceUpdates(pendingQueueKey);
    pendingIdsRef.current = ids;
    setPendingProductIds(ids);
    setOrderSelectedIds(ids);
    setBulkOrderPreviewRows([]);
  }, [pendingQueueKey]);
  useEffect(() => {
    const syncQueue = event => {
      if (event.key !== pendingQueueKey) return;
      const ids = readPendingPriceUpdates(pendingQueueKey);
      pendingIdsRef.current = ids;
      setPendingProductIds(ids);
      setOrderSelectedIds(ids);
      setBulkOrderPreviewRows([]);
      previewRequest.current++;
    };
    window.addEventListener("storage", syncQueue);
    return () => window.removeEventListener("storage", syncQueue);
  }, [pendingQueueKey]);
  useEffect(() => {
    let active = true;
    if (!pendingProductIds.length) { setPendingCatalogProducts([]); return undefined; }
    supabase.from("products").select("*").in("id", pendingProductIds).then(({ data, error }) => {
      if (!active) return;
      if (error) setReviewMessage(`Pending products could not be refreshed: ${error.message}`);
      else setPendingCatalogProducts(data || []);
    });
    return () => { active = false; };
  }, [pendingProductIds]);

  const [supplierReload, setSupplierReload] = useState(0);
  const [supplierListLoading, setSupplierListLoading] = useState(false);
  const [supplierListError, setSupplierListError] = useState("");

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
  const [orderSelectedIds, setOrderSelectedIds] = useState(() => readPendingPriceUpdates(pendingQueueKey));
  const [bulkOrderPreviewRows, setBulkOrderPreviewRows] = useState([]);
  const [bulkOrderLoading, setBulkOrderLoading] = useState(false);

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
          .filter((p) => pendingProductIds.includes(String(getProductId(p))) && (!orderBrand || String(p.brand || "") === orderBrand))
          .map((p) => p.series)
          .filter(Boolean)
      ),
    ].sort();
  }, [safeProducts, orderBrand, pendingProductIds]);

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
    let retryTimer;
    let attempt = 0;
    const load = async () => {
      setSupplierListLoading(true);
      setSupplierListError("");
      try {
        const profile = readStoredFcProfile() || userRef.current;
        const session = getFcSessionState(profile);
        if (!session.username || !session.token) {
          throw new Error("Your session is unavailable. Refresh suppliers after signing in.");
        }
        const rows = await loadSupplierSetup(profile, { includeInactive: false });
        if (!Array.isArray(rows)) throw new Error("The supplier list could not be read. Please refresh suppliers.");
        if (active) setSuppliers(rows.filter((supplier) => supplier.active !== false));
      } catch (error) {
        if (!active) return;
        setSupplierListError(error.message || "Suppliers could not be loaded. Please refresh suppliers.");
        // Retry a temporary read failure once; permission/session failures remain visible.
        const transient = Number(error.status) >= 500 ||
          ["PGRST000", "PGRST001", "PGRST002", "PGRST003", "57014", "53300"].includes(error.code) ||
          /fetch|network|timeout|timed out/i.test(error.message || "");
        if (transient && attempt++ === 0) retryTimer = window.setTimeout(load, 1200);
      } finally {
        if (active) setSupplierListLoading(false);
      }
    };
    void load();
    return () => { active = false; window.clearTimeout(retryTimer); };
  }, [supplierUsername, supplierSessionToken, supplierReload]);

  useEffect(() => {
    const refresh = () => setSupplierReload(value => value + 1);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storageChanged = (event) => {
      if (!event.key || ["loggedInUser", "fairchoice_user"].includes(event.key)) refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("storage", storageChanged);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", storageChanged);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const refreshSelectedSupplierPricing = async (selectedSupplierId = supplierId) => {
    if (!selectedSupplierId || !currentUser) {
      setSupplierPricingRows([]);
      return [];
    }

    setSupplierPricingLoading(true);
    try {
      const data = await loadSupplierProductPricing(readStoredFcProfile() || user, selectedSupplierId, false);
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
  }, [supplierId, supplierUsername, supplierSessionToken]);

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

  function finishApproval(approved) {
    const resolve = approvalResolve.current;
    approvalResolve.current = null;
    approvalBusy.current = false;
    setApproval(null);
    resolve?.(approved);
  }

  function requireAdminPassword(action) {
    if (approvalResolve.current) return Promise.resolve(false);
    return new Promise(resolve => {
      approvalResolve.current = resolve;
      setApproval({ action, password: "", busy: false, error: "" });
    });
  }

  async function approvePriceUpdate() {
    if (!approval || approvalBusy.current || !approval.password) return;
    approvalBusy.current = true;
    setApproval(value => ({ ...value, busy: true, error: "" }));
    try {
      const profile = readStoredFcProfile() || user;
      const username = String(profile?.username || "").trim();
      if (!username) throw new Error("Current login is unavailable. Please sign in again.");
      const { data, error } = await supabase.rpc("fc_login_v2", { p_username: username, p_password: approval.password });
      if (!approvalResolve.current) return;
      if (error || data?.ok !== true) throw new Error(data?.error || error?.message || "Invalid admin password.");
      const role = String(data.profile?.role || data.profile?.access_level || "").trim().toLowerCase();
      if (!["admin", "administrator", "super admin"].includes(role)) throw new Error("An Admin or Super Admin password is required.");
      const refreshedProfile = profileWithFcLoginSession(profile, data);
      localStorage.setItem("fairchoice_user", JSON.stringify(refreshedProfile));
      localStorage.setItem("loggedInUser", JSON.stringify(refreshedProfile));
      onProfileRefresh?.(refreshedProfile);
      setSupplierReload(value => value + 1);
      finishApproval(true);
    } catch (error) {
      approvalBusy.current = false;
      setApproval(value => value && ({ ...value, busy: false, password: "", error: error.message || "Approval failed." }));
    }
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

  const pendingProducts = useMemo(() => {
    const ids = new Set(pendingProductIds.map(String));
    const byId = new Map(safeProducts.filter(product => ids.has(String(getProductId(product)))).map(product => [String(getProductId(product)), product]));
    pendingCatalogProducts.forEach(product => {
      if (ids.has(String(getProductId(product)))) byId.set(String(getProductId(product)), product);
    });
    return [...byId.values()];
  }, [safeProducts, pendingProductIds, pendingCatalogProducts]);

  const pendingBrands = [...new Set(pendingProducts.map(product => product.brand).filter(Boolean))].sort();

  const filteredOrderProducts = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();

    return pendingProducts.filter((p) => {
      const matchBrand = !orderBrand || String(p.brand || "") === orderBrand;
      const matchSeries = !orderSeries || String(p.series || "") === orderSeries;

      const matchSearch =
        !q ||
        String(productName(p)).toLowerCase().includes(q) ||
        String(productCode(p)).toLowerCase().includes(q);

      return matchBrand && matchSeries && matchSearch;
    });
  }, [pendingProducts, orderBrand, orderSeries, orderSearch]);

  const orderTotalPages = Math.max(
    1,
    Math.ceil(filteredOrderProducts.length / PRICE_PAGE_SIZE)
  );
  const orderSafePage = Math.min(orderPage, orderTotalPages);

  const pagedOrderProducts = filteredOrderProducts.slice(
    (orderSafePage - 1) * PRICE_PAGE_SIZE,
    orderSafePage * PRICE_PAGE_SIZE
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
    previewRequest.current++;
    setOrderSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setBulkOrderPreviewRows([]);
  }

  function toggleAllOrderProductsOnPage() {
    previewRequest.current++;
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

    if (!(await requireAdminPassword("Save bulk product prices to the database"))) return;
    const updatedProductIds = [...selectedIds];

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
          readStoredFcProfile() || user
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
    await openUpdatedProductsReview(updatedProductIds);
    await refreshProducts();
  }

  async function loadFreshPricingSettings() {
    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not load current pricing settings: ${error.message}`);
    }

    return data || pricingSettings;
  }

  async function loadActiveOrderMatches(productIds, stage = orderStatus) {
    const ids = [...new Set((productIds || []).filter(Boolean).map(String))];
    if (!ids.length) return [];
    const [settings, productResult] = await Promise.all([
      loadFreshPricingSettings(),
      supabase.from("products").select("*").in("id", ids),
    ]);
    if (productResult.error) throw productResult.error;
    const orders = [];
    for (let offset = 0; ; offset += 200) {
      const result = await supabase.from("orders")
        .select("id, order_number, status, price_mode, customer_country, financial_status, financial_voided_at, order_items!inner(*)")
        .in("status", activePriceOrderStages(stage)).in("order_items.product_id", ids)
        .order("id").range(offset, offset + 199);
      if (result.error) throw result.error;
      orders.push(...(result.data || []));
      if ((result.data || []).length < 200) break;
    }
    return buildPriceOrderPreview(orders, productResult.data || [], ids, settings);
  }

  async function openUpdatedProductsReview(productIds) {
    const pending = mergePendingPriceUpdates(mergePendingPriceUpdates(readPendingPriceUpdates(pendingQueueKey), pendingIdsRef.current), productIds);
    savePendingProducts(pending);
    setReviewMessage("Database prices saved. Choose Apply latest prices to update Received / Warehouse, or Clear pending changes to leave orders unchanged.");
    setOrderSelectedIds(pending);
    setOrderBrand(""); setOrderSeries(""); setOrderSearch(""); setOrderPage(1);
    setBulkOrderPreviewRows([]);
    setActiveTab("bulkOrder");
    const request = ++previewRequest.current;
    setBulkOrderLoading(true);
    try {
      const rows = await loadActiveOrderMatches(pending);
      if (request === previewRequest.current) setBulkOrderPreviewRows(rows);
    }
    catch (error) { alert(`Product prices were saved. Preview could not load: ${error.message}`); }
    finally { setBulkOrderLoading(false); }
  }

  function changeOrderStage(stage) {
    previewRequest.current++;
    setOrderStatus(stage);
    setBulkOrderPreviewRows([]);
  }

  async function updateActiveOrderRows(productIds) {
    // A Yes decision means use the latest database price, replacing saved line
    // prices even when they were manually set before this decision.
    const rows = await loadActiveOrderMatches(productIds);
    setBulkOrderPreviewRows(rows);
    if (!rows.length) {
      setReviewMessage("No matching Received / Warehouse lines. Pending products are retained until you clear them.");
      return null;
    }
    const changed = rows.filter(row => row.oldPrice !== row.newPrice).length;
    if (!window.confirm(`YES: overwrite saved prices with the latest database prices for ${changed} changed line(s) (${rows.length} matching lines) in the selected Received / Warehouse stage?\n\nCancel leaves all order prices unchanged.`)) return null;
    const session = getFcSessionState(readStoredFcProfile() || user);
    const { data, error } = await supabase.rpc("fc_update_active_order_prices_v1", {
      p_username: session.username, p_session_token: session.token, p_items: rows,
    });
    if (error) throw error;
    return data;
  }

  async function handleBulkOrderPreview() {
    if (!orderSelectedIds.length) {
      alert("Please select products first.");
      return;
    }

    const request = ++previewRequest.current;
    setBulkOrderLoading(true);
    try {
      const rows = await loadActiveOrderMatches(orderSelectedIds);
      if (request !== previewRequest.current) return;
      setBulkOrderPreviewRows(rows);

      if (!rows.length) {
        alert("No matching products found in the selected Received / Warehouse stage.");
      }
    } catch (error) {
      alert(error.message || "Failed to preview matching orders.");
    } finally {
      setBulkOrderLoading(false);
    }
  }

  async function handleBulkOrderUpdate() {
    const productIds = orderSelectedIds.filter(id => pendingIdsRef.current.includes(String(id))).map(String);
    if (!productIds.length) { alert("No pending product updates are selected."); return; }
    if (!(await requireAdminPassword("Apply latest database prices to Received orders / Warehouse"))) return;
    setBulkOrderLoading(true);
    try {
      const updated = await updateActiveOrderRows(productIds);
      if (!updated) return;
      savePendingProducts(removePendingPriceUpdates(pendingIdsRef.current, productIds));
      setReviewMessage(`${updated.updated_lines} Received / Warehouse line(s) updated to the latest database prices.`);
      setBulkOrderPreviewRows([]);
      setOrderSelectedIds(current => current.filter(id => !productIds.includes(String(id))));
    } catch (error) {
      setReviewMessage(error.message || "No prices were applied. Retry after refreshing the preview.");
    } finally { setBulkOrderLoading(false); }
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
        readStoredFcProfile() || user
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

    await openUpdatedProductsReview([getProductId(selectedSingleProduct)]);
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

  function clearPendingOrderUpdates() {
    previewRequest.current++;
    savePendingProducts([]);
    setOrderSelectedIds([]);
    setBulkOrderPreviewRows([]);
    setOrderBrand(""); setOrderSeries(""); setOrderSearch(""); setOrderPage(1);
    setReviewMessage("Pending changes cleared. Database prices are saved; Received / Warehouse prices were not changed.");
  }

  return (
    <div className="bg-white rounded-2xl p-4 text-slate-900">
      <PriceApprovalDialog approval={approval}
        onPasswordChange={password => setApproval(value => ({ ...value, password }))}
        onApprove={approvePriceUpdate} onCancel={() => finishApproval(false)} />
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
          ["bulkOrder", `Update to Received / Warehouse (${pendingProductIds.length})`],
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

      {["bulkPrice", "individualPrice"].includes(activeTab) && (
        <div className="mt-4 flex flex-wrap items-center gap-3" aria-live="polite">
          <button type="button" disabled={supplierListLoading}
            onClick={() => setSupplierReload(value => value + 1)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold disabled:opacity-50">
            {supplierListLoading ? "Loading suppliers..." : "Refresh suppliers"}
          </button>
          {supplierListError ? (
            <span role="alert" className="text-sm font-semibold text-red-700">{supplierListError}</span>
          ) : !supplierListLoading && suppliers.length === 0 ? (
            <span className="text-sm text-slate-600">No active suppliers are available.</span>
          ) : null}
        </div>
      )}

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
        <>
        {reviewMessage && <div role="status" className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{reviewMessage}</div>}
        <BulkDatabaseToOrders
          orderStatus={orderStatus}
          setOrderStatus={changeOrderStage}
          brand={orderBrand}
          setBrand={(value) => { setOrderBrand(value); setOrderSeries(""); setOrderPage(1); }}
          series={orderSeries}
          setSeries={setOrderSeries}
          search={orderSearch}
          setSearch={setOrderSearch}
          brands={pendingBrands}
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
          onReset={clearPendingOrderUpdates}
          getProductId={getProductId}
          productCode={productCode}
          productName={productName}
          vatPrice={vatPrice}
        />
        </>
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
