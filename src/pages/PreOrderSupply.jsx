import { useEffect, useMemo, useState } from "react";
import { logAction } from "../utils/auditLog";

const PENDING_KEY = "fairchoice_preorder_supply_pending";
const HISTORY_KEY = "fairchoice_preorder_supply_history";

const FILTERS = ["All", "Pre-order", "Next Supplier", "Bought", "Cannot Supply"];

const normalizeStatus = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const getItemKey = (order, item) =>
  `${order.orderId || order.order_number}:${item.dbId || item.id}`;

const getItemQty = (item = {}) => Number(item.qty || item.quantity || 0);

const isPreOrderStatus = (status) =>
  ["pre order", "preorder", "pre-order", "need supplier", "supply needed"].includes(
    normalizeStatus(status)
  );

const getDisplayStatus = (status) => {
  const normalized = normalizeStatus(status);
  if (["in stock", "available"].includes(normalized)) return "Bought";
  if (["next supplier", "supplier pending"].includes(normalized)) return "Next Supplier";
  if (["cannot supply", "removed"].includes(normalized)) return "Cannot Supply";
  if (isPreOrderStatus(status)) return "Pre-order";
  return status || "Pre-order";
};

const getStatusChanges = (actionType, item) => {
  const qty = getItemQty(item);

  if (actionType === "Buy") {
    return { sourceStatus: "In Stock", includeInPicking: true, pickedQty: qty };
  }

  if (actionType === "PartialBuy") {
    return { sourceStatus: "Need Supplier", includeInPicking: false, pickedQty: 0 };
  }

  if (actionType === "NextSup") {
    return { sourceStatus: "Next Supplier", includeInPicking: false, pickedQty: 0 };
  }

  if (actionType === "Remove") {
    return { sourceStatus: "Cannot Supply", includeInPicking: false, pickedQty: 0 };
  }

  return { sourceStatus: "Need Supplier", includeInPicking: false, pickedQty: 0 };
};

const getCategoryRank = (category) => {
  const value = normalizeStatus(category);
  if (value.includes("vape")) return 1;
  if (value.includes("smoking accessories")) return 2;
  return 3;
};

const readJson = (key, fallback) => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export default function PreOrderSupply({
  orders = [],
  products = [],
  updateOrderItem,
  addOrderItem,
  splitPreOrderItem,
  refreshOrders,
}) {
  const loggedInUser = JSON.parse(localStorage.getItem("loggedInUser") || "null");
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState({});
  const [pendingActions, setPendingActions] = useState(() => readJson(PENDING_KEY, []));
  const [actionHistory, setActionHistory] = useState(() => readJson(HISTORY_KEY, {}));
  const [syncing, setSyncing] = useState(false);
  const [rowQtyInputs, setRowQtyInputs] = useState({});

  useEffect(() => {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pendingActions));
  }, [pendingActions]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(actionHistory));
  }, [actionHistory]);

  const productById = useMemo(
    () => new Map((products || []).map((product) => [String(product.id), product])),
    [products]
  );

  const latestActionByItem = useMemo(() => {
    const map = { ...actionHistory };
    pendingActions.forEach((action) => {
      if (action.actionType === "Recall") {
        delete map[action.itemKey];
      } else {
        map[action.itemKey] = action;
      }
    });
    return map;
  }, [actionHistory, pendingActions]);

  const groupedProducts = useMemo(() => {
    const groups = new Map();

    (orders || []).forEach((order) => {
      if (!["Warehouse Packing", "Ready For Driver"].includes(order.status)) return;

      (order.items || []).forEach((item) => {
        const itemKey = getItemKey(order, item);
        const latestAction = latestActionByItem[itemKey];
        const effectiveStatus =
          latestAction?.newStatus || item.sourceStatus || item.source_status || "In Stock";
        const displayStatus = getDisplayStatus(effectiveStatus);
        const effectiveQty = Number(latestAction?.remainingQty ?? getItemQty(item));
        const originalWasPreOrder = isPreOrderStatus(
          item.sourceStatus || item.source_status || item.status
        );

        if (!originalWasPreOrder && !latestAction) return;

        const product = productById.get(String(item.productId || item.id)) || {};
        const productId = String(item.productId || item.id || item.productCode || item.name);
        const group = groups.get(productId) || {
          productId,
          productName: item.name || item.productName || product.name || "Unnamed Product",
          category: product.category || item.category || "",
          brand: product.brand || item.brand || "",
          series: product.series || item.series || "",
          lines: [],
        };

        group.lines.push({
          order,
          item,
          itemKey,
          status: effectiveStatus,
          displayStatus,
          qty: effectiveQty,
          originalQty: getItemQty(item),
          customerName: order.companyName || order.customerName || "Unknown Customer",
          latestAction,
        });
        groups.set(productId, group);
      });
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        activeLines: group.lines.filter((line) =>
          ["Pre-order", "Next Supplier"].includes(line.displayStatus)
        ),
        needQty: group.lines
          .filter((line) => ["Pre-order", "Next Supplier"].includes(line.displayStatus))
          .reduce((sum, line) => sum + line.qty, 0),
        displayStatus: group.lines.some((line) => line.displayStatus === "Pre-order")
          ? "Pre-order"
          : group.lines.some((line) => line.displayStatus === "Next Supplier")
          ? "Next Supplier"
          : group.lines.some((line) => line.displayStatus === "Cannot Supply")
          ? "Cannot Supply"
          : "Bought",
      }))
      .filter((group) => filter === "All" || group.displayStatus === filter)
      .sort((a, b) => {
        const rankDiff = getCategoryRank(a.category) - getCategoryRank(b.category);
        if (rankDiff !== 0) return rankDiff;

        const aText = `${a.brand} ${a.series} ${a.productName}`.toLowerCase();
        const bText = `${b.brand} ${b.series} ${b.productName}`.toLowerCase();
        return aText.localeCompare(bText);
      });
  }, [orders, productById, latestActionByItem, filter]);

  const queueAction = (actionType, lines) => {
    const timestamp = new Date().toISOString();
    const nextActions = lines.map((entry) => {
      const line = entry.line || entry;
      const allocationQty = Number(entry.allocateQty || line.qty || 0);
      const remainingQty =
        entry.remainingQty !== undefined ? Number(entry.remainingQty) : undefined;
      const previousQty = Number(line.latestAction?.previousQty ?? line.originalQty ?? line.qty);
      const baseChanges =
        actionType === "PartialBuy"
          ? {
              ...getStatusChanges(actionType, line.item),
              qty: remainingQty,
            }
          : actionType === "Recall" && line.latestAction?.actionType === "PartialBuy"
          ? {
              sourceStatus: line.latestAction.previousStatus || "Need Supplier",
              includeInPicking: false,
              pickedQty: 0,
              qty: previousQty,
            }
          : getStatusChanges(actionType, line.item);
      const changes =
        actionType === "Buy"
          ? { ...baseChanges, pickedQty: allocationQty }
          : baseChanges;
      const previousStatus = line.status || "Need Supplier";

      return {
        id: `${line.itemKey}:${actionType}:${Date.now()}:${Math.random()}`,
        itemKey: line.itemKey,
        orderId: line.order.orderId || line.order.order_number,
        itemId: line.item.dbId || line.item.id,
        actionType,
        productId: line.item.productId || line.item.id,
        productName: line.item.name || line.item.productName,
        itemSnapshot: {
          ...line.item,
          productId: line.item.productId || line.item.product_id || line.item.id,
          name: line.item.name || line.item.productName || line.item.product_name,
          qty: allocationQty,
          pickedQty: allocationQty,
          sourceStatus: "In Stock",
          includeInPicking: true,
        },
        customerId: line.order.customerAccountId || line.order.customer_account_id || null,
        customerName: line.customerName,
        quantity: allocationQty,
        previousQty,
        remainingQty,
        recallAddedItemId:
          actionType === "Recall" ? line.latestAction?.addedItemId || null : null,
        previousStatus,
        newStatus: changes.sourceStatus,
        changes,
        userId: loggedInUser?.id || loggedInUser?.staff_id || null,
        userName: loggedInUser?.staff_name || loggedInUser?.username || null,
        timestamp,
        syncStatus: "pending",
      };
    });

    setPendingActions((current) => [...current, ...nextActions]);
  };

  const handleProductBuy = (group) => {
    if (group.activeLines.length === 0) return;
    queueAction("Buy", group.activeLines);
  };

  const handleLessQty = (group) => {
    setExpanded((current) => ({
      ...current,
      [group.productId]: true,
    }));
  };

  const handleCustomerBuy = (line) => {
    const rawValue = rowQtyInputs[line.itemKey];
    const enteredQty = Number(rawValue);

    if (rawValue === undefined || rawValue === "" || Number.isNaN(enteredQty)) {
      alert("Qty Bought cannot be empty.");
      return;
    }

    if (enteredQty <= 0) {
      alert("Qty Bought must be more than 0.");
      return;
    }

    if (
      enteredQty > line.qty &&
      !window.confirm("Entered quantity is higher than this customer needs. Continue?")
    ) {
      return;
    }

    const allocatedQty = Math.min(enteredQty, line.qty);

    if (allocatedQty >= line.qty) {
      queueAction("Buy", [line]);
      return;
    }

    queueAction("PartialBuy", [
      {
        line,
        allocateQty: allocatedQty,
        remainingQty: line.qty - allocatedQty,
      },
    ]);
  };

  const syncPendingActions = async () => {
    if (syncing || pendingActions.length === 0) return;
    setSyncing(true);

    const failed = [];
    const syncedHistory = {};

    for (const action of pendingActions) {
      try {
        let historyAction = action;

        if (action.actionType === "PartialBuy") {
          if (typeof splitPreOrderItem === "function") {
            const addedItem = await splitPreOrderItem(
              action.orderId,
              action.itemId,
              action.quantity,
              action.remainingQty
            );
            historyAction = {
              ...action,
              addedItemId: addedItem?.id || addedItem?.dbId || null,
            };
          } else {
            await updateOrderItem(action.orderId, action.itemId, action.changes);
            if (typeof addOrderItem === "function") {
              const addedItem = await addOrderItem(action.orderId, {
                ...(action.itemSnapshot || {}),
                qty: action.quantity,
                pickedQty: action.quantity,
                sourceStatus: "In Stock",
                includeInPicking: true,
              });
              historyAction = {
                ...action,
                addedItemId: addedItem?.id || addedItem?.dbId || null,
              };
            }
          }
        } else if (action.actionType === "Recall" && action.recallAddedItemId) {
          await updateOrderItem(action.orderId, action.itemId, action.changes);
          await updateOrderItem(action.orderId, action.recallAddedItemId, {
            sourceStatus: "Need Supplier",
            includeInPicking: false,
            pickedQty: 0,
            qty: 0,
          });
        } else {
          await updateOrderItem(action.orderId, action.itemId, action.changes);
        }

        await logAction({
          user: loggedInUser,
          action_type: `Pre-order Supply ${
            action.actionType === "PartialBuy" ? "Buy" : action.actionType
          }`,
          page_module: "Pre-order Supply",
          order_id: action.orderId,
          product_id: action.productId,
          old_value: action.previousStatus,
          new_value: {
            productName: action.productName,
            customerName: action.customerName,
            quantity: action.quantity,
            newStatus: action.newStatus,
            syncStatus: "synced",
          },
        });
        if (action.actionType === "Recall") {
          syncedHistory[action.itemKey] = null;
        } else {
          syncedHistory[action.itemKey] = { ...historyAction, syncStatus: "synced" };
        }
      } catch (error) {
        failed.push({
          ...action,
          syncStatus: "failed",
          error: error.message,
        });
      }
    }

    setActionHistory((current) => {
      const next = { ...current };
      Object.entries(syncedHistory).forEach(([key, value]) => {
        if (value === null) delete next[key];
        else next[key] = value;
      });
      return next;
    });
    setPendingActions(failed);
    setSyncing(false);
    if (failed.length === 0 && typeof refreshOrders === "function") {
      await refreshOrders();
    }
  };

  const renderActionButtons = (group) => {
    const { lines, displayStatus: status } = group;
    const actionableLines = lines.filter((line) =>
      ["Pre-order", "Next Supplier"].includes(line.displayStatus)
    );
    const canBuy = actionableLines.length > 0 && status !== "Cannot Supply";
    const canNextSup = actionableLines.length > 0 && status === "Pre-order";
    const canRemove = actionableLines.length > 0 && status !== "Bought";
    const recallLines = lines.filter((line) => line.latestAction);

    return (
      <>
        <button
          type="button"
          disabled={!canBuy}
          onClick={() => handleProductBuy(group)}
          className="min-h-9 rounded-lg bg-green-700 px-3 py-1.5 text-[14px] font-extrabold text-white disabled:bg-slate-300"
        >
          Buy
        </button>
        <button
          type="button"
          disabled={!canBuy}
          onClick={() => handleLessQty(group)}
          className="min-h-9 rounded-lg bg-blue-700 px-3 py-1.5 text-[14px] font-extrabold text-white disabled:bg-slate-300"
        >
          Less Qty
        </button>
        <button
          type="button"
          disabled={!canNextSup}
          onClick={() => queueAction("NextSup", actionableLines)}
          className="min-h-9 rounded-lg bg-amber-600 px-3 py-1.5 text-[14px] font-extrabold text-white disabled:bg-slate-300"
        >
          Next Supplier
        </button>
        <button
          type="button"
          disabled={!canRemove}
          onClick={() => queueAction("Remove", actionableLines)}
          className="min-h-9 rounded-lg bg-red-700 px-3 py-1.5 text-[14px] font-extrabold text-white disabled:bg-slate-300"
        >
          Remove
        </button>
        {recallLines.length > 0 && (
          <button
            type="button"
            onClick={() => queueAction("Recall", recallLines)}
            className="min-h-9 rounded-lg bg-slate-700 px-3 py-1.5 text-[14px] font-extrabold text-white"
          >
            Recall
          </button>
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold">Pre-order Supply</h2>
          <div className="text-sm font-bold text-amber-700">
            Sync Pending: {pendingActions.length}
          </div>
        </div>

        <button
          type="button"
          onClick={syncPendingActions}
          disabled={syncing || pendingActions.length === 0}
          className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300"
        >
          {syncing ? "Syncing..." : "Sync"}
        </button>
      </div>

      <div className="mb-2 flex gap-1 overflow-x-auto">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-bold ${
              filter === item ? "bg-slate-900 text-white" : "bg-white text-slate-700"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {groupedProducts.map((group) => {
          const open = expanded[group.productId] === true;

          return (
            <div
              key={group.productId}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="space-y-3">
                <div>
                  <div className="text-[14px] font-bold leading-snug text-slate-900">
                    {group.productName}
                  </div>
                  <div className="text-[13px] font-semibold text-slate-700">
                    Need: {group.needQty}
                  </div>
                  <div className="text-[12px] font-semibold text-slate-500">
                    {[group.category, group.brand, group.series].filter(Boolean).join(" | ")}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                  {renderActionButtons(group)}
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [group.productId]: !open,
                      }))
                    }
                    className="min-h-9 rounded-lg bg-slate-800 px-3 py-1.5 text-[14px] font-extrabold text-white"
                  >
                    {open ? "Hide" : "View"}
                  </button>
                </div>
              </div>

              {open && (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  {group.lines.map((line) => (
                    <div
                      key={line.itemKey}
                      className="rounded-lg bg-slate-50 px-3 py-2 text-[12px]"
                    >
                      <div className="mb-2 min-w-0 font-semibold text-slate-700">
                        <span className="block truncate text-[13px] font-extrabold">
                          {line.customerName}
                        </span>
                        <span className="text-[12px] text-slate-500">
                          {line.displayStatus === "Bought"
                            ? "Completed / Qty 0"
                            : `Need: ${line.qty} | ${line.displayStatus}`}
                        </span>
                      </div>

                      {["Pre-order", "Next Supplier"].includes(line.displayStatus) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <label className="flex items-center gap-2 text-[12px] font-bold text-slate-700">
                            Qty Bought:
                            <input
                              type="number"
                              min="1"
                              inputMode="numeric"
                              value={rowQtyInputs[line.itemKey] || ""}
                              onChange={(event) =>
                                setRowQtyInputs((current) => ({
                                  ...current,
                                  [line.itemKey]: event.target.value,
                                }))
                              }
                              className="h-9 w-20 rounded-lg border border-slate-300 px-2 text-[13px] font-bold"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => handleCustomerBuy(line)}
                            className="min-h-9 rounded-lg bg-green-700 px-4 py-1.5 text-[14px] font-extrabold text-white"
                          >
                            Buy
                          </button>
                        </div>
                      ) : (
                        <div className="text-[12px] font-bold text-slate-500">
                          {line.displayStatus}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {groupedProducts.length === 0 && (
          <div className="p-6 text-center text-sm font-bold text-slate-500">
            No pre-order supply items found.
          </div>
        )}
      </div>
    </div>
  );
}
