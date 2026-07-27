import { useMemo, useState } from "react";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import {
  completeOrderPicking,
  pauseOrderPicking,
  recallPickingDecision,
  savePickingDecision,
} from "../services/picking";

const actionClass = (disabled) =>
  `min-h-10 rounded-lg px-3 py-2 text-sm font-bold transition ${
    disabled
      ? "cursor-not-allowed bg-slate-200 text-slate-400"
      : "bg-slate-900 text-white hover:bg-slate-700"
  }`;

const getOriginalStatus = (item = {}) => {
  const value = item.sourceStatus || item.source_status || "In Stock";
  return value === "Need Supplier" || value === "Pre-Order" ? "Pre-Order" : "In Stock";
};

const getDisplayedStatus = (item = {}, action = null) => {
  if (action === "in_stock") return "In Stock";
  if (action === "pre_order") return "Pre-Order";
  if (action === "replace") return "Replacement";
  return getOriginalStatus(item);
};

const statusClass = (status) => {
  if (status === "In Stock") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "Pre-Order") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-violet-200 bg-violet-50 text-violet-800";
};

export default function OrderPicking({ order, products = [], currentUser, onExit, onRefresh }) {
  const [items, setItems] = useState(order?.items || []);
  const [replacementItem, setReplacementItem] = useState(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [error, setError] = useState("");

  const customerName = order?.customer_name || order?.customerName || order?.companyName || "-";
  const branchName = order?.branch_name || order?.branchName || "";
  const allDecided = items.length > 0 && items.every((item) => Boolean(item.pickingAction || item.picking_action));
  const completedCount = items.filter((item) => Boolean(item.pickingAction || item.picking_action)).length;

  const replacementProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const originalProductId = replacementItem?.productId || replacementItem?.product_id || replacementItem?.id;
    return products
      .filter((product) => String(product.id) !== String(originalProductId))
      .filter((product) => {
        if (!query) return true;
        return [product.name, product.productName, product.product_name, product.productCode, product.product_code, product.brand, product.series]
          .some((value) => String(value || "").toLowerCase().includes(query));
      })
      .slice(0, 100);
  }, [products, replacementItem, search]);

  const updateLocalItem = (itemId, updates) => {
    setItems((current) => current.map((item) => String(item.dbId || item.id) === String(itemId) ? { ...item, ...updates } : item));
  };

  const chooseAction = async (item, action, replacement = null) => {
    const itemId = item.dbId || item.id;
    if (!itemId || busyId) return;
    setBusyId(itemId);
    setError("");
    try {
      await savePickingDecision({ orderItemId: itemId, action, user: currentUser, replacement });
      updateLocalItem(itemId, {
        pickingAction: action,
        picking_action: action,
        replacementProductId: replacement?.id || null,
        replacement_product_id: replacement?.id || null,
        replacementProductName: replacement?.name || replacement?.productName || replacement?.product_name || null,
        replacement_product_name: replacement?.name || replacement?.productName || replacement?.product_name || null,
        replacementProductCode: replacement?.productCode || replacement?.product_code || null,
        replacement_product_code: replacement?.productCode || replacement?.product_code || null,
      });
      setReplacementItem(null);
      setSearch("");
    } catch (actionError) {
      setError(actionError.message || "Could not save this picking action.");
    } finally {
      setBusyId(null);
    }
  };

  const recall = async (item) => {
    const itemId = item.dbId || item.id;
    if (!itemId || busyId) return;
    setBusyId(itemId);
    setError("");
    try {
      await recallPickingDecision(itemId);
      updateLocalItem(itemId, {
        pickingAction: null,
        picking_action: null,
        replacementProductId: null,
        replacement_product_id: null,
        replacementProductName: null,
        replacement_product_name: null,
        replacementProductCode: null,
        replacement_product_code: null,
      });
    } catch (recallError) {
      setError(recallError.message || "Could not recall this picking action.");
    } finally {
      setBusyId(null);
    }
  };

  const breakPicking = async () => {
    setPageBusy(true);
    setError("");
    try {
      await pauseOrderPicking(order.orderId, currentUser);
      await onRefresh?.();
      onExit?.();
    } catch (pauseError) {
      setError(pauseError.message || "Could not save the picking break.");
    } finally {
      setPageBusy(false);
    }
  };

  const completePicking = async () => {
    if (!allDecided || pageBusy) return;
    setPageBusy(true);
    setError("");
    try {
      // Completion is also the final sync to the order and warehouse workflow.
      await completeOrderPicking(order.orderId, currentUser);
      await onRefresh?.();
      onExit?.();
    } catch (completeError) {
      setError(completeError.message || "Could not complete and synchronise this order.");
    } finally {
      setPageBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-2 sm:p-4">
      <div className="mx-auto max-w-5xl">
        <header className="sticky top-0 z-20 mb-3 rounded-xl bg-slate-950 p-3 text-white shadow-lg sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-300">Picking Order</div>
              <h1 className="mt-0.5 truncate text-xl font-black sm:text-2xl">{formatDisplayOrderId(order?.orderId)}</h1>
              <div className="mt-0.5 truncate text-sm font-semibold">{customerName}{branchName ? ` | ${branchName}` : ""}</div>
              <div className="mt-1 text-xs text-slate-300">Progress: {completedCount} of {items.length} items</div>
            </div>
            <div className="rounded-lg bg-white/10 px-3 py-2 text-center">
              <div className="text-lg font-black">{completedCount}/{items.length}</div>
              <div className="text-[10px] font-bold uppercase text-slate-300">Completed</div>
            </div>
          </div>
        </header>

        {error && <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}

        <div className="space-y-2">
          {items.map((item, index) => {
            const itemId = item.dbId || item.id;
            const action = item.pickingAction || item.picking_action || null;
            const decided = Boolean(action);
            const replacementName = item.replacementProductName || item.replacement_product_name;
            const displayedStatus = getDisplayedStatus(item, action);
            const itemBusy = busyId === itemId;

            return (
              <article key={itemId} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-black leading-snug text-slate-900 sm:text-lg">{item.productName || item.product_name || item.name}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-blue-800">Quantity: {Number(item.qty ?? item.quantity ?? 0)}</span>
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${statusClass(displayedStatus)}`}>
                        Status: {displayedStatus}
                      </span>
                      {decided && <span className="text-xs font-bold text-emerald-700">✓ Selected</span>}
                    </div>
                    {action === "replace" && replacementName && (
                      <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800">Replace with: {replacementName}</div>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <button type="button" disabled={decided || itemBusy} onClick={() => chooseAction(item, "in_stock")} className={actionClass(decided || itemBusy)}>Add / In Stock</button>
                  <button type="button" disabled={decided || itemBusy} onClick={() => chooseAction(item, "pre_order")} className={actionClass(decided || itemBusy)}>Pre-Order</button>
                  <button type="button" disabled={decided || itemBusy} onClick={() => { setReplacementItem(item); setSearch(""); }} className={actionClass(decided || itemBusy)}>Replace</button>
                  <button type="button" disabled={!decided || itemBusy} onClick={() => recall(item)} className={actionClass(!decided || itemBusy)}>Recall</button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-20 mt-3 rounded-xl border bg-white/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={breakPicking} disabled={pageBusy} className="min-h-11 rounded-lg bg-amber-500 px-5 py-2.5 font-black text-slate-950 disabled:opacity-50">Break / Save Progress</button>
            <button type="button" onClick={completePicking} disabled={!allDecided || pageBusy} className="min-h-11 rounded-lg bg-emerald-700 px-5 py-2.5 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">
              {pageBusy && allDecided ? "Synchronising..." : "Complete Picking"}
            </button>
          </div>
          {!allDecided && <div className="mt-1.5 text-center text-xs font-semibold text-slate-500 sm:text-right">Complete every item before finishing the order.</div>}
        </div>
      </div>

      {replacementItem && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/50 p-0 sm:items-center sm:justify-center sm:p-4">
          <div className="max-h-[90vh] w-full overflow-hidden rounded-t-3xl bg-white sm:max-w-2xl sm:rounded-3xl">
            <div className="border-b p-4">
              <h3 className="text-xl font-black">Replace {replacementItem.productName || replacementItem.name}</h3>
              <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search replacement product..." className="mt-3 min-h-12 w-full rounded-xl border px-4" />
            </div>
            <div className="max-h-[55vh] overflow-auto p-3">
              {replacementProducts.map((product) => (
                <button key={product.id} type="button" onClick={() => chooseAction(replacementItem, "replace", product)} className="mb-2 w-full rounded-xl border p-4 text-left hover:bg-slate-50">
                  <div className="font-black">{product.name || product.productName || product.product_name}</div>
                  <div className="text-sm text-slate-500">{product.productCode || product.product_code || ""} {product.brand ? `| ${product.brand}` : ""}</div>
                </button>
              ))}
              {replacementProducts.length === 0 && <div className="p-5 text-center text-slate-500">No replacement products found.</div>}
            </div>
            <div className="border-t p-3"><button type="button" onClick={() => setReplacementItem(null)} className="min-h-12 w-full rounded-xl bg-slate-200 font-black">Cancel</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
