import { useEffect, useMemo, useState } from "react";
import { getCustomerAccounts } from "../services/customerManagement";
import { getProducts, isActiveProduct } from "../services/products";
import {
  PROMOTION_RULE_KINDS,
  getActivePromotionRules,
  promotionRuleAppliesToAudience,
  promotionRuleAppliesToPriceMode,
} from "../services/promotionRules";
import { createCustomerOrder, updateOrderFields, updateOrderStatus } from "../services/orders";
import { supabase } from "../services/supabase";
import {
  downloadInvoice,
  fetchInvoiceOrderFromDb,
} from "../services/centralInvoiceEngine";
import {
  applyCustomerOrderPromotions,
  getActivePromotionPrice,
} from "./CustomerOrderModules/customerOrderPromotions";
import {
  buildCustomerOrderRequest,
  createCustomerOrderWithSessionRetry,
} from "./CustomerOrderModules/customerOrderSubmission";
import { calculateCartTotals } from "../utils/orderTotals";
import {
  CANONICAL_PAYMENT_SOURCES,
  createPaymentIntentId,
  postCanonicalCustomerPayment,
} from "../services/canonicalPaymentService";
import {
  CUSTOMER_MODES,
  PROMOTION_PAYMENT_METHODS,
  buildPromotionCartLine,
  buildPromotionRunNotes,
  canUsePromotionInvoice,
  getPromotionRunCustomer,
  makePromotionOrderNumber,
} from "../services/salesRepPromotionRun";

const text = (value) => String(value || "").trim();
const lower = (value) => text(value).toLowerCase();

const getBaseVatPrice = (product) =>
  Number(
    product?.vatPrice ??
      product?.vat_price ??
      product?.productSpecialPrice ??
      product?.product_special_price ??
      product?.cashPrice ??
      product?.cash_price ??
      0
  );

const getCustomerEmail = (customer) =>
  text(customer?.email || customer?.contact_email || customer?.invoice_email);

const getCountry = (customer, branch) =>
  text(branch?.country || customer?.country || "Wales");

const isAuthError = (error) => {
  const message = lower(error?.message || error?.details || error);
  return message.includes("jwt") || message.includes("auth") || message.includes("session");
};

const normalizeFlavourValues = (value) => {
  let values = value;
  if (typeof values === "string") {
    const raw = values.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      values = Array.isArray(parsed) ? parsed : raw.split(",");
    } catch {
      values = raw.split(",");
    }
  }

  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => {
      if (item && typeof item === "object") {
        return lower(item.flavour ?? item.flavor ?? item.name ?? item.value ?? item.label);
      }
      return lower(item);
    })
    .filter(Boolean))];
};

const getProductFlavour = (product) =>
  lower(product?.flavour ?? product?.flavor ?? product?.name ?? product?.product_name);

const productMatchesRuleSide = (rule, product, side = "trigger") => {
  if (!rule || !product) return false;
  const isFree = side === "free";
  const productId = isFree ? rule.free_product_id : rule.trigger_product_id;
  const brand = lower(isFree ? rule.free_brand : rule.trigger_brand);
  const series = lower(isFree ? rule.free_series : rule.trigger_series);
  const flavourMode = lower(isFree ? rule.free_flavour_mode : rule.trigger_flavour_mode) || "all";
  const flavours = normalizeFlavourValues(isFree ? rule.free_flavours : rule.trigger_flavours);

  if (productId && String(productId) !== String(product.id)) return false;
  if (brand && brand !== lower(product.brand)) return false;
  if (series && series !== lower(product.series)) return false;

  // FairChoice stores selected flavours as mode="include". Older UI copies used
  // "selected", so accept both while keeping the canonical rule behaviour.
  const productFlavour = getProductFlavour(product);
  const productName = lower(product?.name ?? product?.product_name);
  const matchesSelectedFlavour = flavours.some((flavour) =>
    productFlavour === flavour || (!product?.flavour && !product?.flavor && productName.includes(flavour))
  );

  if ((flavourMode === "include" || flavourMode === "selected") && flavours.length) {
    return matchesSelectedFlavour;
  }
  if (flavourMode === "exclude" && flavours.length) {
    return !matchesSelectedFlavour;
  }

  // mode=all means every product in the configured brand/series is eligible.
  return true;
};

const getRuleSideSummary = (rule, side = "trigger") => {
  if (!rule) return "";
  const isFree = side === "free";
  const mode = lower(isFree ? rule.free_flavour_mode : rule.trigger_flavour_mode) || "all";
  const flavours = normalizeFlavourValues(isFree ? rule.free_flavours : rule.trigger_flavours);
  const series = text(isFree ? rule.free_series : rule.trigger_series);
  if ((mode === "include" || mode === "selected") && flavours.length) {
    return `${flavours.length} selected flavour${flavours.length === 1 ? "" : "s"}`;
  }
  if (mode === "exclude" && flavours.length) {
    return `All ${series || "series"} except ${flavours.length} excluded flavour${flavours.length === 1 ? "" : "s"}`;
  }
  return `All ${series || "series"}`;
};

const getPromotionHeadline = (rule) => {
  if (!rule) return "Promotion";
  if (rule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE) {
    const buySeries = text(rule.trigger_series || rule.trigger_brand || "items");
    const freeSeries = text(rule.free_series || rule.free_brand || buySeries || "items");
    return `Buy ${Number(rule.buy_qty || 0)} ${buySeries} · Get ${Number(rule.free_qty || 0)} ${freeSeries} FREE`;
  }
  if (Number(rule.offer_price || 0) > 0) {
    return `Promotion price £${Number(rule.offer_price).toFixed(2)}`;
  }
  return text(rule.promotion_name || "Promotion");
};

const ProductPicture = ({ product }) => {
  const image = product?.image || product?.image_url;
  return image ? (
    <img
      src={image}
      alt={product?.name || product?.product_name || "Product"}
      className="h-32 w-full object-contain"
      loading="lazy"
    />
  ) : (
    <div className="flex h-32 w-full items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-400">
      No image
    </div>
  );
};

const getPromotionProductPrice = (product, rule) =>
  Number(
    getActivePromotionPrice({
      product,
      promotionRules: rule ? [rule] : [],
      priceMode: "vat",
      audienceType: "sales_rep",
    }) ?? getBaseVatPrice(product)
  );

const readBankProofDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) return resolve("");
    if (!String(file.type || "").startsWith("image/")) {
      return reject(new Error("Bank payment proof must be an image / screenshot."));
    }
    if (Number(file.size || 0) > 2.5 * 1024 * 1024) {
      return reject(new Error("Bank payment screenshot is too large. Please use an image under 2.5 MB."));
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the bank payment screenshot."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });

export default function SalesRepPromotionRun({ userProfile, onLogout, onBackToOrder }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [products, setProducts] = useState([]);
  const [rules, setRules] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [customerMode, setCustomerMode] = useState(CUSTOMER_MODES.REGISTERED);
  const [guestCustomerName, setGuestCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [buyQuantities, setBuyQuantities] = useState({});
  const [freeQuantities, setFreeQuantities] = useState({});
  const [selectionSide, setSelectionSide] = useState("trigger");
  const [paymentMethod, setPaymentMethod] = useState("Cash");
  const [cardAuthCode, setCardAuthCode] = useState("");
  const [competitorSales, setCompetitorSales] = useState("");
  const [invoiceRequested, setInvoiceRequested] = useState(false);
  const [invoiceEmail, setInvoiceEmail] = useState("");
  const [completedOrderNumber, setCompletedOrderNumber] = useState("");
  const [completedInvoiceOrder, setCompletedInvoiceOrder] = useState(null);
  const [invoiceLoadError, setInvoiceLoadError] = useState("");
  const [paymentConfirmOpen, setPaymentConfirmOpen] = useState(false);
  const [bankProofFile, setBankProofFile] = useState(null);
  const [paymentIntentId, setPaymentIntentId] = useState(() => createPaymentIntentId());
  const [completedPaymentStatus, setCompletedPaymentStatus] = useState("");
  const [completedPaymentMessage, setCompletedPaymentMessage] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [productRows, promotionRows, customerRows] = await Promise.all([
          getProducts(),
          getActivePromotionRules(),
          getCustomerAccounts({ operationalOnly: true }),
        ]);
        if (!active) return;
        setProducts((productRows || []).filter(isActiveProduct));
        setRules(promotionRows || []);
        setCustomers(customerRows || []);
      } catch (loadError) {
        if (active) setError(loadError?.message || "Could not load Promotion Run.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const availableRules = useMemo(
    () =>
      rules.filter(
        (rule) =>
          promotionRuleAppliesToPriceMode(rule, "vat") &&
          promotionRuleAppliesToAudience(rule, "sales_rep")
      ),
    [rules]
  );

  const selectedRule = useMemo(
    () => availableRules.find((rule) => String(rule.id) === String(selectedRuleId)) || null,
    [availableRules, selectedRuleId]
  );

  const triggerProducts = useMemo(() => {
    if (!selectedRule) return [];
    return products.filter((product) => productMatchesRuleSide(selectedRule, product, "trigger"));
  }, [products, selectedRule]);

  const freeProducts = useMemo(() => {
    if (!selectedRule || selectedRule.rule_kind !== PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE) return [];
    return products.filter((product) => productMatchesRuleSide(selectedRule, product, "free"));
  }, [products, selectedRule]);

  const isFreeSelection = selectionSide === "free";
  const selectionProducts = isFreeSelection ? freeProducts : triggerProducts;
  const selectionSummary = getRuleSideSummary(selectedRule, isFreeSelection ? "free" : "trigger");


  useEffect(() => {
    setBuyQuantities({});
    setFreeQuantities({});
    setSelectionSide("trigger");
  }, [selectedRuleId]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => String(customer.id) === String(customerId)) || null,
    [customers, customerId]
  );
  const branches = selectedCustomer?.customer_branches?.filter((branch) => branch.active !== false) || [];
  const selectedBranch = branches.find((branch) => String(branch.id) === String(branchId)) || null;

  useEffect(() => {
    if (customerMode !== CUSTOMER_MODES.REGISTERED) {
      setCustomerId("");
      setBranchId("");
      setInvoiceRequested(false);
      setInvoiceEmail("");
      return;
    }
    setInvoiceEmail(getCustomerEmail(selectedCustomer));
  }, [customerMode, selectedCustomer?.id]);

  const country = getCountry(selectedCustomer, selectedBranch);
  const buySelectedQty = Object.values(buyQuantities).reduce((sum, value) => sum + Number(value || 0), 0);
  const freeSelectedQty = Object.values(freeQuantities).reduce((sum, value) => sum + Number(value || 0), 0);

  const buyQty = Number(selectedRule?.buy_qty || 0);
  const freeQtyPerRun = Number(selectedRule?.free_qty || 0);
  const freeQtyEarned =
    selectedRule?.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && buyQty > 0
      ? Math.floor(buySelectedQty / buyQty) * freeQtyPerRun
      : 0;

  useEffect(() => {
    if (freeSelectedQty <= freeQtyEarned) return;
    // If BUY quantities are reduced, trim FREE selections so the basket can
    // never contain more free units than the promotion currently earns.
    let remaining = freeQtyEarned;
    const next = {};
    freeProducts.forEach((product) => {
      const current = Number(freeQuantities[String(product.id)] || 0);
      if (!current || remaining <= 0) return;
      const keep = Math.min(current, remaining);
      if (keep > 0) next[String(product.id)] = keep;
      remaining -= keep;
    });
    setFreeQuantities(next);
  }, [freeQtyEarned]);

  const changeBuyQuantity = (productId, delta) => {
    const key = String(productId);
    setBuyQuantities((current) => {
      const nextQty = Math.max(0, Number(current[key] || 0) + delta);
      const next = { ...current };
      if (nextQty > 0) next[key] = nextQty;
      else delete next[key];
      return next;
    });
  };

  const changeFreeQuantity = (productId, delta) => {
    const key = String(productId);
    setFreeQuantities((current) => {
      const currentTotal = Object.values(current).reduce((sum, value) => sum + Number(value || 0), 0);
      if (delta > 0 && currentTotal >= freeQtyEarned) return current;
      const nextQty = Math.max(0, Number(current[key] || 0) + delta);
      const next = { ...current };
      if (nextQty > 0) next[key] = nextQty;
      else delete next[key];
      return next;
    });
  };

  const baseLines = useMemo(() => {
    if (!selectedRule) return [];
    // Keep every physical flavour as its own order line. The canonical
    // promotion engine totals all eligible BUY lines and discounts the
    // selected FREE lines, so mixed flavours and repeated flavours both work.
    const lines = triggerProducts
      .map((product) => {
        const lineQty = Number(buyQuantities[String(product.id)] || 0);
        if (lineQty <= 0) return null;
        return buildPromotionCartLine({
          product,
          quantity: lineQty,
          unitPrice: getBaseVatPrice(product),
        });
      })
      .filter(Boolean);

    freeProducts.forEach((product) => {
      const lineQty = Number(freeQuantities[String(product.id)] || 0);
      if (lineQty <= 0) return;
      lines.push(
        buildPromotionCartLine({
          product,
          quantity: lineQty,
          unitPrice: getBaseVatPrice(product),
        })
      );
    });

    return lines;
  }, [selectedRule, triggerProducts, freeProducts, buyQuantities, freeQuantities]);

  const cart = selectedRule
    ? applyCustomerOrderPromotions({
        cartLines: baseLines,
        promotionRules: [selectedRule],
        products,
        priceMode: "vat",
        audienceType: "sales_rep",
      })
    : [];
  const totals = calculateCartTotals(cart, { priceMode: "vat", discountPercent: 0 });
  const beforePromotionTotals = calculateCartTotals(baseLines, { priceMode: "vat", discountPercent: 0 });
  const promotionSaving = Math.max(
    0,
    Number(beforePromotionTotals?.grandTotal || 0) - Number(totals?.grandTotal || 0)
  );

  const invoiceAllowed = customerMode === CUSTOMER_MODES.REGISTERED ? canUsePromotionInvoice(customerMode, selectedCustomer) : Boolean(text(guestCustomerName));
  const isAdminSales = ["admin", "super admin"].includes(lower(userProfile?.role || userProfile?.access_level));

  const resetForNextSale = () => {
    setSelectedRuleId("");
    setBuyQuantities({});
    setFreeQuantities({});
    setPaymentMethod("Cash");
    setCardAuthCode("");
    setCompetitorSales("");
    setGuestCustomerName("");
    setInvoiceRequested(false);
    setCompletedOrderNumber("");
    setCompletedInvoiceOrder(null);
    setInvoiceLoadError("");
    setPaymentConfirmOpen(false);
    setBankProofFile(null);
    setPaymentIntentId(createPaymentIntentId());
    setCompletedPaymentStatus("");
    setCompletedPaymentMessage("");
    if (customerMode === CUSTOMER_MODES.GUEST) setInvoiceEmail("");
  };

  const submit = async () => {
    if (saving) return;
    setError("");

    if (!selectedRule) return setError("Select which promotion you are running.");
    if (buySelectedQty <= 0) return setError("Add the promotion BUY products / flavours.");
    if (selectedRule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && buyQty > 0 && buySelectedQty < buyQty) {
      return setError(`This promotion needs at least ${buyQty} BUY items. You have added ${buySelectedQty}.`);
    }
    if (freeQtyEarned > 0 && freeProducts.length > 0 && freeSelectedQty !== freeQtyEarned) {
      return setError(`Select exactly ${freeQtyEarned} FREE item${freeQtyEarned === 1 ? "" : "s"}. You have selected ${freeSelectedQty}.`);
    }
    if (!paymentMethod) return setError("Select a payment method.");
    if (paymentMethod === "Card" && !text(cardAuthCode)) {
      return setError("Card payment requires the card authorisation code / auth code.");
    }
    if (paymentMethod === "Bank Transfer" && customerMode === CUSTOMER_MODES.GUEST) {
      return setError("Bank Transfer requires a registered customer so nisstaj_admin can approve the payment proof.");
    }
    if (paymentMethod === "Bank Transfer" && !bankProofFile) {
      return setError("Bank Transfer requires a payment screenshot before the sale can be completed.");
    }
    if (customerMode === CUSTOMER_MODES.GUEST && !text(guestCustomerName)) {
      return setError("Enter the Guest Customer / Shop name for the invoice and sale record.");
    }
    if (customerMode === CUSTOMER_MODES.REGISTERED && !selectedCustomer) {
      return setError("Select a registered customer, or choose Guest Customer.");
    }
    if (customerMode === CUSTOMER_MODES.REGISTERED && branches.length > 0 && !selectedBranch) {
      return setError("Select the customer branch / shop.");
    }
    if (invoiceRequested && !invoiceAllowed) {
      return setError("Invoice requires a registered customer. Select a registered customer first.");
    }
    if (invoiceRequested && !text(invoiceEmail)) {
      return setError("Enter the email address for the invoice.");
    }

    const customer = getPromotionRunCustomer({ customerMode, customer: selectedCustomer });
    if (customerMode === CUSTOMER_MODES.GUEST) customer.account_name = text(guestCustomerName);
    const orderNumber = makePromotionOrderNumber();
    const notes = buildPromotionRunNotes({
      paymentMethod,
      competitorSales,
      customerMode,
      invoiceRequested,
      invoiceEmail,
      promotionName: selectedRule.promotion_name || getPromotionHeadline(selectedRule),
    });
    const paymentAuditNote = paymentMethod === "Card"
      ? ` Card auth code: ${text(cardAuthCode)}.`
      : "";

    const request = buildCustomerOrderRequest({
      orderNumber,
      customer,
      branch: customerMode === CUSTOMER_MODES.REGISTERED ? selectedBranch : null,
      priceMode: "vat",
      cart,
      finalTotal: Number(totals?.grandTotal || 0),
      effectiveOrderDiscountPercent: 0,
      discountAmount: 0,
      canManualCheckoutDiscount: false,
      userProfile,
      orderCountry: country,
      creditLimit: customerMode === CUSTOMER_MODES.REGISTERED ? Number(selectedCustomer?.credit_limit || 0) : 0,
    });
    request.notes = `${notes}${paymentAuditNote}`;
    request.companyName = customerMode === CUSTOMER_MODES.GUEST ? text(guestCustomerName) : selectedCustomer.account_name;
    request.customer_account_id = customerMode === CUSTOMER_MODES.GUEST ? null : selectedCustomer.id;
    request.customer_branch_id = customerMode === CUSTOMER_MODES.GUEST ? null : selectedBranch?.id || null;

    let bankProofDataUrl = "";
    if (paymentMethod === "Bank Transfer") {
      try {
        bankProofDataUrl = await readBankProofDataUrl(bankProofFile);
      } catch (proofError) {
        setError(proofError?.message || "Could not read bank payment screenshot.");
        return;
      }
    }

    setPaymentConfirmOpen(false);
    setSaving(true);
    try {
      const created = await createCustomerOrderWithSessionRetry({
        orderRequest: request,
        createOrder: createCustomerOrder,
        isAuthError,
        refreshSession: () => supabase.auth.refreshSession(),
        promotionRunContext: {
          cart,
          customer: customerMode === CUSTOMER_MODES.GUEST ? null : selectedCustomer,
          branch: customerMode === CUSTOMER_MODES.GUEST ? null : selectedBranch,
          actor: userProfile,
          audienceType: "sales_rep",
          country,
          profile: userProfile,
        },
      });

      const savedOrderNumber = created?.orderNumber || orderNumber;
      let invoicePaymentStatus = "UNPAID";

      // Checkout payments are part of the sale itself. They use ORDER_PAYMENT so
      // order-taking access is sufficient; the separate Cash Collection page keeps
      // its own payments.collect_cash permission.
      if (customerMode === CUSTOMER_MODES.REGISTERED && selectedCustomer) {
        try {
          const paymentResult = await postCanonicalCustomerPayment({
            customerAccountId: selectedCustomer.id,
            customerBranchId: selectedBranch?.id || null,
            amount: Number(totals?.grandTotal || 0),
            paymentDate: new Date().toISOString(),
            paymentMethod,
            paymentSource: CANONICAL_PAYMENT_SOURCES.ORDER_PAYMENT,
            paymentReference: savedOrderNumber,
            paidBy: selectedCustomer.account_name || selectedCustomer.company_name || "Customer",
            collectorName:
              userProfile?.staff_name ||
              userProfile?.name ||
              userProfile?.username ||
              "",
            collectorStaffId: userProfile?.staff_id || userProfile?.id || null,
            collectorRole: userProfile?.role || userProfile?.access_level || "Sales Rep",
            paymentIntentId,
            notes: `Promotion Run payment for ${savedOrderNumber}${paymentMethod === "Card" ? ` · Card auth ${text(cardAuthCode)}` : ""}`,
            metadata: {
              payment_applies_to: "PROMOTION_RUN",
              order_number: savedOrderNumber,
              promotion_name: selectedRule.promotion_name || getPromotionHeadline(selectedRule),
              bank_proof_data_url: bankProofDataUrl || null,
              bank_proof_name: bankProofFile?.name || null,
              bank_proof_mime_type: bankProofFile?.type || null,
              card_auth_code: paymentMethod === "Card" ? text(cardAuthCode) : null,
            },
            allocations: [],
          });
          const pending =
            paymentResult?.verification_status === "PENDING_VERIFICATION" ||
            paymentResult?.payment?.verification_status === "PENDING_VERIFICATION";
          invoicePaymentStatus = pending ? "UNPAID" : "PAID";
          setCompletedPaymentStatus(pending ? "PENDING_APPROVAL" : "PAID");
          setCompletedPaymentMessage(
            pending
              ? "Bank transfer recorded. Awaiting nisstaj_admin approval; the invoice remains unpaid until approval."
              : "Customer payment recorded through the canonical Sales Rep collection path."
          );
        } catch (paymentError) {
          await updateOrderStatus(savedOrderNumber, "Cancelled").catch((cancelError) =>
            console.error("Promotion payment rollback failed:", cancelError)
          );
          setPaymentIntentId(createPaymentIntentId());
          setError(`Payment was not accepted, so the promotion sale was not completed: ${paymentError?.message || "Unknown payment error"}`);
          return;
        }
      } else {
        setCompletedPaymentStatus("GUEST_PAID");
        setCompletedPaymentMessage(`Guest promotion sale recorded as PAID for ${text(guestCustomerName)}.`);
        invoicePaymentStatus = "PAID";
      }

      // Promotion Run is an in-person fulfilled sale. Once payment is accepted, mark the
      // normal order as Delivered so Central Invoices and Brand Performance consume it.
      // Bank Transfer remains Received until its pending payment is approved.
      if (invoicePaymentStatus === "PAID") {
        await updateOrderFields(savedOrderNumber, {
          payment_collected: "yes",
          payment_amount: Number(totals?.grandTotal || 0),
          payment_type: paymentMethod,
          payment_status: "PAID",
        }).catch((paymentSnapshotError) =>
          console.warn("Could not save paid order snapshot:", paymentSnapshotError)
        );
        await updateOrderStatus(savedOrderNumber, "Delivered");
      }

      setCompletedOrderNumber(savedOrderNumber);

      // Every registered-customer promotion sale has an invoice available after
      // completion. For immediate payments, fetch it after payment posting so the
      // PDF can reflect the latest canonical paid/allocation state.
      if ((customerMode === CUSTOMER_MODES.REGISTERED && selectedCustomer) || customerMode === CUSTOMER_MODES.GUEST) {
        setInvoiceLoadError("");
        try {
          const invoiceOrder = await fetchInvoiceOrderFromDb({ order_number: savedOrderNumber });
          const invoiceForDocument = invoiceOrder
            ? {
                ...invoiceOrder,
                _documentPaymentStatus: invoicePaymentStatus,
                invoicePaymentStatus: invoicePaymentStatus,
              }
            : invoiceOrder;
          setCompletedInvoiceOrder(invoiceForDocument);
        } catch (invoiceError) {
          setCompletedInvoiceOrder(null);
          setInvoiceLoadError(invoiceError?.message || "Invoice is not ready yet. Try again below.");
        }
      } else {
        setCompletedInvoiceOrder(null);
        setInvoiceLoadError("");
      }
    } catch (submitError) {
      setError(submitError?.message || "Promotion sale could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const loadCompletedInvoice = async () => {
    if (!completedOrderNumber) return null;
    setInvoiceLoadError("");
    try {
      const invoiceOrder = await fetchInvoiceOrderFromDb({ order_number: completedOrderNumber });
      const documentStatus = completedPaymentStatus === "PAID" ? "PAID" : "UNPAID";
      const invoiceForDocument = invoiceOrder
        ? {
            ...invoiceOrder,
            _documentPaymentStatus: documentStatus,
            invoicePaymentStatus: documentStatus,
          }
        : invoiceOrder;
      setCompletedInvoiceOrder(invoiceForDocument);
      return invoiceForDocument;
    } catch (invoiceError) {
      setInvoiceLoadError(invoiceError?.message || "Invoice is not ready yet. Try again.");
      return null;
    }
  };

  const downloadCompletedInvoice = async () => {
    try {
      const invoiceOrder = completedInvoiceOrder || await loadCompletedInvoice();
      if (!invoiceOrder) return;
      await downloadInvoice(invoiceOrder);
    } catch (invoiceError) {
      setError(invoiceError?.message || "Could not open invoice.");
    }
  };

  const prepareInvoiceEmail = () => {
    if (!completedOrderNumber || !text(invoiceEmail)) return;
    const subject = encodeURIComponent(`FairChoice invoice ${completedOrderNumber}`);
    const body = encodeURIComponent(
      `Please find your FairChoice invoice ${completedOrderNumber}.\n\nDownload the invoice from FairChoice and attach it to this email before sending.`
    );
    window.location.href = `mailto:${encodeURIComponent(text(invoiceEmail))}?subject=${subject}&body=${body}`;
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-100 p-6"><div className="mx-auto max-w-3xl rounded-3xl bg-white p-6 shadow">Loading Promotion Run...</div></div>;
  }

  return (
    <div className="min-h-screen bg-slate-100 p-3 sm:p-5">
      <div className="mx-auto max-w-6xl overflow-hidden rounded-3xl bg-white shadow-xl">
        <header className="bg-blue-950 px-5 py-4 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-blue-200">{isAdminSales ? "Admin Sales" : "Sales Rep"} · Ask Log</p>
              <h1 className="text-2xl font-black">Promotion Run</h1>
              {selectedRule ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-blue-100">
                  <span className="font-bold text-white">{text(selectedRule.promotion_name || getPromotionHeadline(selectedRule))}</span>
                  <button
                    type="button"
                    onClick={() => setSelectionSide("trigger")}
                    className={`rounded-lg border px-2 py-0.5 font-black ${
                      selectionSide === "trigger" ? "border-white bg-white text-blue-950" : "border-white/25 text-white"
                    }`}
                  >
                    Buy {Number(selectedRule.buy_qty || 0)}
                  </button>
                  {selectedRule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && Number(selectedRule.free_qty || 0) > 0 && (
                    <>
                      <span className="text-blue-300">|</span>
                      <button
                        type="button"
                        onClick={() => setSelectionSide("free")}
                        className={`rounded-lg border px-2 py-0.5 font-black ${
                          selectionSide === "free" ? "border-white bg-white text-emerald-800" : "border-white/25 text-white"
                        }`}
                      >
                        Free {Number(selectedRule.free_qty || 0)}
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-blue-100">Select a promotion below.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onBackToOrder} className="rounded-xl border border-white/30 px-3 py-2 text-sm font-bold">Normal Sale</button>
              <button type="button" onClick={onLogout} className="rounded-xl border border-white/30 px-3 py-2 text-sm font-bold">Logout</button>
            </div>
          </div>
        </header>

        <main className="space-y-5 p-4 sm:p-6">
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 font-bold text-red-800">{error}</div>}

          {completedOrderNumber ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
              <h2 className="text-xl font-black text-emerald-900">Promotion sale recorded</h2>
              <p className="mt-1 text-sm text-emerald-800">Order {completedOrderNumber} was created through the normal FairChoice order path.</p>
              <div className="mt-3 grid gap-2 rounded-2xl bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div><span className="block text-xs font-bold uppercase text-slate-500">Sale record</span><strong>{completedOrderNumber}</strong></div>
                <div><span className="block text-xs font-bold uppercase text-slate-500">Customer</span><strong>{customerMode === CUSTOMER_MODES.GUEST ? (text(guestCustomerName) || "Guest Customer") : (selectedCustomer?.account_name || "Registered customer")}</strong></div>
                <div><span className="block text-xs font-bold uppercase text-slate-500">Payment</span><strong>{paymentMethod}</strong></div>
                <div><span className="block text-xs font-bold uppercase text-slate-500">Amount</span><strong>£{Number(totals?.grandTotal || 0).toFixed(2)}</strong></div>
                {paymentMethod === "Card" && text(cardAuthCode) && (
                  <div><span className="block text-xs font-bold uppercase text-slate-500">Card auth code</span><strong>{text(cardAuthCode)}</strong></div>
                )}
              </div>
              {completedPaymentStatus && (
                <div className={`mt-3 rounded-xl p-3 text-sm font-bold ${
                  completedPaymentStatus === "PAID"
                    ? "bg-emerald-100 text-emerald-900"
                    : completedPaymentStatus === "PENDING_APPROVAL"
                    ? "bg-amber-100 text-amber-900"
                    : completedPaymentStatus === "PAYMENT_ERROR"
                    ? "bg-red-100 text-red-900"
                    : "bg-slate-100 text-slate-700"
                }`}>
                  {completedPaymentStatus === "PAID" && "PAID · "}
                  {completedPaymentStatus === "PENDING_APPROVAL" && "BANK PAYMENT PENDING APPROVAL · "}
                  {completedPaymentStatus === "UNPAID" && "UNPAID · "}
                  {completedPaymentMessage}
                </div>
              )}
              {(customerMode === CUSTOMER_MODES.REGISTERED || customerMode === CUSTOMER_MODES.GUEST) && (
                <div className="mt-4 rounded-2xl border border-blue-200 bg-white p-4">
                  <div className="font-black text-blue-950">{completedPaymentStatus === "PAID" ? "PAID Invoice" : "Invoice"}</div>
                  <p className="mt-1 text-sm text-slate-600">
                    {completedPaymentStatus === "PENDING_APPROVAL"
                      ? "Bank transfer is awaiting nisstaj_admin approval. This invoice must not be treated as paid until approval."
                      : completedPaymentStatus === "PAID"
                      ? "Payment is recorded. Download the latest PDF or share it by email."
                      : "Registered customer: download the PDF or share it by email."}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                    <input
                      type="email"
                      value={invoiceEmail}
                      onChange={(e) => setInvoiceEmail(e.target.value)}
                      placeholder="Customer email"
                      className="rounded-xl border p-3"
                    />
                    <button type="button" onClick={downloadCompletedInvoice} className="rounded-xl bg-blue-700 px-4 py-2 font-bold text-white">Download PDF</button>
                    <button type="button" onClick={prepareInvoiceEmail} disabled={!text(invoiceEmail)} className="rounded-xl border border-blue-700 bg-white px-4 py-2 font-bold text-blue-800 disabled:opacity-40">Email Invoice</button>
                  </div>
                  {invoiceLoadError && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-amber-800">
                      <span>{invoiceLoadError}</span>
                      <button type="button" onClick={loadCompletedInvoice} className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-1">Retry invoice</button>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-slate-600">For WhatsApp: download the PDF, then attach it in WhatsApp.</p>
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={resetForNextSale} className="rounded-xl border border-emerald-700 bg-white px-4 py-2 font-bold text-emerald-800">Next Promotion Sale</button>
                <button type="button" onClick={onBackToOrder} className="rounded-xl border border-slate-500 bg-white px-4 py-2 font-bold text-slate-700">Normal Sale / Delivery Order</button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-3xl border p-4">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-emerald-700">Step 1</p>
                    <h2 className="text-xl font-black">What promotion are you running?</h2>
                    <p className="text-sm text-slate-500">Only active promotions that apply to Sales are shown.</p>
                  </div>
                  <button type="button" onClick={onBackToOrder} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-900">Customer wants other products? Normal Sale →</button>
                </div>

                {!availableRules.length ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-4 font-bold text-amber-900">No active Sales promotions are available.</div>
                ) : (
                  <label className="mt-4 block font-bold">
                    Select promotion
                    <select
                      value={selectedRuleId}
                      onChange={(e) => setSelectedRuleId(e.target.value)}
                      className="mt-1 w-full rounded-xl border p-3"
                    >
                      <option value="">Choose promotion</option>
                      {availableRules.map((rule) => (
                        <option key={rule.id} value={rule.id}>
                          {text(rule.promotion_name || getPromotionHeadline(rule))} — {getPromotionHeadline(rule)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </section>

              {selectedRule && (
                <section className="space-y-4 rounded-3xl border p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-bold">Customer</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setCustomerMode(CUSTOMER_MODES.REGISTERED)} className={`rounded-xl border p-3 font-bold ${customerMode === CUSTOMER_MODES.REGISTERED ? "border-blue-700 bg-blue-50 text-blue-900" : ""}`}>Registered</button>
                        <button type="button" onClick={() => setCustomerMode(CUSTOMER_MODES.GUEST)} className={`rounded-xl border p-3 font-bold ${customerMode === CUSTOMER_MODES.GUEST ? "border-blue-700 bg-blue-50 text-blue-900" : ""}`}>Guest Customer</button>
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-bold">Payment Method</label>
                      <select value={paymentMethod} onChange={(e) => { setPaymentMethod(e.target.value); setCardAuthCode(""); }} className="w-full rounded-xl border p-3">
                        {PROMOTION_PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}
                      </select>
                      {paymentMethod === "Card" && (
                        <input
                          type="text"
                          value={cardAuthCode}
                          onChange={(e) => setCardAuthCode(e.target.value)}
                          placeholder="Card authorisation code / Auth Code #"
                          className="mt-2 w-full rounded-xl border border-blue-300 p-3 font-bold"
                        />
                      )}
                    </div>

                    {customerMode === CUSTOMER_MODES.GUEST && (
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-sm font-bold">Customer / Shop Name</label>
                        <input type="text" value={guestCustomerName} onChange={(e) => setGuestCustomerName(e.target.value)} placeholder="Enter customer or shop name" className="w-full rounded-xl border p-3" />
                        <p className="mt-1 text-xs text-slate-500">Saved on the sale and shown in the normal Invoice tab.</p>
                      </div>
                    )}

                    {customerMode === CUSTOMER_MODES.REGISTERED && (
                      <>
                        <div>
                          <label className="mb-1 block text-sm font-bold">Registered Customer</label>
                          <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setBranchId(""); }} className="w-full rounded-xl border p-3">
                            <option value="">Select customer</option>
                            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.account_name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-bold">Branch / Shop</label>
                          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={!branches.length} className="w-full rounded-xl border p-3 disabled:bg-slate-100">
                            <option value="">{branches.length ? "Select branch" : "Main account"}</option>
                            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}{branch.postcode ? ` - ${branch.postcode}` : ""}</option>)}
                          </select>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid gap-4 border-t pt-4 md:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-bold">Competitor Sales</label>
                      <textarea rows="4" value={competitorSales} onChange={(e) => setCompetitorSales(e.target.value)} placeholder="Example: Elfbar 12 units, SKE 8 units" className="w-full rounded-xl border p-3" />
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      <label className="flex items-center gap-2 font-bold">
                        <input type="checkbox" checked={invoiceRequested} disabled={!invoiceAllowed} onChange={(e) => setInvoiceRequested(e.target.checked)} /> Customer wants invoice
                      </label>
                      {!invoiceAllowed && <p className="mt-2 text-sm text-amber-800">Enter the Guest Customer / Shop name to create the invoice.</p>}
                      {invoiceRequested && (
                        <input type="email" value={invoiceEmail} onChange={(e) => setInvoiceEmail(e.target.value)} placeholder="Invoice email" className="mt-3 w-full rounded-xl border p-3" />
                      )}
                    </div>
                  </div>
                </section>
              )}

              {selectedRule && (
                <section className="rounded-3xl border p-4">
                  <p className="text-xs font-black uppercase tracking-wider text-blue-700">Step 2</p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-xl font-black">{text(selectedRule.promotion_name || getPromotionHeadline(selectedRule))}</h2>
                      <p className="text-sm font-bold text-emerald-700">{getPromotionHeadline(selectedRule)}</p>
                    </div>
                    <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
                      {[selectedRule.trigger_brand, selectedRule.trigger_series].filter(Boolean).join(" · ")}
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className={`font-black ${isFreeSelection ? "text-emerald-900" : "text-slate-900"}`}>
                          {isFreeSelection ? `FREE products / flavours (${Number(selectedRule.free_qty || 0)})` : `BUY products / flavours (${Number(selectedRule.buy_qty || 0)})`}
                        </h3>
                        <p className="text-xs font-bold text-slate-500">{selectionSummary}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectionSide("trigger")}
                          className={`rounded-xl border px-4 py-2 text-sm font-black ${selectionSide === "trigger" ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                        >
                          Buy {Number(selectedRule.buy_qty || 0)}
                        </button>
                        {selectedRule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && Number(selectedRule.free_qty || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectionSide("free")}
                            className={`rounded-xl border px-4 py-2 text-sm font-black ${selectionSide === "free" ? "border-emerald-700 bg-emerald-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                          >
                            Free {Number(selectedRule.free_qty || 0)}
                          </button>
                        )}
                      </div>
                    </div>

                    {!selectionProducts.length ? (
                      <div className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">
                        No active products match the {isFreeSelection ? "FREE" : "BUY"} side of this promotion.
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {selectionProducts.map((product) => {
                          const selectedQty = Number(
                            (isFreeSelection ? freeQuantities : buyQuantities)[String(product.id)] || 0
                          );
                          const selected = selectedQty > 0;
                          const normalPrice = Number(getBaseVatPrice(product));
                          const promotionPrice = getPromotionProductPrice(product, selectedRule);
                          const hasPromotionPrice = !isFreeSelection && Math.abs(normalPrice - promotionPrice) > 0.004;
                          return (
                            <article
                              key={`${selectionSide}-${product.id}`}
                              className={`rounded-2xl border-2 bg-white p-3 ${
                                selected
                                  ? isFreeSelection ? "border-emerald-700 bg-emerald-50" : "border-blue-700 bg-blue-50"
                                  : isFreeSelection ? "border-emerald-100" : "border-slate-200"
                              }`}
                            >
                              <ProductPicture product={product} />
                              <div className="mt-2 min-h-[42px] font-black text-slate-900">
                                {product.name || product.product_name}
                              </div>
                              <div className="mt-1 text-xs text-slate-500">
                                {[product.brand, product.series, product.flavour].filter(Boolean).join(" · ")}
                              </div>
                              <div className="mt-2">
                                {isFreeSelection ? (
                                  <>
                                    <div className="text-xs text-slate-500">Normal £{normalPrice.toFixed(2)}</div>
                                    <div className="text-lg font-black text-emerald-700">Promotion FREE £0.00</div>
                                  </>
                                ) : hasPromotionPrice ? (
                                  <>
                                    <div className="text-xs text-slate-500 line-through">Normal £{normalPrice.toFixed(2)}</div>
                                    <div className="text-lg font-black text-emerald-700">Promotion £{promotionPrice.toFixed(2)}</div>
                                  </>
                                ) : (
                                  <div className="text-lg font-black text-blue-950">£{normalPrice.toFixed(2)}</div>
                                )}
                              </div>
                              <div className="mt-3 flex items-center gap-2">
                                {selectedQty > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => isFreeSelection
                                      ? changeFreeQuantity(product.id, -1)
                                      : changeBuyQuantity(product.id, -1)}
                                    className="h-10 w-10 rounded-xl border border-slate-300 bg-white text-lg font-black"
                                  >
                                    −
                                  </button>
                                )}
                                <button
                                  type="button"
                                  disabled={isFreeSelection && freeSelectedQty >= freeQtyEarned}
                                  onClick={() => isFreeSelection
                                    ? changeFreeQuantity(product.id, 1)
                                    : changeBuyQuantity(product.id, 1)}
                                  className={`h-10 flex-1 rounded-xl px-3 font-black disabled:cursor-not-allowed disabled:opacity-40 ${
                                    isFreeSelection
                                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                      : "bg-blue-600 text-white hover:bg-blue-700"
                                  }`}
                                >
                                  {selectedQty > 0 ? `Add another (${selectedQty})` : (isFreeSelection ? "Add FREE item" : "Add")}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {buySelectedQty > 0 && (
                    <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-black">Promotion basket</div>
                          <div className="text-sm text-slate-600">{getPromotionHeadline(selectedRule)}</div>
                        </div>
                        <div className="flex gap-2 text-sm font-black">
                          <span className="rounded-xl bg-blue-100 px-3 py-2 text-blue-900">BUY selected {buySelectedQty}</span>
                          {selectedRule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && (
                            <span className="rounded-xl bg-emerald-100 px-3 py-2 text-emerald-900">FREE selected {freeSelectedQty}/{freeQtyEarned}</span>
                          )}
                        </div>
                      </div>
                      {selectedRule.rule_kind === PROMOTION_RULE_KINDS.BULK_BUY_GET_FREE && (
                        <div className="mt-2 text-sm font-bold text-emerald-700">
                          {buySelectedQty} BUY item{buySelectedQty === 1 ? "" : "s"} currently earn {freeQtyEarned} free item{freeQtyEarned === 1 ? "" : "s"}.
                        </div>
                      )}
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl bg-white p-3">
                          <div className="text-xs font-bold uppercase text-slate-500">Normal amount</div>
                          <div className="text-xl font-black text-slate-900">£{Number(beforePromotionTotals?.grandTotal || 0).toFixed(2)}</div>
                        </div>
                        <div className="rounded-xl bg-white p-3">
                          <div className="text-xs font-bold uppercase text-slate-500">Promotion amount</div>
                          <div className="text-xl font-black text-blue-950">£{Number(totals?.grandTotal || 0).toFixed(2)}</div>
                        </div>
                        <div className="rounded-xl bg-emerald-50 p-3">
                          <div className="text-xs font-bold uppercase text-emerald-700">Saving</div>
                          <div className="text-xl font-black text-emerald-800">£{promotionSaving.toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              )}

              {selectedRule && buySelectedQty > 0 && (
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-slate-500">Promotion sale total</div>
                      <div className="text-2xl font-black text-slate-950">£{Number(totals?.grandTotal || 0).toFixed(2)}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setError("");
                        if (paymentMethod === "Bank Transfer") {
                          setPaymentConfirmOpen(true);
                          return;
                        }
                        if (window.confirm(`Customer paid £${Number(totals?.grandTotal || 0).toFixed(2)} by ${paymentMethod}?`)) {
                          void submit();
                        }
                      }}
                      disabled={saving}
                      className="rounded-2xl bg-emerald-600 px-6 py-3 font-black text-white disabled:opacity-50"
                    >
                      {saving ? "Recording sale..." : "Complete Promotion Sale"}
                    </button>
                  </div>

                  {paymentConfirmOpen && paymentMethod === "Bank Transfer" && (
                    <div className="mt-4 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4">
                      <div className="text-lg font-black text-amber-950">Bank payment proof required</div>
                      <p className="mt-1 text-sm text-amber-900">
                        Upload the customer's bank-payment screenshot. The sale completes after the payment is recorded as pending approval.
                      </p>
                      <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3">
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(e) => setBankProofFile(e.target.files?.[0] || null)}
                          className="block w-full text-sm"
                        />
                        {bankProofFile && <div className="mt-1 text-xs font-bold text-amber-800">Proof selected: {bankProofFile.name}</div>}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!bankProofFile) return;
                            if (window.confirm(`Customer paid £${Number(totals?.grandTotal || 0).toFixed(2)} by Bank Transfer?`)) {
                              void submit();
                            }
                          }}
                          disabled={saving || !bankProofFile}
                          className="rounded-xl bg-emerald-700 px-5 py-3 font-black text-white disabled:opacity-40"
                        >
                          {saving ? "Recording sale..." : "Confirm Bank Payment & Complete Sale"}
                        </button>
                        <button type="button" onClick={() => setPaymentConfirmOpen(false)} className="rounded-xl px-4 py-3 font-bold text-slate-500">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
