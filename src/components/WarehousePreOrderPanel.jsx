import { useEffect, useMemo, useState } from "react";
import {
  loadWarehouseOperationalEvents,
  normalizeWarehouseStatus,
  recordWarehouseOperationalActivity,
} from "../services/warehouseActivity.js";

const itemId = (item) => item.dbId || item.id;
const itemQty = (item) => Number(item.qty ?? item.quantity ?? 0);
const orderNumber = (order) => order.orderId || order.order_number;
const itemKey = (order, item) => `${orderNumber(order)}:${itemId(item)}`;

export default function WarehousePreOrderPanel({
  order,
  currentUser,
  refreshOrders,
  onClose,
}) {
  const [events, setEvents] = useState([]);
  const [activityWarning, setActivityWarning] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [savedStatuses, setSavedStatuses] = useState({});

  useEffect(() => {
    let active = true;
    loadWarehouseOperationalEvents(currentUser).then((result) => {
      if (!active) return;
      setEvents(result.events || []);
      setActivityWarning(result.warning || "");
    }).catch((error) => {
      if (active) setActivityWarning(error?.message || "Warehouse activity could not be loaded.");
    });
    return () => { active = false; };
  }, [currentUser]);

  const recalledAvailableEventIds = useMemo(() => new Set(
    events
      .filter((event) => event.actionType === "Recall Available")
      .map((event) => event.referencedEventId)
      .filter(Boolean),
  ), [events]);

  const recallableAvailableByItemId = useMemo(() => {
    const result = new Map();
    for (const event of events) {
      const key = String(event.orderItemId || "");
      if (
        key &&
        event.actionType === "Available" &&
        event.oldStatus === "Cannot Supply" &&
        !recalledAvailableEventIds.has(event.id) &&
        !result.has(key)
      ) {
        result.set(key, event);
      }
    }
    return result;
  }, [events, recalledAvailableEventIds]);

  const saveActivity = async (item, actionType, newStatus, referencedEvent = null) => {
    const label = actionType === "Recall Available" ? "Recall Available" : actionType;
    if (!window.confirm(`${label}: ${item.name || item.productName}?`)) return;
    setSavingKey(itemKey(order, item));
    let saved;
    try {
      saved = await recordWarehouseOperationalActivity({
        order,
        item,
        actionType,
        newStatus,
        sourceModule: "Warehouse",
        referencedEventId: referencedEvent?.id || null,
        referencedClientActionId: referencedEvent?.clientActionId || null,
      }, currentUser);
      setEvents((current) => [saved, ...current]);
      setSavedStatuses((current) => ({ ...current, [String(itemId(item))]: saved.newStatus }));
      setActivityWarning("");
    } catch (error) {
      alert(error?.message || "Warehouse activity could not be saved.");
      setSavingKey("");
      return;
    }
    try {
      if (typeof refreshOrders === "function") await refreshOrders();
    } catch (error) {
      alert(error?.message || "Warehouse activity was saved, but the order list could not be refreshed.");
    } finally {
      setSavingKey("");
    }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-3" role="dialog" aria-modal="true" aria-label="Warehouse Pre-Order Supply">
    <div className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-2xl bg-white p-4 shadow-2xl">
      <header className="mb-3 flex items-center justify-between gap-3"><div><h3 className="text-lg font-extrabold">Pre-Order Supply</h3><p className="text-xs font-bold text-slate-500">Order {orderNumber(order)}</p></div><button type="button" onClick={onClose} className="rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold text-white">Close</button></header>
      {activityWarning && <p role="alert" className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-bold text-amber-900">{activityWarning}</p>}
      <div className="hidden grid-cols-[1fr_70px_120px_1fr] gap-2 border-b px-2 py-2 text-xs font-extrabold text-slate-600 md:grid"><span>Product</span><span>Qty</span><span>Current Status</span><span>Actions</span></div>
      {(order.items || []).map((item) => {
        const key = itemId(item);
        const status = savedStatuses[String(key)] || normalizeWarehouseStatus(item.sourceStatus || item.source_status || item.status || "In Stock");
        const saving = savingKey === itemKey(order, item);
        const recallableAvailable = recallableAvailableByItemId.get(String(key));
        return <div key={key} className="grid gap-2 border-b px-2 py-3 md:grid-cols-[1fr_70px_120px_1fr] md:items-center">
          <strong className="text-sm">{item.name || item.productName}</strong><span>{itemQty(item)}</span><span className="font-bold">{status}</span>
          <div className="flex flex-wrap items-center gap-2">
            {(status === "Pre-Order" || status === "Cannot Supply") && <button disabled={saving} onClick={() => saveActivity(item, "Available", "In Stock")} className="rounded bg-green-700 px-2 py-1 text-xs font-bold text-white">Available</button>}
            {status === "In Stock" && <button disabled={saving} onClick={() => saveActivity(item, "Cannot Supply", "Cannot Supply")} className="rounded bg-red-700 px-2 py-1 text-xs font-bold text-white">Cannot Supply</button>}
            {status === "In Stock" && recallableAvailable && <button disabled={saving} onClick={() => saveActivity(item, "Recall Available", "Cannot Supply", recallableAvailable)} className="rounded bg-amber-700 px-2 py-1 text-xs font-bold text-white">Recall</button>}
          </div>
        </div>;
      })}
    </div>
  </div>;
}
