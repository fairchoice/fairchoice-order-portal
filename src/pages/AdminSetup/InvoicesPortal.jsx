import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../services/supabase";
import { formatCurrency } from "../../utils/currency";
import {
  amendInvoice,
  createManualInvoice,
  downloadInvoice,
  fetchInvoiceOrderFromDb,
  filterActiveInvoiceLines,
  getInvoiceTotal,
  hydrateOrdersWithFullOrderItems,
  loadProcessingQueueOrders,
  mergeOperationalOrders,
  previewInvoice,
  printInvoice,
  withResolvedInvoicePaymentStatus,
} from "../../services/centralInvoiceEngine";
import {
  confirmReturnCredit,
  createReturnRequest,
  RETURN_TYPES,
} from "../../services/centralReturnEngine";
import { getCustomerAccounts } from "../../services/customerManagement";
import { getProducts } from "../../services/products";
import { getProductPriceForMode, isServerManagerPriceMode } from "../../utils/pricing";
import {
  calculateCartOrderItems,
  calculateCartTotals,
  getOrderItemProductCode,
} from "../../utils/orderTotals";

const getCreatedDate = (row) => row.created_at || row.invoice_date || row.date || "";
const getReference = (row) => row.reference_no || row.order_number || row.invoice_number || row.id || "-";
const getCustomer = (row) => row.customer_name || row.company_name || row.account_name || "-";
const getReferenceCandidates = (row = {}) =>
  [
    row._freshOrder?.order_number,
    row._freshOrder?.orderId,
    row.order_number,
    row.orderNumber,
    row.orderId,
    row.reference_no,
    row.invoice_number,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
const getAmount = (row) =>
  row._freshOrder
    ? getInvoiceTotal(row._freshOrder)
    : Number(row.invoice_total ?? row.invoice_amount ?? row.amount ?? row.debit ?? 0);
const getOrderPaymentStatus = (order = {}, invoiceTotal = 0) => {
  const explicitStatus = String(order.invoice_status || order.payment_status || order.paymentStatus || "")
    .trim()
    .toUpperCase();
  if (["PAID", "PART PAID", "UNPAID"].includes(explicitStatus)) return explicitStatus;

  const paymentCollected = String(order.payment_collected || order.paymentCollected || "")
    .trim()
    .toLowerCase();
  const paymentAmount = Number(
    order.payment_amount ??
      order.paymentAmount ??
      order.paid_amount ??
      order.paidAmount ??
      0
  );

  if (paymentCollected === "yes" || paymentCollected === "true") return "PAID";
  if (invoiceTotal > 0 && paymentAmount >= invoiceTotal - 0.01) return "PAID";
  if (paymentAmount > 0) return "PART PAID";
  return "UNPAID";
};
const getLedgerRowForOrder = (ledgerRowsByReference, order = {}) => {
  const references = getReferenceCandidates(order);
  return references.map((reference) => ledgerRowsByReference.get(reference)).find(Boolean) || null;
};
const mergeLedgerMetadataIntoOrderRow = (orderRow = {}, ledgerRow = null) => {
  if (!ledgerRow) return orderRow;

  const invoiceTotal = getInvoiceTotal(orderRow._freshOrder || orderRow);

  return {
    ...ledgerRow,
    ...orderRow,
    id: ledgerRow.id || orderRow.id,
    debit: invoiceTotal,
    amount: invoiceTotal,
    invoice_amount: invoiceTotal,
    invoice_total: invoiceTotal,
    paid_amount: ledgerRow.paid_amount ?? orderRow.paid_amount,
    remaining_amount: ledgerRow.remaining_amount ?? orderRow.remaining_amount,
    invoice_status: ledgerRow.invoice_status || orderRow.invoice_status,
    status: ledgerRow.invoice_status || ledgerRow.status || orderRow.status,
    _ledgerRow: ledgerRow,
  };
};
const getBranch = (row) =>
  row.branch_name ||
  row.delivery_branch_name ||
  row._freshOrder?.branchName ||
  row._freshOrder?.branch_name ||
  row._freshOrder?.delivery_branch_name ||
  "";
const normalizeSearchText = (value) => String(value || "").trim().toLowerCase();
const normalizeOrderSearchText = (value) =>
  String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const stripOrderPrefix = (value) => normalizeOrderSearchText(value).replace(/^ORD-?/, "");
const getOrderSearch = (value) => {
  const compact = normalizeOrderSearchText(value);
  if (!compact) return null;

  const bareOrder = stripOrderPrefix(compact);
  if (!bareOrder || !/^\d{6,}$/.test(bareOrder)) return null;

  return {
    compact,
    bareOrder,
    canonical: `ORD-${bareOrder}`,
  };
};
const orderFieldMatches = (value, orderSearch) => {
  if (!orderSearch || !value) return false;

  const compact = normalizeOrderSearchText(value);
  const bareOrder = stripOrderPrefix(compact);

  return (
    compact.includes(orderSearch.compact) ||
    compact.includes(orderSearch.canonical) ||
    bareOrder.includes(orderSearch.bareOrder)
  );
};
const getInvoiceSearchFields = (row) => [
  row._freshOrder?.order_number,
  row._freshOrder?.orderId,
  row.reference_no,
  row.order_number,
  row.invoice_number,
  getCustomer(row),
  getBranch(row),
  row.invoice_status,
  row.status,
];
const getInvoicePriceMode = (row = {}) =>
  row.price_mode ||
  row.order_price_mode ||
  row.priceMode ||
  row._freshOrder?.price_mode ||
  row._freshOrder?.priceMode ||
  row.__order?.price_mode ||
  row.__order?.priceMode ||
  row.transaction_snapshot?.price_mode ||
  "";
const isServerManagerInvoiceRow = (row = {}) =>
  row.isProcessingQueueOrder === true ||
  row.__order?.isProcessingQueueOrder === true ||
  row._freshOrder?.isProcessingQueueOrder === true ||
  isServerManagerPriceMode(getInvoicePriceMode(row));
const isDeliveredInvoiceRow = (order = {}) =>
  ["delivered", "confirmed", "delivery confirmed", "completed"].includes(
    String(order.status || "").trim().toLowerCase()
  );
const getOrderInvoiceListRow = (order = {}) => {
  const invoiceTotal = getInvoiceTotal({
    ...order,
    items: order.items || order.order_items || [],
  });
  const invoiceStatus = getOrderPaymentStatus(order, invoiceTotal);

  return {
    id: `order-invoice-${order.order_number}`,
    created_at: order.delivered_at || order.updated_at || order.created_at,
    invoice_date: order.delivered_at || order.updated_at || order.created_at,
    entry_type: "INVOICE",
    reference_no: order.order_number,
    order_number: order.order_number,
    customer_name: order.company_name || "",
    branch_name:
      order.delivery_branch_name ||
      order.branch_name ||
      order.shop_name ||
      "",
    debit: invoiceTotal,
    amount: invoiceTotal,
    invoice_amount: invoiceTotal,
    invoice_total: invoiceTotal,
    credit: 0,
    paid_amount: invoiceStatus === "PAID" ? invoiceTotal : Number(order.payment_amount || 0),
    remaining_amount:
      invoiceStatus === "PAID"
        ? 0
        : Math.max(0, invoiceTotal - Number(order.payment_amount || 0)),
    invoice_status: invoiceStatus,
    status: invoiceStatus,
    _freshOrder: {
      ...order,
      items: order.items || order.order_items || [],
    },
  };
};
const getProductName = (product) => product?.name || product?.productName || product?.product_name || "";
const getProductSku = (product) => product?.sku || product?.SKU || product?.product_sku || "";
const getProductCode = (product) => product?.productCode || product?.product_code || product?.code || "";
const getProductBarcode = (product) =>
  product?.barcode || product?.bar_code || product?.ean || product?.ean13 || product?.upc || "";
const getProductSearchText = (product) =>
  [
    getProductSku(product),
    getProductCode(product),
    getProductName(product),
    product?.brand,
    product?.flavour,
    getProductBarcode(product),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export default function InvoicesPortal() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [invoicePage, setInvoicePage] = useState(1);
  const [invoicePageSize, setInvoicePageSize] = useState(10);
  const [exactSearchInvoices, setExactSearchInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [pricingSettings, setPricingSettings] = useState({});
  const [setupLoading, setSetupLoading] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [workbenchMode, setWorkbenchMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [debouncedProductSearch, setDebouncedProductSearch] = useState("");
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [highlightedProductIndex, setHighlightedProductIndex] = useState(0);
  const productSearchInputRef = useRef(null);
  const [form, setForm] = useState({
    customerId: "",
    branchId: "",
    priceMode: "VAT",
    productId: "",
    qty: 1,
    returnType: "Customer Rejected",
    reason: "",
    notes: "",
    lines: [],
  });
  const [amendOrder, setAmendOrder] = useState(null);
  const loggedInUser = JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );
  const userRole = String(loggedInUser?.role || loggedInUser?.access_level || "").toLowerCase();
  const isAdminUser = userRole.includes("admin") || loggedInUser?.permissions?.access_accounts === true;
  const isNisstajAdmin =
    String(loggedInUser?.username || "").trim().toLowerCase() === "nisstaj_admin";
  const canViewServerManagerInvoices = isNisstajAdmin;
  const canShowInvoiceRow = (row = {}) =>
    canViewServerManagerInvoices || !isServerManagerInvoiceRow(row);
  const activeFormLines = useMemo(
    () => filterActiveInvoiceLines(form.lines),
    [form.lines]
  );

  const formTotals = useMemo(
    () => calculateCartTotals(activeFormLines, { priceMode: form.priceMode }),
    [activeFormLines, form.priceMode]
  );
  const formTotalQuantity = activeFormLines.reduce(
    (sum, line) => sum + Number(line.qty ?? line.quantity ?? line.pickedQty ?? 0),
    0
  );
  const getProductPriceColumnForMode = (priceMode = "") => {
    const mode = String(priceMode).toLowerCase();
    if (mode.includes("cash")) return "cash_price";
    if (mode.includes("wales")) return "wales_price";
    if (mode.includes("england")) return "england_price";
    return "vat_price";
  };

  const getOrderForInvoice = async (row) => {
    const order = await fetchInvoiceOrderFromDb(row);
    if (!order) {
      alert("Original order not found for this invoice.");
      return null;
    }

    return {
      ...order,
      orderId: order.order_number,
      order_number: order.order_number,
      companyName: order.company_name || row.customer_name,
      company_name: order.company_name || row.customer_name,
      branchName: order.branch_name || row.branch_name,
      branch_name: order.branch_name || row.branch_name,
      items: order.items || order.order_items || [],
    };
  };

  const selectedCustomer = customers.find(
    (customer) => String(customer.id) === String(form.customerId)
  );
  const selectedBranches =
    selectedCustomer?.customer_branches?.filter((branch) => branch.active !== false) || [];
  const selectedBranch = selectedBranches.find(
    (branch) => String(branch.id) === String(form.branchId)
  );
  const selectedPricingCountry =
    selectedBranch?.country ||
    selectedCustomer?.country ||
    selectedCustomer?.customer_country ||
    "";
  const canAddWorkbenchProduct =
    workbenchMode === "amend" || Boolean(selectedCustomer);
  const selectedProduct = products.find(
    (item) => String(item.id) === String(form.productId)
  );
  const productSearchValue = debouncedProductSearch.trim().toLowerCase();
  const matchingProducts = useMemo(() => {
    if (!canAddWorkbenchProduct || !productSearchValue) return [];

    return products
      .filter((product) => getProductSearchText(product).includes(productSearchValue))
      .slice(0, 20);
  }, [canAddWorkbenchProduct, productSearchValue, products]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedProductSearch(productSearch);
      setHighlightedProductIndex(0);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [productSearch]);

  useEffect(() => {
    if (!canAddWorkbenchProduct) {
      setProductSearch("");
      setDebouncedProductSearch("");
      setProductSearchOpen(false);
      setHighlightedProductIndex(0);
      setForm((current) =>
        current.productId ? { ...current, productId: "" } : current
      );
    }
  }, [canAddWorkbenchProduct]);

  const focusProductSearch = () => {
    window.setTimeout(() => productSearchInputRef.current?.focus(), 0);
  };

  const clearProductPicker = ({ focus = false } = {}) => {
    setProductSearch("");
    setDebouncedProductSearch("");
    setProductSearchOpen(false);
    setHighlightedProductIndex(0);
    if (focus) focusProductSearch();
  };

  const selectProduct = (product) => {
    if (!product) return;

    setForm((current) => ({ ...current, productId: product.id }));
    setProductSearch(getProductName(product));
    setDebouncedProductSearch(getProductName(product));
    setProductSearchOpen(false);
    setHighlightedProductIndex(0);
  };

  const highlightSearchText = (text) => {
    const value = String(text || "");
    const query = productSearch.trim();
    if (!query) return value;

    const index = value.toLowerCase().indexOf(query.toLowerCase());
    if (index === -1) return value;

    return (
      <>
        {value.slice(0, index)}
        <mark className="rounded bg-yellow-100 px-0.5 text-slate-950">
          {value.slice(index, index + query.length)}
        </mark>
        {value.slice(index + query.length)}
      </>
    );
  };

  const handleProductSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      setProductSearchOpen(false);
      return;
    }

    if (!productSearchOpen && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      setProductSearchOpen(true);
    }

    if (!matchingProducts.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedProductIndex((current) =>
        Math.min(current + 1, matchingProducts.length - 1)
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedProductIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && productSearchOpen) {
      event.preventDefault();
      selectProduct(matchingProducts[highlightedProductIndex] || matchingProducts[0]);
    }
  };

  const resetForm = () => {
    setWorkbenchMode("");
    setAmendOrder(null);
    clearProductPicker();
    setForm({
      customerId: "",
      branchId: "",
      priceMode: "VAT",
      productId: "",
      qty: 1,
      returnType: "Customer Rejected",
      reason: "",
      notes: "",
      lines: [],
    });
  };

  const addSelectedProductLine = () => {
    if (setupLoading || setupError) {
      alert(setupError || "Invoice setup data is still loading.");
      return;
    }
    if (!canAddWorkbenchProduct) {
      alert("Select customer first.");
      return;
    }

    const product = products.find((item) => String(item.id) === String(form.productId));
    const qty = Number(form.qty || 0);

    if (!product || qty <= 0) {
      alert("Select a product and quantity.");
      return;
    }

    const price = getProductPriceForMode(
      product,
      form.priceMode,
      selectedPricingCountry,
      pricingSettings
    );
    const line = {
      id: product.id,
      productId: product.id,
      productCode: product.productCode || product.product_code || "",
      product_code: product.productCode || product.product_code || "",
      code: product.code || product.productCode || product.product_code || "",
      sku: product.sku || product.SKU || product.product_sku || "",
      name: product.name || product.productName || product.product_name,
      brand: product.brand || "",
      series: product.series || "",
      flavour: product.flavour || "",
      cartonSize: product.cartonSize || product.carton_size || "",
      qty,
      pickedQty: qty,
      price,
      selectedPrice: price,
      unit_price: price,
      vatRate: product.vatRate || product.vat_type || product.vatType || 20,
      vatType: product.vatType || product.vat_type || 20,
      sourceStatus: "In Stock",
      includeInPicking: true,
    };

    setForm((current) => ({
      ...current,
      productId: "",
      qty: 1,
      lines: [...current.lines, line],
    }));
    clearProductPicker({ focus: true });
  };

  const updateFormLine = (index, updates) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...updates } : line
      ),
    }));
  };

  const removeFormLine = (index) => {
    setForm((current) => ({
      ...current,
      lines: current.lines.filter((_, lineIndex) => lineIndex !== index),
    }));
  };

  const openAmendForm = async (row) => {
    if (!isAdminUser) {
      alert("Only admin users can amend invoices.");
      return;
    }
    const order = await getOrderForInvoice(row);
    if (!order) return;

    setAmendOrder(order);
    setWorkbenchMode("amend");
    setForm({
      customerId: order.customer_account_id || order.customerAccountId || "",
      branchId: order.customer_branch_id || order.customerBranchId || "",
      priceMode: order.price_mode || order.priceMode || "VAT",
      productId: "",
      qty: 1,
      returnType: "Customer Rejected",
      reason: "",
      notes: order.invoice_notes || order.notes || "",
      lines: (order.items || []).map((item) => ({
        ...item,
        id: item.product_id || item.productId || item.id,
        productId: item.product_id || item.productId || item.id,
        productCode: getOrderItemProductCode(item),
        product_code: getOrderItemProductCode(item),
        name: item.product_name || item.productName || item.name,
        qty: Number(item.qty || item.quantity || 0),
        pickedQty: Number(item.picked_qty ?? item.pickedQty ?? item.qty ?? 0),
        price: Number(item.price || item.unit_price || 0),
        selectedPrice: Number(item.price || item.unit_price || 0),
        unit_price: Number(item.price || item.unit_price || 0),
        vatRate: item.vat_rate || item.vatRate || item.vat_type || item.vatType || 20,
        dbId: item.id || item.dbId,
        includeInPicking: item.include_in_picking !== false,
        sourceStatus: item.source_status || item.sourceStatus || "In Stock",
      })),
    });
  };

  const saveManualInvoice = async () => {
    if (!selectedCustomer) {
      alert("Select customer.");
      return;
    }
    if (selectedBranches.length > 0 && !selectedBranch) {
      alert("Select branch.");
      return;
    }
    if (!form.lines.length) {
      alert("Add at least one product.");
      return;
    }

    setSaving(true);
    try {
      const result = await createManualInvoice({
        companyName: selectedCustomer.account_name,
        customerAccountId: selectedCustomer.id,
        customerBranchId: selectedBranch?.id || null,
        branchName: selectedBranch?.branch_name || "",
        deliveryAddress:
          selectedBranch?.delivery_address || selectedCustomer.address || "",
        deliveryPostcode: selectedBranch?.postcode || selectedCustomer.postcode || "",
        priceMode: form.priceMode,
        cart: form.lines,
        notes: form.notes,
        confirmedBy: "Manual Invoice",
        currentUser: loggedInUser,
      });

      await loadInvoices();
      resetForm();
      if (result?.order) previewInvoice(result.order);
    } catch (err) {
      console.error("Manual invoice error:", err);
      alert(err.message || "Could not create manual invoice.");
    } finally {
      setSaving(false);
    }
  };

  const saveReturnInvoice = async () => {
    if (!selectedCustomer) {
      alert("Select customer.");
      return;
    }
    if (!form.lines.length) {
      alert("Add at least one returned product.");
      return;
    }

    setSaving(true);
    try {
      const returnRequest = await createReturnRequest({
        order: {
          orderId: `MANUAL-RETURN-${Date.now()}`,
          customerAccountId: selectedCustomer.id,
          customerBranchId: selectedBranch?.id || null,
          companyName: selectedCustomer.account_name,
          branchName: selectedBranch?.branch_name || "",
        },
        returnType: form.returnType,
        items: form.lines.map((line) => ({
          ...line,
          returnQty: line.qty,
          reason: form.reason || "Other",
        })),
        source: "INVOICE_WORKBENCH",
        notes: form.notes,
        currentUser: loggedInUser,
      });

      await confirmReturnCredit({ returnRequest, currentUser: loggedInUser });
      await loadInvoices();
      resetForm();
      alert("Return invoice / credit created.");
    } catch (err) {
      console.error("Return invoice error:", err);
      const missingReturnsTable = err.message?.includes("customer_returns");
      alert(
        missingReturnsTable && isAdminUser
          ? "Return invoice setup is required. Run supabase/migrations/20260704_financial_documents_setup.sql in Supabase, then retry."
          : missingReturnsTable
          ? "Return invoice setup is not available yet. Please contact an admin."
          : err.message || "Could not create return invoice."
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAmendment = async () => {
    if (!isAdminUser) {
      alert("Only admin users can amend invoices.");
      return;
    }
    if (!amendOrder) return;
    if (!form.lines.length) {
      alert("Invoice must contain at least one line.");
      return;
    }
    if (!form.notes.trim()) {
      alert("Amendment reason / notes are required.");
      return;
    }

    setSaving(true);
    try {
      const previousTotals = calculateCartTotals(amendOrder.items || [], {
        priceMode: amendOrder.price_mode || amendOrder.priceMode || form.priceMode,
      });
      const invoiceLines = filterActiveInvoiceLines(form.lines);
      const totals = calculateCartTotals(invoiceLines, { priceMode: form.priceMode });
      const calculatedItems = calculateCartOrderItems(invoiceLines, {
        priceMode: form.priceMode,
      });
      const activeDbIds = new Set(
        calculatedItems.map((line) => String(line.dbId || "")).filter(Boolean)
      );
      const previousItemsById = new Map(
        (amendOrder.items || []).map((item) => [
          String(item.product_id || item.productId || item.id),
          item,
        ])
      );
      const changedItems = calculatedItems.map((line) => {
        const previous = previousItemsById.get(String(line.id || line.productId));
        return {
          productId: line.id || line.productId,
          productName: line.name || line.productName || line.product_name,
          previousQty: Number(previous?.qty || previous?.quantity || 0),
          newQty: Number(line.qty || 0),
          previousPrice: Number(previous?.price || previous?.unit_price || 0),
          newPrice: Number(line.price || 0),
        };
      });
      const removedAuditItems = (amendOrder.items || [])
        .filter(
          (item) =>
            item.id &&
            !form.lines.some((line) => String(line.dbId || "") === String(item.id))
        )
        .map((item) => ({
          productId: item.product_id || item.productId,
          productName: item.product_name || item.productName || item.name,
          previousQty: Number(item.qty || item.quantity || 0),
          newQty: 0,
          previousPrice: Number(item.price || item.unit_price || 0),
          newPrice: 0,
          action: "Removed",
        }));

      const { error: orderUpdateError } = await supabase
        .from("orders")
        .update({
          subtotal: totals.netTotal.toFixed(2),
          net_total: totals.netTotal.toFixed(2),
          vat_total: totals.vatTotal.toFixed(2),
          order_total: totals.grandTotal.toFixed(2),
          notes: form.notes || null,
        })
        .eq("order_number", amendOrder.order_number || amendOrder.orderId);

      if (orderUpdateError) throw orderUpdateError;

      for (const line of calculatedItems) {
        if (line.dbId) {
          const { error: itemUpdateError } = await supabase
            .from("order_items")
            .update({
              qty: line.qty,
              picked_qty: line.qty,
              price: line.price.toFixed(2),
              line_total: line.line_total.toFixed(2),
              net_total: line.net_total.toFixed(2),
              gross_total: line.gross_total.toFixed(2),
              vat_total: line.vat_total.toFixed(2),
              vat_amount: line.vat_total.toFixed(2),
              vat_rate: line.vat_rate,
              vat_type: line.vat_type,
              source_status: line.sourceStatus || line.source_status || "In Stock",
              include_in_picking: true,
            })
            .eq("id", line.dbId);

          if (itemUpdateError) throw itemUpdateError;
        } else {
          const { data: orderRow, error: orderLookupError } = await supabase
            .from("orders")
            .select("id")
            .eq("order_number", amendOrder.order_number || amendOrder.orderId)
            .single();

          if (orderLookupError) throw orderLookupError;

          const { error: itemInsertError } = await supabase.from("order_items").insert({
            order_id: orderRow?.id || amendOrder.id,
            product_id: line.id || line.productId,
            product_code: getOrderItemProductCode(line),
            product_name: line.name,
            brand: line.brand || "",
            series: line.series || "",
            qty: line.qty,
            picked_qty: line.qty,
            price: line.price.toFixed(2),
            line_total: line.line_total.toFixed(2),
            net_total: line.net_total.toFixed(2),
            gross_total: line.gross_total.toFixed(2),
            vat_total: line.vat_total.toFixed(2),
            vat_amount: line.vat_total.toFixed(2),
            vat_rate: line.vat_rate,
            vat_type: line.vat_type,
            source_status: "In Stock",
            include_in_picking: true,
          });

          if (itemInsertError) throw itemInsertError;
        }
      }

      const removedLines = (amendOrder.items || []).filter(
        (item) => item.id && !activeDbIds.has(String(item.id))
      );

      for (const line of removedLines) {
        const { error: removedLineError } = await supabase
          .from("order_items")
          .update({
            qty: 0,
            picked_qty: 0,
            line_total: "0.00",
            net_total: "0.00",
            gross_total: "0.00",
            vat_total: "0.00",
            vat_amount: "0.00",
            source_status: "Removed",
            include_in_picking: false,
          })
          .eq("id", line.id);

        if (removedLineError) throw removedLineError;
      }

      const amendedOrder = {
        ...amendOrder,
        items: calculatedItems,
        order_items: calculatedItems,
        order_total: totals.grandTotal,
        net_total: totals.netTotal,
        vat_total: totals.vatTotal,
        subtotal: totals.netTotal,
        notes: form.notes,
      };
      const freshAmendedOrder =
        (await fetchInvoiceOrderFromDb(amendOrder.order_number || amendOrder.orderId)) ||
        amendedOrder;

      await amendInvoice({
        order: freshAmendedOrder,
        reason: form.notes.trim(),
        previousTotal: previousTotals.grandTotal,
        newTotal: totals.grandTotal,
        changedItems: [...changedItems, ...removedAuditItems],
        currentUser: loggedInUser,
      });
      await loadInvoices();
      resetForm();
      previewInvoice(freshAmendedOrder);
    } catch (err) {
      console.error("Amend invoice error:", err);
      alert(err.message || "Could not amend invoice.");
    } finally {
      setSaving(false);
    }
  };

  const updateCatalogPriceForLine = async (line) => {
    if (!isAdminUser) {
      alert("Only admin users can update product prices.");
      return;
    }

    const productId = line.productId || line.id;
    const price = Number(line.price || 0);
    if (!productId || price <= 0) {
      alert("Select a valid product line and price.");
      return;
    }

    const column = getProductPriceColumnForMode(form.priceMode);
    const ok = window.confirm(
      `Update the current product ${column.replaceAll("_", " ")} to ${formatCurrency(price)}?`
    );
    if (!ok) return;

    const { error: updateError } = await supabase
      .from("products")
      .update({ [column]: price })
      .eq("id", productId);

    if (updateError) {
      alert("Could not update product price: " + updateError.message);
      return;
    }

    setProducts((current) =>
      current.map((product) =>
        String(product.id) === String(productId) ? { ...product, [column]: price } : product
      )
    );
    alert("Current product price updated.");
  };

  const runInvoiceAction = async (row, action) => {
    try {
      const order = await getOrderForInvoice(row);
      if (!order) return;
      const resolvedOrder = await withResolvedInvoicePaymentStatus(order);
      action(resolvedOrder);
    } catch (err) {
      console.error("Invoice action error:", err);
      alert(err.message || "Could not open invoice.");
    }
  };

  const loadInvoices = async () => {
    setLoading(true);
    setError("");

    try {
      const [ledgerResult, ordersResult, processingQueueOrders] = await Promise.all([
        supabase
          .from("customer_ledger")
          .select("*")
          .eq("entry_type", "INVOICE")
          .order("created_at", { ascending: false }),
        supabase
          .from("orders")
          .select("*, order_items(*)")
          .order("created_at", { ascending: false })
          .limit(500),
        canViewServerManagerInvoices ? loadProcessingQueueOrders() : Promise.resolve([]),
      ]);

      let data = (ledgerResult.data || []).filter(canShowInvoiceRow);
      let ledgerError = ledgerResult.error;

      if (ordersResult.error) throw ordersResult.error;

      if (ledgerError) {
        const retry = await supabase
          .from("customer_ledger")
          .select("*")
          .ilike("entry_type", "%invoice%")
          .order("created_at", { ascending: false });
        data = (retry.data || []).filter(canShowInvoiceRow);
        ledgerError = retry.error;
      }

      if (ledgerError) throw ledgerError;

      const ledgerRows = data || [];
      const ledgerRowsByReference = new Map();
      ledgerRows.forEach((row) => {
        getReferenceCandidates(row).forEach((reference) => {
          if (!ledgerRowsByReference.has(reference)) {
            ledgerRowsByReference.set(reference, row);
          }
        });
      });

      const fullOrders = await hydrateOrdersWithFullOrderItems(ordersResult.data || []);
      const deliveredOrders = fullOrders
        .filter(isDeliveredInvoiceRow)
        .filter(canShowInvoiceRow);
      const operationalOrders = mergeOperationalOrders(
        deliveredOrders,
        processingQueueOrders
      );

      const rowsByReference = new Map();
      operationalOrders.forEach((order) => {
        const reference = order.order_number || order.orderId;
        if (!reference) return;

        const orderRow = {
          ...getOrderInvoiceListRow(order),
          _invoiceSource: order.isProcessingQueueOrder
            ? "processing_queue_operational_order"
            : "delivered_order",
        };
        const ledgerRow = getLedgerRowForOrder(ledgerRowsByReference, order);
        rowsByReference.set(reference, mergeLedgerMetadataIntoOrderRow(orderRow, ledgerRow));
      });

      ledgerRows.forEach((row) => {
        const references = getReferenceCandidates(row);
        const hasCanonicalOrder = references.some((reference) =>
          rowsByReference.has(reference)
        );

        if (!hasCanonicalOrder) {
          rowsByReference.set(getReference(row), row);
        }
      });

      const mergedRows = [...rowsByReference.values()].sort(
        (a, b) =>
          new Date(getCreatedDate(b) || 0).getTime() -
          new Date(getCreatedDate(a) || 0).getTime()
      );

      const invoiceRows = await Promise.all(
        mergedRows.map(async (row) => {
          try {
            const order = await fetchInvoiceOrderFromDb(row);
            if (!order) return row;

            const invoiceTotal = getInvoiceTotal(order);
            const refreshedRow = {
              ...row,
              _freshOrder: order,
              _invoiceSource: "canonical_order_refresh",
              debit: invoiceTotal,
              amount: invoiceTotal,
              invoice_amount: invoiceTotal,
              invoice_total: invoiceTotal,
            };

            return refreshedRow;
          } catch (err) {
            console.warn("Could not refresh invoice order for list row:", err);
            return row;
          }
        })
      );

      setInvoices(invoiceRows.filter(canShowInvoiceRow));
    } catch (err) {
      console.error("Invoice portal loading error:", err);
      setError(err.message || "Could not load invoices.");
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();

    const loadSetupData = async () => {
      setSetupLoading(true);
      setSetupError("");

      try {
        const [customerRows, productRows, pricingResult] = await Promise.all([
          getCustomerAccounts(),
          getProducts(),
          supabase.from("pricing_settings").select("*").eq("id", 1).maybeSingle(),
        ]);
        setCustomers(customerRows || []);
        setProducts(productRows || []);
        if (!pricingResult.error && pricingResult.data) {
          setPricingSettings(pricingResult.data);
        }
      } catch (err) {
        console.error("Invoice workbench setup loading error:", err);
        setSetupError(err.message || "Could not load customers/products for invoice workbench.");
      } finally {
        setSetupLoading(false);
      }
    };

    loadSetupData();
  }, []);

  useEffect(() => {
    const orderSearch = getOrderSearch(search);
    if (!orderSearch) {
      setExactSearchInvoices([]);
      return;
    }

    let cancelled = false;

    const loadExactSearchInvoice = async () => {
      const rowsByReference = new Map();
      const hiddenProtectedReferences = new Set();

      try {
        const order = await fetchInvoiceOrderFromDb(orderSearch.canonical);
        if (order && !canShowInvoiceRow({ _freshOrder: order })) {
          hiddenProtectedReferences.add(order.order_number);
          hiddenProtectedReferences.add(orderSearch.canonical);
          hiddenProtectedReferences.add(orderSearch.bareOrder);
        } else if (order) {
          const invoiceTotal = getInvoiceTotal(order);
          const invoiceStatus = getOrderPaymentStatus(order, invoiceTotal);
          rowsByReference.set(order.order_number, {
            id: `order-search-${order.order_number}`,
            reference_no: order.order_number,
            order_number: order.order_number,
            customer_name: order.company_name || order.companyName || "",
            branch_name:
              order.branch_name ||
              order.branchName ||
              order.delivery_branch_name ||
              "",
            created_at: order.created_at || order.invoice_date || order.delivered_at,
            invoice_status: invoiceStatus,
            status: invoiceStatus,
            debit: invoiceTotal,
            amount: invoiceTotal,
            invoice_amount: invoiceTotal,
            invoice_total: invoiceTotal,
            paid_amount: invoiceStatus === "PAID" ? invoiceTotal : Number(order.payment_amount || 0),
            remaining_amount:
              invoiceStatus === "PAID"
                ? 0
                : Math.max(0, invoiceTotal - Number(order.payment_amount || 0)),
            _freshOrder: order,
          });
        }
      } catch (err) {
        console.warn("Order exact invoice search failed:", err);
      }

      try {
        const { data: ledgerRows, error: ledgerSearchError } = await supabase
          .from("customer_ledger")
          .select("*")
          .or(
            `reference_no.eq.${orderSearch.canonical},order_number.eq.${orderSearch.canonical},reference_no.eq.${orderSearch.bareOrder},order_number.eq.${orderSearch.bareOrder}`
          )
          .order("created_at", { ascending: false });

        if (ledgerSearchError) throw ledgerSearchError;

        (ledgerRows || []).filter(canShowInvoiceRow).forEach((row) => {
          const reference = getReference(row);
          if (hiddenProtectedReferences.has(reference)) return;
          const freshRow = rowsByReference.get(reference) || {};
          rowsByReference.set(reference, {
            ...row,
            ...freshRow,
          });
        });
      } catch (err) {
        console.warn("Ledger exact invoice search failed:", err);
      }

      if (!cancelled) {
        setExactSearchInvoices([...rowsByReference.values()].filter(canShowInvoiceRow));
      }
    };

    loadExactSearchInvoice();

    return () => {
      cancelled = true;
    };
  }, [canViewServerManagerInvoices, search]);

  const filteredInvoices = useMemo(() => {
    const value = normalizeSearchText(search);
    const orderSearch = getOrderSearch(search);
    const rowsByReference = new Map();
    [...exactSearchInvoices, ...invoices].forEach((row) => {
      rowsByReference.set(getReference(row), row);
    });
    const searchableInvoices = [...rowsByReference.values()];

    return searchableInvoices.filter((row) => {
      if (!canShowInvoiceRow(row)) return false;
      const created = getCreatedDate(row);
      const invoiceTime = created ? new Date(created).getTime() : null;
      if (dateFrom && invoiceTime) {
        const fromTime = new Date(`${dateFrom}T00:00:00`).getTime();
        if (invoiceTime < fromTime) return false;
      }
      if (dateTo && invoiceTime) {
        const toTime = new Date(`${dateTo}T23:59:59`).getTime();
        if (invoiceTime > toTime) return false;
      }
      if (!value) return true;
      const fields = getInvoiceSearchFields(row);
      if (
        orderSearch &&
        fields.some((field) => orderFieldMatches(field, orderSearch))
      ) {
        return true;
      }

      return fields.join(" ").toLowerCase().includes(value);
    });
  }, [canViewServerManagerInvoices, dateFrom, dateTo, exactSearchInvoices, invoices, search]);

  useEffect(() => {
    setInvoicePage(1);
  }, [dateFrom, dateTo, search]);

  const invoiceTotalPages = Math.max(
    1,
    Math.ceil(filteredInvoices.length / invoicePageSize)
  );

  useEffect(() => {
    setInvoicePage((current) => Math.min(current, invoiceTotalPages));
  }, [invoiceTotalPages]);

  const pagedInvoices = useMemo(() => {
    const start = (invoicePage - 1) * invoicePageSize;
    return filteredInvoices.slice(start, start + invoicePageSize);
  }, [filteredInvoices, invoicePage, invoicePageSize]);

  const totalOutstanding = filteredInvoices.reduce(
    (sum, row) => sum + Math.max(0, Number(row.debit || getAmount(row)) - Number(row.credit || 0)),
    0
  );

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-900">Invoices</h2>
            <p className="text-sm text-slate-500">Central invoice list created from delivered orders.</p>
          </div>
          <button type="button" onClick={loadInvoices} className="bg-blue-700 text-white px-4 py-2 rounded-xl font-bold">
            Refresh
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              resetForm();
              setWorkbenchMode("manual");
            }}
            disabled={setupLoading || Boolean(setupError)}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold disabled:bg-slate-400"
          >
            {setupLoading ? "Loading..." : "Create Manual Invoice"}
          </button>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setWorkbenchMode("return");
            }}
            disabled={setupLoading || Boolean(setupError)}
            className="bg-purple-700 text-white px-4 py-2 rounded-xl text-sm font-bold disabled:bg-slate-400"
          >
            Create Return Invoice
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Invoices</div>
            <div className="text-2xl font-extrabold">{filteredInvoices.length}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Total</div>
            <div className="text-2xl font-extrabold">{formatCurrency(filteredInvoices.reduce((sum, row) => sum + getAmount(row), 0))}</div>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-500 uppercase">Outstanding</div>
            <div className="text-2xl font-extrabold">{formatCurrency(totalOutstanding)}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px_180px_auto] gap-2">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setInvoicePage(1);
            }}
            placeholder="Search invoice, order, customer, status"
            className="w-full border border-slate-300 rounded-xl p-3"
          />
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setInvoicePage(1);
            }}
            className="w-full border border-slate-300 rounded-xl p-3"
            aria-label="Invoice date from"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setInvoicePage(1);
            }}
            className="w-full border border-slate-300 rounded-xl p-3"
            aria-label="Invoice date to"
          />
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
              setInvoicePage(1);
            }}
            className="border border-slate-300 px-4 py-2 rounded-xl text-sm font-bold"
          >
            Clear
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4">{error}</div>}
      {setupError && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4">
          {setupError}
        </div>
      )}

      {workbenchMode && (
        <div className="w-full max-w-full overflow-hidden bg-white rounded-2xl shadow-sm border border-slate-200 p-4 md:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h3 className="min-w-0 text-xl font-extrabold">
              {workbenchMode === "manual"
                ? "Create Manual Invoice"
                : workbenchMode === "return"
                ? "Create Return Invoice"
                : "Amend Invoice"}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="bg-slate-100 text-slate-700 px-3 py-2 rounded-xl text-sm font-bold"
            >
              Close
            </button>
          </div>

          {setupLoading && (
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm font-bold text-blue-800">
              Loading customers and products...
            </div>
          )}

          {!setupLoading && !setupError && (!customers.length || !products.length) && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm font-bold text-amber-800">
              Customer or product setup data is missing. Add customers and products before creating invoices.
            </div>
          )}

          {workbenchMode !== "amend" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <select
                value={form.customerId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    customerId: event.target.value,
                    branchId: "",
                  }))
                }
                className="w-full min-w-0 border border-slate-300 rounded-xl p-3 bg-white"
              >
                <option value="">Select customer</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.account_name}
                  </option>
                ))}
              </select>

              <select
                value={form.branchId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, branchId: event.target.value }))
                }
                className="w-full min-w-0 border border-slate-300 rounded-xl p-3 bg-white"
                disabled={!selectedBranches.length}
              >
                <option value="">{selectedBranches.length ? "Select branch" : "No branch"}</option>
                {selectedBranches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.branch_name || branch.shop_name}
                  </option>
                ))}
              </select>

              {workbenchMode === "manual" ? (
                <select
                  value={form.priceMode}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, priceMode: event.target.value }))
                  }
                  className="w-full min-w-0 border border-slate-300 rounded-xl p-3 bg-white"
                >
                  <option value="VAT">VAT</option>
                  <option value="CASH">Cash</option>
                  <option value="SERVER">Server</option>
                  <option value="MANAGER">Manager</option>
                </select>
              ) : (
                <select
                  value={form.returnType}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, returnType: event.target.value }))
                  }
                  className="w-full min-w-0 border border-slate-300 rounded-xl p-3 bg-white"
                >
                  {RETURN_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {workbenchMode === "amend" && amendOrder && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm font-bold text-amber-800">
              Amending {amendOrder.orderId || amendOrder.order_number} for{" "}
              {amendOrder.companyName || amendOrder.company_name}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(90px,120px)_minmax(130px,auto)] gap-3">
            <div className="relative min-w-0">
              <input
                ref={productSearchInputRef}
                value={productSearch}
                onChange={(event) => {
                  setProductSearch(event.target.value);
                  setProductSearchOpen(true);
                  setForm((current) =>
                    current.productId ? { ...current, productId: "" } : current
                  );
                }}
                onFocus={() => setProductSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setProductSearchOpen(false), 120)}
                onKeyDown={handleProductSearchKeyDown}
                placeholder={
                  canAddWorkbenchProduct
                    ? "Search product by SKU, code, name, brand, flavour, barcode"
                    : "Select customer first"
                }
                className="w-full min-w-0 border border-slate-300 rounded-xl p-3 bg-white"
                disabled={!canAddWorkbenchProduct}
                role="combobox"
                aria-expanded={productSearchOpen}
                aria-controls="invoice-product-results"
                aria-autocomplete="list"
              />
              {selectedProduct && (
                <div className="mt-1 text-xs font-bold text-slate-500">
                  Selected: {getProductName(selectedProduct)} - SKU {getProductSku(selectedProduct) || "-"}
                </div>
              )}
              {productSearchOpen && canAddWorkbenchProduct && productSearch.trim() && (
                <div
                  id="invoice-product-results"
                  className="absolute z-30 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl"
                  role="listbox"
                >
                  {matchingProducts.length ? (
                    matchingProducts.map((product, index) => {
                      const productName = getProductName(product);
                      const sku = getProductSku(product);
                      const price = getProductPriceForMode(
                        product,
                        form.priceMode,
                        selectedPricingCountry,
                        pricingSettings
                      );
                      const highlighted = index === highlightedProductIndex;

                      return (
                        <button
                          key={product.id}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectProduct(product)}
                          onMouseEnter={() => setHighlightedProductIndex(index)}
                          className={`flex w-full min-w-0 items-center justify-between gap-3 px-3 py-2 text-left ${
                            highlighted ? "bg-blue-50" : "bg-white hover:bg-slate-50"
                          }`}
                          role="option"
                          aria-selected={highlighted}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-extrabold text-slate-900">
                              {highlightSearchText(productName)}
                            </span>
                            <span className="block truncate text-xs font-bold text-slate-500">
                              SKU {highlightSearchText(sku || "-")}
                            </span>
                          </span>
                          <span className="shrink-0 text-sm font-extrabold text-slate-900">
                            {formatCurrency(price)}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-3 py-3 text-sm font-bold text-slate-500">
                      No matching products found.
                    </div>
                  )}
                </div>
              )}
            </div>
            <input
              type="number"
              min="1"
              value={form.qty}
              onChange={(event) =>
                setForm((current) => ({ ...current, qty: event.target.value }))
              }
              className="w-full min-w-0 border border-slate-300 rounded-xl p-3"
              disabled={!canAddWorkbenchProduct}
            />
            <button
              type="button"
              onClick={addSelectedProductLine}
              disabled={setupLoading || Boolean(setupError) || !canAddWorkbenchProduct}
              className="w-full bg-blue-700 text-white px-4 py-2 rounded-xl font-bold disabled:bg-slate-400"
            >
              Add Product
            </button>
          </div>

          <div className="w-full max-w-full overflow-hidden border border-slate-200 rounded-xl">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="text-left p-2 md:p-3">Product</th>
                  <th className="w-20 text-right p-2 md:p-3">Qty</th>
                  <th className="w-24 text-right p-2 md:p-3">Price</th>
                  {workbenchMode === "amend" && (
                    <th className="w-28 text-right p-2 md:p-3">Catalog</th>
                  )}
                  <th className="w-24 text-right p-2 md:p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {form.lines.length === 0 ? (
                  <tr>
                    <td colSpan={workbenchMode === "amend" ? 5 : 4} className="p-4 text-center text-slate-500">
                      No products added.
                    </td>
                  </tr>
                ) : (
                  form.lines.map((line, index) => (
                    <tr key={`${line.productId || line.id}-${index}`} className="border-t">
                      <td className="min-w-0 break-words p-2 md:p-3 font-bold">{line.name || line.productName}</td>
                      <td className="p-2 md:p-3 text-right">
                        <input
                          type="number"
                          min="0"
                          value={line.qty}
                          onChange={(event) =>
                            updateFormLine(index, {
                              qty: Number(event.target.value || 0),
                              pickedQty: Number(event.target.value || 0),
                            })
                          }
                          className="w-full min-w-0 border rounded-lg p-2 text-right"
                        />
                      </td>
                      {workbenchMode === "amend" && (
                        <td className="p-2 md:p-3 text-right">
                          <button
                            type="button"
                            onClick={() => updateCatalogPriceForLine(line)}
                            className="w-full bg-indigo-600 text-white px-2 py-1 rounded-lg text-[11px] font-bold"
                          >
                            Update Price
                          </button>
                        </td>
                      )}
                      <td className="p-2 md:p-3 text-right">
                        <input
                          type="number"
                          step="0.01"
                          value={line.price}
                          onChange={(event) =>
                            updateFormLine(index, {
                              price: Number(event.target.value || 0),
                              selectedPrice: Number(event.target.value || 0),
                              unit_price: Number(event.target.value || 0),
                            })
                          }
                          className="w-full min-w-0 border rounded-lg p-2 text-right"
                        />
                      </td>
                      <td className="p-2 md:p-3 text-right">
                        <button
                          type="button"
                          onClick={() => removeFormLine(index)}
                          className="w-full bg-red-600 text-white px-2 py-1 rounded-lg text-xs font-bold"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="rounded-xl bg-slate-50 border p-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">Total Quantity</div>
              <div className="text-lg font-extrabold">{formTotalQuantity}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border p-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">Total Lines</div>
              <div className="text-lg font-extrabold">{form.lines.length}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border p-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">Total Net</div>
              <div className="text-lg font-extrabold">{formatCurrency(formTotals.netTotal || 0)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border p-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">VAT</div>
              <div className="text-lg font-extrabold">{formatCurrency(formTotals.vatTotal || 0)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 border p-3">
              <div className="text-[11px] font-bold uppercase text-slate-500">Grand Total</div>
              <div className="text-lg font-extrabold">{formatCurrency(formTotals.grandTotal || formTotals.totalAmount || 0)}</div>
            </div>
          </div>

          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            placeholder={
              workbenchMode === "amend"
                ? "Amendment reason / notes"
                : "Invoice notes"
            }
            className="w-full max-w-full border border-slate-300 rounded-xl p-3"
          />

          <button
            type="button"
            disabled={saving || setupLoading || Boolean(setupError)}
            onClick={
              workbenchMode === "manual"
                ? saveManualInvoice
                : workbenchMode === "return"
                ? saveReturnInvoice
                : saveAmendment
            }
            className="w-full sm:w-auto bg-green-700 text-white px-5 py-3 rounded-xl font-bold disabled:bg-slate-400"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-600">
              <tr>
                <th className="text-left p-3">Invoice / Order</th>
                <th className="text-left p-3">Customer</th>
                <th className="text-left p-3">Date</th>
                <th className="text-right p-3">Amount</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="6">Loading invoices...</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr><td className="p-5 text-center text-slate-500" colSpan="6">No invoices found yet. Confirm a delivery to create an invoice.</td></tr>
              ) : (
                pagedInvoices.map((row) => {
                  const amount = getAmount(row);

                  return (
                    <tr key={row.id || getReference(row)} className="border-t border-slate-100">
                      <td className="p-3 font-bold text-slate-900">{getReference(row)}</td>
                      <td className="p-3">{getCustomer(row)}</td>
                      <td className="p-3">{getCreatedDate(row) ? new Date(getCreatedDate(row)).toLocaleDateString() : "-"}</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(amount)}</td>
                      <td className="p-3"><span className="rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-bold">{row.invoice_status || row.status || "UNPAID"}</span></td>
                      <td className="p-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" onClick={() => runInvoiceAction(row, previewInvoice)} className="bg-slate-100 text-slate-800 px-3 py-1 rounded-lg text-xs font-bold">View</button>
                          <button type="button" onClick={() => runInvoiceAction(row, downloadInvoice)} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-xs font-bold">Download PDF</button>
                          <button type="button" onClick={() => runInvoiceAction(row, printInvoice)} className="bg-black text-white px-3 py-1 rounded-lg text-xs font-bold">Print</button>
                          {isAdminUser && (
                            <button type="button" onClick={() => openAmendForm(row)} className="bg-amber-600 text-white px-3 py-1 rounded-lg text-xs font-bold">Amend</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
            <span>Rows</span>
            <select
              value={invoicePageSize}
              onChange={(event) => {
                setInvoicePageSize(Number(event.target.value));
                setInvoicePage(1);
              }}
              className="border border-slate-300 rounded-lg px-2 py-1 bg-white"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
            </select>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-3">
            <button
              type="button"
              onClick={() => setInvoicePage((current) => Math.max(1, current - 1))}
              disabled={loading || invoicePage <= 1}
              className="border border-slate-300 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm font-bold text-slate-600">
              Page {invoicePage} of {invoiceTotalPages}
            </span>
            <button
              type="button"
              onClick={() =>
                setInvoicePage((current) => Math.min(invoiceTotalPages, current + 1))
              }
              disabled={loading || invoicePage >= invoiceTotalPages}
              className="border border-slate-300 px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
