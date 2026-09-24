import { useEffect, useMemo, useState } from "react";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import { logAction } from "../utils/auditLog";
import {
  applyLocationStockToProducts,
  buildLocationStockMap,
  getProductLocationStock,
  resolveOrderInventoryCountry,
} from "../services/locationStock";
import { getPickingAvailability } from "../services/pickingAvailability";
import {
  completeOrderPicking,
  getOrderedQty,
  getRemainingPickingQty,
  getResolvedQty,
  pauseOrderPicking,
  recallPickingDecision,
  savePickingDecision,
} from "../services/picking";

const FAIRCHOICE_BLUE = "#0f5b8d";
const number = (value) => Number(value || 0);
const itemIdOf = (item) => item?.dbId || item?.id || null;
const productIdOf = (item) =>
  item?.productId ||
  item?.product_id ||
  item?.product?.id ||
  item?.products?.id ||
  item?.id ||
  null;

const isActiveProduct = (product = {}) => {
  if (product.active === false || product.is_active === false) return false;
  const status = String(product.status || product.product_status || "").trim().toLowerCase();
  return !["inactive", "disabled", "deleted", "archived"].includes(status);
};


const pickingStatusRank = (item = {}) => {
  const value = String(item.sourceStatus || item.source_status || "In Stock").trim().toLowerCase();
  if (["in stock", "available"].includes(value)) return 1;
  if (["need supplier", "pre-order", "pre order", "next supplier"].includes(value)) return 2;
  if (["cannot supply", "supply needed"].includes(value)) return 3;
  return 4;
};

const sortPickingItemsInitially = (items = []) =>
  [...(items || [])].sort((a, b) => {
    const rank = pickingStatusRank(a) - pickingStatusRank(b);
    if (rank !== 0) return rank;
    return String(a.name || a.productName || a.product_name || "").localeCompare(
      String(b.name || b.productName || b.product_name || ""),
      "en-GB",
      { numeric: true, sensitivity: "base" }
    );
  });

const actionClass = (disabled) =>
  `h-9 rounded-lg px-2 py-1 text-xs font-black transition ${
    disabled
      ? "cursor-not-allowed bg-slate-200 text-slate-400"
      : "bg-[#0f5b8d] text-white hover:bg-[#0b466d]"
  }`;

const applyResult = (item, result = {}) => ({
  ...item,
  pickingOrderedQty: number(
    result.picking_ordered_qty ?? result.ordered_qty ?? getOrderedQty(item)
  ),
  picking_ordered_qty: number(
    result.picking_ordered_qty ?? result.ordered_qty ?? getOrderedQty(item)
  ),
  pickingInStockQty: number(
    result.picking_in_stock_qty ?? result.in_stock_qty
  ),
  picking_in_stock_qty: number(
    result.picking_in_stock_qty ?? result.in_stock_qty
  ),
  pickingPreOrderQty: number(
    result.picking_pre_order_qty ?? result.pre_order_qty
  ),
  picking_pre_order_qty: number(
    result.picking_pre_order_qty ?? result.pre_order_qty
  ),
  pickingReplacedQty: number(
    result.picking_replaced_qty ?? result.replaced_qty
  ),
  picking_replaced_qty: number(
    result.picking_replaced_qty ?? result.replaced_qty
  ),
  pickingAction: result.picking_action ?? item.pickingAction,
  picking_action: result.picking_action ?? item.picking_action,
  sourceStatus:
    number(result.picking_pre_order_qty ?? result.pre_order_qty) > 0
      ? "Need Supplier"
      : number(result.picking_in_stock_qty ?? result.in_stock_qty) > 0 ||
          number(result.picking_replaced_qty ?? result.replaced_qty) > 0
        ? "In Stock"
        : item.sourceStatus,
  replacementProductId: result.replacement_product_id ?? item.replacementProductId ?? item.replacement_product_id,
  replacement_product_id: result.replacement_product_id ?? item.replacement_product_id,
  replacementProductName: result.replacement_product_name ?? item.replacementProductName ?? item.replacement_product_name,
  replacement_product_name: result.replacement_product_name ?? item.replacement_product_name,
});

export default function OrderPicking(props) {
  const { order } = props;
  const orderSessionKey = useMemo(() => {
    return order?.orderId || "picking-order";
  }, [order?.orderId]);

  return <OrderPickingSession key={orderSessionKey} {...props} />;
}

function OrderPickingSession({
  order,
  products = [],
  currentUser,
  onExit,
  onRefresh,
}) {
  const [items, setItems] = useState(() => sortPickingItemsInitially(order?.items || []));
  const [quantities, setQuantities] = useState({});
  const [liveProducts, setLiveProducts] = useState(products);
  const [replacementItem, setReplacementItem] = useState(null);
  const [selectedReplacement, setSelectedReplacement] = useState(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [pageBusy, setPageBusy] = useState(false);
  const [error, setError] = useState("");
  const [stockRefreshNonce, setStockRefreshNonce] = useState(0);

  const inventoryCountry = resolveOrderInventoryCountry(order);

  useEffect(() => {
    let active = true;
    const refreshLocationStock = async () => {
      const ids = [...new Set((order?.items || []).map(productIdOf).filter(Boolean))];
      if (!ids.length) {
        setLiveProducts(products);
        return;
      }
      try {
        const rows = await getProductLocationStock(ids);
        const map = buildLocationStockMap(rows);
        if (!active) return;
        setLiveProducts(
          products.map((product) => ({
            ...product,
            locationStocks: map[product.id] || product.locationStocks || {},
          }))
        );
      } catch (locationError) {
        if (active) {
          setError(
            locationError?.message || "Could not refresh warehouse stock."
          );
          setLiveProducts(products);
        }
      }
    };
    refreshLocationStock();
    return () => {
      active = false;
    };
  }, [order?.items, products, stockRefreshNonce]);

  const countryProducts = useMemo(
    () => applyLocationStockToProducts(liveProducts, inventoryCountry),
    [liveProducts, inventoryCountry]
  );

  const productsById = useMemo(
    () =>
      new Map(
        countryProducts
          .filter((product) => product?.id)
          .map((product) => [String(product.id), product])
      ),
    [countryProducts]
  );

  const totalOrdered = items.reduce(
    (sum, item) => sum + getOrderedQty(item),
    0
  );
  const totalResolved = items.reduce(
    (sum, item) => sum + getResolvedQty(item),
    0
  );
  const allDecided = totalOrdered > 0 && totalResolved === totalOrdered;

  const accountName =
    order?.customer_name ||
    order?.customerName ||
    order?.companyName ||
    order?.account_name ||
    order?.accountName ||
    "-";
  const branchName =
    order?.branch_name || order?.branchName || order?.customer_branch_name || "";

  const replacementProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const originalProductId = productIdOf(replacementItem);
    return countryProducts
      .filter(isActiveProduct)
      .filter((product) => String(product.id) !== String(originalProductId))
      .filter(
        (product) =>
          !product.inventoryLocationMissing && number(product.stock) > 0
      )
      .filter(
        (product) =>
          !query ||
          [
            product.name,
            product.productName,
            product.product_name,
            product.productCode,
            product.product_code,
            product.brand,
            product.series,
          ].some((value) =>
            String(value || "")
              .toLowerCase()
              .includes(query)
          )
      )
      .slice(0, 100);
  }, [countryProducts, replacementItem, search]);

  const updateLocalItem = (itemId, updater) =>
    setItems((current) =>
      current.map((item) =>
        String(itemIdOf(item)) === String(itemId)
          ? typeof updater === "function"
            ? updater(item)
            : { ...item, ...updater }
          : item
      )
    );

  const selectedQuantity = (item, stock) => {
    const id = itemIdOf(item);
    const remaining = getRemainingPickingQty(item);
    const recommended = Math.max(1, Math.min(remaining, Math.max(0, stock)));
    return Math.min(
      Math.max(1, number(quantities[id] ?? recommended)),
      Math.max(1, remaining)
    );
  };

  const setQty = (item, value) => {
    const id = itemIdOf(item);
    const remaining = getRemainingPickingQty(item);
    setQuantities((current) => ({
      ...current,
      [id]: Math.min(
        Math.max(1, Number(value) || 1),
        Math.max(1, remaining)
      ),
    }));
  };

  const chooseAction = async (
    item,
    action,
    replacement = null,
    forceFull = false,
    stock = 0
  ) => {
    const itemId = itemIdOf(item);
    const remaining = getRemainingPickingQty(item);
    if (!itemId || busyId || remaining <= 0) return;
    const requested = forceFull
      ? remaining
      : action === "replace"
        ? Math.min(selectedQuantity(item, stock), Math.max(0, stock), remaining)
        : Math.min(selectedQuantity(item, stock), remaining);

    if (requested <= 0) {
      setError("No stock is available for this action.");
      return;
    }

    setBusyId(itemId);
    setError("");
    try {
      const result = await savePickingDecision({
        order,
        orderItemId: itemId,
        action,
        quantity: requested,
        user: currentUser,
        replacement,
      });
      updateLocalItem(itemId, (current) => {
        const next = applyResult(current, result);
        if (action === "replace" && replacement) {
          const replacementName = replacement.name || replacement.productName || replacement.product_name || "Replacement product";
          next.replacementProductId = replacement.id;
          next.replacement_product_id = replacement.id;
          next.replacementProductName = replacementName;
          next.replacement_product_name = replacementName;
        }
        return next;
      });
      setQuantities((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      setReplacementItem(null);
      setSelectedReplacement(null);
      setSearch("");
      if (action === "in_stock" || action === "replace") {
        setStockRefreshNonce((value) => value + 1);
      }

      await logAction({
        user: currentUser,
        action_type: action === "replace" ? "Picking replacement saved" : "Picking status changed",
        page_module: "Picking",
        order_id: order.orderId,
        product_id: productIdOf(item),
        old_value: {
          source_status: item.sourceStatus || item.source_status || "In Stock",
          product_id: productIdOf(item),
          product_name: item.productName || item.product_name || item.name || "",
        },
        new_value: {
          action,
          quantity: requested,
          source_status: action === "pre_order" ? "Need Supplier" : "In Stock",
          replacement_product_id: replacement?.id || null,
          replacement_product_name: replacement?.name || replacement?.productName || replacement?.product_name || null,
          reason: "Picking action",
        },
      });
    } catch (actionError) {
      setError(actionError.message || "Could not save this picking action.");
    } finally {
      setBusyId(null);
    }
  };

  const recall = async (item) => {
    const itemId = itemIdOf(item);
    if (!itemId || busyId) return;
    if (!window.confirm("Recall this product action and restore the previous picking state?")) {
      return;
    }
    setBusyId(itemId);
    setError("");
    try {
      const result = await recallPickingDecision(itemId, currentUser);
      updateLocalItem(itemId, (current) => applyResult(current, result));
      setQuantities((current) => {
        const next = { ...current };
        delete next[itemId];
        return next;
      });
      setStockRefreshNonce((value) => value + 1);
      await logAction({
        user: currentUser,
        action_type: "Picking action recalled",
        page_module: "Picking",
        order_id: order.orderId,
        product_id: productIdOf(item),
        old_value: {
          picking_action: item.pickingAction || item.picking_action || null,
          source_status: item.sourceStatus || item.source_status || null,
        },
        new_value: { reason: "Picker recall" },
      });
    } catch (recallError) {
      setError(recallError.message || "Could not recall this picking action.");
    } finally {
      setBusyId(null);
    }
  };

  const recallAll = async () => {
    const actionedItems = items.filter((item) => getResolvedQty(item) > 0);
    if (!actionedItems.length || pageBusy || busyId) return;
    if (
      !window.confirm(
        `Recall all saved actions for ${actionedItems.length} product${actionedItems.length === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }

    setPageBusy(true);
    setError("");
    try {
      for (const item of actionedItems) {
        const itemId = itemIdOf(item);
        if (!itemId) continue;
        const result = await recallPickingDecision(itemId, currentUser);
        updateLocalItem(itemId, (current) => applyResult(current, result));
      }
      setQuantities({});
      setStockRefreshNonce((value) => value + 1);
    } catch (recallError) {
      setError(recallError.message || "Could not recall all picking actions.");
    } finally {
      setPageBusy(false);
    }
  };

  // Break keeps the database lock, so the same picker can continue later and
  // another picker cannot accidentally take the order.
  const breakPicking = () => {
    onExit?.();
  };

  // Cancel releases the current lock and makes the in-progress order available
  // for another picker. Existing saved item decisions remain intact.
  const cancelPicking = async () => {
    if (pageBusy) return;
    if (
      !window.confirm(
        "Cancel this picking session and release the order for another picker?"
      )
    ) {
      return;
    }
    setPageBusy(true);
    setError("");
    try {
      await pauseOrderPicking(order.orderId, currentUser);
      await onRefresh?.();
      onExit?.();
    } catch (cancelError) {
      setError(cancelError.message || "Could not release this order.");
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
      setError(
        completeError.message || "Could not complete and synchronise this order."
      );
    } finally {
      setPageBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 p-2 sm:p-4">
      <div className="mx-auto max-w-5xl">
        <header
          className="sticky top-0 z-20 mb-2 rounded-xl p-2.5 text-white shadow-lg"
          style={{ backgroundColor: FAIRCHOICE_BLUE }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase text-blue-100">
                Picking Order
              </div>
              <h1 className="text-xl font-black">
                {formatDisplayOrderId(order?.orderId)}
              </h1>
              <div className="text-sm font-semibold">Account: {accountName}</div>
              {branchName && (
                <div className="text-sm font-semibold">Branch: {branchName}</div>
              )}
              <div className="mt-1 text-xs text-blue-100">
                Inventory: {inventoryCountry || "Unresolved"}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:flex sm:items-start">
              <button
                type="button"
                onClick={recallAll}
                disabled={totalResolved <= 0 || pageBusy || Boolean(busyId)}
                className="min-h-11 rounded-lg border border-white/60 px-3 text-xs font-black text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Recall All
              </button>
              <button
                type="button"
                onClick={breakPicking}
                disabled={pageBusy}
                className="min-h-11 rounded-lg border border-white/60 px-3 text-xs font-black text-white hover:bg-white/10 disabled:opacity-50"
              >
                Break
              </button>
              <div className="rounded-lg bg-white/15 px-3 py-2 text-center">
                <div className="text-lg font-black">
                  {totalResolved}/{totalOrdered}
                </div>
                <div className="text-[10px] font-bold uppercase">
                  Units resolved
                </div>
              </div>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          {items.map((item) => {
            const itemId = itemIdOf(item);
            const ordered = getOrderedQty(item);
            const remaining = getRemainingPickingQty(item);
            const product = productsById.get(String(productIdOf(item)));
            const availability = getPickingAvailability(remaining, product);
            const stock = availability.stock;
            const itemBusy = busyId === itemId;
            const hasSavedAction = getResolvedQty(item) > 0;
            const pickedQty = number(item.pickingInStockQty ?? item.picking_in_stock_qty);
            const preOrderQty = number(item.pickingPreOrderQty ?? item.picking_pre_order_qty);
            const replacedQty = number(item.pickingReplacedQty ?? item.picking_replaced_qty);
            const canResolveRemainder = remaining > 0 && pickedQty > 0 && preOrderQty === 0 && replacedQty === 0;
            const selectedQty = selectedQuantity(item, stock);
            const canPartPick =
              remaining > 1 &&
              stock > 0 &&
              stock < remaining &&
              selectedQty === stock;
            const currentSourceStatus = String(
              item.sourceStatus || item.source_status || "In Stock"
            ).trim().toLowerCase();
            const isPreOrderOverride = [
              "need supplier",
              "pre-order",
              "pre order",
              "next supplier",
            ].includes(currentSourceStatus);
            const canPickAll =
              remaining > 0 &&
              (isPreOrderOverride ||
                (!product?.inventoryLocationMissing && stock >= remaining));

            return (
              <article
                key={itemId}
                className="rounded-lg border bg-white px-2.5 py-2 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-black sm:text-base">
                      {item.productName || item.product_name || item.name}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-600">
                      <span>Order <b className="text-slate-900">{ordered}</b></span>
                      <span className="text-emerald-700">Stock <b>{stock}</b></span>
                      <span className="text-blue-700">Remaining <b>{remaining}</b></span>
                      {pickedQty > 0 && <span className="text-emerald-700">Picked <b>{pickedQty}</b></span>}
                      {preOrderQty > 0 && <span className="text-amber-700">Pre-order <b>{preOrderQty}</b></span>}
                      {replacedQty > 0 && <span className="text-blue-700">Replaced <b>{replacedQty}</b></span>}
                    </div>
                    {replacedQty > 0 && (item.replacementProductName || item.replacement_product_name) && (
                      <div className="mt-1 truncate text-[11px] font-bold text-blue-700">
                        Replacement: {item.replacementProductName || item.replacement_product_name}
                      </div>
                    )}
                  </div>
                  <div className={`shrink-0 rounded-md border px-2 py-1 text-center text-[10px] font-black uppercase ${availability.className}`}>
                    {availability.label}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <span className="mr-1 text-[10px] font-black uppercase text-slate-500">Qty</span>
                  <button
                    type="button"
                    aria-label="Decrease picking quantity"
                    disabled={(hasSavedAction && !canResolveRemainder) || selectedQty <= 1 || itemBusy}
                    onClick={() => setQty(item, selectedQty - 1)}
                    className="h-8 w-8 rounded-md bg-slate-200 text-sm font-black disabled:cursor-not-allowed disabled:text-slate-400"
                  >−</button>
                  <input
                    aria-label="Picking quantity"
                    type="number"
                    min="1"
                    max={Math.max(1, remaining)}
                    value={selectedQty}
                    disabled={(hasSavedAction && !canResolveRemainder) || remaining <= 1 || itemBusy}
                    onChange={(event) => setQty(item, event.target.value)}
                    className="h-8 w-14 rounded-md border text-center text-sm font-black disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                  />
                  <button
                    type="button"
                    aria-label="Increase picking quantity"
                    disabled={(hasSavedAction && !canResolveRemainder) || selectedQty >= remaining || itemBusy}
                    onClick={() => setQty(item, selectedQty + 1)}
                    className="h-8 w-8 rounded-md bg-slate-200 text-sm font-black disabled:cursor-not-allowed disabled:text-slate-400"
                  >+</button>
                  <span className="text-[10px] font-bold text-slate-500">{remaining <= 1 ? "unit" : `of ${remaining}`}</span>
                </div>

                <div className="mt-2 grid grid-cols-5 gap-1">
                  <button
                    type="button"
                    disabled={hasSavedAction || !canPartPick || itemBusy}
                    onClick={() => chooseAction(item, "in_stock", null, false, stock)}
                    className={actionClass(hasSavedAction || !canPartPick || itemBusy)}
                  >Part</button>
                  <button
                    type="button"
                    disabled={hasSavedAction || !canPickAll || itemBusy}
                    onClick={() => chooseAction(item, "in_stock", null, true, stock)}
                    className={actionClass(hasSavedAction || !canPickAll || itemBusy)}
                  >Pick</button>
                  <button
                    type="button"
                    disabled={(hasSavedAction && !canResolveRemainder) || !remaining || itemBusy}
                    onClick={() => chooseAction(item, "pre_order", null, false, stock)}
                    className={actionClass((hasSavedAction && !canResolveRemainder) || !remaining || itemBusy)}
                  >Pre</button>
                  <button
                    type="button"
                    disabled={(hasSavedAction && !canResolveRemainder) || !remaining || itemBusy}
                    onClick={() => { setReplacementItem(item); setSelectedReplacement(null); setSearch(""); }}
                    className={actionClass((hasSavedAction && !canResolveRemainder) || !remaining || itemBusy)}
                  >Replace</button>
                  <button
                    type="button"
                    disabled={!hasSavedAction || itemBusy}
                    onClick={() => recall(item)}
                    className={actionClass(!hasSavedAction || itemBusy)}
                  >Recall</button>
                </div>
              </article>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-20 mt-3 rounded-xl border bg-white/95 p-3 shadow-2xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <button
              type="button"
              onClick={cancelPicking}
              disabled={pageBusy}
              className="min-h-11 rounded-lg border border-red-300 bg-red-50 px-5 font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
            >
              Cancel Picking / Release Order
            </button>
            <button
              type="button"
              onClick={completePicking}
              disabled={!allDecided || pageBusy}
              className={actionClass(!allDecided || pageBusy)}
            >
              Complete Picking
            </button>
          </div>
        </div>

        {replacementItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3">
            <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="border-b p-4">
                <h2 className="text-lg font-black">
                  Replace {replacementItem.productName || replacementItem.product_name}
                </h2>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search replacement product..."
                  className="mt-3 w-full rounded-lg border p-3"
                />
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                {replacementProducts.map((product) => {
                  const selected = String(selectedReplacement?.id || "") === String(product.id);
                  return (
                  <button
                    type="button"
                    key={product.id}
                    onClick={() => setSelectedReplacement(product)}
                    className={`mb-2 flex w-full items-center justify-between rounded-xl border p-4 text-left ${selected ? "border-[#0f5b8d] bg-blue-50 ring-2 ring-blue-200" : "border-slate-200 hover:bg-slate-50"}`}
                  >
                    <div className="font-bold">
                      {product.name || product.productName || product.product_name}
                    </div>
                    <div className="text-sm text-slate-500">
                      Stock: {product.stock} ({inventoryCountry})
                    </div>
                  </button>
                  );
                })}
                {!replacementProducts.length && (
                  <div className="p-5 text-center text-slate-500">
                    No replacement products with {inventoryCountry || "resolved"} stock.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 border-t p-3">
                <button
                  type="button"
                  onClick={() => { setReplacementItem(null); setSelectedReplacement(null); }}
                  className="min-h-12 rounded-xl bg-slate-200 font-black"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!selectedReplacement || Boolean(busyId)}
                  onClick={() => selectedReplacement && chooseAction(
                    replacementItem,
                    "replace",
                    selectedReplacement,
                    false,
                    number(selectedReplacement.stock)
                  )}
                  className={actionClass(!selectedReplacement || Boolean(busyId))}
                >
                  Add Replacement
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
