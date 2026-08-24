import { useEffect, useMemo, useState } from "react";
import { logAction } from "../utils/auditLog";
import { supabase } from "../services/supabase";
import { supplierOptionsForSelection } from "../services/suppliers";
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
import {
  loadWarehouseOperationalEvents,
  recordWarehouseOperationalActivity,
} from "../services/warehouseActivity";
import { compareWarehouseProducts } from "../utils/warehouseProductSorting";

const TABS = ["Pre-order Queue", "Next Supplier", "Bought", "Cannot Supply", "Order Pre-orders"];

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
}) {
  const loggedInUser = useMemo(
    () => JSON.parse(localStorage.getItem("loggedInUser") || "null"),
    [],
  );
  const [tab, setTab] = useState("Pre-order Queue");
  const [pendingActions, setPendingActions] = useState(() => readJson(PREORDER_SUPPLY_PENDING_KEY, []));
  const [actionHistory, setActionHistory] = useState({});
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyWarning, setHistoryWarning] = useState("");
  const [warehouseEvents, setWarehouseEvents] = useState([]);
  const [warehouseStatusOverrides, setWarehouseStatusOverrides] = useState({});
  const [warehouseActivityWarning, setWarehouseActivityWarning] = useState("");
  const [suppliers, setSuppliers] = useState([]);
  const [queueSupplierId, setQueueSupplierId] = useState("");
  const [nextSupplierId, setNextSupplierId] = useState("");
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [buyQty, setBuyQty] = useState({});
  const [allocations, setAllocations] = useState({});
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    localStorage.setItem(PREORDER_SUPPLY_PENDING_KEY, JSON.stringify(pendingActions));
  }, [pendingActions]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPendingActions((current) => {
        const filtered = filterPendingPreOrderActionsForOrders(current, orders);
        return filtered.length === current.length && filtered.every((entry, index) => entry === current[index])
          ? current
          : filtered;
      });
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [orders]);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    let active = true;

    const refreshSharedHistory = async () => {
      try {
        const { history, events, warning } = await loadPreOrderSupplyHistory(loggedInUser);
        if (!active) return;
        setHistoryWarning(warning || "");
        setActionHistory(history || {});
        setHistoryEvents(events || []);
      } catch (error) {
        console.error("Pre-order supply history load error:", error);
      }
    };

    refreshSharedHistory();
    const intervalId = window.setInterval(refreshSharedHistory, 10000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshSharedHistory();
    };
    window.addEventListener("focus", refreshSharedHistory);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSharedHistory);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loggedInUser]);

  useEffect(() => {
    let active = true;
    loadWarehouseOperationalEvents(loggedInUser).then((result) => {
      if (!active) return;
      setWarehouseEvents(result.events || []);
      setWarehouseActivityWarning(result.warning || "");
    }).catch((error) => {
      if (active) setWarehouseActivityWarning(error?.message || "Warehouse activity could not be loaded.");
    });
    return () => { active = false; };
  }, [loggedInUser]);

  const supplierById = useMemo(
    () => new Map(suppliers.map((supplier) => [String(supplier.id), supplier])),
    [suppliers],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [String(product.id), product])),
    [products],
  );

  // Current Warehouse Packing orders determine operational demand;
  // permanent events retain supplier workflow state without resurrecting exited orders.
  const pendingActionByItem = useMemo(() => {
    const latest = {};
    for (const action of pendingActions) {
      latest[action.itemKey] = action;
    }
    return latest;
  }, [pendingActions]);

  const warehouseLines = useMemo(() => {
    const result = [];
    for (const order of orders || []) {
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
  }, [orders, productById]);

  const allLines = useMemo(
    () =>
      warehouseLines.flatMap((line) => {
        const hasPendingAction = Object.prototype.hasOwnProperty.call(
          pendingActionByItem,
          line.itemKey,
        );
        const latestAction = hasPendingAction
          ? pendingActionByItem[line.itemKey]
          : actionHistory[line.itemKey];
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
    [actionHistory, pendingActionByItem, warehouseLines],
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

  const groupedQueue = useMemo(() => {
    const stage = tab === "Next Supplier" ? "Next Supplier" : "Pre-order";
    const groups = new Map();
    for (const line of allLines.filter((entry) =>
      tab === "Pre-order Queue"
        ? isWarehousePreOrderQueueLine(entry.order, entry.displayStatus)
        : entry.displayStatus === stage)) {
      const group = groups.get(line.productId) || {
        productId: line.productId,
        productName: line.productName,
        category: line.category,
        subCategory: line.subCategory,
        brand: line.brand,
        series: line.series,
        lines: [],
      };
      group.lines.push(line);
      groups.set(line.productId, group);
    }
    return [...groups.values()]
      .map((group) => ({
        ...group,
        requiredQty: group.lines.reduce((sum, line) => sum + line.qty, 0),
      }))
      .sort(compareWarehouseProducts);
  }, [allLines, tab]);

  const activeSupplierGroups = useMemo(() => {
    const targetActions =
      tab === "Bought"
        ? ["Buy", "PartialBuy"]
        : tab === "Cannot Supply"
          ? ["Remove", "Available", "Recall Available"]
          : [];

    // Pending rows are visible only on the device currently preparing them.
    // After Sync All, shared RPC history becomes the source of truth on every device.
    const combinedEvents = [...pendingActions, ...historyEvents];
    const reversedClientIds = new Set(
      combinedEvents
        .filter((event) => event.actionType === "Recall" && event.recalledClientActionId)
        .map((event) => event.recalledClientActionId),
    );
    const pendingClientIds = new Set(pendingActions.map((event) => event.clientActionId));
    const recalledWarehouseAvailableIds = new Set(
      [...warehouseEvents, ...pendingActions]
        .filter((event) => event.actionType === "Recall Available")
        .flatMap((event) => [event.referencedEventId, event.referencedClientActionId])
        .filter(Boolean)
        .map(String),
    );
    const seen = new Set();
    const supplierGroups = new Map();

    const productSortRecord = (record) => {
      const warehouseLine = warehouseLineByItemKey.get(record.itemKey) ||
        warehouseLineByItemId.get(String(record.orderItemId || record.itemId || ""));
      const product = productById.get(String(record.productId || warehouseLine?.productId || "")) || {};
      return {
        ...product,
        mainCategory:
          warehouseLine?.category || product.mainCategory || product.main_category || product.category || "",
        subCategory:
          warehouseLine?.subCategory || product.subCategory || product.sub_category || "",
        series: warehouseLine?.series || product.series || "",
        productName: record.productName || warehouseLine?.productName || product.name || "",
        sortKey: record.clientActionId || record.id || record.itemKey,
      };
    };

    const activeCannotSupplyItemKeys = new Set();
    for (const event of combinedEvents) {
      const identity = event.clientActionId || event.id;
      if (!identity || seen.has(identity) || reversedClientIds.has(identity)) continue;
      seen.add(identity);
      if (!targetActions.includes(event.actionType)) continue;
      if (!isLivePreOrderSupplyEvent(event, liveWarehouseItemKeys, liveWarehouseItemIds)) continue;

      const delivered = isDeliveryConfirmed(event);
      if (delivered) continue;
      if (!pendingClientIds.has(event.clientActionId)) {
        if (event.actionType === "Remove") {
          const warehouseLine = warehouseLineByItemKey.get(event.itemKey);
          if (warehouseSupplyStage(warehouseLine?.status) !== "Cannot Supply") continue;
        }
        if (event.actionType === "Buy" || event.actionType === "PartialBuy") {
          const boughtItemId =
            event.actionType === "PartialBuy" ? event.addedItemId : event.itemId;
          const warehouseLine = boughtItemId
            ? warehouseLineByItemId.get(String(boughtItemId))
            : warehouseLineByItemKey.get(event.itemKey);
          if (!["in stock", "available"].includes(normalizeStatus(warehouseLine?.status))) {
            continue;
          }
        }
      }
      if (["Remove", "Available"].includes(event.actionType)) {
        activeCannotSupplyItemKeys.add(event.itemKey);
      }

      const supplierName = event.supplierName || "Supplier not recorded";
      const records = supplierGroups.get(supplierName) || [];
      records.push(event);
      supplierGroups.set(supplierName, records);
    }

    if (tab === "Cannot Supply") {
      for (const line of allLines) {
        if (
          line.displayStatus !== "Cannot Supply" ||
          activeCannotSupplyItemKeys.has(line.itemKey)
        ) continue;
        const supplierName = "Supplier not recorded";
        const records = supplierGroups.get(supplierName) || [];
        records.push({
          id: `warehouse:${line.itemKey}`,
          itemKey: line.itemKey,
          itemId: line.item.dbId || line.item.id,
          actionType: "WarehouseCannotSupply",
          productId: itemProductId(line.item),
          productName: line.productName,
          customerId: line.order.customerAccountId || line.order.customer_account_id || null,
          customerName: line.customerName,
          branchName: line.branchName,
          orderId: line.orderNumber,
          quantity: line.qty,
        });
        supplierGroups.set(supplierName, records);
      }
      for (const event of warehouseEvents.filter((entry) => {
        if (entry.actionType !== "Available") return false;
        if (
          recalledWarehouseAvailableIds.has(String(entry.id)) ||
          recalledWarehouseAvailableIds.has(String(entry.clientActionId))
        ) return false;
        const warehouseLine = warehouseLineByItemKey.get(entry.itemKey) ||
          warehouseLineByItemId.get(String(entry.orderItemId || entry.itemId || ""));
        return ["in stock", "available"].includes(normalizeStatus(warehouseLine?.status)) &&
          isLivePreOrderSupplyEvent(entry, liveWarehouseItemKeys, liveWarehouseItemIds);
      })) {
        const supplierName = "Warehouse activity";
        const records = supplierGroups.get(supplierName) || [];
        records.push(event);
        supplierGroups.set(supplierName, records);
      }
    }

    return [...supplierGroups.entries()]
      .map(([supplierName, records]) => ({
        supplierName,
        records: [...records].sort((left, right) =>
          compareWarehouseProducts(productSortRecord(left), productSortRecord(right))),
      }))
      .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  }, [
    allLines,
    historyEvents,
    liveWarehouseItemIds,
    liveWarehouseItemKeys,
    pendingActions,
    productById,
    tab,
    warehouseLineByItemId,
    warehouseLineByItemKey,
    warehouseEvents,
  ]);

  const recalledAvailableEventIds = useMemo(() => new Set(
    [...warehouseEvents, ...pendingActions]
      .filter((event) => event.actionType === "Recall Available")
      .flatMap((event) => [event.referencedEventId, event.referencedClientActionId])
      .filter(Boolean),
  ), [pendingActions, warehouseEvents]);

  const receivedOrderPreOrders = useMemo(
    () =>
      allLines.filter(
        (line) =>
          ["Received", "In Progress"].includes(line.order.status) &&
          isPreOrderStatus(line.item.sourceStatus || line.item.source_status || line.item.status),
      ),
    [allLines],
  );

  const selectedSupplier = (stage) => {
    const supplierId = stage === "Next Supplier" ? nextSupplierId : queueSupplierId;
    return supplierById.get(String(supplierId)) || null;
  };

  const queueAction = (actionType, entries, supplier, batchId = safeUuid()) => {
    const timestamp = new Date().toISOString();
    const actions = entries.map((entry) => {
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
      const changes = preOrderSupplyItemChanges(actionType, {
        quantity,
        remainingQuantity: remainingQty,
        restoreQuantity,
      });
      return {
        id: `${line.itemKey}:${actionType}:${safeUuid()}`,
        clientActionId: safeUuid(),
        batchId,
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
    });
    setPendingActions((current) => [...current, ...actions]);
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

  const confirmBuy = (group) => {
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
    const batchId = safeUuid();
    for (const line of group.lines) {
      const allocated = Number(currentAllocations[line.itemKey] || 0);
      if (allocated <= 0) continue;
      if (allocated >= line.qty) {
        queueAction("Buy", [{ line, allocateQty: line.qty }], supplier, batchId);
      } else {
        queueAction(
          "PartialBuy",
          [{ line, allocateQty: allocated, remainingQty: line.qty - allocated }],
          supplier,
          batchId,
        );
      }
    }
    setExpandedProduct(null);
  };

  const moveToNextSupplier = (group) => {
    const supplier = selectedSupplier("Pre-order Queue");
    if (!supplier) return alert("Select the supplier that could not fulfil this product.");
    queueAction("NextSup", group.lines, supplier);
  };

  const removeFromNextSupplier = (group) => {
    const supplier = selectedSupplier("Next Supplier");
    if (!supplier) return alert("Select the supplier that could not supply this product.");
    queueAction("Remove", group.lines, supplier);
  };

  const recallRecord = (record) => {
    const line = warehouseLines.find((entry) => entry.itemKey === record.itemKey);
    if (!line) return alert("The related order item is no longer available for recall.");
    const recallLine = { ...line, latestAction: record };
    if (!window.confirm(`Recall ${record.productName || line.productName} for ${record.customerName || line.customerName}?`)) return;
    queueAction("Recall", [recallLine], {
      id: record.supplierId,
      supplier_name: record.supplierName,
    });
  };

  const changeWarehouseAvailability = (record, recall = false) => {
    const line = warehouseLines.find((entry) => entry.itemKey === record.itemKey) ||
      warehouseLines.find((entry) => String(entry.item.dbId || entry.item.id) === String(record.orderItemId || record.itemId));
    if (!line) return alert("The related Warehouse order item is no longer available.");
    const actionType = recall ? "Recall Available" : "Available";
    if (!window.confirm(`${actionType}: ${record.productName || line.productName}?`)) return;
    if (recall && record.syncStatus === "pending") {
      setPendingActions((current) => current.filter(
        (action) => action.clientActionId !== record.clientActionId,
      ));
      return;
    }
    queueAction(actionType, [{ ...line, latestAction: record }], null);
  };

  const recordHasActiveCannotSupply = (record) => {
    const line = warehouseLines.find((entry) => entry.itemKey === record.itemKey) ||
      warehouseLines.find((entry) => String(entry.item.dbId || entry.item.id) === String(record.orderItemId || record.itemId));
    const itemId = String(line?.item.dbId || line?.item.id || record.orderItemId || record.itemId || "");
    return warehouseSupplyStage(warehouseStatusOverrides[itemId] || line?.status) === "Cannot Supply";
  };

  const syncPendingActions = async () => {
    if (syncing || pendingActions.length === 0) return;
    setSyncing(true);
    const failed = [];
    const failedItemKeys = new Set();
    const synced = {};
    const queuedByClientActionId = new Map(
      pendingActions.map((action) => [action.clientActionId, action]),
    );
    const persistedByClientActionId = new Map();
    for (const action of pendingActions) {
      try {
        if (failedItemKeys.has(action.itemKey)) {
          throw new Error("An earlier pending change for this item failed.");
        }
        let persistedAction = action;
        if (
          action.actionType === "Recall" &&
          action.recalledClientActionId &&
          queuedByClientActionId.has(action.recalledClientActionId) &&
          !persistedByClientActionId.has(action.recalledClientActionId)
        ) {
          throw new Error("The recalled Buy must sync successfully before its Recall.");
        }
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
          setWarehouseEvents((current) => [savedWarehouseEvent, ...current]);
          setWarehouseStatusOverrides((current) => ({
            ...current,
            [String(savedWarehouseEvent.orderItemId || action.itemId)]: savedWarehouseEvent.newStatus,
          }));
          synced[action.itemKey] = null;
          continue;
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
          const recalledAction = persistedByClientActionId.get(
            action.recalledClientActionId,
          );
          const recallAddedItemId =
            action.recallAddedItemId || recalledAction?.addedItemId || null;
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
        } else if (action.actionType !== "NextSup") {
          const updated = await updateOrderItem(action.orderId, action.itemId, action.changes);
          if (updated === false) throw new Error("The Warehouse item did not update.");
        }

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
            remainingQty: action.remainingQty,
            status: action.newStatus,
            batchId: action.batchId,
          },
        });
        persistedAction = { ...persistedAction, syncStatus: "synced" };
        const savedEvent = await recordPreOrderSupplyEvent(persistedAction, loggedInUser);
        setHistoryEvents((current) => [savedEvent, ...current]);
        persistedByClientActionId.set(action.clientActionId, persistedAction);
        synced[action.itemKey] = action.actionType === "Recall" ? null : persistedAction;
      } catch (error) {
        failedItemKeys.add(action.itemKey);
        failed.push({ ...action, syncStatus: "failed", error: error.message });
      }
    }
    setActionHistory((current) => {
      const next = { ...current };
      for (const [key, value] of Object.entries(synced)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      return next;
    });
    setPendingActions(failed);
    setSyncing(false);
    if (failed.length === 0) {
      localStorage.removeItem(PREORDER_SUPPLY_PENDING_KEY);
      if (typeof refreshOrders === "function") await refreshOrders();
      const { history, events, warning } = await loadPreOrderSupplyHistory(loggedInUser);
      setHistoryWarning(warning || "");
      setActionHistory(history || {});
      setHistoryEvents(events || []);
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
          {groupedQueue.map((group) => {
            const open = expandedProduct === group.productId;
            const selectedQty = Number(buyQty[group.productId] ?? group.requiredQty);
            const groupAllocations = allocations[group.productId] || {};
            return (
              <div key={group.productId} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedProduct(open ? null : group.productId)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <span className="min-w-0 truncate text-sm font-extrabold text-slate-900">
                    {group.productName}
                  </span>
                  <span className="shrink-0 text-sm font-extrabold text-slate-700">Qty {group.requiredQty}</span>
                </button>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => openAllocation(group)}
                    className="rounded-lg bg-green-700 px-3 py-2 text-xs font-extrabold text-white"
                  >
                    Buy
                  </button>
                  {tab === "Pre-order Queue" ? (
                    <button
                      type="button"
                      onClick={() => moveToNextSupplier(group)}
                      className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-extrabold text-white"
                    >
                      Next Supplier
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeFromNextSupplier(group)}
                      className="rounded-lg bg-red-700 px-3 py-2 text-xs font-extrabold text-white"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {open && (
                  <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                    <label className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700">
                      Available from supplier
                      <input
                        type="number"
                        min="0"
                        max={group.requiredQty}
                        value={selectedQty}
                        onChange={(event) => updateBuyQuantity(group, event.target.value)}
                        className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-center font-extrabold"
                      />
                    </label>
                    {group.lines.map((line) => (
                      <div key={line.itemKey} className="flex items-center gap-2 rounded-lg bg-slate-50 p-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-extrabold text-slate-800">
                            {line.customerName}{line.branchName ? ` · ${line.branchName}` : ""}
                          </div>
                          <div className="text-[11px] font-semibold text-slate-500">
                            Order {line.orderNumber} · Needs {line.qty}
                          </div>
                        </div>
                        <input
                          aria-label={`Allocate ${line.productName} to ${line.customerName}`}
                          type="number"
                          min="0"
                          max={line.qty}
                          value={groupAllocations[line.itemKey] ?? 0}
                          onChange={(event) =>
                            setAllocations((current) => ({
                              ...current,
                              [group.productId]: {
                                ...(current[group.productId] || {}),
                                [line.itemKey]: Math.max(
                                  0,
                                  Math.min(line.qty, Number(event.target.value || 0)),
                                ),
                              },
                            }))
                          }
                          className="h-9 w-16 rounded-lg border border-slate-300 px-2 text-center text-xs font-extrabold"
                        />
                      </div>
                    ))}
                    <div className="flex items-center justify-between text-xs font-extrabold text-slate-700">
                      <span>
                        Allocated {Object.values(groupAllocations).reduce((sum, value) => sum + Number(value || 0), 0)} of {selectedQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => confirmBuy(group)}
                        className="rounded-lg bg-green-700 px-4 py-2 text-xs font-extrabold text-white"
                      >
                        Confirm Buy
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {groupedQueue.length === 0 && (
            <div className="rounded-xl bg-white p-8 text-center text-sm font-bold text-slate-500">
              No products in this queue.
            </div>
          )}
        </div>
      </>
    );
  };

  const renderActiveEvents = () => (
    <div className="space-y-4">
      {activeSupplierGroups.map(({ supplierName, records }) => (
            <details
              key={supplierName}
              open
              className="rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <summary className="cursor-pointer px-3 py-3 text-sm font-extrabold text-slate-900">
                {supplierName} ({records.reduce((sum, record) => sum + Number(record.quantity || 0), 0)})
              </summary>
              <div className="border-t border-slate-200">
                {records.map((record) => {
                  const isAvailable = record.actionType === "Available";
                  const isAvailabilityRecall = record.actionType === "Recall Available";
                  const canRecallAvailable = isAvailable && !recalledAvailableEventIds.has(record.id);
                  const activeCannotSupply = recordHasActiveCannotSupply(record);
                  return (
                  <div
                    key={record.clientActionId || record.id}
                    className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-extrabold text-slate-800">
                        {record.productName}
                      </div>
                      {record.actionType !== "Remove" && (
                        <div className="text-[11px] font-bold text-slate-500">
                          Qty {record.quantity}
                        </div>
                      )}
                      {(isAvailable || isAvailabilityRecall) && (
                        <div className="text-[10px] font-semibold text-slate-500">
                          {record.oldStatus || record.previousStatus} → {record.newStatus} | {record.actionType}
                        </div>
                      )}
                    </div>
                    {tab === "Cannot Supply" && activeCannotSupply && !isAvailable && !isAvailabilityRecall && (
                      <button
                        type="button"
                        onClick={() => changeWarehouseAvailability(record)}
                        className="rounded-lg bg-green-700 px-3 py-1.5 text-xs font-extrabold text-white"
                      >
                        Available
                      </button>
                    )}
                    {tab === "Cannot Supply" && canRecallAvailable && (
                      <button
                        type="button"
                        onClick={() => changeWarehouseAvailability(record, true)}
                        className="rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-extrabold text-white"
                      >
                        Recall
                      </button>
                    )}
                    {!isAvailable && !isAvailabilityRecall && record.actionType !== "WarehouseCannotSupply" && (
                      <button
                        type="button"
                        onClick={() => recallRecord(record)}
                        className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-extrabold text-white"
                      >
                        {tab === "Bought" ? "Recall Bought" : "Recall"}
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            </details>
      ))}
      {activeSupplierGroups.length === 0 && (
        <div className="rounded-xl bg-white p-8 text-center text-sm font-bold text-slate-500">
          No {tab.toLowerCase()} records.
        </div>
      )}
    </div>
  );


  return (
    <div className="min-h-screen bg-slate-50 p-2">
      <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-white p-3 shadow-sm">
        <div>
          <h2 className="text-base font-extrabold text-slate-900">Pre-order Supply</h2>
          <div className="text-xs font-bold text-amber-700">Pending changes: {pendingActions.length}</div>
        </div>
        <button
          type="button"
          onClick={syncPendingActions}
          disabled={syncing || pendingActions.length === 0}
          className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-extrabold text-white disabled:bg-slate-300"
        >
          {syncing ? "Syncing..." : "Sync All"}
        </button>
      </div>

      {historyWarning && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {historyWarning} Current order statuses remain visible.
        </div>
      )}
      {warehouseActivityWarning && (
        <div className="mb-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          {warehouseActivityWarning}
        </div>
      )}

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

      {tab === "Pre-order Queue" || tab === "Next Supplier" ? renderQueue() : null}
      {tab === "Bought" || tab === "Cannot Supply" ? renderActiveEvents() : null}
      {tab === "Order Pre-orders" && (
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
