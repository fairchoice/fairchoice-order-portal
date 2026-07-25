import { useMemo, useState } from "react";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import {
  completeOrderPicking,
  pauseOrderPicking,
  recallPickingDecision,
  savePickingDecision,
} from "../services/picking";

const actionClass = (disabled, active = false) =>
  `min-h-12 rounded-xl px-4 py-3 text-sm font-bold transition ${
    disabled
      ? "cursor-not-allowed bg-slate-200 text-slate-400"
      : active
        ? "bg-emerald-700 text-white"
        : "bg-slate-900 text-white hover:bg-slate-700"
  }`;

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
      await completeOrderPicking(order.orderId, currentUser);
      await onRefresh?.();
      onExit?.();
    } catch (completeError) {
      setError(completeError.message || "Could not complete this order.");
    } finally {
      setPageBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-5">
      <div className="mx-auto max-w-5xl">
        <header className="sticky top-0 z-20 mb-4 rounded-2xl bg-slate-950 p-4 text-white shadow-lg sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-300">Picking Order</div>
              <h1 className="mt-1 text-2xl font-black sm:text-3xl">{formatDisplayOrderId(order?.orderId)}</h1>
              <div className="mt-1 text-base font-semibold">{customerName}{branchName ? ` | ${branchName}` : ""}</div>
              <div className="mt-2 text-sm text-slate-300">Progress: {completedCount} of {items.length} items</div>
            </div>
            <button type="button" onClick={breakPicking} disabled={pageBusy} className="min-h-12 rounded-xl bg-amber-500 px-5 py-3 font-black text-slate-950 disabled:opacity-50">
              Break / Save Progress
            </button>
          </div>
        </header>

        {error && <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 font-semibold text-red-800">{error}</div>}

        <div className="space-y-3">
          {items.map((item) => {
            const itemId = item.dbId || item.id;
            const action = item.pickingAction || item.picking_action || null;
            const decided = Boolean(action);
            const replacementName = item.replacementProductName || item.replacement_product_name;
            return (
              <article key={itemId} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-lg font-black text-slate-900">{item.productName || item.product_name || item.name}</h2>
                    <div className="mt-1 text-base font-bold text-blue-800">Quantity: {Number(item.qty ?? item.quantity ?? 0)}</div>
                    {action === "replace" && replacementName && <div className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm font-bold text-violet-800">Replace with: {replacementName}</div>}
                  </div>
                  {decided && <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase text-emerald-800">{action === "in_stock" ? "Added / In Stock" : action === "pre_order" ? "Pre-Order" : "Replacement selected"}</span>}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <button type="button" disabled={decided || busyId === itemId} onClick={() => chooseAction(item, "in_stock")} className={actionClass(decided, action === "in_stock")}>Add / In Stock</button>
                  <button type="button" disabled={decided || busyId === itemId} onClick={() => chooseAction(item, "pre_order")} className={actionClass(decided, action === "pre_order")}>Pre-Order</button>
                  <button type="button" disabled={decided || busyId === itemId} onClick={() => { setReplacementItem(item); setSearch(""); }} className={actionClass(decided, action === "replace")}>Replace</button>
                  <button type="button" disabled={!decided || busyId === itemId} onClick={() => recall(item)} className={actionClass(!decided)}>Recall</button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-20 mt-5 rounded-2xl border bg-white/95 p-3 shadow-2xl backdrop-blur sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={breakPicking} disabled={pageBusy} className="min-h-12 rounded-xl bg-amber-500 px-6 py-3 font-black text-slate-950 disabled:opacity-50">Break / Save Progress</button>
            <button type="button" onClick={completePicking} disabled={!allDecided || pageBusy} className="min-h-12 rounded-xl bg-emerald-700 px-6 py-3 font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500">Complete Picking</button>
          </div>
          {!allDecided && <div className="mt-2 text-center text-xs font-semibold text-slate-500 sm:text-right">Complete every item before finishing the order.</div>}
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
