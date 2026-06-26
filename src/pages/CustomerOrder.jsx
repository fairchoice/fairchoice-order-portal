import { useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabase.js";
import Pricing from "./AdminSetup/Pricing";
import Suppliers from "./AdminSetup/Suppliers";
import Staff from "./AdminSetup/Staff";
import LoginConfig from "./AdminSetup/LoginConfig";

import { formatCurrency } from "../utils/currency";

import BackOfficeLayout, {
  ComingSoonPlaceholder,
  getComingSoonTitle,
} from "./AdminSetup/BackOfficeLayout";

import Categories from "./AdminSetup/Categories";
import Warehouse from "./Warehouse";
import Driver from "./AdminSetup/Driver";
import StockReceipts from "./AdminSetup/StockReceipts";
import StockHistory from "./AdminSetup/StockHistory";
import CustomerCredit from "./AdminSetup/CustomerCredit";
import WeeklyAccount from "./AdminSetup/WeeklyAccount";
import Customers from "./AdminSetup/Customers";

import ProductCard, { ProductListRow } from "../components/ProductCard";
import ProductFilters from "../components/ProductFilters";
import Cart from "../components/Cart.jsx";

import { getProducts } from "../services/products";
import {
  applyLocationStockToProducts,
  saveProductLocationStock,
} from "../services/locationStock";
import {
  applyPromotionRulesToCart,
  getActivePromotionRules,
  PROMOTION_RULE_KINDS,
} from "../services/promotionRules";
import {
  calculateOrderTotals,
  getOrderItemNetTotal,
  getOrderItemQty,
  getOrderItemUnitPrice,
  getOrderItemVatTotal,
} from "../utils/orderTotals";
import { calculateCustomerCredit } from "../utils/customerCredit";

import AdminProducts from "./AdminProducts";
import ProductImportExport from "./AdminSetup/ProductImportExport";
import ProductPromotions from "./AdminSetup/ProductPromotions";
import AdminOrders from "./AdminOrders";
import fairchoiceLogo from "../assets/fairchoice-logo.png";


import { getCustomerAccounts } from "../services/customerManagement";

import {
  createCustomerOrder,
  updateOrderStatus,
  updateOrderFields,
} from "../services/orders";

function normalizeProduct(raw) {
  return {
    id: raw.id,
    productCode: raw.product_code || "",
    name: raw.product_name || "Unnamed Product",
    category: raw.main_category || "Uncategorised",
    subCategory: raw.sub_category || "",
    brand: raw.brand || "Other",
    series: raw.series || "",
    flavour: raw.flavour || "",
    cashPrice: Number(raw.cash_price || 0),
    vatPrice: Number(raw.vat_price || 0),
    walesSpecialPrice: Number(raw.wales_special_price || 0),
    englandSpecialPrice: Number(raw.england_special_price || 0),
    cartonSize: raw.carton_size || "",
    image: raw.image_url || "https://placehold.co/400x300?text=Product",
    stock: Number(raw.stock || 0),
    lowStockAlert: Number(raw.low_stock_alert || 10),
    status: raw.status || "Active",
    active: String(raw.status || "Active").trim().toLowerCase() !== "inactive",
    availableInEngland: raw.available_in_england === true,
    availableInWales: raw.available_in_wales === true,
    vatType: raw.vat_type || "20",
    availableFromSupplier: raw.available_from_supplier !== false,
    isNew: Boolean(raw.is_new ?? raw.isNew),
    isPromotion: Boolean(raw.is_promotion ?? raw.isPromotion),
    isReduced: Boolean(raw.is_reduced ?? raw.isReduced),
    comingSoon: Boolean(raw.coming_soon ?? raw.comingSoon),
    recommended: Boolean(raw.recommended),
    topSeller: Boolean(raw.top_seller ?? raw.topSeller),
    costPrice: Number(raw.cost_price || 0),
    supplierName: raw.supplier_name || "",
    salesAccount: raw.sales_account || "",
    purchaseAccount: raw.purchase_account || "",
  };
}

const PRODUCT_LABEL_PRIORITY = [
  "comingSoon",
  "isNew",
  "isPromotion",
  "isReduced",
  "recommended",
  "topSeller",
];

const getProductLabelValue = (product) =>
  PRODUCT_LABEL_PRIORITY.find((key) => product?.[key] === true) || "";

const getProductLabelPayload = (labelValue) => ({
  is_new: labelValue === "isNew",
  is_promotion: labelValue === "isPromotion",
  is_reduced: labelValue === "isReduced",
  coming_soon: labelValue === "comingSoon",
  recommended: labelValue === "recommended",
  top_seller: labelValue === "topSeller",
});

const getProductLabelFormFlags = (labelValue) => ({
  isNew: labelValue === "isNew",
  isPromotion: labelValue === "isPromotion",
  isReduced: labelValue === "isReduced",
  comingSoon: labelValue === "comingSoon",
  recommended: labelValue === "recommended",
  topSeller: labelValue === "topSeller",
});

const PRODUCT_DISPLAY_LIMIT = 20;

const getStableSampleScore = (product, seed) => {
  const value = `${product?.id || product?.productCode || product?.name || ""}|${seed}`;
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const stableSampleProducts = (items, limit, seed) => {
  if (items.length <= limit) return items;

  return [...items]
    .sort(
      (a, b) =>
        getStableSampleScore(a, seed) - getStableSampleScore(b, seed)
    )
    .slice(0, limit);
};

const getOrderProductAvailabilityRank = (product) => {
  const sourceStatus = String(product?.sourceStatus || "").trim().toLowerCase();
  const productStatus = String(product?.status || "").trim().toLowerCase();

  if (
    sourceStatus === "cannot supply" ||
    productStatus === "cannot supply" ||
    product?.comingSoon
  ) {
    return 3;
  }

  if (Number(product?.stock || 0) > 0) return 1;

  if (
    sourceStatus === "need supplier" ||
    sourceStatus === "pre-order" ||
    sourceStatus === "pre order" ||
    productStatus === "need supplier" ||
    productStatus === "pre-order" ||
    productStatus === "pre order" ||
    product?.availableFromSupplier
  ) {
    return 2;
  }

  return 3;
};

const sortOrderProductsByAvailability = (items) =>
  [...items].sort((a, b) => {
    const rankDiff =
      getOrderProductAvailabilityRank(a) - getOrderProductAvailabilityRank(b);

    if (rankDiff !== 0) return rankDiff;

    return String(a.name || "").localeCompare(String(b.name || ""));
  });

const getCustomerAddress = (customer, branch) =>
  branch?.delivery_address ||
  branch?.postcode ||
  customer?.address ||
  customer?.delivery_address ||
  customer?.postcode ||
  "-";

const getCreditBalance = (customer, ledger = [], openingBalance = 0) =>
  calculateCustomerCredit(customer, ledger, openingBalance).outstanding;

const normalizeCountry = (value) => String(value || "").trim().toLowerCase();

const getCustomerBranches = (customer) =>
  Array.isArray(customer?.customer_branches) ? customer.customer_branches : [];

const getCustomerAccountCountry = (customer) =>
  customer?.country ||
  customer?.account_country ||
  customer?.defaultCountry ||
  customer?.default_country ||
  "";

const getCustomerBranchCountry = (customer) => {
  const branches = getCustomerBranches(customer);
  const defaultBranch =
    branches.find((branch) => branch.default_branch || branch.is_default) ||
    branches[0];

  return defaultBranch?.country || "";
};

const customerMatchesCountry = (customer, country) => {
  const selectedCountry = normalizeCountry(country);
  if (!selectedCountry) return true;

  const accountCountry = normalizeCountry(getCustomerAccountCountry(customer));
  if (accountCountry) return accountCountry === selectedCountry;

  return getCustomerBranches(customer).some(
    (branch) => normalizeCountry(branch.country) === selectedCountry
  );
};

const getCountryFilteredBranches = (customer, country, shouldFilter) => {
  const activeBranches = getCustomerBranches(customer).filter(
    (branch) => branch.active !== false
  );

  if (!shouldFilter) return activeBranches;

  const selectedCountry = normalizeCountry(country);
  if (!selectedCountry) return activeBranches;

  return activeBranches.filter(
    (branch) => normalizeCountry(branch.country) === selectedCountry
  );
};
export default function CustomerOrder({ userProfile }) {

const loggedInUser =
  JSON.parse(localStorage.getItem("loggedInUser") || "null") ||
  JSON.parse(localStorage.getItem("fairchoice_user") || "null");


  const activeUser = userProfile || loggedInUser || {};
const role = activeUser?.role || "Customer";
  const normalizedRole = (role || "").replace(/\s+/g, "").toLowerCase();

  const isAdmin =
    normalizedRole === "admin" || normalizedRole === "superadmin";
  const isSalesRep = normalizedRole === "salesrep";
  const isWarehouse = normalizedRole === "warehouse";
  const isDriver = normalizedRole === "driver";
  const isCustomer = normalizedRole === "customer";

  

 const [page, setPage] = useState(() => {
  if (isCustomer) return "order";
  if (isDriver) return "driver";
  if (isWarehouse) return "warehouse";
  if (isAdmin && window.location.hash === "#admin") return "orders";

  if (window.location.hash === "#products") return "products";
  if (window.location.hash === "#warehouse") return "warehouse";
  if (window.location.hash === "#driver") return "driver";
  if (window.location.hash === "#stock-receipts") return "stockreceipts";
  if (window.location.hash === "#stockhistory") return "stockhistory";
  if (window.location.hash === "#config") return "config";
  if (window.location.hash === "#customers") return "customers";
  if (window.location.hash === "#credit") return "credit";

  return isAdmin ? "orders" : "order";
});

  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedCustomerAccount, setSelectedCustomerAccount] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [paymentHistoryBranchId, setPaymentHistoryBranchId] = useState("");
  const [customerLedger, setCustomerLedger] = useState([]);
  const [customerOpeningBalance, setCustomerOpeningBalance] = useState(0);

  const [salesPaymentForm, setSalesPaymentForm] = useState({
  customerId: "",
  branchId: "",
  amount: "",
  paymentType: "Cash",
  whoPaid: "",
  collectionDate: new Date().toISOString().split("T")[0],
  notes: "",
});



const [savingSalesPayment, setSavingSalesPayment] = useState(false);

  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
 

  const [priceMode, setPriceMode] = useState("vat");
  const [companyName, setCompanyName] = useState("");

  const [manualCountry, setManualCountry] = useState("Wales");

  const [pricingSettings, setPricingSettings] = useState({
    server_discount_percent: 2,
    manager_discount_percent: 2.5,
    super_discount_percent: 3.5,
    show_manager_offer: true,
    show_super_offer: true,
  });

  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productError, setProductError] = useState("");
  const [promotionRules, setPromotionRules] = useState([]);

  const CART_KEY = "fairchoice_cart";

const [cart, setCart] = useState(() => {
  try {
    const savedCart = localStorage.getItem(CART_KEY);
    return savedCart ? JSON.parse(savedCart) : [];
  } catch {
    return [];
  }
});


useEffect(() => {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}, [cart]);

const applyCartPromotions = (cartLines) =>
  applyPromotionRulesToCart(cartLines, promotionRules, { products, priceMode });

const refreshPromotionRules = async () => {
  try {
    const rules = await getActivePromotionRules();
    setPromotionRules(rules || []);
  } catch (error) {
    console.error("Promotion rules loading error:", error);
  }
};

useEffect(() => {
  setCart((oldCart) => {
    const recalculatedCart = applyPromotionRulesToCart(
      oldCart,
      promotionRules,
      { products, priceMode }
    );

    return JSON.stringify(recalculatedCart) === JSON.stringify(oldCart)
      ? oldCart
      : recalculatedCart;
  });
}, [promotionRules, products]);


const loadCustomerCreditSnapshot = async (customer = selectedCustomerAccount) => {
  const customerName = customer?.account_name || companyName;

  if (!customerName) {
    setCustomerLedger([]);
    setCustomerOpeningBalance(0);
    return { ledgerRows: [], openingBalance: 0 };
  }

  const [{ data: ledgerData, error: ledgerError }, { data: balanceRow }] = await Promise.all([
    supabase
    .from("customer_ledger")
    .select("*")
    .eq("customer_name", customerName)
      .order("created_at", { ascending: true }),
    supabase
      .from("customer_opening_balances")
      .select("*")
      .eq("customer_name", customerName)
      .maybeSingle(),
  ]);

  if (ledgerError) {
    console.error("Customer ledger loading error:", ledgerError);

    alert(
      `Could not load payment history.\n\n${ledgerError.message}\n\n${ledgerError.details || ""}`
    );

    return { ledgerRows: [], openingBalance: 0 };
  }

  const ledgerRows = ledgerData || [];
  const openingBalance = Number(balanceRow?.opening_balance || 0);

  setCustomerLedger(ledgerRows);
  setCustomerOpeningBalance(openingBalance);

  return { ledgerRows, openingBalance };
};

const fetchCustomerLedger = () => loadCustomerCreditSnapshot();

useEffect(() => {
  if (selectedCustomerAccount && (page === "paymentHistory" || page === "order")) {
    fetchCustomerLedger();
  }
}, [page, selectedCustomerAccount?.id, userProfile?.customer_account_id]);

  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orders, setOrders] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState({});

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Products");
  const [selectedSubCategory, setSelectedSubCategory] =
    useState("All Sub Categories");
  const [selectedBrand, setSelectedBrand] = useState("All Brands");
  const [selectedSeries, setSelectedSeries] = useState("All Series");
  const [productView, setProductView] = useState("grid");

  const [selectedImage, setSelectedImage] = useState(null);

  const [editingId, setEditingId] = useState(null);

  const [productForm, setProductForm] = useState({
    productCode: "",
    name: "",
    category: "",
    subCategory: "",
    brand: "",
    series: "",
    flavour: "",
    cashPrice: "",
    vatPrice: "",
    walesSpecialPrice: "",
    englandSpecialPrice: "",
    cartonSize: "",
    image: "",
    stock: "",
    lowStockAlert: "10",
    availableInEngland: true,
    availableInWales: true,
    vatType: "20",
    availableFromSupplier: true,
    costPrice: "",
    supplierName: "",
    salesAccount: "",
    purchaseAccount: "",
    locationStocks: {},
    isNew: false,
    isPromotion: false,
    isReduced: false,
    comingSoon: false,
    recommended: false,
    topSeller: false,
    active: true,
  });

  const getDefaultProductAccounts = async (category) => {
    const selectedCategory = String(category || "").trim();

    if (!selectedCategory) {
      return {
        salesAccount: "",
        purchaseAccount: "",
      };
    }

    const { data, error } = await supabase
      .from("account_codes")
      .select("account_code, account_type, main_category")
      .eq("active", true)
      .eq("main_category", selectedCategory)
      .in("account_type", ["Sales", "Purchase"]);

    if (error) {
      console.error("Default account code loading error:", error);
      return {
        salesAccount: "",
        purchaseAccount: "",
      };
    }

    const salesAccount = (data || []).find(
      (account) => account.account_type === "Sales"
    );
    const purchaseAccount = (data || []).find(
      (account) => account.account_type === "Purchase"
    );

    return {
      salesAccount: salesAccount?.account_code || "",
      purchaseAccount: purchaseAccount?.account_code || "",
    };
  };

  const orderCountry =
  (isAdmin || isSalesRep)
    ? manualCountry
    : selectedBranch?.country ||
      selectedCustomerAccount?.country ||
      "Wales";

  const filteredCustomersForSalesRep = useMemo(() => {
    if (!isSalesRep) return customerAccounts;

    return customerAccounts.filter((customer) =>
      customerMatchesCountry(customer, orderCountry)
    );
  }, [customerAccounts, isSalesRep, orderCountry]);

  const filteredBranchesForSelectedCustomer = useMemo(
    () =>
      getCountryFilteredBranches(
        selectedCustomerAccount,
        orderCountry,
        isSalesRep
      ),
    [selectedCustomerAccount, orderCountry, isSalesRep]
  );

  const roundToFairQuarter = (price) => {
  const value = Number(price || 0);
  const pounds = Math.floor(value);
  const cents = Math.round((value - pounds) * 100);

  if (cents <= 15) return pounds;
  if (cents <= 35) return pounds + 0.25;
  if (cents <= 65) return pounds + 0.5;
  if (cents <= 85) return pounds + 0.75;

  return pounds + 1;
};

const getVatRate = (vatType) => {
  const rate = Number(String(vatType || "20").replace("%", "").trim());
  if (rate === 5) return 5;
  if (rate === 0) return 0;
  return 20;
};

const normalizePromotionType = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isVatPriceMode = (mode) => {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  return (
    normalizedMode === "vat" ||
    normalizedMode === "ex vat" ||
    normalizedMode === "ex. vat"
  );
};

const getPromotionRuleProductId = (rule) =>
  rule?.product_id ??
  rule?.productId ??
  rule?.trigger_product_id ??
  rule?.triggerProductId ??
  rule?.selected_product_id ??
  rule?.selectedProductId ??
  rule?.product?.id ??
  rule?.selected_product?.id ??
  rule?.selectedProduct?.id ??
  rule?.promotion_product?.product_id ??
  rule?.promotionProduct?.productId ??
  rule?.rule_product?.product_id ??
  rule?.ruleProduct?.productId;

const getPromotionRulePrice = (rule) =>
  rule?.promotion_price ??
  rule?.promotionPrice ??
  rule?.offer_price ??
  rule?.offerPrice;

const getPromotionRuleProductIds = (rule) => {
  const directProductId = getPromotionRuleProductId(rule);
  const ids = directProductId != null ? [directProductId] : [];
  const relatedProducts =
    rule?.selected_products ??
    rule?.selectedProducts ??
    rule?.products ??
    rule?.rule_products ??
    rule?.ruleProducts ??
    rule?.promotion_products ??
    rule?.promotionProducts ??
    [];

  if (Array.isArray(relatedProducts)) {
    relatedProducts.forEach((item) => {
      const productId =
        item?.product_id ??
        item?.productId ??
        item?.id ??
        item?.product?.id;
      if (productId != null) ids.push(productId);
    });
  }

  return ids;
};

const isPromotionPriceRule = (rule) => {
  const type = normalizePromotionType(
    rule?.promotion_type ??
      rule?.promotionType ??
      rule?.promotion_type_name ??
      rule?.promotionTypeName
  );

  return (
    type === "promotion_price" ||
    type === "promotionprice" ||
    rule?.rule_kind === PROMOTION_RULE_KINDS.PROMOTION_PRICE
  );
};

const getActivePromotionPriceRule = (product) => {
  if (!isVatPriceMode(priceMode)) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return promotionRules.find((rule) => {
    const startDate = rule?.start_date ? new Date(rule.start_date) : null;
    const endDate = rule?.end_date ? new Date(rule.end_date) : null;

    if (startDate) startDate.setHours(0, 0, 0, 0);
    if (endDate) endDate.setHours(23, 59, 59, 999);

    const startsOk = !startDate || startDate <= today;
    const endsOk = !endDate || endDate >= today;
    const productIds = getPromotionRuleProductIds(rule);
    const promotionPrice = getPromotionRulePrice(rule);

  const activeOk =
  rule?.active === true ||
  String(rule?.active).toLowerCase() === "true";

const productMatch = productIds.some(
  (productId) => String(productId) === String(product?.id)
);

return (
  activeOk &&
  startsOk &&
  endsOk &&
  isPromotionPriceRule(rule) &&
  productMatch &&
  promotionPrice != null &&
  promotionPrice !== ""
);


  }) || null;
};

const getPromotionPrice = (product) => {
  const rule = getActivePromotionPriceRule(product);
  if (!rule) return null;

  const promotionPrice = Number(getPromotionRulePrice(rule));
  return Number.isFinite(promotionPrice) ? promotionPrice : null;
};

const getPrice = (product) => {
  const mode = String(priceMode || "").toLowerCase();

  const exVatPrice = Number(product.vatPrice || 0);
  const vatRate = getVatRate(product.vatType);
  const incVatPrice = exVatPrice + exVatPrice * (vatRate / 100);

  if (isVatPriceMode(mode)) {
    return exVatPrice;
  }

  if (mode === "server" || mode === "manager") {
    const country = String(orderCountry || "").toLowerCase();
    const specialPrice =
      country === "wales"
        ? Number(product.walesSpecialPrice || 0)
        : country === "england"
        ? Number(product.englandSpecialPrice || 0)
        : 0;

    if (specialPrice > 0) {
      return specialPrice;
    }
  }

  const discounts = {
    server: pricingSettings.server_discount_percent,
    manager: pricingSettings.manager_discount_percent,
    super: pricingSettings.super_discount_percent,
  };

  const discount = Number(discounts[mode] || 0);
  const discountedPrice = incVatPrice * (1 - discount / 100);

  return roundToFairQuarter(discountedPrice);
};

const recalculateCartItemForPriceMode = (item, nextQty = item.qty) => {
  const quantity = Math.max(1, Number(nextQty || 1));
  const selectedPrice = Number(getPrice(item) || 0);
  const exVatPrice = isVatPriceMode(priceMode)
    ? selectedPrice
    : Number(item.vatPrice || item.vat_price || selectedPrice || 0);
  const vatRate = getVatRate(item.vatType || item.vat_type);
  const vatAmount = exVatPrice * (vatRate / 100);
  const incVatPrice = exVatPrice + vatAmount;
  const lineTotal = quantity * selectedPrice;

  return {
    ...item,
    qty: quantity,
    quantity,
    selectedPrice,
    price: selectedPrice,
    unit_price: selectedPrice,
    unitPrice: selectedPrice,
    amount: lineTotal,
    line_total: lineTotal,
    lineTotal,
    total: lineTotal,
    exVatPrice,
    normalSelectedPrice: Number(item.vatPrice || item.vat_price || 0),
    normalPrice: Number(item.vatPrice || item.vat_price || 0),
    vatRate,
    vatAmount,
    incVatPrice,
  };
};

useEffect(() => {
  setCart((oldCart) => {
    const normalCart = oldCart.filter((item) => !item.isPromotionFree);
    const recalculatedCart = normalCart.map((item) =>
      recalculateCartItemForPriceMode(item, item.qty)
    );
    const nextCart = applyCartPromotions(recalculatedCart);

    return JSON.stringify(nextCart) === JSON.stringify(oldCart)
      ? oldCart
      : nextCart;
  });
}, [priceMode, orderCountry, pricingSettings, promotionRules, products]);


useEffect(() => {
  if (isAdmin && page === "order" && window.location.hash === "#admin") {
    setPage("orders");
    fetchOrders();
    return;
  }

}, [isAdmin, isWarehouse, isDriver, isSalesRep, isCustomer]);

useEffect(() => {
  if (!isCustomer) return;
  if (page === "order" || page === "paymentHistory") return;

  setPage("order");
}, [isCustomer, page]);



  useEffect(() => {
    if (!supabase) {
      setProductError("Supabase is not configured.");
      return;
    }

  
    fetchProducts();
    fetchPricingSettings();
    refreshPromotionRules();

 if (
  isAdmin ||
  isWarehouse ||
  isDriver ||
  [
    "#admin",
    "#products",
    "#warehouse",
    "#driver",
    "#stock-receipts",
    "#stockhistory",
    "#credit",
  ].includes(window.location.hash)
) {
  fetchOrders();
}
  }, []);

  useEffect(() => {
    async function loadCustomerAccounts() {
      try {
        const data = await getCustomerAccounts();
        setCustomerAccounts(data || []);
      } catch (error) {
        console.error("Customer loading error:", error);
      }
    }

    loadCustomerAccounts();
  }, []);

  useEffect(() => {
    if (!isCustomer) return;
    if (!userProfile?.customer_account_id) return;
    if (!customerAccounts.length) return;

    const customer = customerAccounts.find(
      (c) => String(c.id) === String(userProfile.customer_account_id)
    );

    if (!customer) {
      console.error("Linked customer account not found");
      return;
    }

    setSelectedCustomerId(customer.id);
    setSelectedCustomerAccount(customer);
    setCompanyName(customer.account_name);
    setPriceMode(String(customer.default_price_mode || "vat").toLowerCase());
  }, [isCustomer, userProfile?.customer_account_id, customerAccounts]);

  useEffect(() => {
    if (!selectedCustomerAccount) return;

    if (filteredBranchesForSelectedCustomer.length === 1) {
      setSelectedBranchId(filteredBranchesForSelectedCustomer[0].id);
      setSelectedBranch(filteredBranchesForSelectedCustomer[0]);
    }
  }, [selectedCustomerAccount, filteredBranchesForSelectedCustomer]);

  useEffect(() => {
    if (!isSalesRep) return;

    if (
      selectedCustomerAccount &&
      !customerMatchesCountry(selectedCustomerAccount, orderCountry)
    ) {
      setSelectedCustomerId("");
      setSelectedCustomerAccount(null);
      setSelectedBranchId("");
      setSelectedBranch(null);
      setCompanyName("");
      setPriceMode("vat");
      setCart([]);
      localStorage.removeItem(CART_KEY);
      return;
    }

    if (
      selectedBranch &&
      normalizeCountry(selectedBranch.country) !== normalizeCountry(orderCountry)
    ) {
      setSelectedBranchId("");
      setSelectedBranch(null);
    }
  }, [isSalesRep, orderCountry, selectedCustomerAccount, selectedBranch]);

  const fetchProducts = async () => {
    setProductError("");
    setProductsLoading(true);

    try {
      const data = await getProducts();
      const productsForCountry = applyLocationStockToProducts(
        data || [],
        orderCountry
      );

      setProducts((productsForCountry || []).filter((p) => p.name));
    } catch (error) {
      console.error("Product loading error:", error);
      setProductError(error.message);
    }

    setProductsLoading(false);
  };

  useEffect(() => {
    if (!supabase) return;
    fetchProducts();
  }, [orderCountry]);

  const fetchPricingSettings = async () => {
    const { data, error } = await supabase
      .from("pricing_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (!error && data) {
      setPricingSettings(data);
    }
  };

const fetchOrders = async () => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const mappedOrders = (data || []).map((order) => ({
      dbId: order.id,
      orderId: order.order_number,
      customerAccountId: order.customer_account_id || "",
      customer_account_id: order.customer_account_id || "",
      customerBranchId: order.customer_branch_id || order.branch_id || "",
      customer_branch_id: order.customer_branch_id || order.branch_id || "",
      customerName: order.company_name,
      phoneNumber: "",
      companyName: order.company_name,
      branchName:
        order.delivery_branch_name ||
        order.branch_name ||
        order.branchName ||
        order.shop_name ||
        order.shopName ||
        "",
      deliveryAddress:
        order.delivery_address || order.delivery_postcode || order.postcode || "",
      priceMode: order.price_mode || "vat",
      total: Number(order.order_total || order.total || 0),
      orderTotal: Number(order.order_total || order.total || 0),
      totalAmount: Number(order.total_amount || 0),
      finalTotal: Number(
        order.final_total ||
          order.finalTotal ||
          order.total_amount ||
          order.order_total ||
          order.total ||
          0
      ),
      vatTotal: Number(order.vat_total || order.total_vat || order.vat || 0),
      discount_percent: Number(order.discount_percent || 0),
      discount_amount: Number(order.discount_amount || 0),
      discount_applied_by: order.discount_applied_by || "",
      discount_applied_by_name: order.discount_applied_by_name || "",
      createdAt: new Date(order.created_at).toLocaleString(),
      status: order.status,

      driverName: order.driver_name || "",
      deliveredAt: order.delivered_at || "",
      paymentType: order.payment_type || "",
      paymentAmount: Number(order.payment_amount || 0),
      paymentCollected: order.payment_collected || "",
      payment_collected: order.payment_collected || "",
      paidBy: order.paid_by || "",
      receivedBy: order.received_by || "",

      items: (order.order_items || []).map((item) => ({
        dbId: item.id,
        id: item.product_id,
        productCode: item.product_code || item.code || "",
        product_code: item.product_code || item.code || "",
        name: item.product_name,
        brand: item.brand || "",
        series: item.series || "",
        flavour: item.flavour || "",
        cartonSize: item.carton_size || "",
        qty: Number(item.qty || 0),
        selectedPrice: Number(item.price || 0),
        price: Number(item.price || 0),
        lineTotal: Number(item.line_total || item.lineTotal || 0),
        line_total: Number(item.line_total || item.lineTotal || 0),
        vatRate: Number(item.vat_percent || item.vatPercent || 20),
        vatTotal: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
        stock: Number(item.stock_before || 0),
        sourceStatus: item.source_status || "In Stock",
        pickedQty: Number(item.picked_qty || item.qty || 0),
        includeInPicking: item.include_in_picking !== false,
      })),
    }));

    setOrders(mappedOrders);
  } catch (error) {
    console.error("Orders loading error:", error);
  }
};

  const changeOrderStatus = async (orderNumber, status) => {
    try {
      await updateOrderStatus(orderNumber, status);

      setOrders((oldOrders) =>
        oldOrders.map((order) =>
          order.orderId === orderNumber ? { ...order, status } : order
        )
      );
    } catch (error) {
      console.error("Status update error:", error);
      alert("Could not update order status.");
    }
  };

  const updateOrderExtraFields = async (orderNumber, updates) => {
    try {
      await updateOrderFields(orderNumber, updates);
      await fetchOrders();
    } catch (error) {
      console.error("Order update error:", error);
      alert("Could not update order details.");
    }
  };

  const categories = [
    "All Products",
    ...new Set(products.map((p) => p.category).filter(Boolean)),
  ];

  const subCategories = [
  "All Sub Categories",
  ...new Set(
    products
      .filter(
        (p) =>
          selectedCategory === "All Products" ||
          p.category === selectedCategory
      )
      .map((p) => String(p.subCategory || "").trim())
      .filter(Boolean)
  ),
];

const brands = [
  "All Brands",
  ...new Set(
    products
      .filter(
        (p) =>
          (selectedCategory === "All Products" ||
            p.category === selectedCategory) &&
          (selectedSubCategory === "All Sub Categories" ||
            p.subCategory === selectedSubCategory)
      )
      .map((p) => String(p.brand || "").trim())
      .filter(Boolean)
  ),
];


const seriesList = [
  "All Series",
  ...new Set(
    products
      .filter(
        (p) =>
          (selectedCategory === "All Products" ||
            p.category === selectedCategory) &&
          (selectedSubCategory === "All Sub Categories" ||
            p.subCategory === selectedSubCategory) &&
          (selectedBrand === "All Brands" ||
            p.brand === selectedBrand)
      )
      .map((p) => String(p.series || "").trim())
      .filter(Boolean)
  ),
];

const filteredProducts = useMemo(() => {
  const keyword = search.trim().toLowerCase();

  return sortOrderProductsByAvailability(
    products.filter((product) => {
      if (
        (orderCountry === "England" && !product.availableInEngland) ||
        (orderCountry === "Wales" && !product.availableInWales)
      ) {
        return false;
      }

      const productCategory = String(product.category || "").trim();
      const productSubCategory = String(product.subCategory || "").trim();
      const productBrand = String(product.brand || "").trim();
      const productSeries = String(product.series || "").trim();

      return (
        product.active &&
        (selectedCategory === "All Products" ||
          productCategory === selectedCategory) &&
        (selectedSubCategory === "All Sub Categories" ||
          productSubCategory === selectedSubCategory) &&
        (selectedBrand === "All Brands" ||
          productBrand === selectedBrand) &&
        (selectedSeries === "All Series" ||
          productSeries === selectedSeries) &&
        (keyword === "" ||
          String(product.name || "").toLowerCase().includes(keyword) ||
          String(product.productCode || "").toLowerCase().includes(keyword) ||
          productBrand.toLowerCase().includes(keyword) ||
          productSeries.toLowerCase().includes(keyword) ||
          String(product.flavour || "").toLowerCase().includes(keyword))
      );
    })
  );
}, [
  products,
  selectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
  search,
  orderCountry,
]);

const visibleProducts = useMemo(() => {
  if (selectedSeries !== "All Series") return filteredProducts;

  const sampleSeed = [
    selectedCategory,
    selectedSubCategory,
    selectedBrand,
    search.trim().toLowerCase(),
    orderCountry,
  ].join("|");

  return sortOrderProductsByAvailability(
    stableSampleProducts(filteredProducts, PRODUCT_DISPLAY_LIMIT, sampleSeed)
  );
}, [
  filteredProducts,
  selectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
  search,
  orderCountry,
]);

  const addToCart = (product, qty = 1) => {
  const quantity = Math.max(1, Number(qty || 1));

  setCart((oldCart) => {
    const normalCart = oldCart.filter((item) => !item.isPromotionFree);
    const found = normalCart.find((item) => item.id === product.id);

    if (found) {
      const newQty = found.qty + quantity;

      const nextCart = normalCart.map((item) =>
        item.id === product.id
          ? recalculateCartItemForPriceMode(
              {
                ...item,
                ...product,
                sourceStatus:
                  product.stock < newQty ? "Need Supplier" : "In Stock",
                pickedQty: Math.min(product.stock, newQty),
              },
              newQty
            )
          : item
      );

      return applyCartPromotions(nextCart);
    }

    return applyCartPromotions([
      ...normalCart,
      recalculateCartItemForPriceMode(
        {
          ...product,
        sourceStatus:
          product.stock < quantity ? "Need Supplier" : "In Stock",
        includeInPicking: true,
        pickedQty: Math.min(product.stock, quantity),
        },
        quantity
      ),
    ]);
  });
};

  const increaseQty = (id) => {
    setCart((oldCart) =>
      applyCartPromotions(
        oldCart
          .filter((item) => !item.isPromotionFree)
          .map((item) =>
            item.id === id
              ? recalculateCartItemForPriceMode(
                  {
                    ...item,
                    sourceStatus:
                      item.stock < item.qty + 1 ? "Need Supplier" : "In Stock",
                    pickedQty: Math.min(item.stock, item.qty + 1),
                  },
                  item.qty + 1
                )
              : item
          )
      )
    );
  };

  const decreaseQty = (id) => {
    setCart((oldCart) =>
      applyCartPromotions(
        oldCart
          .filter((item) => !item.isPromotionFree)
          .map((item) =>
            item.id === id
              ? item.qty - 1 <= 0
                ? { ...item, qty: 0, quantity: 0, pickedQty: 0 }
                : recalculateCartItemForPriceMode(
                    {
                      ...item,
                      pickedQty: Math.min(item.stock, item.qty - 1),
                    },
                    item.qty - 1
                  )
              : item
          )
          .filter((item) => item.qty > 0)
      )
    );
  };

  const changeQty = (id, value) => {
    const quantity = Math.max(1, Number(value || 1));

    setCart((oldCart) =>
      applyCartPromotions(
        oldCart
          .filter((item) => !item.isPromotionFree)
          .map((item) =>
            item.id === id
              ? recalculateCartItemForPriceMode(
                  {
                    ...item,
                    sourceStatus:
                      item.stock < quantity ? "Need Supplier" : "In Stock",
                    pickedQty: Math.min(item.stock, quantity),
                  },
                  quantity
                )
              : item
          )
      )
    );
  };

  const removeItem = (id) => {
    setCart((oldCart) =>
      applyCartPromotions(
        oldCart.filter((item) => !item.isPromotionFree && item.id !== id)
      )
    );
  };

  const promotionDiscountAmount = cart.reduce(
    (sum, item) => sum + Number(item.promotionDiscountAmount || 0),
    0
  );

  const subtotal = cart.reduce((sum, item) => {
    if (item.isPromotionFree) return sum;

    const qty = Number(item.qty || 0);

    if (isVatPriceMode(priceMode)) {
      return sum + Number(
        item.selectedPrice ?? item.exVatPrice ?? item.vatPrice ?? 0
      ) * qty;
    }

    return sum + Number(item.selectedPrice || 0) * qty;
  }, 0);

  const discountedSubtotal =
    isVatPriceMode(priceMode)
      ? Math.max(0, subtotal - promotionDiscountAmount)
      : subtotal;

  const vatTotal = isVatPriceMode(priceMode) ? discountedSubtotal * 0.2 : 0;
  const total = isVatPriceMode(priceMode) ? discountedSubtotal + vatTotal : subtotal;

 const discountAmount =
  total * (Number(orderDiscountPercent || 0) / 100);

const finalTotal =
  Math.max(0, total - discountAmount);

const selectedCustomerBranches = (selectedCustomerAccount?.customer_branches || []).filter(
  (branch) => branch.active !== false
);
const filteredCustomerLedger = paymentHistoryBranchId
  ? customerLedger.filter(
      (row) =>
        String(row.branch_id || row.customer_branch_id || "") ===
          String(paymentHistoryBranchId) ||
        String(row.branch_name || "") ===
          String(
            selectedCustomerBranches.find(
              (branch) => String(branch.id) === String(paymentHistoryBranchId)
            )?.branch_name || ""
          )
    )
  : customerLedger;
const branchOutstandingRows = selectedCustomerBranches.map((branch) => {
  const rows = customerLedger.filter(
    (row) =>
      String(row.branch_id || row.customer_branch_id || "") === String(branch.id) ||
      String(row.branch_name || "") === String(branch.branch_name)
  );

  return {
    id: branch.id,
    branchName: branch.branch_name,
    outstanding: calculateCustomerCredit(selectedCustomerAccount, rows, 0).outstanding,
  };
});

const isFinalOrderStatus = (status) =>
  ["delivered", "delivery confirmed", "completed"].includes(
    String(status || "").trim().toLowerCase()
  );

const selectedCustomerAccountId = String(selectedCustomerAccount?.id || "");
const selectedCustomerName = String(
  selectedCustomerAccount?.account_name || companyName || ""
).trim().toLowerCase();

const completedCustomerOrders = orders.filter((order) => {
  if (!isFinalOrderStatus(order.status)) return false;

  const orderCustomerAccountId = String(
    order.customerAccountId || order.customer_account_id || ""
  );

  if (selectedCustomerAccountId && orderCustomerAccountId) {
    return orderCustomerAccountId === selectedCustomerAccountId;
  }

  const orderCustomerName = String(
    order.companyName || order.customerName || ""
  ).trim().toLowerCase();

  return Boolean(selectedCustomerName && orderCustomerName === selectedCustomerName);
});

  const toggleOrderExpanded = (orderId) => {
    setExpandedOrders((old) => ({
      ...old,
      [orderId]: !old[orderId],
    }));
  };

  const saveSalesRepCollection = async () => {
  if (savingSalesPayment) return;

  const customer = customerAccounts.find(
    (c) => String(c.id) === String(salesPaymentForm.customerId)
  );
  const salesCustomerBranches = (customer?.customer_branches || []).filter(
    (branch) => branch.active !== false
  );
  const selectedSalesBranch =
    salesCustomerBranches.find(
      (branch) => String(branch.id) === String(salesPaymentForm.branchId)
    ) || null;

  if (!customer) {
    alert("Please select customer.");
    return;
  }

  if (!Number(salesPaymentForm.amount || 0)) {
    alert("Please enter amount.");
    return;
  }

  if (!salesPaymentForm.whoPaid.trim()) {
    alert("Please enter who paid.");
    return;
  }

  if (
    !window.confirm(
      `Save collection of ${formatCurrency(salesPaymentForm.amount)}`
    )
  ) {
    return;
  }

  setSavingSalesPayment(true);

  try {
   const { error } = await supabase
  .from("customer_ledger")
  .insert({
    customer_name: customer.account_name,
    entry_type: "PAYMENT",
    transaction_type: "PAYMENT",

    reference_no: "SALES_REP_COLLECTION",

    debit: 0,
    credit: Number(salesPaymentForm.amount),

    payment_type: salesPaymentForm.paymentType,
    payment_applies_to: "SALES_REP_COLLECTION",
    collection_source: "SALES_REP_COLLECTION",

    paid_by: salesPaymentForm.whoPaid,
    who_paid: salesPaymentForm.whoPaid,

   received_by: loggedInUser.staff_name || loggedInUser.username || null,
  received_by_username: loggedInUser.username || null,
  received_by_role: loggedInUser.role || null,
  received_by_staff_id: loggedInUser.staff_id || null,

  collected_by: loggedInUser.staff_id || loggedInUser.id || null,
  collected_by_name: loggedInUser.staff_name || loggedInUser.username || null,
  collected_by_username: loggedInUser.username || null,
  collected_by_role: loggedInUser.role || null,

    notes: [
      selectedSalesBranch ? `Branch: ${selectedSalesBranch.branch_name}` : "",
      salesPaymentForm.collectionDate
        ? `Collection date: ${salesPaymentForm.collectionDate}`
        : "",
      salesPaymentForm.notes || "",
    ]
      .filter(Boolean)
      .join("\n"),
  });

    if (error) throw error;

    alert("Collection saved successfully.");

    if (String(selectedCustomerAccount?.id || "") === String(customer.id || "")) {
      await loadCustomerCreditSnapshot(selectedCustomerAccount);
    }

    setSalesPaymentForm({
      customerId: "",
      branchId: "",
      amount: "",
      paymentType: "Cash",
      whoPaid: "",
      collectionDate: new Date()
        .toISOString()
        .split("T")[0],
      notes: "",
    });
  } catch (error) {
    alert(error.message);
  } finally {
    setSavingSalesPayment(false);
  }
};


const submitOrder = async () => {
  if (isSubmittingOrder) return;

  if (!selectedCustomerAccount) {
    alert("Please select customer account.");
    return;
  }

  const branches = selectedCustomerAccount.customer_branches || [];

  if (branches.length > 0 && !selectedBranch) {
    alert("Please select delivery branch / shop.");
    return;
  }
  const paidCartForOrder = cart.filter((item) => !item.isPromotionFree);

  if (paidCartForOrder.length === 0) {
    alert("Please add at least one product.");
    return;
  }

  const accountStatus =
    selectedCustomerAccount?.account_status ||
    selectedCustomerAccount?.status ||
    "Active";

  const { ledgerRows, openingBalance } = await loadCustomerCreditSnapshot(
    selectedCustomerAccount
  );
  const creditSummary = calculateCustomerCredit(
    selectedCustomerAccount,
    ledgerRows,
    openingBalance
  );
  const creditLimit = creditSummary.creditLimit;
  const outstandingBalance = creditSummary.outstanding;

  const orderTotal = Number(finalTotal || 0);
  const projectedBalance = outstandingBalance + orderTotal;

  if (accountStatus === "On Hold") {
    alert("Customer account is On Hold. Order cannot be submitted.");
    return;
  }

  if (accountStatus === "Stopped") {
    alert("Customer account is Stopped. Please contact Accounts.");
    return;
  }

  if (creditLimit > 0 && projectedBalance > creditLimit) {
    alert(
      `Credit limit exceeded.\n\n` +
        `Credit Limit: ${formatCurrency(creditLimit)}\n` +
        `Outstanding Balance: ${formatCurrency(outstandingBalance)}\n` +
        `Current Order: ${formatCurrency(orderTotal)}\n` +
        `Projected Balance: ${formatCurrency(projectedBalance)}`
    );
    return;
  }

  setIsSubmittingOrder(true);

  try {

    const { orderNumber } = await createCustomerOrder({
  companyName: selectedCustomerAccount.account_name,
  priceMode,
  cart: paidCartForOrder,
  total: finalTotal,

discount_percent: Number(orderDiscountPercent || 0),
discount_amount: Number(discountAmount || 0),

discount_applied_by: userProfile?.id || "",
discount_applied_by_name:
  userProfile?.full_name || userProfile?.name || "",

  customer_account_id: selectedCustomerAccount.id,
  customer_branch_id: selectedBranch?.id || null,
  delivery_branch_name: selectedBranch?.branch_name || "",
  delivery_address: selectedBranch?.delivery_address || "",
  delivery_postcode: selectedBranch?.postcode || "",
  customer_country: orderCountry,
  credit_limit: creditLimit,
});

const newOrder = {
    orderId: orderNumber,
    customerName: selectedCustomerAccount.account_name,
    companyName: selectedCustomerAccount.account_name,

    branchName: selectedBranch?.branch_name || "",

   deliveryAddress: selectedBranch?.delivery_address || "",
   priceMode,
   total: finalTotal,
   discount_percent: Number(orderDiscountPercent || 0),
    discount_amount: Number(discountAmount || 0),
   discount_applied_by_name:
    userProfile?.full_name || userProfile?.name || "",
   createdAt: new Date().toLocaleString(),
   status: "Received",
   items: paidCartForOrder,
    };

    setOrders((oldOrders) => [newOrder, ...oldOrders]);

    localStorage.removeItem(CART_KEY);

    setCart([]);
    setOrderDiscountPercent(0);

    if (!isCustomer) {
      setSelectedCustomerId("");
      setSelectedCustomerAccount(null);
      setSelectedBranchId("");
      setSelectedBranch(null);
      setCompanyName("");
    }

    await fetchProducts();

    alert(
  `âœ… Order Submitted Successfully

Order Number: ${orderNumber}

Thank you for your order.

Your order has been received and is being processed by FairChoice.

Please quote your Order Number if you need assistance.`

);
  } catch (error) {
    console.error("Order submit error:", error);
    alert("Order failed. Check Supabase table permissions/RLS policies.");
  } finally {
    setIsSubmittingOrder(false);
  }
};

const recalculateOrder = (order, updatedItems) => {
  const totals = calculateOrderTotals(updatedItems, {
    priceMode: order.priceMode || order.price_mode,
  });

  const discountPercent = Number(order.discount_percent || 0);
  const discountAmount = totals.totalAmount * (discountPercent / 100);
  const finalTotal = Math.max(0, totals.totalAmount - discountAmount);

  return {
    ...order,
    items: updatedItems,
    total: finalTotal,
    finalTotal,
    discount_amount: discountAmount,
  };
};

const updateOrderItem = async (orderId, itemId, updates) => {
  setOrders((oldOrders) =>
    oldOrders.map((order) => {
      if (order.orderId !== orderId) return order;

      const updatedItems = order.items.map((item) => {
        const itemKey = item.dbId || item.id || item.productId || item.product_id;

        if (String(itemKey) !== String(itemId)) return item;

        return {
          ...item,
          ...updates,
        };
      });

      return recalculateOrder(order, updatedItems);
    })
  );

  const dbUpdates = {};

  if (updates.qty !== undefined) dbUpdates.qty = updates.qty;
  if (updates.pickedQty !== undefined) dbUpdates.picked_qty = updates.pickedQty;
  if (updates.sourceStatus !== undefined) dbUpdates.source_status = updates.sourceStatus;
  if (updates.includeInPicking !== undefined)
    dbUpdates.include_in_picking = updates.includeInPicking;

  const { error } = await supabase
    .from("order_items")
    .update(dbUpdates)
    .eq("id", itemId);

 if (error) {
  console.error("Customer ledger loading error:", error);

  alert(
    `Could not load payment history.\n\n${error.message}\n\n${error.details || ""}`
  );

  return;
}


};
const addOrderItem = async (orderId, newItem) => {
  const order = orders.find((o) => o.orderId === orderId);

  if (!order?.dbId) {
    alert("Order database ID not found.");
    return;
  }

  const qty = Number(newItem.qty || 1);
  const price = Number(newItem.price || 0);

  const { error } = await supabase
    .from("order_items")
    .insert({
      order_id: order.dbId,
      product_id: newItem.productId,
      product_name: newItem.name,
      brand: newItem.brand || "",
      series: newItem.series || "",
      flavour: newItem.flavour || "",
      carton_size: newItem.cartonSize || "",
      qty,
      picked_qty: qty,
      price,
      line_total: price * qty,
      source_status: "In Stock",
      include_in_picking: true,
    });

  if (error) {
    console.error("Add item error:", error);
    alert(error.message);
    return;
  }

  await fetchOrders();
};

  const saveProduct = async () => {
    if (!supabase) {
      alert("Supabase is not configured.");
      return;
    }

    if (!productForm.name || !productForm.category || !productForm.vatPrice) {
      alert("Please fill product name, category, and VAT price.");
      return;
    }

    const defaultAccounts = await getDefaultProductAccounts(productForm.category);
    const productFormForSave = {
      ...productForm,
      ...getProductLabelFormFlags(getProductLabelValue(productForm)),
    };

    const payload = {
      product_code: productFormForSave.productCode,
      product_name: productFormForSave.name,
      main_category: productFormForSave.category,
      sub_category: productFormForSave.subCategory,
      brand: productFormForSave.brand,
      series: productFormForSave.series,
      flavour: productFormForSave.flavour,
      cash_price: Number(productFormForSave.cashPrice || 0),
      vat_price: Number(productFormForSave.vatPrice || 0),
      wales_special_price: Number(productFormForSave.walesSpecialPrice || 0),
      england_special_price: Number(productFormForSave.englandSpecialPrice || 0),
      cost_price: Number(productFormForSave.costPrice || 0),
      supplier_name: productFormForSave.supplierName || "",
      sales_account: productFormForSave.salesAccount || defaultAccounts.salesAccount || "",
      purchase_account: productFormForSave.purchaseAccount || defaultAccounts.purchaseAccount || "",
      carton_size: productFormForSave.cartonSize,
      image_url:
        productFormForSave.image || "https://placehold.co/400x300?text=Product",
      stock: Number(productFormForSave.stock || 0),
      low_stock_alert: Number(productFormForSave.lowStockAlert || 10),
      status: productFormForSave.active === false ? "Inactive" : "Active",
      available_in_england: productFormForSave.availableInEngland,
      available_in_wales: productFormForSave.availableInWales,
      vat_type: productFormForSave.vatType,
      available_from_supplier: productFormForSave.availableFromSupplier !== false,
      is_new: productFormForSave.isNew === true,
      is_promotion: productFormForSave.isPromotion === true,
      is_reduced: productFormForSave.isReduced === true,
      coming_soon: productFormForSave.comingSoon === true,
      recommended: productFormForSave.recommended === true,
      top_seller: productFormForSave.topSeller === true,
      
           
    };

    const response = editingId
      ? await supabase
          .from("products")
          .update(payload)
          .eq("id", editingId)
          .select()
          .single()
      : await supabase.from("products").insert(payload).select().single();

    if (response.error) {
      console.error("Product save error:", response.error);
      alert("Product save failed.");
      return;
    }

    try {
      await saveProductLocationStock(
        response.data?.id || editingId,
        productFormForSave.locationStocks || {}
      );
    } catch (stockError) {
      console.error("Location stock save error:", stockError);
      alert(
        `Product was saved, but location stock could not be saved.\n\n${stockError.message}`
      );
      return;
    }

    setEditingId(null);
    setProductForm({
      productCode: "",
      name: "",
      category: "",
      subCategory: "",
      brand: "",
      series: "",
      flavour: "",
      cashPrice: "",
      vatPrice: "",
      walesSpecialPrice: "",
      englandSpecialPrice: "",
      cartonSize: "",
      image: "",
      stock: "",
      lowStockAlert: "10",
      availableInEngland: true,
      availableInWales: true,
      vatType: "20",
      availableFromSupplier: true,
      costPrice: "",
      supplierName: "",
      salesAccount: "",
      purchaseAccount: "",
      locationStocks: {},
      isNew: false,
      isPromotion: false,
      isReduced: false,
      comingSoon: false,
      recommended: false,
      topSeller: false,
      active: true,
    });

    await fetchProducts();
    alert("Product saved.");
  };

  const editProduct = (product) => {
    setEditingId(product.id);
    const productLabelFormFlags = getProductLabelFormFlags(
      getProductLabelValue(product)
    );

    setProductForm({
      productCode: product.productCode || "",
      name: product.name || "",
      category: product.category || "",
      subCategory: product.subCategory || "",
      brand: product.brand || "",
      series: product.series || "",
      flavour: product.flavour || "",
      cashPrice: product.cashPrice || "",
      vatPrice: product.vatPrice || "",
      walesSpecialPrice: product.walesSpecialPrice || "",
      englandSpecialPrice: product.englandSpecialPrice || "",
      cartonSize: product.cartonSize || "",
      image: product.image || "",
      stock: product.stock || "",
      lowStockAlert: product.lowStockAlert || "",
      availableInEngland: product.availableInEngland === true,
      availableInWales: product.availableInWales === true,
      vatType: product.vatType || "20",
      availableFromSupplier: product.availableFromSupplier !== false,
      costPrice: product.costPrice || "",
      supplierName: product.supplierName || "",
      salesAccount: product.salesAccount || "",
      purchaseAccount: product.purchaseAccount || "",
      locationStocks: product.locationStocks || {},
      isNew: productLabelFormFlags.isNew === true,
      isPromotion: productLabelFormFlags.isPromotion === true,
      isReduced: productLabelFormFlags.isReduced === true,
      comingSoon: productLabelFormFlags.comingSoon === true,
      recommended: productLabelFormFlags.recommended === true,
      topSeller: productLabelFormFlags.topSeller === true,
      active: product.active !== false,
    });

    setPage("products");
  };

  const printPickingList = (order) => {
    const totals = calculateOrderTotals(order.items || [], {
      priceMode: order.priceMode || order.price_mode,
    });
    const printableItems = totals.invoiceItems;

    const rows = printableItems
      .map(
        (item) => `
          <tr>
            <td>
              ${item.name}<br/>
              <small>${item.cartonSize || ""}</small><br/>
              <small>${item.sourceStatus || "In Stock"}</small>
            </td>
            <td style="text-align:right;font-size:18px;font-weight:bold;">
              ${getOrderItemQty(item)}
            </td>
          </tr>
        `
      )
      .join("");

    const html = `
      <html>
        <head>
          <title>Picking List</title>
          <style>
            body { font-family: Arial, sans-serif; width: 72mm; margin: 0; padding: 8px; font-size: 12px; }
            h2 { text-align: center; margin: 0 0 8px; font-size: 18px; }
            .line { border-top: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { padding: 6px 0; border-bottom: 1px dashed #ccc; vertical-align: top; }
            @media print { @page { size: 80mm auto; margin: 3mm; } }
          </style>
        </head>
        <body>
          <h2>PICKING LIST</h2>
          <div class="line"></div>
          <div><b>Order:</b> ${order.orderId}</div>
          <div><b>Date:</b> ${order.createdAt}</div>
          <div><b>Company:</b> ${order.companyName || "-"}</div>
          <div><b>Price:</b> ${String(order.priceMode).toUpperCase()}</div>
          <div class="line"></div>
          <table>${rows}</table>
          <div class="line"></div>
          <div><b>Total Items:</b> ${totals.totalQty}</div>
          <br />
          <div>Picker: __________________</div>
          <br />
          <div>Checked: _________________</div>
          <script>window.print();</script>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=360,height=700");

    if (!win) {
      alert("Popup blocked. Please allow popups to print the picking list.");
      return;
    }

    win.document.write(html);
    win.document.close();
  };

  const escapeDocumentText = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const formatOrderDocumentDate = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("en-GB");
  };

  const getOrderDocumentTitle = (documentType) => {
    if (documentType === "deliveryNote") return "Delivery Note";
    if (documentType === "orderForm") return "Order Form";
    return "Sales Invoice";
  };

  const openCustomerOrderDocument = (order, documentType) => {
    const priceMode = order.priceMode || order.price_mode || "";
    const totals = calculateOrderTotals(order.items || [], { priceMode });
    const title = getOrderDocumentTitle(documentType);
    const showPrices = documentType !== "deliveryNote";
    const orderNumber = order.orderId || order.order_number || order.id || "-";
    const branchName = order.branchName || order.branch_name || "";
    const customerName = order.companyName || order.customerName || "-";
    const address = order.deliveryAddress || order.delivery_address || "";

    const rows = totals.invoiceItems
      .map((item) => {
        const qty = getOrderItemQty(item);
        const unitPrice = getOrderItemUnitPrice(item);
        const netTotal = getOrderItemNetTotal(item);
        const vatTotal = getOrderItemVatTotal(item);
        const vatRate = Number(item.vatRate ?? item.vat_percent ?? item.vatPercent ?? 20);

        return `
          <tr>
            <td>${escapeDocumentText(item.productCode || item.product_code || "")}</td>
            <td>${escapeDocumentText(item.name || item.productName || item.product_name || "")}</td>
            <td class="right">${qty}</td>
            ${
              showPrices
                ? `
                  <td class="right">${formatCurrency(unitPrice)}</td>
                  <td class="right">${vatRate.toFixed(2)}</td>
                  <td class="right">${formatCurrency(netTotal)}</td>
                  <td class="right">${formatCurrency(vatTotal)}</td>
                `
                : ""
            }
          </tr>
        `;
      })
      .join("");

    const html = `
      <html>
        <head>
          <title>${escapeDocumentText(title)} ${escapeDocumentText(orderNumber)}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 28px; color: #111827; }
            h1 { margin: 0 0 8px; text-transform: uppercase; }
            .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 18px 0; }
            .box { border: 1px solid #111827; padding: 10px; min-height: 72px; }
            table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 12px; }
            th { background: #e5edf8; text-align: left; }
            th, td { border-bottom: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
            .right { text-align: right; }
            .totals { margin-left: auto; margin-top: 18px; width: 280px; border: 1px solid #111827; }
            .totals div { display: flex; justify-content: space-between; padding: 7px 9px; border-bottom: 1px solid #111827; }
            .totals div:last-child { border-bottom: 0; font-weight: 800; }
            .muted { color: #4b5563; font-size: 12px; }
            @media print { body { padding: 18px; } }
          </style>
        </head>
        <body>
          <h1>${escapeDocumentText(title)}</h1>
          <div class="muted">Fair Choice Cash and Carry Ltd</div>

          <div class="meta">
            <div class="box">
              <b>${escapeDocumentText(documentType === "deliveryNote" ? "Deliver To" : "Customer")}</b><br />
              ${escapeDocumentText(customerName)}<br />
              ${branchName ? `${escapeDocumentText(branchName)}<br />` : ""}
              ${escapeDocumentText(address)}
            </div>
            <div class="box">
              <b>Order Number:</b> ${escapeDocumentText(orderNumber)}<br />
              <b>Date:</b> ${escapeDocumentText(formatOrderDocumentDate(order.createdAt || order.created_at))}<br />
              <b>Price Mode:</b> ${escapeDocumentText(String(priceMode || "-").toUpperCase())}<br />
              <b>Total Qty:</b> ${totals.totalQty}
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th class="right">Qty</th>
                ${
                  showPrices
                    ? `
                      <th class="right">Price</th>
                      <th class="right">VAT %</th>
                      <th class="right">Net</th>
                      <th class="right">VAT</th>
                    `
                    : ""
                }
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="${showPrices ? 7 : 3}">No supplied items.</td></tr>`}
            </tbody>
          </table>

          ${
            showPrices
              ? `
                <div class="totals">
                  <div><span>Total Net</span><strong>${formatCurrency(totals.netTotal)}</strong></div>
                  <div><span>Total VAT</span><strong>${formatCurrency(totals.vatTotal)}</strong></div>
                  <div><span>Total</span><strong>${formatCurrency(totals.totalAmount)}</strong></div>
                </div>
              `
              : `
                <div class="totals">
                  <div><span>Total Lines</span><strong>${totals.totalLines}</strong></div>
                  <div><span>Total Qty</span><strong>${totals.totalQty}</strong></div>
                </div>
              `
          }

          <script>window.print();</script>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      alert("Popup blocked. Please allow popups to download the document.");
      return;
    }

    win.document.write(html);
    win.document.close();
  };

  const comingSoonTitle = getComingSoonTitle(page);

const backOfficeContent = comingSoonTitle ? (
  <ComingSoonPlaceholder title={comingSoonTitle} />
) : (
  <>
    {page === "orders" && (
      <AdminOrders
        orders={orders}
        products={products}
        expandedOrders={expandedOrders}
        toggleOrderExpanded={toggleOrderExpanded}
        printPickingList={printPickingList}
        updateOrderItem={updateOrderItem}
        addOrderItem={addOrderItem}
        changeOrderStatus={changeOrderStatus}
        fetchOrders={fetchOrders}
      />
    )}

    {page === "warehouse" && (
      <Warehouse
        orders={orders}
        printPickingList={printPickingList}
        changeOrderStatus={changeOrderStatus}
        updateOrderItem={updateOrderItem}
        updateOrderExtraFields={updateOrderExtraFields}
      />
    )}

    {page === "driver" && (
      <Driver
        orders={orders}
        changeOrderStatus={changeOrderStatus}
        updateOrderExtraFields={updateOrderExtraFields}
        refreshOrders={fetchOrders}
      />
    )}

    {page === "customers" && <Customers />}

    {page === "products" && (
      <AdminProducts
        products={products}
        productForm={productForm}
        setProductForm={setProductForm}
        editingId={editingId}
        saveProduct={saveProduct}
        fetchProducts={fetchProducts}
        editProduct={editProduct}
      />
    )}

    {page === "credit" && <CustomerCredit />}
    {page === "weeklyAccount" && <WeeklyAccount />}
    {page === "stockhistory" && <StockHistory />}

    {page === "stockreceipts" && (
      <StockReceipts products={products} fetchProducts={fetchProducts} />
    )}

    {page === "staff" && <Staff />}
    {page === "loginSetup" && <LoginConfig />}
    {page === "suppliers" && <Suppliers />}
    {page === "pricing" && <Pricing />}
    {page === "categories" && <Categories />}
    {page === "productImportExport" && (
      <ProductImportExport
        products={products}
        fetchProducts={fetchProducts}
      />
    )}
    {page === "promotions" && (
      <ProductPromotions
        products={products}
        fetchProducts={fetchProducts}
      />
    )}
  </>
);

  return (
    <div className="customer-portal-shell min-h-screen bg-slate-100 p-4 pb-40">
      <div className="customer-portal-container max-w-7xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden">
        
        <div className="portal-header customer-header bg-gradient-to-r from-blue-950 to-blue-700 text-white px-6 py-5">
  <div className="portal-header-inner flex items-start justify-between w-full gap-4">
    <div className="portal-brand-block flex items-start gap-3">
      <img
        src={fairchoiceLogo}
        alt="FairChoice Cash and Carry"
        className="portal-logo"
      />
      <div className="portal-title-block">
      <h1 className="portal-title text-3xl font-bold">
        FairChoice Order Portal
      </h1>

      <p className="portal-subtitle text-blue-100 text-sm">
        {isAdmin
          ? "Backoffice product and order management"
          : isSalesRep
          ? "Sales Rep Order Form"
          : "Customer order form"}
      </p>
      </div>
    </div>

    <div className="portal-actions flex flex-col items-end gap-2">
      <button
        onClick={() => {
          if (window.confirm("Log out now?")) {
            localStorage.removeItem("fairchoice_user");
            localStorage.removeItem("fairchoice_last_active");
            window.location.reload();
          }
        }}
        className="logout-btn border border-white/30 px-3 py-1 rounded-lg text-xs font-medium hover:bg-white/10 transition whitespace-nowrap"
      >
        Logout
      </button>

      {isCustomer && (
        <div className="customer-nav-buttons flex gap-2">
          <button
            onClick={() => setPage("order")}
            className={`order-tab-btn btn-secondary bg-white text-blue-800 px-3 py-1 rounded-lg text-xs font-bold ${page === "order" ? "active" : ""}`}
          >
            Order
          </button>

          <button
            onClick={async () => {
              await fetchCustomerLedger();
              setPage("paymentHistory");
            }}
            className={`payment-history-tab-btn btn-primary bg-white/10 border border-white/30 text-white px-3 py-1 rounded-lg text-xs font-bold ${page === "paymentHistory" ? "active" : ""}`}
          >
            Payment History
          </button>
        </div>
      )}

      {isAdmin && page === "order" && (
        <button
          type="button"
          onClick={async () => {
            setPage("orders");
            await fetchOrders();
          }}
          className="back-office-btn mb-4 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-800"
        >
          Back Office
        </button>
      )}

      {isSalesRep && (
        <div className="customer-nav-buttons flex gap-2">
          <button
            onClick={() => setPage("order")}
            className={`order-tab-btn btn-secondary bg-white text-blue-800 px-3 py-1 rounded-lg text-xs font-bold ${page === "order" ? "active" : ""}`}
          >
            Order
          </button>

          <button
            onClick={() => setPage("salesCashCollection")}
            className={`payment-history-tab-btn btn-primary bg-white/10 border border-white/30 text-white px-3 py-1 rounded-lg text-xs font-bold ${page === "salesCashCollection" ? "active" : ""}`}
          >
            Cash Collection
          </button>
        </div>
      )}
    </div>
  </div>

{(isAdmin || isWarehouse || isDriver) && page !== "order" && (
<BackOfficeLayout
  page={page}
  setPage={setPage}
  fetchOrders={fetchOrders}
  isAdmin={isAdmin}
  isSalesRep={isSalesRep}
  isWarehouse={isWarehouse}
  isDriver={isDriver}
  isCustomer={isCustomer}
>
  {backOfficeContent}
</BackOfficeLayout>
)}

</div>

        {(isAdmin || isSalesRep || isCustomer) && page === "order" && (
          <div className="customer-order-page p-3 md:p-4 pb-32 md:pb-40 grid grid-cols-1 lg:grid-cols-4 gap-3 md:gap-4">
            
 <div className="lg:col-span-4 bg-slate-50 rounded-2xl p-3 md:p-4">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3 text-sm font-bold">

    {isCustomer && (() => {
  const activeBranches = filteredBranchesForSelectedCustomer;

  if (activeBranches.length <= 1) return null;

  return (
    <div className="mb-3">
      <label className="font-bold text-sm block mb-1">
        Branch
      </label>

      <select
        className="border rounded-xl p-3 w-full"
        value={selectedBranchId}
        onChange={(e) => {
          const branch = activeBranches.find(
            (b) => String(b.id) === String(e.target.value)
          );

          setSelectedBranchId(e.target.value);
          setSelectedBranch(branch || null);
        }}
      >
        <option value="">Select Branch / Shop</option>
        {activeBranches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.branch_name} - {branch.postcode}
          </option>
        ))}
      </select>
    </div>
  );
})()}

    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full text-slate-700">
      <div className="font-semibold">
        Address: {getCustomerAddress(selectedCustomerAccount, selectedBranch)}
      </div>
      <div>{formatCurrency(selectedCustomerAccount?.credit_limit)}
      </div>
      <div>
        Credit Balance {formatCurrency(
          getCreditBalance(selectedCustomerAccount, customerLedger, customerOpeningBalance)
        )}
      </div>
    </div>

          <select
  value={priceMode}
  onChange={(e) => setPriceMode(e.target.value)}
  disabled={
    isCustomer &&
    selectedCustomerAccount &&
    [
      selectedCustomerAccount.allow_vat,
      selectedCustomerAccount.allow_server,
      selectedCustomerAccount.allow_manager,
      selectedCustomerAccount.allow_super,
    ].filter(Boolean).length === 1
  }
  className="border rounded-xl px-3 py-2 font-bold bg-white text-slate-700 disabled:bg-slate-200 disabled:text-slate-500"
>
  {(isAdmin || isSalesRep || selectedCustomerAccount?.allow_vat) && (
    <option value="vat">Ex. VAT</option>
  )}

  {(isAdmin || isSalesRep || selectedCustomerAccount?.allow_server) && (
    <option value="server">Server</option>
  )}

  {(isAdmin || isSalesRep || selectedCustomerAccount?.allow_manager) &&
    pricingSettings?.show_manager_offer && (
      <option value="manager">Manager Offer</option>
    )}

  {(isAdmin || isSalesRep || selectedCustomerAccount?.allow_super) &&
    pricingSettings?.show_super_offer && (
      <option value="super">Admin Offer</option>
    )}
</select>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
   {!isCustomer && (
  <div>
    <label className="font-bold text-sm block mb-1">
      Customer Details
    </label>

    <select
      className="border rounded-xl p-3 w-full"
      value={selectedCustomerId}
      onChange={(e) => {
        const customerId = e.target.value;

        const customer = customerAccounts.find(
          (c) => String(c.id) === String(customerId)
        );

        setSelectedCustomerId(customerId);
        setSelectedCustomerAccount(customer || null);
        setSelectedBranchId("");
        setSelectedBranch(null);

        if (customer) {
          setCompanyName(customer.account_name);

          const allowedModes = [];

          if (isAdmin || isSalesRep || customer.allow_vat) allowedModes.push("vat");
          if (isAdmin || isSalesRep || customer.allow_server) allowedModes.push("server");
          if (isAdmin || isSalesRep || customer.allow_manager) allowedModes.push("manager");
          if (isAdmin || isSalesRep || customer.allow_super) allowedModes.push("super");

          const defaultMode = String(
            customer.default_price_mode || "vat"
          ).toLowerCase();

          setPriceMode(
            allowedModes.includes(defaultMode)
              ? defaultMode
              : allowedModes[0] || "vat"
          );
        } else {
          setCompanyName("");
          setPriceMode("vat");
        }
      }}
    >
      <option value="">Select Customer</option>

      {filteredCustomersForSalesRep.map((customer) => (
        <option key={customer.id} value={customer.id}>
          {customer.account_name}
        </option>
      ))}
    </select>
  </div>
    )}

    {(() => {
   const activeBranches = filteredBranchesForSelectedCustomer;

   if (isCustomer && activeBranches.length <= 1) return null;
   return (
    <div>
      <label className="font-bold text-sm block mb-1">
        Branch Details
      </label>
      <select
        className="border rounded-xl p-3 w-full"
        value={selectedBranchId}
        disabled={!selectedCustomerAccount}
        onChange={(e) => {
          const branchId = e.target.value;

          const branch = activeBranches.find(
            (b) => String(b.id) === String(branchId)
          );

          setSelectedBranchId(branchId);
          setSelectedBranch(branch || null);
        }}
      >
        <option value="">Select Branch / Shop</option>

        {activeBranches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.branch_name} - {branch.postcode}
          </option>          
        ))}
      </select>      
    </div>
    
  );
})()}

{(isAdmin || isSalesRep) && (
  <div>
    <label className="font-bold text-sm block mb-1">
      Country
    </label>

    <select
      value={manualCountry}
      onChange={(e) => setManualCountry(e.target.value)}
      className="border rounded-xl p-3 w-full font-bold"
    >
      <option value="Wales">Wales</option>
      <option value="England">England</option>
    </select>
  </div>
)}
      
  </div>

<ProductFilters
  search={search}
  setSearch={setSearch}
  categories={categories}
  selectedCategory={selectedCategory}
  brands={brands}
  selectedBrand={selectedBrand}
  seriesList={seriesList}
  selectedSeries={selectedSeries}
  subCategories={subCategories}
  selectedSubCategory={selectedSubCategory}
  setSelectedCategory={(value) => {
    setSelectedCategory(value);
    setSelectedSubCategory("All Sub Categories");
    setSelectedBrand("All Brands");
    setSelectedSeries("All Series");
  }}
  setSelectedSubCategory={(value) => {
    setSelectedSubCategory(value);
    setSelectedBrand("All Brands");
    setSelectedSeries("All Series");
  }}
  setSelectedBrand={(value) => {
    setSelectedBrand(value);
    setSelectedSeries("All Series");
  }}
  setSelectedSeries={setSelectedSeries}
/>

  <div className="mt-3 flex justify-end gap-2">
    {["grid", "list"].map((view) => (
      <button
        key={view}
        type="button"
        onClick={() => setProductView(view)}
        className={
          productView === view
            ? "rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white"
            : "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700"
        }
      >
        {view === "grid" ? "Grid View" : "List View"}
      </button>
    ))}
  </div>

</div>

            <div className="lg:col-span-3">
              {productsLoading && products.length === 0 && (
                <div className="bg-slate-50 border rounded-3xl p-5 mb-4">
                  Loading products from Supabase...
                </div>
              )}

              {productError && (
                <div className="bg-slate-50 border rounded-3xl p-5 mb-4 text-red-600 font-bold">
                  {productError}
                </div>
              )}

              {!productsLoading &&
                !productError &&
                filteredProducts.length === 0 && (
                  <div className="bg-slate-50 border rounded-3xl p-5 mb-4">
                    No products found for {orderCountry}.
                  </div>
                )}

              {productView === "grid" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
                  {visibleProducts.map((product) => (
                    (() => {
                      const activePromotionPriceRule =
                        getActivePromotionPriceRule(product);

                      return (
                    <ProductCard
                      key={product.id}
                      product={{
                        ...product,
                        isPromotion:
                          product.isPromotion ||
                          Boolean(activePromotionPriceRule),
                        promotionName:
                          activePromotionPriceRule?.promotion_name ||
                          product.promotionName,
                      }}
                      addToCart={addToCart}
                      onImageClick={setSelectedImage}
                      price={getPrice(product)}
                      cartQty={
                        cart.find((item) => item.id === product.id)?.qty || 0
                      }
                      onAdd={addToCart}
                    />
                      );
                    })()
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleProducts.map((product) => (
                    (() => {
                      const activePromotionPriceRule =
                        getActivePromotionPriceRule(product);

                      return (
                    <ProductListRow
                      key={product.id}
                      product={{
                        ...product,
                        isPromotion:
                          product.isPromotion ||
                          Boolean(activePromotionPriceRule),
                        promotionName:
                          activePromotionPriceRule?.promotion_name ||
                          product.promotionName,
                      }}
                      addToCart={addToCart}
                      onImageClick={setSelectedImage}
                      price={getPrice(product)}
                      cartQty={
                        cart.find((item) => item.id === product.id)?.qty || 0
                      }
                      onAdd={addToCart}
                    />
                      );
                    })()
                  ))}
                </div>
              )}
            </div>

           <Cart
            cart={cart}
            total={finalTotal}
            originalTotal={total}
            orderDiscountPercent={orderDiscountPercent}
            setOrderDiscountPercent={setOrderDiscountPercent}
            discountAmount={discountAmount}
            promotionDiscountAmount={promotionDiscountAmount}
            canDiscount={isAdmin || isSalesRep}
            priceMode={priceMode}
            onSubmit={submitOrder}
            isSubmitting={isSubmittingOrder}
            onIncrease={increaseQty}
            onDecrease={decreaseQty}
            onRemove={removeItem}
            onChangeQty={changeQty}
            submitOrder={submitOrder}
          />
          </div>
        )}

       
          {isCustomer && page === "paymentHistory" && (
  <div className="customer-payment-history p-4">
    <div className="payment-history-card bg-white rounded-2xl shadow-sm border p-4">

      <div className="payment-history-summary flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">
          Customer Credit Account
        </h2>

        <div className="payment-history-outstanding border rounded-xl px-4 py-2 text-right">
          <div className="text-xs text-slate-500 font-bold">
            Total Outstanding
          </div>
          <div className="text-2xl font-bold text-red-600">{formatCurrency(
              calculateCustomerCredit(
                selectedCustomerAccount,
                customerLedger,
                customerOpeningBalance
              ).outstanding
            )}
          </div>
        </div>
      </div>

      <h3 className="font-bold text-lg mb-3">
        Statement: {selectedCustomerAccount?.account_name || companyName}
      </h3>

      {selectedCustomerBranches.length > 0 && (
        <div className="mb-4 space-y-3">
          <select
            value={paymentHistoryBranchId}
            onChange={(e) => setPaymentHistoryBranchId(e.target.value)}
            className="w-full border rounded-xl p-3 text-sm"
          >
            <option value="">All Branches</option>
            {selectedCustomerBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name}
                {branch.postcode ? ` - ${branch.postcode}` : ""}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {branchOutstandingRows.map((branch) => (
              <div key={branch.id} className="border rounded-xl p-3 bg-slate-50">
                <div className="text-xs font-bold text-slate-500">
                  {branch.branchName}
                </div>
                <div className="text-lg font-extrabold text-slate-900">
                  {formatCurrency(branch.outstanding)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {completedCustomerOrders.length > 0 && (
        <div className="mb-4 border rounded-2xl p-3 bg-slate-50">
          <h3 className="font-bold text-base mb-3">Delivered Orders</h3>

          <div className="space-y-2">
            {completedCustomerOrders.map((order) => {
              const orderTotals = calculateOrderTotals(order.items || [], {
                priceMode: order.priceMode || order.price_mode,
              });

              return (
                <div
                  key={order.dbId || order.orderId}
                  className="border rounded-xl bg-white p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div>
                    <div className="font-bold">
                      {order.orderId || "-"}
                      {order.branchName ? ` | ${order.branchName}` : ""}
                    </div>
                    <div className="text-xs text-slate-500">
                      {order.createdAt || "-"} | {String(order.priceMode || "-").toUpperCase()} |{" "}
                      {formatCurrency(orderTotals.totalAmount)} | Total Qty: {orderTotals.totalQty}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openCustomerOrderDocument(order, "invoice")}
                      className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                    >
                      Download Invoice
                    </button>
                    <button
                      type="button"
                      onClick={() => openCustomerOrderDocument(order, "orderForm")}
                      className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-bold"
                    >
                      Download Order Form
                    </button>
                    <button
                      type="button"
                      onClick={() => openCustomerOrderDocument(order, "deliveryNote")}
                      className="bg-emerald-700 text-white px-3 py-2 rounded-lg text-xs font-bold"
                    >
                      Download Delivery Note
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="customer-ledger-table-wrap overflow-x-auto border rounded-2xl">
        <table className="customer-ledger-table w-full text-sm">
          <thead className="bg-slate-100">
            <tr className="border-b">
              <th className="text-left p-3">Date</th>
              <th className="text-left p-3">Transaction</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Amount</th>
              <th className="text-right p-3">Balance</th>
              <th className="text-center p-3">Action</th>
            </tr>
          </thead>

          <tbody>
            {filteredCustomerLedger.map((row) => {
              const type = String(
                row.entry_type || row.transaction_type || ""
              ).toUpperCase();

              const isInvoice = type === "INVOICE";
              const isPayment = type === "PAYMENT";

              const amount = Number(
                row.amount ||
                row.invoice_amount ||
                row.payment_amount ||
                row.debit ||
                row.credit ||
                0
              );

              const status = String(
                row.invoice_status || row.status || ""
              ).toUpperCase();

              const priceMode = String(
                row.price_mode || row.order_price_mode || ""
              ).toLowerCase();

              const canDownloadInvoice =
                isInvoice &&
                priceMode === "vat" &&
                ["UNPAID", "PART PAID", "PART_PAID", "FULL PAID", "FULL_PAID"].includes(status);

              return (
                <tr key={row.id} className="border-b">
                  <td className="p-3">
                    {new Date(row.created_at).toLocaleDateString("en-GB")}
                  </td>

                  <td className="p-3 font-bold">
                    {isInvoice ? "Invoice" : "Payment"}

                    {row.branch_name && (
                      <div className="text-xs text-slate-500 font-normal mt-1">
                        Branch: {row.branch_name}
                      </div>
                    )}

                    {isPayment && (
                      <div className="text-xs text-slate-500 font-normal mt-1">
                        Type: {row.payment_type || "-"}<br />
                        Who Paid: {row.paid_by || "-"}<br />
                        Applies To: Invoice
                      </div>
                    )}
                  </td>

                  <td className="p-3">
                    {isInvoice ? (
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs font-bold">
                        {status || "UNPAID"}
                      </span>
                    ) : (
                      <span className="font-bold">
                        Payment Received
                      </span>
                    )}
                  </td>

                  <td
                    className={`p-3 text-right font-bold ${
                      isPayment ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {isPayment ? "-" : ""}{formatCurrency(amount)}
                  </td>

                  <td className="p-3 text-right font-bold">{formatCurrency(row.balance)}
                  </td>

                  <td className="p-3 text-center">
                    {canDownloadInvoice ? (
                      <button
                        onClick={() => {
                          alert("Connect this to existing CustomerCredit Download Invoice function.");
                        }}
                        className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                      >
                        Download Invoice
                      </button>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

    </div>
  </div>
)}
       {isSalesRep && page === "salesCashCollection" && (
  <div className="p-4">
    <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3">
      <h2 className="text-xl font-bold">
        Sales Rep Cash Collection
      </h2>

      <select
        value={salesPaymentForm.customerId}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            customerId: e.target.value,
            branchId: "",
          })
        }
        className="w-full border rounded-xl p-3"
      >
        <option value="">Select Customer</option>

        {customerAccounts.map((customer) => (
          <option
            key={customer.id}
            value={customer.id}
          >
            {customer.account_name}
          </option>
        ))}
      </select>

      {(() => {
        const customer = customerAccounts.find(
          (account) => String(account.id) === String(salesPaymentForm.customerId)
        );
        const branches = (customer?.customer_branches || []).filter(
          (branch) => branch.active !== false
        );

        if (!branches.length) return null;

        return (
          <select
            value={salesPaymentForm.branchId}
            onChange={(e) =>
              setSalesPaymentForm({
                ...salesPaymentForm,
                branchId: e.target.value,
              })
            }
            className="w-full border rounded-xl p-3"
          >
            <option value="">Select Branch / Shop</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.branch_name}
                {branch.postcode ? ` - ${branch.postcode}` : ""}
              </option>
            ))}
          </select>
        );
      })()}

      <input
        type="number"
        placeholder="Amount Collected"
        value={salesPaymentForm.amount}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            amount: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      />

      <select
        value={salesPaymentForm.paymentType}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            paymentType: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      >
        <option value="Cash">Cash</option>
        <option value="Bank Transfer">
          Bank Transfer
        </option>
        <option value="Account">Account</option>
        <option value="Cheque">Cheque</option>
      </select>

      <input
        placeholder="Who Paid / Shop Staff Name"
        value={salesPaymentForm.whoPaid}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            whoPaid: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      />

      <input
        type="date"
        value={salesPaymentForm.collectionDate}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            collectionDate: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      />

      <textarea
        placeholder="Notes"
        value={salesPaymentForm.notes}
        onChange={(e) =>
          setSalesPaymentForm({
            ...salesPaymentForm,
            notes: e.target.value,
          })
        }
        className="w-full border rounded-xl p-3"
      />

      <button
        onClick={saveSalesRepCollection}
        disabled={savingSalesPayment}
        className="w-full bg-green-700 text-white py-3 rounded-xl font-bold"
      >
        {savingSalesPayment
          ? "Saving..."
          : "Save Collection"}
      </button>
    </div>
  </div>
)}      
     
        {selectedImage && (
          <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
            onClick={() => setSelectedImage(null)}
          >
            <div
              className="bg-white rounded-2xl p-4 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={selectedImage.image}
                alt={selectedImage.name}
                className="w-full max-h-[500px] object-contain"
              />

              <h3 className="font-bold text-lg mt-3">
                {selectedImage.name}
              </h3>

              <button
                onClick={() => setSelectedImage(null)}
                className="mt-4 w-full bg-blue-600 text-white py-3 rounded-xl font-bold"
              >
                Close
              </button>
              
            </div>
          </div>
        )}

      {page === "order" && (isAdmin || isSalesRep || isCustomer) && (
  <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t shadow-xl p-3">
    <div className="max-w-7xl mx-auto flex items-center justify-between">
      <div>
        <div className="text-xs text-slate-500">
          {cart.filter((item) => !item.isPromotionFree).reduce((sum, item) => sum + item.qty, 0)} Items
        </div>

        <div className="font-bold text-xl">
            {formatCurrency(finalTotal)}
          </div>

          {cart.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm("Clear all cart items?")) {
                  localStorage.removeItem(CART_KEY);
                  setCart([]);
                }
              }}
              className="text-xs text-red-600 underline mt-1"
            >
              Clear Cart
            </button>
          )}
           </div>

      <button
        onClick={() => {
          document.querySelector(".checkout-section")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }}
        className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-bold"
      >
        Checkout
      </button>
    </div>
  </div>
)}

<button
  onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
  className="fixed bottom-20 right-4 z-50 bg-slate-800 text-white text-sm font-bold px-5 py-3 rounded-full shadow-lg opacity-95 hover:opacity-100"
>
  â†‘ Top
</button>

      </div>
    </div>
  );
}
