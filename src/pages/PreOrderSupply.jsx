import { useEffect, useMemo, useState } from "react";
import { logAction } from "../utils/auditLog";
import { supabase } from "../services/supabase";
import { loadSupplierProductPricing, supplierOptionsForSelection } from "../services/suppliers";
import {
  allocateSupplierQuantity,
  filterPendingPreOrderActionsForOrders,
  isActivePreOrderSupplyOrder,
  isWarehousePreOrderQueueLine,
  isLivePreOrderSupplyEvent,
  preOrderSupplyItemChanges,
  preOrderWorkflowStage,
  PREORDER_SUPPLY_PENDING_KEY,
  warehouseSupplyStage,
} from "../services/preOrderSupplyAllocation";
import {
  loadPreOrderSupplyHistory,
  recordPreOrderSupplyEvent,
} from "../services/preOrderSupplyHistory";
import { recordWarehouseOperationalActivity } from "../services/warehouseActivity";
import { compareWarehouseProducts } from "../utils/warehouseProductSorting";

const TABS = ["Pre-order Queue", "Next Supplier", "Bought", "Purchase History", "Order Pre-orders"];
const PREORDER_SUPPLY_ORDER_SNAPSHOT_KEY = "fc_preorder_supply_order_snapshot_v1";
const PREORDER_SUPPLIER_HIGHLIGHT_KEY = "fc_preorder_supplier_highlights_v1";
const MAX_SYNC_PRODUCTS = 30;
const PURCHASE_SESSION_KEY = "fc_preorder_purchase_session_v1";

const localDateKey = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const safeUuid = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const getItemKey = (order, item) =>
  `${order.orderId || order.order_number}:${item.dbId || item.id}`;
const getItemQty = (item = {}) => Number(item.qty ?? item.quantity ?? 0);
const itemProductId = (item = {}) =>
  item.productId || item.product_id || item.product?.id || item.products?.id || item.id;

const isPreOrderStatus = (value) => warehouseSupplyStage(value) === "Pre-order";

const deliveredStatuses = new Set([
  "delivered",
  "delivery confirmed",
  "confirmed delivered",
]);

const isDeliveryConfirmed = (event = {}) =>
  Boolean(event.deliveryConfirmed || event.deliveryConfirmedAt) ||
  deliveredStatuses.has(normalizeStatus(event.orderStatus));

function SupplierSelector({ suppliers, value, onChange, label = "Supplier" }) {
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-extrabold text-slate-700">
      <span className="shrink-0">{label}</span>
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-bold text-slate-900"
      >
        <option value="">Select Supplier</option>
        {supplierOptionsForSelection(suppliers).map((supplier) => (
          <option key={supplier.id} value={supplier.id}>
            {supplier.supplier_name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function PreOrderSupply({
  orders = [],
  products = [],
  updateOrderItem,
  addOrderItem,
  splitPreOrderItem,
  restorePreOrderSplit,
  refreshOrders,
  historyOnly = false,
}) {
  const loggedInUser = useMemo(
    () => JSON.parse(localStorage.getItem("loggedInUser") || "null"),
    [],
  );
  const [tab, setTab] = useState(() => historyOnly ? "Purchase History" : "Pre-order Queue");
  const [pendingActions, setPendingActions] = useState(() => readJson(PREORDER_SUPPLY_PENDING_KEY, []));
  const [, setActionHistory] = useState({});
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyWarning, setHistoryWarning] = useState("");
  const [purchaseReportSearch, setPurchaseReportSearch] = useState("");
  const [purchaseReportSupplier, setPurchaseReportSupplier] = useState("All");
  const [purchaseReportAction, setPurchaseReportAction] = useState("All");
  const [purchaseReportFrom, setPurchaseReportFrom] = useState("");
  const [purchaseReportTo, setPurchaseReportTo] = useState("");
  const [purchaseReportPage, setPurchaseReportPage] = useState(1);
  const [purchaseReportPageSize, setPurchaseReportPageSize] = useState(25);
  const [suppliers, setSuppliers] = useState([]);
  const [supplierPricingCache, setSupplierPricingCache] = useState({});
  const [queueSupplierId, setQueueSupplierId] = useState("");
  const [nextSupplierId, setNextSupplierId] = useState("");
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [buyQty, setBuyQty] = useState({});
  const [allocations, setAllocations] = useState({});
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [collapsedOrderSections, setCollapsedOrderSections] = useState({});
  const [orderSnapshot, setOrderSnapshot] = useState(() => readJson(PREORDER_SUPPLY_ORDER_SNAPSHOT_KEY, null));
  const [purchaseSession, setPurchaseSession] = useState(() => {
    const saved = readJson(PURCHASE_SESSION_KEY, null);
    return saved?.date === localDateKey() ? saved : null;
  });
  const purchaseStarted = Boolean(purchaseSession?.date === localDateKey() && purchaseSession?.startedAt);

  const startPurchaseSession = () => {
    const date = localDateKey();
    const existing = readJson(PURCHASE_SESSION_KEY, null);
    if (existing?.date === date && existing?.startedAt) {
      setPurchaseSession(existing);
      return;
    }
    const next = { date, sessionId: safeUuid(), startedAt: new Date().toISOString() };
    localStorage.setItem(PURCHASE_SESSION_KEY, JSON.stringify(next));
    setPurchaseSession(next);
    setSyncMessage("Purchase session started. Bought is reset to 0 for this session.");
    logAction({
      user: loggedInUser,
      action_type: "Pre-order Supply Start Purchase",
      page_module: "Pre-order Supply",
      new_value: next,
    }).catch((error) => console.error("Purchase session audit log failed:", error));
  };

  useEffect(() => {
    localStorage.setItem(PREORDER_SUPPLY_PENDING_KEY, JSON.stringify(pendingActions));
  }, [pendingActions]);

  useEffect(() => {
    if (historyOnly) return undefined;
    const refreshPurchaseDay = () => {
      const saved = readJson(PURCHASE_SESSION_KEY, null);
      if (saved?.date === localDateKey() && saved?.startedAt) {
        setPurchaseSession(saved);
      } else {
        setPurchaseSession(null);
        setTab("Pre-order Queue");
        setExpandedProduct(null);
      }
    };
    refreshPurchaseDay();
    const intervalId = window.setInterval(refreshPurchaseDay, 30000);
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    const midnightTimeoutId = window.setTimeout(refreshPurchaseDay, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    window.addEventListener("focus", refreshPurchaseDay);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(midnightTimeoutId);
      window.removeEventListener("focus", refreshPurchaseDay);
    };
  }, [historyOnly]);

  useEffect(() => {
    if (historyOnly && tab !== "Purchase History") setTab("Purchase History");
  }, [historyOnly, tab]);

  useEffect(() => {
    if (!Array.isArray(orders) || orders.length === 0) return;
    const snapshot = { savedAt: new Date().toISOString(), orders };
    setOrderSnapshot(snapshot);
    try {
      localStorage.setItem(PREORDER_SUPPLY_ORDER_SNAPSHOT_KEY, JSON.stringify(snapshot));
    } catch {
      // Keep the in-memory snapshot even if browser storage is temporarily full.
    }
  }, [orders]);

  const effectiveOrders = useMemo(() => {
    if (Array.isArray(orders) && orders.length > 0) return orders;
    if (pendingActions.length > 0 && Array.isArray(orderSnapshot?.orders)) return orderSnapshot.orders;
    return orders || [];
  }, [orderSnapshot, orders, pendingActions.length]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPendingActions((current) => {
        const filtered = filterPendingPreOrderActionsForOrders(current, effectiveOrders);
        return filtered.length === current.length && filtered.every((entry, index) => entry === current[index])
          ? current
          : filtered;
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [effectiveOrders]);

  useEffect(() => {
    if (!historyOnly && !purchaseStarted) return undefined;
    let active = true;
    supabase
      .from("suppliers")
      .select("id, supplier_name, active")
      .eq("active", true)
      .order("supplier_name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) console.error("Supplier list load failed:", error);
        else setSuppliers(data || []);
      });
    return () => {
      active = false;
    };
  }, [historyOnly, purchaseStarted]);

  useEffect(() => {
    if (!historyOnly && !purchaseStarted) {
      setHistoryEvents([]);
      setHistoryWarning("");
      return undefined;
    }
    let active = true;

    const refreshSharedHistory = async () => {
      if (syncing) return;
      try {
        const historyPages = historyOnly || tab === "Purchase History" ? 20 : 1;
        const { history, events, warning } = await loadPreOrderSupplyHistory(loggedInUser, { maxPages: historyPages });
        if (!active) return;
        setHistoryWarning(warning || "");
        setActionHistory(history || {});
        setHistoryEvents(events || []);
      } catch (error) {
        console.error("Pre-order supply history load error:", error);
      }
    };

    refreshSharedHistory();
    // Full purchase history is large. Only poll while the user is actually viewing it;
    // operational tabs use the first page plus locally saved sync events.
    const intervalId = historyOnly || tab === "Purchase History"
      ? window.setInterval(refreshSharedHistory, 30000)
      : null;
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshSharedHistory();
    };
    window.addEventListener("focus", refreshSharedHistory);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSharedHistory);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loggedInUser, syncing, historyOnly, tab, purchaseStarted]);


  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [String(supplier.id), supplier])),
    [suppliers],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [String(product.id), product])),
    [products],
  );

  const loadSupplierPricingRows = async (supplierId) => {
    const key = String(supplierId || "");
    if (!key) return [];
    if (supplierPricingCache[key]) return supplierPricingCache[key];
    const data = await loadSupplierProductPricing(loggedInUser, key, false);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    setSupplierPricingCache((current) => ({ ...current, [key]: rows }));
    return rows;
  };

  const supplierCostForProduct = async (supplierId, productId) => {
    const findCost = (rows = []) => {
      const matches = rows
        .filter((row) =>
          String(row.product_id || row.productId || "") === String(productId || "") &&
          row.active !== false && !row.effective_to)
        .sort((left, right) =>
          String(right.effective_from || "").localeCompare(String(left.effective_from || "")));
      const preferred = matches.find((row) => String(row.pricing_basis || "").toUpperCase() === "STANDARD") || matches[0];
      if (!preferred) return null;
      const unitCost = Number(preferred.unit_cost);
      if (!Number.isFinite(unitCost) || unitCost < 0) return null;
      return { unitCost, pricingBasis: preferred.pricing_basis || "STANDARD" };
    };

    const cachedRows = await loadSupplierPricingRows(supplierId);
    const cachedCost = findCost(cachedRows);
    if (cachedCost) return cachedCost;

    // Re-read once before treating the price as missing. This avoids stale POS cache
    // after a supplier cost is added or changed in Supplier Setup.
    const refreshed = await loadSupplierProductPricing(loggedInUser, supplierId, false);
    const refreshedRows = Array.isArray(refreshed?.rows) ? refreshed.rows : [];
    setSupplierPricingCache((current) => ({ ...current, [String(supplierId || "")]: refreshedRows }));
    return findCost(refreshedRows);
  };

  // Current Warehouse Packing orders determine operational demand;
  // permanent events retain supplier workflow state without resurrecting exited orders.
  const pendingActionByItem = useMemo(() => {
    const latest = {};
    for (const action of pendingActions) {
      latest[action.itemKey] = action;
    }
    return latest;
  }, [pendingActions]);

  // Synced Next Supplier events must continue to control the POS queue after
  // local pending state is cleared. This also preserves legacy rows that were
  // synced before Next Supplier became a persisted Warehouse item status.
  const syncedNextSupplierByItem = useMemo(() => {
    const latest = {};
    const events = [...historyEvents].sort(
      (left, right) => new Date(left?.timestamp || 0) - new Date(right?.timestamp || 0),
    );
    for (const event of events) {
      const key = String(event?.itemKey || "");
      if (!key) continue;
      if (event.actionType === "NextSup") latest[key] = event;
      if (["Buy", "PartialBuy", "Remove", "Recall"].includes(event.actionType)) {
        delete latest[key];
      }
    }
    return latest;
  }, [historyEvents]);

  const warehouseLines = useMemo(() => {
    const result = [];
    for (const order of effectiveOrders || []) {
      if (!isActivePreOrderSupplyOrder(order)) continue;
      for (const item of order.items || []) {
        const key = getItemKey(order, item);
        const product = productById.get(String(itemProductId(item))) || {};
        result.push({
          order,
          item,
          itemKey: key,
          productId: String(itemProductId(item) || item.productCode || item.name),
          productName: item.name || item.productName || product.name || "Unnamed Product",
          category: product.category || product.mainCategory || product.main_category || item.category || item.mainCategory || item.main_category || "",
          subCategory: product.subCategory || product.sub_category || item.subCategory || item.sub_category || "",
          brand: product.brand || item.brand || "",
          series: product.series || item.series || "",
          customerName: order.companyName || order.customerName || "Unknown Customer",
          branchName: order.branchName || order.branch_name || "",
          orderNumber: order.orderId || order.order_number,
          qty: getItemQty(item),
          originalQty: getItemQty(item),
          status: item.sourceStatus || item.source_status || item.status || "In Stock",
        });
      }
    }
    return result;
  }, [effectiveOrders, productById]);

  const allLines = useMemo(
    () =>
      warehouseLines.flatMap((line) => {
        const hasPendingAction = Object.prototype.hasOwnProperty.call(
          pendingActionByItem,
          line.itemKey,
        );
        const latestAction = hasPendingAction
          ? pendingActionByItem[line.itemKey]
          : syncedNextSupplierByItem[line.itemKey] || null;
        const warehouseStage = warehouseSupplyStage(line.status);
        if (!warehouseStage && !(hasPendingAction && latestAction?.actionType === "Recall")) {
          return [];
        }
        const displayStatus = preOrderWorkflowStage(line.status, latestAction, {
          pending: hasPendingAction,
        });
        return [{
          ...line,
          qty: Number(latestAction?.remainingQty ?? line.qty),
          displayStatus,
          latestAction,
        }];
      }),
    [pendingActionByItem, syncedNextSupplierByItem, warehouseLines],
  );

  const warehouseLineByItemKey = useMemo(
    () => new Map(warehouseLines.map((line) => [line.itemKey, line])),
    [warehouseLines],
  );
  const warehouseLineByItemId = useMemo(
    () =>
      new Map(
        warehouseLines.map((line) => [String(line.item.dbId || line.item.id), line]),
      ),
    [warehouseLines],
  );
  const liveWarehouseItemKeys = useMemo(
    () => new Set(warehouseLines.map((line) => String(line.itemKey))),
    [warehouseLines],
  );
  const liveWarehouseItemIds = useMemo(
    () => new Set(warehouseLines.map((line) => String(line.item.dbId || line.item.id))),
    [warehouseLines],
  );

  // ChP-05 Phase 3: present the POS queue exactly by customer order instead of
  // merging the same product across different customers. Each row still reuses
  // the existing fast Buy/Sync workflow, so this is a display grouping only.
  const orderQueueSections = useMemo(() => {
    const stage = tab === "Next Supplier" ? "Next Supplier" : "Pre-order";
    const lines = allLines.filter((entry) =>
      tab === "Pre-order Queue"
        ? isWarehousePreOrderQueueLine(entry.order, entry.displayStatus)
        : entry.displayStatus === stage);
    const sections = new Map();
    for (const line of lines) {
      const orderKey = String(line.orderNumber || line.customerName || "Unknown");
      const section = sections.get(orderKey) || {
        orderKey,
        orderNumber: line.orderNumber,
        customerName: line.customerName,
        branchName: line.branchName,
        rows: [],
      };
      section.rows.push({
        productId: line.itemKey,
        productName: line.productName,
        category: line.category,
        subCategory: line.subCategory,
        brand: line.brand,
        series: line.series,
        requiredQty: Number(line.qty || 0),
        lines: [line],
      });
      sections.set(orderKey, section);
    }
    return [...sections.values()]
      .map((section) => ({
        ...section,
        rows: section.rows.sort(compareWarehouseProducts),
      }))
      .sort((a, b) =>
        String(a.customerName || "").localeCompare(String(b.customerName || "")) ||
        String(a.orderNumber || "").localeCompare(String(b.orderNumber || "")));
  }, [allLines, tab]);

  const activePendingRecords = useMemo(() => {
    if (tab === "Bought") {
      const sessionStartedAt = purchaseSession?.startedAt ? new Date(purchaseSession.startedAt).getTime() : 0;
      return pendingActions.filter((event) => {
        if (!["Buy", "PartialBuy"].includes(event.actionType)) return false;
        if (!sessionStartedAt) return true;
        const eventTime = new Date(event.timestamp || 0).getTime();
        return Number.isFinite(eventTime) && eventTime >= sessionStartedAt;
      });
    }
    return [];
  }, [pendingActions, tab, purchaseSession?.startedAt]);

  const todayKey = localDateKey();
  const todayPurchaseEvents = useMemo(() => {
    const recalled = new Set(
      historyEvents
        .filter((event) => event.actionType === "Recall")
        .flatMap((event) => [event.recalledClientActionId, event.recalledEventId])
        .filter(Boolean)
        .map(String),
    );
    const seen = new Set();
    const sessionStartedAt = purchaseSession?.startedAt ? new Date(purchaseSession.startedAt).getTime() : 0;
    return historyEvents.filter((event) => {
      const identity = String(event.clientActionId || event.id || "");
      const stamp = localDateKey(event.timestamp);
      const eventTime = new Date(event.timestamp || 0).getTime();
      if (!identity || seen.has(identity) || recalled.has(identity)) return false;
      if (!["Buy", "PartialBuy"].includes(event.actionType) || stamp !== todayKey) return false;
      if (sessionStartedAt && (!Number.isFinite(eventTime) || eventTime < sessionStartedAt)) return false;
      seen.add(identity);
      return true;
    });
  }, [historyEvents, todayKey, purchaseSession?.startedAt]);

  const boughtTodayTotal = useMemo(
    () => todayPurchaseEvents.reduce((sum, event) => sum + Number(event.quantity || 0), 0),
    [todayPurchaseEvents],
  );
  const boughtTodayAmount = useMemo(
    () => todayPurchaseEvents.reduce((sum, event) => sum + Number(event.totalCost || 0), 0),
    [todayPurchaseEvents],
  );

  const purchaseHistoryByDate = useMemo(() => {
    const recalled = new Set(
      historyEvents
        .filter((event) => event.actionType === "Recall")
        .flatMap((event) => [event.recalledClientActionId, event.recalledEventId])
        .filter(Boolean)
        .map(String),
    );
    const seen = new Set();
    const groups = new Map();
    const sessionStartedAt = !historyOnly && purchaseSession?.startedAt ? new Date(purchaseSession.startedAt).getTime() : 0;
    for (const event of historyEvents) {
      const identity = String(event.clientActionId || event.id || "");
      if (!identity || seen.has(identity) || recalled.has(identity)) continue;
      if (!["Buy", "PartialBuy", "NextSup", "Remove"].includes(event.actionType)) continue;
      if (sessionStartedAt) {
        const eventTime = new Date(event.timestamp || 0).getTime();
        if (!Number.isFinite(eventTime) || eventTime < sessionStartedAt) continue;
      }
      seen.add(identity);
      const date = localDateKey(event.timestamp) || "Unknown date";
      const records = groups.get(date) || [];
      records.push(event);
      groups.set(date, records);
    }
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [historyEvents, historyOnly, purchaseSession?.startedAt]);

  const purchaseReportRows = useMemo(() => {
    const recalled = new Set(
      historyEvents
        .filter((event) => event.actionType === "Recall")
        .flatMap((event) => [event.recalledClientActionId, event.recalledEventId])
        .filter(Boolean)
        .map(String),
    );
    const seen = new Set();
    const query = purchaseReportSearch.trim().toLowerCase();
    const sessionStartedAt = !historyOnly && purchaseSession?.startedAt ? new Date(purchaseSession.startedAt).getTime() : 0;
    return historyEvents.filter((event) => {
      const identity = String(event.clientActionId || event.id || "");
      if (!identity || seen.has(identity) || recalled.has(identity)) return false;
      if (!["Buy", "PartialBuy", "NextSup", "Remove"].includes(event.actionType)) return false;
      if (sessionStartedAt) {
        const eventTime = new Date(event.timestamp || 0).getTime();
        if (!Number.isFinite(eventTime) || eventTime < sessionStartedAt) return false;
      }
      seen.add(identity);
      const date = localDateKey(event.timestamp);
      const actionLabel = ["Buy", "PartialBuy"].includes(event.actionType)
        ? "Bought"
        : event.actionType === "NextSup"
          ? "Next Supplier"
          : "Cannot Supply";
      if (purchaseReportFrom && date < purchaseReportFrom) return false;
      if (purchaseReportTo && date > purchaseReportTo) return false;
      if (purchaseReportSupplier !== "All" && String(event.supplierName || "—") !== purchaseReportSupplier) return false;
      if (purchaseReportAction !== "All" && actionLabel !== purchaseReportAction) return false;
      if (query) {
        const haystack = [event.productName, event.productCode, event.supplierName, event.orderNumber, actionLabel]
          .filter(Boolean)
          .join(" " )
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [historyEvents, historyOnly, purchaseSession?.startedAt, purchaseReportSearch, purchaseReportSupplier, purchaseReportAction, purchaseReportFrom, purchaseReportTo]);

  const purchaseReportSuppliers = useMemo(() =>
    [...new Set(historyEvents.map((event) => String(event.supplierName || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [historyEvents],
  );

  const purchaseReportPageCount = Math.max(1, Math.ceil(purchaseReportRows.length / purchaseReportPageSize));
  const purchaseReportPageRows = useMemo(() => {
    const start = (purchaseReportPage - 1) * purchaseReportPageSize;
    return purchaseReportRows.slice(start, start + purchaseReportPageSize);
  }, [purchaseReportRows, purchaseReportPage, purchaseReportPageSize]);

  useEffect(() => {
    setPurchaseReportPage(1);
  }, [purchaseReportSearch, purchaseReportSupplier, purchaseReportAction, purchaseReportFrom, purchaseReportTo, purchaseReportPageSize]);

  useEffect(() => {
    if (purchaseReportPage > purchaseReportPageCount) setPurchaseReportPage(purchaseReportPageCount);
  }, [purchaseReportPage, purchaseReportPageCount]);

  const purchaseReportStats = useMemo(() => {
    const bought = purchaseReportRows.filter((row) => ["Buy", "PartialBuy"].includes(row.actionType));
    const totalQty = bought.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const totalSpend = bought.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
    const uniqueProducts = new Set(bought.map((row) => String(row.productId || row.productCode || row.productName || ""))).size;
    const uniqueSuppliers = new Set(bought.map((row) => String(row.supplierName || "")).filter(Boolean)).size;
    const nextSupplierQty = purchaseReportRows.filter((row) => row.actionType === "NextSup").reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const cannotSupplyQty = purchaseReportRows.filter((row) => row.actionType === "Remove").reduce((sum, row) => sum + Number(row.quantity || 0), 0);

    const productMap = new Map();
    const supplierMap = new Map();
    for (const row of bought) {
      const productKey = String(row.productId || row.productCode || row.productName || "Unknown");
      const product = productMap.get(productKey) || { name: row.productName || "Unknown Product", qty: 0, spend: 0 };
      product.qty += Number(row.quantity || 0);
      product.spend += Number(row.totalCost || 0);
      productMap.set(productKey, product);
      const supplierKey = String(row.supplierName || "Unknown Supplier");
      const supplier = supplierMap.get(supplierKey) || { name: supplierKey, qty: 0, spend: 0 };
      supplier.qty += Number(row.quantity || 0);
      supplier.spend += Number(row.totalCost || 0);
      supplierMap.set(supplierKey, supplier);
    }

    return {
      totalQty,
      totalSpend,
      uniqueProducts,
      uniqueSuppliers,
      nextSupplierQty,
      cannotSupplyQty,
      avgCost: totalQty > 0 ? totalSpend / totalQty : 0,
      topProducts: [...productMap.values()].sort((a, b) => b.qty - a.qty || b.spend - a.spend).slice(0, 10),
      topSuppliers: [...supplierMap.values()].sort((a, b) => b.spend - a.spend || b.qty - a.qty).slice(0, 10),
    };
  }, [purchaseReportRows]);

  const receivedOrderPreOrders = useMemo(() => {
    const result = [];
    for (const order of effectiveOrders || []) {
      if (!["Received", "In Progress"].includes(String(order?.status || "").trim())) continue;
      for (const item of order.items || []) {
        const status = item.sourceStatus || item.source_status || item.status;
        if (!isPreOrderStatus(status)) continue;
        const product = productById.get(String(itemProductId(item))) || {};
        result.push({
          order,
          item,
          itemKey: getItemKey(order, item),
          productId: String(itemProductId(item) || item.productCode || item.name),
          productName: item.name || item.productName || product.name || "Unnamed Product",
          customerName: order.companyName || order.customerName || "Unknown Customer",
          branchName: order.branchName || order.branch_name || "",
          orderNumber: order.orderId || order.order_number,
          qty: getItemQty(item),
        });
      }
    }
    return result.sort((left, right) =>
      String(left.orderNumber || "").localeCompare(String(right.orderNumber || "")) ||
      String(left.productName || "").localeCompare(String(right.productName || ""))
    );
  }, [effectiveOrders, productById]);

  const selectedSupplier = (stage) => {
    const supplierId = stage === "Next Supplier" ? nextSupplierId : queueSupplierId;
    return supplierById.get(String(supplierId)) || null;
  };

  const queueAction = async (
    actionType,
    entries,
    supplier,
    batchId = safeUuid(),
    supplierCostOverride = null,
  ) => {
    const timestamp = new Date().toISOString();
    const actions = await Promise.all(entries.map(async (entry) => {
      const line = entry.line || entry;
      const quantity = Number(entry.allocateQty ?? line.qty ?? 0);
      const remainingQty =
        entry.remainingQty === undefined ? undefined : Number(entry.remainingQty || 0);
      const previousStatus = line.displayStatus === "Next Supplier"
        ? "Next Supplier"
        : line.status || "Need Supplier";
      const restoreQuantity = Number(
        line.latestAction?.previousQty ?? line.originalQty ?? line.qty ?? 0,
      );
      const baseChanges = preOrderSupplyItemChanges(actionType, {
        quantity,
        remainingQuantity: remainingQty,
        restoreQuantity,
      });
      const changes = baseChanges;
      const resolvedSupplierCost = ["Buy", "PartialBuy"].includes(actionType) && supplier?.id
        ? (supplierCostOverride || await supplierCostForProduct(supplier.id, itemProductId(line.item)))
        : null;
      // Cost entry is optional during rollout. If a supplier/product cost is not yet
      // configured, allow the purchase to continue at £0.00 and preserve that zero
      // snapshot in POS Purchase History. Once a supplier cost is configured, that
      // supplier-specific cost is used automatically.
      const supplierCost = ["Buy", "PartialBuy"].includes(actionType)
        ? (resolvedSupplierCost || { unitCost: 0, pricingBasis: "STANDARD" })
        : null;
      return {
        id: `${line.itemKey}:${actionType}:${safeUuid()}`,
        clientActionId: safeUuid(),
        batchId,
        purchaseSessionId: purchaseSession?.sessionId || null,
        purchaseSessionDate: purchaseSession?.date || localDateKey(),
        itemKey: line.itemKey,
        orderId: line.orderNumber,
        itemId: line.item.dbId || line.item.id,
        actionType,
        productId: itemProductId(line.item),
        productCode: line.item.productCode || line.item.product_code || null,
        productName: line.productName,
        customerId: line.order.customerAccountId || line.order.customer_account_id || null,
        customerName: line.customerName,
        branchName: line.branchName,
        country:
          line.order.customer_country || line.order.customerCountry ||
          line.order.branch_country || line.order.branchCountry ||
          line.order.delivery_country || line.order.country || null,
        warehouseLocation:
          line.order.warehouseLocation || line.order.warehouse_location || null,
        supplierId: supplier?.id || null,
        supplierName: supplier?.supplier_name || null,
        unitCost: supplierCost?.unitCost ?? null,
        pricingBasis: supplierCost?.pricingBasis || null,
        totalCost: supplierCost ? Number((supplierCost.unitCost * quantity).toFixed(2)) : 0,
        quantity,
        previousQty: line.originalQty,
        remainingQty,
        previousStatus,
        newStatus: changes?.sourceStatus || previousStatus,
        changes,
        itemSnapshot: {
          ...line.item,
          productId: itemProductId(line.item),
          name: line.productName,
          qty: quantity,
          pickedQty: quantity,
          sourceStatus: "In Stock",
          includeInPicking: true,
        },
        recallAddedItemId: actionType === "Recall" ? line.latestAction?.addedItemId || null : null,
        recalledClientActionId:
          actionType === "Recall" ? line.latestAction?.clientActionId || null : null,
        recalledEventId: actionType === "Recall" ? line.latestAction?.id || null : null,
        referencedEventId:
          actionType === "Recall Available" ? line.latestAction?.id || null : null,
        referencedClientActionId:
          actionType === "Recall Available" ? line.latestAction?.clientActionId || null : null,
        userId: loggedInUser?.id || loggedInUser?.staff_id || null,
        userName: loggedInUser?.staff_name || loggedInUser?.username || null,
        timestamp,
        syncStatus: "pending",
      };
    }));
    setPendingActions((current) => [...current, ...actions]);
    return actions;
  };

  const openAllocation = (group) => {
    const initialQty = Number(buyQty[group.productId] ?? group.requiredQty);
    setBuyQty((current) => ({ ...current, [group.productId]: initialQty }));
    setAllocations((current) => ({
      ...current,
      [group.productId]: allocateSupplierQuantity(group.lines, initialQty),
    }));
    setExpandedProduct(group.productId);
  };

  const updateBuyQuantity = (group, value) => {
    const quantity = Math.max(0, Math.min(group.requiredQty, Number(value || 0)));
    setBuyQty((current) => ({ ...current, [group.productId]: quantity }));
    setAllocations((current) => ({
      ...current,
      [group.productId]: allocateSupplierQuantity(group.lines, quantity),
    }));
  };

  const confirmBuy = async (group) => {
    const supplier = selectedSupplier(tab);
    if (!supplier) return alert("Select a supplier before buying.");
    const requested = Number(buyQty[group.productId] ?? group.requiredQty);
    const currentAllocations = allocations[group.productId] || {};
    const allocationTotal = Object.values(currentAllocations).reduce(
      (sum, value) => sum + Number(value || 0),
      0,
    );
    if (allocationTotal !== requested) {
      return alert(`Customer allocations must total ${requested}. Current total: ${allocationTotal}.`);
    }

    try {
      // Resolve supplier cost once for this product, then queue every customer allocation
      // locally. A product group can contain many order lines, so reloading the same
      // supplier pricing for every line makes Confirm Buy unnecessarily slow.
      const batchId = safeUuid();
      const supplierCost = await supplierCostForProduct(supplier.id, group.productId);
      const fullBuys = [];
      const partialBuys = [];

      for (const line of group.lines) {
        const allocated = Number(currentAllocations[line.itemKey] || 0);
        if (allocated <= 0) continue;
        if (allocated >= line.qty) {
          fullBuys.push({ line, allocateQty: line.qty });
        } else {
          partialBuys.push({
            line,
            allocateQty: allocated,
            remainingQty: line.qty - allocated,
          });
        }
      }

      await Promise.all([
        fullBuys.length
          ? queueAction("Buy", fullBuys, supplier, batchId, supplierCost)
          : Promise.resolve(),
        partialBuys.length
          ? queueAction("PartialBuy", partialBuys, supplier, batchId, supplierCost)
          : Promise.resolve(),
      ]);
      setExpandedProduct(null);
    } catch (error) {
      alert(error?.message || "Supplier cost price could not be loaded.");
    }
  };

  const moveToNextSupplier = async (group) => {
    const supplier = selectedSupplier("Pre-order Queue");
    if (!supplier) return alert("Select the supplier that could not fulfil this product.");
    await queueAction("NextSup", group.lines, supplier);
  };

  const removeFromNextSupplier = async (group) => {
    const supplier = selectedSupplier("Next Supplier");
    if (!supplier) return alert("Select the supplier that could not supply this product.");
    await queueAction("Remove", group.lines, supplier);
  };

  const recallPendingRecords = (records) => {
    const ids = new Set((records || []).map((record) => String(record.clientActionId || record.id || "")));
    const itemKeys = new Set((records || []).map((record) => String(record.itemKey || "")));
    setPendingActions((current) => current.filter((action) => {
      const actionId = String(action.clientActionId || action.id || "");
      const actionKey = String(action.itemKey || "");
      return !ids.has(actionId) && !itemKeys.has(actionKey);
    }));
  };

  const recallNextSupplierGroup = async (group) => {
    const lines = group?.lines || [];
    if (!lines.length) return;

    const pendingRecords = [];
    const persistedLines = [];

    for (const line of lines) {
      const pendingAction = pendingActionByItem[line.itemKey];
      if (pendingAction?.actionType === "NextSup") {
        pendingRecords.push(pendingAction);
        continue;
      }

      if (line.latestAction?.actionType === "NextSup" || line.displayStatus === "Next Supplier") {
        persistedLines.push(line);
      }
    }

    // An unsynced Next Supplier action has not changed Warehouse yet, so removing
    // the local pending action is enough to return it to the Pre-order queue.
    if (pendingRecords.length) recallPendingRecords(pendingRecords);

    // A synced Next Supplier action has already persisted the Warehouse status.
    // Queue a real Recall so Sync restores Need Supplier and records the reversal.
    if (persistedLines.length) {
      await queueAction("Recall", persistedLines, null);
    }
  };

  const cacheSupplierHighlight = (action = {}) => {
    if (!["Buy", "PartialBuy", "Recall"].includes(action.actionType)) return;
    try {
      const cache = readJson(PREORDER_SUPPLIER_HIGHLIGHT_KEY, {});
      const targetItemId = action.actionType === "PartialBuy"
        ? (action.addedItemId || action.itemId)
        : action.itemId;
      const key = `${action.orderId}:${targetItemId}`;
      if (action.actionType === "Recall") {
        delete cache[key];
        if (action.recallAddedItemId) delete cache[`${action.orderId}:${action.recallAddedItemId}`];
      } else {
        cache[key] = {
          supplierId: action.supplierId || null,
          supplierName: action.supplierName || "Supplier",
          syncedAt: action.timestamp || new Date().toISOString(),
        };
      }
      localStorage.setItem(PREORDER_SUPPLIER_HIGHLIGHT_KEY, JSON.stringify(cache));
    } catch {
      // Highlight cache is visual only; never slow or fail the purchasing workflow.
    }
  };

  const syncPendingActions = async () => {
    if (syncing || pendingActions.length === 0) return;
    setSyncing(true);

    setSyncMessage("");
    const failed = [];
    const synced = {};
    const persistedByClientActionId = new Map();
    const groupedActions = new Map();

    // Actions for one order item must stay sequential (for example Buy -> Recall),
    // but unrelated order items can sync in parallel.
    const selectedItemKeys = [];
    const selectedItemKeySet = new Set();
    for (const action of pendingActions) {
      const key = String(action.itemKey || action.itemId || action.clientActionId);
      if (!selectedItemKeySet.has(key)) {
        if (selectedItemKeys.length >= MAX_SYNC_PRODUCTS) continue;
        selectedItemKeys.push(key);
        selectedItemKeySet.add(key);
      }
      if (!selectedItemKeySet.has(key)) continue;
      const group = groupedActions.get(key) || [];
      group.push(action);
      groupedActions.set(key, group);
    }

    const syncAction = async (action) => {
      let persistedAction = action;

      if (["Available", "Recall Available"].includes(action.actionType)) {
        const line = warehouseLineByItemKey.get(action.itemKey) ||
          warehouseLineByItemId.get(String(action.itemId));
        if (!line) throw new Error("The related order item is no longer in the active workflow.");
        const savedWarehouseEvent = await recordWarehouseOperationalActivity({
          order: line.order,
          item: line.item,
          actionType: action.actionType,
          newStatus: action.newStatus,
          sourceModule: "Pre-Order Supply",
          referencedEventId: action.referencedEventId,
          referencedClientActionId: action.referencedClientActionId,
        }, loggedInUser);
        synced[action.itemKey] = null;
        return;
      }

      if (action.actionType === "PartialBuy") {
        if (typeof splitPreOrderItem === "function") {
          const added = await splitPreOrderItem(
            action.orderId,
            action.itemId,
            action.quantity,
            action.remainingQty,
          );
          if (!added) throw new Error("The partial Buy split did not complete.");
          persistedAction = { ...action, addedItemId: added?.id || added?.dbId || null };
        } else {
          const updated = await updateOrderItem(action.orderId, action.itemId, action.changes);
          if (updated === false) throw new Error("The remaining Pre-Order quantity did not update.");
          if (typeof addOrderItem === "function") {
            const added = await addOrderItem(action.orderId, action.itemSnapshot);
            if (!added) throw new Error("The bought split quantity was not created.");
            persistedAction = { ...action, addedItemId: added?.id || added?.dbId || null };
          }
        }
      } else if (action.actionType === "Recall") {
        const recalledAction = persistedByClientActionId.get(action.recalledClientActionId);
        const recallAddedItemId = action.recallAddedItemId || recalledAction?.addedItemId || null;
        if (recallAddedItemId && typeof restorePreOrderSplit === "function") {
          const restored = await restorePreOrderSplit(
            action.orderId,
            action.itemId,
            recallAddedItemId,
            Number(action.previousQty || action.quantity || 0),
          );
          if (restored === false) throw new Error("The recalled partial Buy did not restore.");
        } else {
          const restored = await updateOrderItem(action.orderId, action.itemId, action.changes);
          if (restored === false) throw new Error("The recalled Pre-Order quantity did not restore.");
        }
        if (recallAddedItemId && typeof restorePreOrderSplit !== "function") {
          const cleared = await updateOrderItem(action.orderId, recallAddedItemId, {
            sourceStatus: "Need Supplier",
            includeInPicking: false,
            pickedQty: 0,
            qty: 0,
          });
          if (cleared === false) throw new Error("The recalled bought split did not clear.");
        }
      } else if (action.actionType === "Remove") {
        // Cannot Supply is a single Warehouse transition + audit event.
        // Do not update the item first or the RPC sees Cannot Supply -> Cannot Supply.
        const line = warehouseLineByItemKey.get(action.itemKey) ||
          warehouseLineByItemId.get(String(action.itemId));
        if (!line) throw new Error("The related order item is no longer in the active workflow.");
        try {
          await recordWarehouseOperationalActivity({
            order: line.order,
            item: line.item,
            actionType: "Cannot Supply",
            newStatus: "Cannot Supply",
            sourceModule: "Pre-Order Supply",
          }, loggedInUser);
        } catch (error) {
          // Recovery for actions left pending by the old two-step implementation:
          // the item may already be Cannot Supply even though the POS event did not finish.
          if (!String(error?.message || "").includes("valid Warehouse status transition")) throw error;
          const itemId = action.itemId || line.item?.dbId || line.item?.id;
          const { data: currentItem, error: currentItemError } = await supabase
            .from("order_items")
            .select("source_status")
            .eq("id", itemId)
            .maybeSingle();
          if (currentItemError || warehouseSupplyStage(currentItem?.source_status) !== "Cannot Supply") {
            throw error;
          }
          // Status is already correct; continue so history/audit can complete and
          // this stale pending action is removed.
        }
      } else {
        const updated = await updateOrderItem(action.orderId, action.itemId, action.changes);
        if (updated === false) throw new Error("The Warehouse item did not update.");
      }

      persistedAction = { ...persistedAction, syncStatus: "synced" };

      // Save the permanent supplier event before we consider a Buy successfully synced.
      // If the status update succeeded but the event save fails, immediately restore only
      // the previous status. Quantities / picked / packed / inclusion flags are never changed.
      let savedEvent;
      try {
        savedEvent = await recordPreOrderSupplyEvent(persistedAction, loggedInUser);
      } catch (historyError) {
        try {
          if (action.actionType === "Buy") {
            // Full Buy only changed the supply status, so restore status only.
            await updateOrderItem(action.orderId, action.itemId, {
              sourceStatus: action.previousStatus || "Need Supplier",
            });
          } else if (action.actionType === "PartialBuy") {
            // Partial Buy creates a temporary split before the supplier event is saved.
            // If permanent history fails, undo that split so the order is exactly as it
            // was before Sync. This is failure rollback only; successful Buy never changes
            // any extra quantity/picked/packed fields beyond the existing split workflow.
            const addedItemId = persistedAction.addedItemId || null;
            if (addedItemId && typeof restorePreOrderSplit === "function") {
              const restored = await restorePreOrderSplit(
                action.orderId,
                action.itemId,
                addedItemId,
                Number(action.previousQty || action.quantity || 0),
              );
              if (restored === false) throw new Error("Partial Buy split rollback did not complete.");
            } else {
              await updateOrderItem(action.orderId, action.itemId, {
                sourceStatus: action.previousStatus || "Need Supplier",
                qty: Number(action.previousQty || action.quantity || 0),
              });
              if (addedItemId) {
                await updateOrderItem(action.orderId, addedItemId, {
                  sourceStatus: action.previousStatus || "Need Supplier",
                  qty: 0,
                });
              }
            }
          }
        } catch (restoreError) {
          console.error("Pre-order supplier state rollback failed after history error:", restoreError);
        }
        throw historyError;
      }

      // Audit logging is secondary to the permanent supplier event. A transient audit-log
      // failure must not create an In Stock item with missing supplier ownership/history.
      try {
        await logAction({
          user: loggedInUser,
          action_type: `Pre-order Supply ${action.actionType}`,
          page_module: "Pre-order Supply",
          order_id: action.orderId,
          product_id: action.productId,
          old_value: action.previousStatus,
          new_value: {
            supplierId: action.supplierId,
            supplierName: action.supplierName,
            customerName: action.customerName,
            branchName: action.branchName,
            quantity: action.quantity,
            unitCost: action.unitCost,
            totalCost: action.totalCost,
            pricingBasis: action.pricingBasis,
            remainingQty: action.remainingQty,
            status: action.newStatus,
            batchId: action.batchId,
          },
        });
      } catch (auditError) {
        console.warn("Pre-order Supply audit log skipped:", auditError?.message || auditError);
      }

      setHistoryEvents((current) => [savedEvent, ...current]);
      cacheSupplierHighlight(persistedAction);
      persistedByClientActionId.set(action.clientActionId, persistedAction);
      synced[action.itemKey] = action.actionType === "Recall" ? null : persistedAction;
    };

    const groups = [...groupedActions.values()];
    let nextGroupIndex = 0;
    const worker = async () => {
      while (nextGroupIndex < groups.length) {
        const group = groups[nextGroupIndex++];
        let groupFailed = false;
        for (const action of group) {
          if (groupFailed) {
            failed.push({
              ...action,
              syncStatus: "failed",
              error: "An earlier pending change for this item failed.",
            });
            continue;
          }
          try {
            await syncAction(action);
          } catch (error) {
            groupFailed = true;
            failed.push({ ...action, syncStatus: "failed", error: error.message });
          }
        }
      }
    };

    try {
      const workerCount = Math.min(4, groups.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      setActionHistory((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(synced)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        return next;
      });
      const untouched = pendingActions.filter((action) => !selectedItemKeySet.has(String(action.itemKey || action.itemId || action.clientActionId)));
      const remaining = [...failed, ...untouched];
      setPendingActions(remaining);
      const syncedCount = pendingActions.length - untouched.length - failed.length;
      setSyncMessage(failed.length > 0
        ? `Synced ${syncedCount}. Failed ${failed.length}. ${failed[0]?.error || "Retry when signal improves."}`
        : `Synced ${syncedCount}. ${untouched.length > 0 ? `${untouched.length} changes remain for the next batch.` : "All changes are up to date."}`);

      if (remaining.length === 0) {
        localStorage.removeItem(PREORDER_SUPPLY_PENDING_KEY);
      }

      // Core sync is complete at this point. Do not keep the Sync button blocked while
      // the much larger order refresh and shared-history reload run. The UI already has
      // the saved events above, so these can safely refresh in the background.
      void (async () => {
        if (typeof refreshOrders === "function") {
          try { await refreshOrders(); } catch { /* preserve the cached warehouse snapshot */ }
        }

        // Do not reload the full permanent event archive here. Each successful sync
        // already inserted its saved event into local state above. Reloading up to 20
        // pages after every batch was generating hundreds of requests and delaying the UI.
      })();
    } finally {
      setSyncing(false);
    }
  };

  const renderQueue = () => {
    const supplierId = tab === "Next Supplier" ? nextSupplierId : queueSupplierId;
    const setSupplierId = tab === "Next Supplier" ? setNextSupplierId : setQueueSupplierId;
    return (
      <>
        <div className="mb-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          <SupplierSelector suppliers={suppliers} value={supplierId} onChange={setSupplierId} />
        </div>
        <div className="space-y-2">
          {orderQueueSections.map((section) => (
            <div key={section.orderKey} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-900 sm:text-base">
                    {section.customerName}{section.branchName ? ` · ${section.branchName}` : ""}
                  </div>
                  <div className="mt-0.5 text-xs font-bold text-slate-500">Order {section.orderNumber}</div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedOrderSections((current) => ({
                      ...current,
                      [section.orderKey]: current[section.orderKey] === false ? true : false,
                    }))
                  }
                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-extrabold text-slate-700 hover:bg-slate-100"
                  aria-expanded={collapsedOrderSections[section.orderKey] === false}
                >
                  {collapsedOrderSections[section.orderKey] === false ? "Hide" : "Show"}
                </button>
              </div>
              {collapsedOrderSections[section.orderKey] === false && (
              <div className="divide-y divide-slate-100">
                {section.rows.map((group) => {
                  const open = expandedProduct === group.productId;
                  const selectedQty = Number(buyQty[group.productId] ?? group.requiredQty);
                  const groupAllocations = allocations[group.productId] || {};
                  return (
                    <div key={group.productId} className="p-3">
                      <div className="grid grid-cols-[minmax(0,1fr)_60px] items-center gap-2">
                        <div className="min-w-0 truncate text-xs font-extrabold text-slate-900">{group.productName}</div>
                        <div className="text-right text-xs font-extrabold text-slate-700">Qty {group.requiredQty}</div>
                      </div>
                      <div className={`mt-2 grid gap-2 ${tab === "Next Supplier" ? "grid-cols-3" : "grid-cols-2"}`}>
                        <button type="button" onClick={() => openAllocation(group)} className="rounded-lg bg-green-700 px-3 py-2 text-xs font-extrabold text-white">Buy</button>
                        {tab === "Pre-order Queue" ? (
                          <button type="button" onClick={() => moveToNextSupplier(group)} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-extrabold text-white">Next Supplier</button>
                        ) : (
                          <>
                            <button type="button" onClick={() => removeFromNextSupplier(group)} className="rounded-lg bg-red-700 px-3 py-2 text-xs font-extrabold text-white">Cannot Supply</button>
                            <button type="button" onClick={() => recallNextSupplierGroup(group)} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-extrabold text-white">Recall</button>
                          </>
                        )}
                      </div>
                      {open && (
                        <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                          <label className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700">
                            Available from supplier
                            <input type="number" min="0" max={group.requiredQty} value={selectedQty} onChange={(event) => updateBuyQuantity(group, event.target.value)} className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-center font-extrabold" />
                          </label>
                          {group.lines.map((line) => (
                            <div key={line.itemKey} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs">
                              <span className="font-bold text-slate-700">Needs {line.qty}</span>
                              <input aria-label={`Allocate ${line.productName} to ${line.customerName}`} type="number" min="0" max={line.qty} value={groupAllocations[line.itemKey] ?? 0} onChange={(event) => setAllocations((current) => ({ ...current, [group.productId]: { ...(current[group.productId] || {}), [line.itemKey]: Math.max(0, Math.min(line.qty, Number(event.target.value || 0))) } }))} className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-center text-xs font-extrabold" />
                            </div>
                          ))}
                          <div className="flex items-center justify-between text-xs font-extrabold text-slate-700">
                            <span>Allocated {Object.values(groupAllocations).reduce((sum, value) => sum + Number(value || 0), 0)} of {selectedQty}</span>
                            <button type="button" onClick={() => confirmBuy(group)} className="rounded-lg bg-green-700 px-4 py-2 text-xs font-extrabold text-white">Confirm Buy</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          ))}
          {orderQueueSections.length === 0 && (
            <div className="rounded-xl bg-white p-8 text-center text-sm font-bold text-slate-500">
              No products in this queue.
            </div>
          )}
        </div>
      </>
    );
  };

  const money = (value) => Number(value || 0).toLocaleString("en-GB", {
    style: "currency", currency: "GBP",
  });

  const renderActiveEvents = () => (
    <div className="space-y-4">
      {tab === "Bought" && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-extrabold text-slate-800">Pending Bought · Qty {activePendingRecords.reduce((sum, record) => sum + Number(record.quantity || 0), 0)}</span>
              <span className="text-[11px] font-bold text-amber-700">{activePendingRecords.length} records pending sync</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_130px_70px_100px_110px_80px] gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-extrabold uppercase text-slate-500">
              <span>Product</span><span>Supplier</span><span>Qty</span><span>Cost</span><span>Total</span><span>Action</span>
            </div>
            {activePendingRecords.map((record) => (
              <div key={record.clientActionId || record.id} className="grid grid-cols-[minmax(0,1fr)_130px_70px_100px_110px_80px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                <span className="truncate font-extrabold text-slate-800">{record.productName}</span>
                <span className="truncate">{record.supplierName || "—"}</span>
                <span>{record.quantity}</span>
                <span>{money(record.unitCost)}</span>
                <span className="font-extrabold">{money(record.totalCost)}</span>
                <button type="button" onClick={() => recallPendingRecords([record])} className="rounded bg-slate-700 px-2 py-1 text-[11px] font-extrabold text-white">Recall</button>
              </div>
            ))}
            {activePendingRecords.length === 0 && <div className="p-5 text-center text-sm font-bold text-slate-500">No pending Bought items.</div>}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-white p-3 text-sm font-extrabold text-slate-900 shadow-sm">Bought today: {boughtTodayTotal} items</div>
            <div className="rounded-xl bg-white p-3 text-sm font-extrabold text-slate-900 shadow-sm">Purchase amount today: {money(boughtTodayAmount)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold text-slate-800">Synced Today</div>
            <div className="grid grid-cols-[minmax(0,1fr)_130px_70px_100px_110px] gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-extrabold uppercase text-slate-500">
              <span>Product</span><span>Supplier</span><span>Qty</span><span>Cost</span><span>Total</span>
            </div>
            {todayPurchaseEvents.map((record) => (
              <div key={record.clientActionId || record.id} className="grid grid-cols-[minmax(0,1fr)_130px_70px_100px_110px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                <span className="truncate font-extrabold text-slate-800">{record.productName}</span>
                <span className="truncate">{record.supplierName || "—"}</span>
                <span>{record.quantity}</span>
                <span>{money(record.unitCost)}</span>
                <span className="font-extrabold">{money(record.totalCost)}</span>
              </div>
            ))}
            {todayPurchaseEvents.length === 0 && <div className="p-5 text-center text-sm font-bold text-slate-500">No purchases synced today.</div>}
          </div>
        </>
      )}

    </div>
  );

  const renderPurchaseHistory = () => (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-extrabold text-slate-900">POS Purchase Analysis</div>
            <div className="text-[11px] font-bold text-slate-500">
              {historyOnly
                ? "Permanent synced POS history for purchasing and future stock planning."
                : `Current purchase session · ${purchaseSession?.date || localDateKey()} · history starts from session start.`}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setPurchaseReportSearch(""); setPurchaseReportSupplier("All"); setPurchaseReportAction("All"); setPurchaseReportFrom(""); setPurchaseReportTo(""); setPurchaseReportPage(1); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-extrabold text-slate-700"
          >
            Clear Filters
          </button>
        </div>
        <div className="grid gap-2 md:grid-cols-5">
          <input value={purchaseReportSearch} onChange={(e) => setPurchaseReportSearch(e.target.value)} placeholder="Product, code, supplier, order" className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
          <select value={purchaseReportSupplier} onChange={(e) => setPurchaseReportSupplier(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">
            <option>All</option>
            {purchaseReportSuppliers.map((supplier) => <option key={supplier} value={supplier}>{supplier}</option>)}
          </select>
          <select value={purchaseReportAction} onChange={(e) => setPurchaseReportAction(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">
            <option>All</option><option>Bought</option><option>Next Supplier</option><option>Cannot Supply</option>
          </select>
          <input type="date" value={purchaseReportFrom} onChange={(e) => setPurchaseReportFrom(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
          <input type="date" value={purchaseReportTo} onChange={(e) => setPurchaseReportTo(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs" />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Bought Qty</div><div className="text-xl font-black text-slate-900">{purchaseReportStats.totalQty}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Purchase Spend</div><div className="text-xl font-black text-slate-900">{money(purchaseReportStats.totalSpend)}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Products Bought</div><div className="text-xl font-black text-slate-900">{purchaseReportStats.uniqueProducts}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Average Unit Cost</div><div className="text-xl font-black text-slate-900">{money(purchaseReportStats.avgCost)}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Suppliers Used</div><div className="text-xl font-black text-slate-900">{purchaseReportStats.uniqueSuppliers}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Next Supplier Qty</div><div className="text-xl font-black text-amber-700">{purchaseReportStats.nextSupplierQty}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Cannot Supply Qty</div><div className="text-xl font-black text-red-700">{purchaseReportStats.cannotSupplyQty}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-[10px] font-extrabold uppercase text-slate-500">Report Records</div><div className="text-xl font-black text-slate-900">{purchaseReportRows.length}</div></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold">Top Products Bought</div>
          {purchaseReportStats.topProducts.map((row, index) => (
            <div key={`${row.name}-${index}`} className="grid grid-cols-[30px_minmax(0,1fr)_80px_100px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
              <span>{index + 1}</span><span className="truncate font-bold">{row.name}</span><span>Qty {row.qty}</span><span className="font-extrabold">{money(row.spend)}</span>
            </div>
          ))}
          {purchaseReportStats.topProducts.length === 0 && <div className="p-5 text-center text-xs font-bold text-slate-500">No bought product data for these filters.</div>}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold">Supplier Purchase Analysis</div>
          {purchaseReportStats.topSuppliers.map((row, index) => (
            <div key={`${row.name}-${index}`} className="grid grid-cols-[30px_minmax(0,1fr)_80px_100px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
              <span>{index + 1}</span><span className="truncate font-bold">{row.name}</span><span>Qty {row.qty}</span><span className="font-extrabold">{money(row.spend)}</span>
            </div>
          ))}
          {purchaseReportStats.topSuppliers.length === 0 && <div className="p-5 text-center text-xs font-bold text-slate-500">No supplier purchase data for these filters.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-extrabold">POS Detailed History</div>
        <div className="overflow-x-auto">
          <div className="min-w-[980px]">
            <div className="grid grid-cols-[95px_110px_minmax(220px,1fr)_160px_80px_90px_100px_140px] gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-extrabold uppercase text-slate-500">
              <span>Date</span><span>Action</span><span>Product</span><span>Supplier</span><span>Qty</span><span>Unit Cost</span><span>Total</span><span>Order</span>
            </div>
            {purchaseReportPageRows.map((record) => {
              const isBought = ["Buy", "PartialBuy"].includes(record.actionType);
              const label = record.actionType === "NextSup" ? "Next Supplier" : record.actionType === "Remove" ? "Cannot Supply" : "Bought";
              return (
                <div key={record.clientActionId || record.id} className="grid grid-cols-[95px_110px_minmax(220px,1fr)_160px_80px_90px_100px_140px] gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0">
                  <span>{localDateKey(record.timestamp)}</span><span className="font-extrabold">{label}</span><span className="truncate font-bold">{record.productName}</span><span className="truncate">{record.supplierName || "—"}</span><span>{record.quantity}</span><span>{isBought ? money(record.unitCost) : "—"}</span><span className="font-extrabold">{isBought ? money(record.totalCost) : "—"}</span><span className="truncate">{record.orderNumber || "—"}</span>
                </div>
              );
            })}
            {purchaseReportRows.length === 0 && <div className="p-8 text-center text-sm font-bold text-slate-500">No POS history matches these filters.</div>}
          </div>
        </div>
        {purchaseReportRows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-600">Rows</span>
              <select
                value={purchaseReportPageSize}
                onChange={(e) => setPurchaseReportPageSize(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 font-bold"
              >
                {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
              <span className="text-slate-500">
                {(purchaseReportPage - 1) * purchaseReportPageSize + 1}-{Math.min(purchaseReportPage * purchaseReportPageSize, purchaseReportRows.length)} of {purchaseReportRows.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPurchaseReportPage((page) => Math.max(1, page - 1))}
                disabled={purchaseReportPage <= 1}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-extrabold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="min-w-[90px] text-center font-extrabold text-slate-700">Page {purchaseReportPage} of {purchaseReportPageCount}</span>
              <button
                type="button"
                onClick={() => setPurchaseReportPage((page) => Math.min(purchaseReportPageCount, page + 1))}
                disabled={purchaseReportPage >= purchaseReportPageCount}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-extrabold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-extrabold uppercase text-slate-500">Daily History</div>
        {purchaseHistoryByDate.map(([date, records]) => {
          const qty = records.filter((r) => ["Buy", "PartialBuy"].includes(r.actionType)).reduce((sum, r) => sum + Number(r.quantity || 0), 0);
          const amount = records.reduce((sum, r) => sum + Number(r.totalCost || 0), 0);
          return (
            <details key={date} open={date === todayKey} className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="cursor-pointer px-3 py-3 text-sm font-extrabold text-slate-900">{date} · Bought {qty} · {money(amount)}</summary>
              <div className="border-t border-slate-200">
                {records.map((record) => (
                  <div key={record.clientActionId || record.id} className="grid gap-1 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)_150px_70px_100px_110px]">
                    <span className="font-extrabold">{record.actionType === "NextSup" ? "Next Supplier" : record.actionType === "Remove" ? "Cannot Supply" : "Bought"}</span>
                    <span className="truncate font-bold">{record.productName}</span>
                    <span className="truncate">{record.supplierName || "—"}</span>
                    <span>Qty {record.quantity}</span>
                    <span>{["Buy", "PartialBuy"].includes(record.actionType) ? money(record.unitCost) : "—"}</span>
                    <span className="font-extrabold">{["Buy", "PartialBuy"].includes(record.actionType) ? money(record.totalCost) : "—"}</span>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
        {purchaseHistoryByDate.length === 0 && <div className="rounded-xl bg-white p-8 text-center text-sm font-bold text-slate-500">No POS Purchase History yet.</div>}
      </div>
    </div>
  );


  return (
    <div className="min-h-screen bg-slate-50 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">{historyOnly ? "POS Purchase History" : "Pre-order Supply"}</h2>
          {historyOnly ? (
            <div className="text-xs font-semibold text-slate-600">Purchase history, supplier spend and stock-planning analysis.</div>
          ) : (
            <div className="text-xs font-bold text-amber-700">
              {purchaseStarted
                ? `Purchase session ${purchaseSession?.date} · Pending changes: ${pendingActions.length} · Sync batch: max ${MAX_SYNC_PRODUCTS} products`
                : `Purchase not started for ${localDateKey()}`}
            </div>
          )}
        </div>
        {!historyOnly && purchaseStarted && (
          <button
            type="button"
            onClick={syncPendingActions}
            disabled={syncing || pendingActions.length === 0}
            className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-extrabold text-white disabled:bg-slate-300"
          >
            {syncing ? "Syncing..." : "Sync All"}
          </button>
        )}
      </div>

      {!historyOnly && syncMessage && (
        <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900">
          {syncMessage}
        </div>
      )}

      {!historyOnly && historyWarning && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {historyWarning} Current order statuses remain visible.
        </div>
      )}

      {!historyOnly && !purchaseStarted && (
        <div className="rounded-xl border border-blue-200 bg-white p-6 text-center shadow-sm">
          <div className="text-lg font-black text-slate-900">Daily Purchase Not Started</div>
          <div className="mt-1 text-xs font-semibold text-slate-600">Start today&apos;s purchase session to load the POS. Bought will begin from 0 for this session.</div>
          <button type="button" onClick={startPurchaseSession} className="mt-4 rounded-lg bg-emerald-700 px-6 py-3 text-sm font-extrabold text-white">
            Let Start Purchase
          </button>
        </div>
      )}

      {!historyOnly && purchaseStarted && (
        <div className="mb-2 flex gap-1 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setTab(item);
                setExpandedProduct(null);
              }}
              className={`whitespace-nowrap rounded-lg border px-3 py-2 text-[11px] font-extrabold ${
                tab === item ? "bg-slate-900 text-white" : "bg-white text-slate-700"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      )}

      {!historyOnly && purchaseStarted && (tab === "Pre-order Queue" || tab === "Next Supplier") ? renderQueue() : null}
      {!historyOnly && purchaseStarted && tab === "Bought" ? renderActiveEvents() : null}
      {(historyOnly || purchaseStarted) && tab === "Purchase History" ? renderPurchaseHistory() : null}
      {!historyOnly && purchaseStarted && tab === "Order Pre-orders" && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {receivedOrderPreOrders.map((line) => (
            <div key={line.itemKey} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
              <div className="min-w-0">
                <div className="truncate text-xs font-extrabold text-slate-900">{line.productName}</div>
                <div className="truncate text-[11px] font-semibold text-slate-500">
                  {line.customerName}{line.branchName ? ` · ${line.branchName}` : ""} · {line.orderNumber}
                </div>
              </div>
              <div className="text-xs font-extrabold text-slate-700">Qty {line.qty}</div>
            </div>
          ))}
          {receivedOrderPreOrders.length === 0 && (
            <div className="p-8 text-center text-sm font-bold text-slate-500">
              No Received Order pre-orders.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
