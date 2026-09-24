import { useMemo, useRef, useState } from "react";
import {
  createReturnRequest,
  findMatchingReturn,
  loadPotentialDuplicateReturns,
  RETURN_REASONS,
  RETURN_TYPES,
} from "../services/centralReturnEngine";
import { formatCurrency } from "../utils/currency";
import { getOrderItemQty } from "../utils/orderTotals";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import {
  getPriceModeLabel,
  getProductPriceDetailsForMode,
  isVatPriceMode,
} from "../utils/pricing";
import {
  acquireReturnSubmissionLock,
  releaseReturnSubmissionLock,
} from "../services/returnRequestSubmissionSafety";

const getOrderItems = (order = {}) => order.items || order.order_items || [];
const getItemName = (item = {}) => item.name || item.productName || item.product_name || "Unnamed Product";
const getItemCode = (item = {}) => item.productCode || item.product_code || item.code || "";
const getItemPrice = (item = {}) => Number(item.price || item.unit_price || item.selectedPrice || 0);

const RETURN_PRICE_MODES = [
  { value: "vat", label: "Ex.VAT" },
  { value: "server", label: "Inc.VAT" },
  { value: "manager", label: "Manager Offer" },
  { value: "super", label: "Admin Offer" },
];

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const normalizeCatalogProduct = (product = {}) => ({
  ...product,
  id: product.id || product.product_id,
  product_id: product.id || product.product_id,
  productCode: product.productCode || product.product_code,
  product_code: product.productCode || product.product_code,
  name: product.name || product.product_name,
  product_name: product.name || product.product_name,
  qty: product.qty || product.quantity || 1,
  price: product.price || product.vatPrice || product.vat_price || 0,
});

export default function ReturnRequestModal({
  order,
  source = "RETURN_PORTAL",
  currentUser,
  onClose,
  onSaved,
  catalogProducts = [],
  allowCatalogProducts = false,
  pricingSettings = {},
  country = "",
  embedded = false,
  onSubmittingChange,
  onCreatedReturnChange,
  onCreateAnother,
}) {
  const initialPriceMode = String(order?.priceMode || order?.price_mode || "vat").toLowerCase();
  const [returnType, setReturnType] = useState(RETURN_TYPES[0]);
  const [priceMode, setPriceMode] = useState(initialPriceMode);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [notes, setNotes] = useState("");
  const [createdReturn, setCreatedReturn] = useState(null);
  const submitLockRef = useRef(false);
  const createdReturnRef = useRef(null);

  const previousInvoiceNumber = order?.previousInvoiceNumber || "";
  const previousInvoiceDate = order?.previousInvoiceDate || "";

  const orderItems = allowCatalogProducts
    ? catalogProducts.map(normalizeCatalogProduct)
    : getOrderItems(order);
  const resolvedCountry =
    country ||
    order?.country ||
    order?.branchCountry ||
    order?.branch_country ||
    order?.delivery_country ||
    "";

  const findCatalogProduct = (item = {}) => {
    const itemId = item.id || item.productId || item.product_id;
    const itemCode = getItemCode(item);
    return catalogProducts.find((product) => {
      const productId = product.id || product.product_id;
      const productCode = product.productCode || product.product_code || product.code || "";
      return (itemId && String(productId) === String(itemId)) ||
        (itemCode && String(productCode).toLowerCase() === String(itemCode).toLowerCase());
    }) || null;
  };

  const getLineFinancials = (item = {}, qtyOverride) => {
    const pricingProduct = findCatalogProduct(item) || item;
    const details = getProductPriceDetailsForMode(
      pricingProduct,
      priceMode,
      resolvedCountry,
      pricingSettings
    );
    const fallbackPrice = getItemPrice(item);
    const unitPrice = Number(details?.price || details?.unitPrice || fallbackPrice || 0);
    const qty = Number(qtyOverride ?? item.returnQty ?? item.qty ?? item.quantity ?? 0);
    const netTotal = roundMoney(unitPrice * qty);
    const vatTotal = isVatPriceMode(priceMode)
      ? roundMoney(Number(details?.vatAmount || 0) * qty)
      : 0;
    return {
      unitPrice: roundMoney(unitPrice),
      netTotal,
      vatTotal,
      grossTotal: roundMoney(netTotal + vatTotal),
    };
  };

  const getPricedLine = (line = {}) => {
    const financials = getLineFinancials(line);
    return {
      ...line,
      price: financials.unitPrice,
      selectedPrice: financials.unitPrice,
      unit_price: financials.unitPrice,
      net_total: financials.netTotal,
      vat_total: financials.vatTotal,
      gross_total: financials.grossTotal,
      price_mode: priceMode,
    };
  };
  const filteredItems = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return orderItems.slice(0, 10);

    return orderItems.filter((item) => {
      const name = getItemName(item).toLowerCase();
      const code = getItemCode(item).toLowerCase();
      return name.includes(value) || code.includes(value);
    }).slice(0, 10);
  }, [orderItems, search]);

  if (!order) return null;

  const addProduct = (item) => {
    const productId = item.id || item.productId || item.product_id || getItemName(item);
    const exists = lines.some((line) => String(line.productKey) === String(productId));
    if (exists) return;

    setLines((old) => [
      ...old,
      {
        ...item,
        productKey: productId,
        returnQty: 1,
        reason: RETURN_REASONS[0],
        price_mode: priceMode,
      },
    ]);
  };

  const updateLine = (index, updates) => {
    setLines((old) => old.map((line, lineIndex) => (lineIndex === index ? { ...line, ...updates } : line)));
  };

  const removeLine = (index) => {
    setLines((old) => old.filter((_, lineIndex) => lineIndex !== index));
  };

  const total = lines.reduce((sum, line) => sum + getLineFinancials(line).grossTotal, 0);
  const totalQty = lines.reduce((sum, line) => sum + Number(line.returnQty || 0), 0);
  const customerName = order.companyName || order.company_name || "Customer";
  const branchName = order.branchName || order.branch_name || "Not specified";
  const formLocked = saving || showConfirmation;

  const requestReturnConfirmation = () => {
    if (submitLockRef.current || createdReturnRef.current?.id || createdReturn?.id) return;
    if (!priceMode) {
      alert("Please select a Price Mode for this return.");
      return;
    }
    if (!lines.length) {
      alert("Please add at least one product to return.");
      return;
    }
    setShowConfirmation(true);
  };

  const saveReturn = async () => {
    if (!acquireReturnSubmissionLock(submitLockRef, createdReturnRef.current || createdReturn)) return;
    setShowConfirmation(false);
    setSaving(true);
    onSubmittingChange?.(true);

    const referenceNotes = [
      `Price mode: ${getPriceModeLabel(priceMode)}`,
      previousInvoiceNumber ? `Previous invoice: ${previousInvoiceNumber}` : "",
      previousInvoiceDate ? `Previous invoice date: ${previousInvoiceDate}` : "",
      notes,
    ].filter(Boolean).join("\n");

    try {
      const existingReturns = await loadPotentialDuplicateReturns(order);
      const matchingReturn = findMatchingReturn({
        order,
        returnType,
        items: lines.map(getPricedLine),
        existingReturns,
      });
      if (
        matchingReturn &&
        !window.confirm(
          `A matching return already exists (${matchingReturn.return_number || matchingReturn.id}).\n\nCreate another return anyway?`
        )
      ) {
        releaseReturnSubmissionLock(submitLockRef);
        setSaving(false);
        onSubmittingChange?.(false);
        return;
      }
      const savedReturn = await createReturnRequest({
        order,
        returnType,
        source,
        currentUser,
        notes: referenceNotes,
        items: lines.map(getPricedLine),
        priceMode,
        allowDuplicate: Boolean(matchingReturn),
      });
      const receipt = {
        ...savedReturn,
        receiptCustomerName: savedReturn.customer_name || customerName,
        receiptBranchName: savedReturn.branch_name || branchName,
        receiptProductCount: lines.length,
        receiptTotalQty: totalQty,
        receiptEstimatedCredit: Number(savedReturn.return_total ?? total),
        receiptPriceMode: savedReturn.price_mode || priceMode,
        status: savedReturn.status || "Pending Warehouse Confirmation",
      };
      createdReturnRef.current = receipt;
      setCreatedReturn(receipt);
      setLines([]);
      setSearch("");
      setNotes("");
      setReturnType(RETURN_TYPES[0]);
      setPriceMode(initialPriceMode);
      setShowConfirmation(false);
      setSaving(false);
      onSubmittingChange?.(false);
      onCreatedReturnChange?.(receipt);
      onSaved?.(receipt);
    } catch (error) {
      console.error("Return request error:", error);
      alert("Could not create return request: " + error.message);
      releaseReturnSubmissionLock(submitLockRef);
      setSaving(false);
      onSubmittingChange?.(false);
    }
  };

  const createAnotherReturn = () => {
    createdReturnRef.current = null;
    releaseReturnSubmissionLock(submitLockRef);
    setCreatedReturn(null);
    setLines([]);
    setSearch("");
    setNotes("");
    setReturnType(RETURN_TYPES[0]);
    setPriceMode(initialPriceMode);
    setShowConfirmation(false);
    setSaving(false);
    onSubmittingChange?.(false);
    onCreatedReturnChange?.(null);
    onCreateAnother?.();
  };

  if (createdReturn?.id) {
    const receipt = (
      <div className={`${embedded ? "w-full" : "bg-white rounded-2xl shadow-xl w-full max-w-3xl"} p-5 space-y-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold text-emerald-800">Return Request Created</h3>
            <p className="text-sm text-slate-500">Warehouse can confirm the return next.</p>
          </div>
          {!embedded && (
            <button type="button" disabled={saving} onClick={onClose} className="bg-slate-200 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
              Close
            </button>
          )}
        </div>
        <dl className="grid grid-cols-1 gap-3 rounded-xl border bg-emerald-50 p-4 sm:grid-cols-2">
          <div><dt className="text-xs font-bold text-slate-500">Return No</dt><dd className="font-extrabold">{createdReturn.return_number}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Status</dt><dd className="font-bold">{createdReturn.status}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Price Mode</dt><dd className="font-bold">{getPriceModeLabel(createdReturn.receiptPriceMode)}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Customer</dt><dd className="font-bold">{createdReturn.receiptCustomerName}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Products</dt><dd className="font-bold">{createdReturn.receiptProductCount}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Total Qty</dt><dd className="font-bold">{createdReturn.receiptTotalQty}</dd></div>
          <div><dt className="text-xs font-bold text-slate-500">Estimated Credit</dt><dd className="font-extrabold">{formatCurrency(createdReturn.receiptEstimatedCredit)}</dd></div>
        </dl>
        <button type="button" onClick={createAnotherReturn} className="w-full rounded-xl bg-blue-700 px-5 py-3 font-bold text-white">
          Create Another Return
        </button>
      </div>
    );
    if (embedded) return receipt;
    return <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">{receipt}</div>;
  }

  const content = (
      <div className={`${embedded ? "w-full" : "bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-auto"} p-4 space-y-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold">Create Return</h3>
            <p className="text-sm text-slate-500">
              {formatDisplayOrderId(order.orderId || order.order_number) || "Order"} | {order.companyName || order.company_name || "Customer"}
            </p>
          </div>
          {!embedded && (
            <button type="button" disabled={formLocked} onClick={onClose} className="bg-slate-200 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
              Close
            </button>
          )}
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Return Type</label>
          <select disabled={formLocked} value={returnType} onChange={(e) => setReturnType(e.target.value)} className="w-full border rounded-xl p-3 bg-white disabled:bg-slate-100">
            {RETURN_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Price Mode</label>
          <select
            disabled={formLocked}
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value)}
            className="w-full border rounded-xl p-3 bg-white font-bold disabled:bg-slate-100"
          >
            {RETURN_PRICE_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>{mode.label}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Return value is calculated using the selected price mode.</p>
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">
            {allowCatalogProducts ? "Search Product" : "Search Delivered Product"}
          </label>
          <input disabled={formLocked} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product name or code" className="w-full border rounded-xl p-3 disabled:bg-slate-100" />

          <div className="mt-2 border rounded-xl divide-y overflow-hidden">
            {filteredItems.map((item) => (
              <button
                type="button"
                disabled={formLocked}
                key={`${item.id || item.product_id || getItemName(item)}-${getItemCode(item)}`}
                onClick={() => addProduct(item)}
                className="w-full text-left p-3 hover:bg-slate-50 flex justify-between gap-3 disabled:opacity-50"
              >
                <span>
                  <span className="font-bold">{getItemName(item)}</span>
                  <span className="block text-xs text-slate-500">
                    {getItemCode(item) || "No code"}
                    {!allowCatalogProducts && ` | Delivered Qty: ${getOrderItemQty(item)}`}
                  </span>
                </span>
                <span className="text-xs font-bold text-blue-700">Add</span>
              </button>
            ))}

            {filteredItems.length === 0 && (
              <div className="p-3 text-sm text-slate-500">No matching delivered products.</div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-bold">Return Products</h4>
          {lines.map((line, index) => {
            const deliveredQty = getOrderItemQty(line);
            return (
              <div key={`${line.productKey}-${index}`} className="border rounded-xl p-3 grid grid-cols-1 md:grid-cols-[1fr_90px_170px_auto] gap-2 md:items-center">
                <div>
                  <div className="font-bold">{getItemName(line)}</div>
                  <div className="text-xs text-slate-500">
                    {!allowCatalogProducts && `Delivered: ${deliveredQty} | `}
                    Price ({getPriceModeLabel(priceMode)}): {formatCurrency(getLineFinancials(line).unitPrice)}
                  </div>
                </div>
                <input
                  type="number"
                  disabled={formLocked}
                  min="1"
                  max={allowCatalogProducts ? undefined : deliveredQty || undefined}
                  value={line.returnQty}
                  onChange={(e) => updateLine(index, { returnQty: Math.max(1, Number(e.target.value || 1)) })}
                  className="border rounded-lg p-2"
                />
                <select disabled={formLocked} value={line.reason} onChange={(e) => updateLine(index, { reason: e.target.value })} className="border rounded-lg p-2 bg-white disabled:bg-slate-100">
                  {RETURN_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
                <button type="button" disabled={formLocked} onClick={() => removeLine(index)} className="bg-red-100 text-red-700 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50">
                  Remove
                </button>
              </div>
            );
          })}

          {lines.length === 0 && <div className="border rounded-xl p-4 text-center text-slate-500">No products added yet.</div>}
        </div>

        <textarea disabled={formLocked} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" className="w-full border rounded-xl p-3 disabled:bg-slate-100" />

        <div className="border rounded-xl p-3 bg-slate-50 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-sm">
            <strong>Confirmation:</strong> {lines.length} product(s), estimated credit {formatCurrency(total)}
          </div>
          <button type="button" onClick={requestReturnConfirmation} disabled={formLocked} className="bg-green-700 text-white px-5 py-3 rounded-xl font-bold disabled:bg-slate-300">
            {saving ? "Creating Return..." : "Confirm Return Request"}
          </button>
        </div>

        {showConfirmation && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-labelledby="return-confirmation-title">
            <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
              <h4 id="return-confirmation-title" className="text-xl font-extrabold">Create this return request?</h4>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="font-bold text-slate-500">Customer</dt><dd>{customerName}</dd>
                <dt className="font-bold text-slate-500">Branch</dt><dd>{branchName}</dd>
                <dt className="font-bold text-slate-500">Previous Invoice</dt><dd>{previousInvoiceNumber || "Not specified"}</dd>
                <dt className="font-bold text-slate-500">Price Mode</dt><dd>{getPriceModeLabel(priceMode)}</dd>
                <dt className="font-bold text-slate-500">Return Products</dt><dd>{lines.length}</dd>
                <dt className="font-bold text-slate-500">Total Qty</dt><dd>{totalQty}</dd>
                <dt className="font-bold text-slate-500">Estimated Credit</dt><dd>{formatCurrency(total)}</dd>
              </dl>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setShowConfirmation(false)} className="rounded-xl bg-slate-200 px-4 py-3 font-bold">Cancel</button>
                <button type="button" onClick={saveReturn} disabled={saving} className="rounded-xl bg-green-700 px-4 py-3 font-bold text-white disabled:bg-slate-300">
                  {saving ? "Creating Return..." : "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
  );

  if (embedded) return content;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-3">
      {content}
    </div>
  );
}
