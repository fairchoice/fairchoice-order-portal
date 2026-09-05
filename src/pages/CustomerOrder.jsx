import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../services/supabase.js";
import {
  buildLegacyStaffProfile,
  isAdminStaffRole,
  normalizeStaffRole,
  resolveBackOfficeAccess,
} from "../services/authProfile";
import {
  buildPaymentPreview,
  loadCentralPaymentSnapshot,
  loadReadOnlyCustomerCreditSnapshot,
} from "../services/centralPaymentService";
import {
  CANONICAL_PAYMENT_SOURCES,
  createPaymentIntentId,
  postCanonicalCustomerPayment,
} from "../services/canonicalPaymentService";
import PricingRule from "./AdminSetup/PricingRule";
import Suppliers from "./AdminSetup/Suppliers";
import SupplierAccounts from "./AdminSetup/SupplierAccounts";
import Staff from "./AdminSetup/Staff";
import AccessControl from "./AdminSetup/AccessControl";
import StaffLogin from "./AdminSetup/StaffLogin";
import CustomerLogin from "./AdminSetup/CustomerLogin";
import PriceManagement from "./AdminSetup/PriceManagement";

import { formatCurrency } from "../utils/currency";
import { formatDisplayOrderId } from "../utils/orderDisplay";
import {
  buildCustomerPortalHistoryState,
  getCustomerCartStorageKey,
  getCustomerPortalHistoryAction,
  getCustomerPortalHash,
  isCustomerPortalHomeView,
  isCustomerPortalPageAllowed,
  isOrderAuthError,
  resolveCustomerPortalPage,
} from "../utils/customerPortalState";
import { getDisplayProductImage, isPlaceholderProductImage } from "../utils/productImages";
import {
  getCustomerInvoiceWatermark,
  getInvoiceActionForStatus,
  normalizeInvoicePaymentStatus,
} from "../utils/invoicePaymentStatus";
import { sortPrintItems } from "../utils/printItemSorting";
import { FC_PERMISSIONS, hasFcPermission } from "../security/fcPermissions";
import {
  PAGE_BY_ROUTE,
  PAGE_REGISTRY,
  canAccessPage,
  canPerform,
} from "../security/accessControlRegistry";


import BackOfficeLayout, {
  ComingSoonPlaceholder,
} from "./AdminSetup/BackOfficeLayout";
import { getComingSoonTitle } from "./AdminSetup/backOfficePageHelpers";

import Categories from "./AdminSetup/Categories";
import Warehouse from "./Warehouse";
import PreOrderSupply from "./PreOrderSupply";
import Driver from "./AdminSetup/Driver";
import StockReceipts from "./AdminSetup/StockReceipts";
import StockHistory from "./AdminSetup/StockHistory";
import StockTaking from "./AdminSetup/StockTaking";
import CustomerCredit from "./AdminSetup/CustomerCredit";
import CentralPayment from "./AdminSetup/CentralPayment";
import BranchSeparation from "./AdminSetup/BranchSeparation";
import WeeklyAccount from "./AdminSetup/WeeklyAccount";
import Expenses from "./AdminSetup/Expenses";
import InvoicesPortal from "./AdminSetup/InvoicesPortal";
import OrderSalesInvoices from "./AdminSetup/OrderSalesInvoices";
import ReturnsPortal from "./AdminSetup/ReturnsPortal";
import Customers from "./AdminSetup/Customers";
import HomePageImages from "./AdminSetup/HomePageImages";
import PurchasePlanningReport from "./reports/PurchasePlanningReport";
import WarehouseActivityReport from "./reports/WarehouseActivityReport";
import ProfitAnalysisReport from "./reports/ProfitAnalysisReport";
import ProductLineAnalysisReport from "./reports/ProductLineAnalysisReport";
import BrandPerformanceReport from "./reports/BrandPerformanceReport";
import AllCreditOutstanding from "./AdminSetup/AllCreditOutstanding";
import SalesRouteAnalysisReport from "./reports/SalesRouteAnalysisReport";
import SalesRouteSetup from "./AdminSetup/SalesRouteSetup";
import { EXCEPTION_ORDER_REASONS, loadTodaysSalesRoute, NO_ORDER_REASONS, recordSalesRouteVisit } from "../services/salesRouteService";

import ProductCard, { ProductListRow } from "../components/ProductCard";
import ProductFilters from "../components/ProductFilters";
import {
  getCustomerStatusLabel,
  isOperationalCustomer,
} from "../utils/customerStatus";
import HomeCategoryGrid from "../components/HomeCategoryGrid";
import HomepageTargetMessages from "../components/HomepageTargetMessages";
import Cart from "../components/Cart.jsx";
import ReturnRequestModal from "../components/ReturnRequestModal";

import { getProducts, isActiveProduct } from "../services/products";
import { getHomepageItems } from "../services/homepageItems";
import {
  getActiveHomepageMessages,
  getMatchingHomepageMessages,
} from "../services/homepageMessages";
import {
  applyLocationStockToProducts,
  saveProductLocationStock,
} from "../services/locationStock";
import { getActivePromotionRules } from "../services/promotionRules";
import {
  applyCustomerOrderPromotions,
  findActivePromotionPriceRule,
  getActivePromotionPrice,
  getPromotionDiscountAmount,
  productMatchesPromotionPosterSeries,
  resolvePromotionAudienceType,
} from "./CustomerOrderModules/customerOrderPromotions";
import {
  buildCustomerOrderRequest,
  createCustomerOrderWithSessionRetry,
} from "./CustomerOrderModules/customerOrderSubmission";
import {
  addReceivedOrderItemWithPromotions,
  updateReceivedOrderItemWithPromotions,
} from "./CustomerOrderModules/receivedOrderItemChanges";
import {
  calculateCartOrderItems,
  calculateCartTotals,
  calculateOrderTotals,
  getOrderItemProductCode,
  roundMoney,

  getOrderItemQty,
} from "../utils/orderTotals";
import { calculateDocumentTotals } from "../utils/documentTotals";
import {
  getProductPriceForMode,
  getProductPriceDetailsForMode,
  getHomepagePriceForMode,
  getPriceModeLabel,
  getVatRate,
  isVatPriceMode,
} from "../utils/pricing";
import {
  calculateCustomerCredit,
  getLedgerCredit,
  getLedgerDebit,
} from "../utils/customerCredit";

import AdminProducts from "./AdminProducts";
import ProductImportExport from "./AdminSetup/ProductImportExport";
import ProductPromotions from "./AdminSetup/ProductPromotions";
import AdminOrders from "./AdminOrders";
import OrderPicking from "./OrderPicking";
import { claimOrderForPicking } from "../services/picking";
import fairchoiceLogo from "../assets/fairchoice-logo.png";


import { getCustomerAccounts } from "../services/customerManagement";

import {
  createCustomerOrder,
  updateOrderStatus,
  updateOrderFields,
} from "../services/orders";
import {
  clearPendingPreOrderActionsForOrder,
  isActivePreOrderSupplyOrder,
} from "../services/preOrderSupplyAllocation";
import { reversePreOrderSupplyForReceivedOrder } from "../services/preOrderSupplyHistory";
import {
  applyInvoicePaymentAllocations,
  createOrUpdateInvoiceForDeliveredOrder,
  fetchInvoiceOrderFromDb,
  loadProcessingQueueOrders,
  mergeOperationalOrders,
  downloadInvoice as downloadCentralInvoice,
  previewInvoice as previewCentralInvoice,
  withResolvedInvoicePaymentStatus,
} from "../services/centralInvoiceEngine";
import { mergeAuthenticatedProfile } from "../services/fcSession";
import {
  CENTRAL_CART_ENABLED,
  beginCentralCartSubmission,
  cancelCentralCartSubmission,
  finalizeCentralCartSubmission,
  incrementCentralCartItem,
  loadCentralCart,
  removeCentralCartItem,
  setCentralCartItemQuantity,
} from "../services/customerCart";

const LEGACY_CART_KEY = "fairchoice_cart";

async function refreshSupabaseSessionIfNeeded() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) return null;

  const expiresAt = Number(session.expires_at || 0) * 1000;
  if (!expiresAt || expiresAt - Date.now() > 60_000) return session;

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
  return refreshed.data.session;
}

const readCheckoutBankProofDataUrl = (file) =>
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
    productSpecialPrice: Number(
      raw.product_special_price ?? raw.productSpecialPrice ?? raw.cash_price ?? 0
    ),
    product_special_price: Number(
      raw.product_special_price ?? raw.productSpecialPrice ?? raw.cash_price ?? 0
    ),
    walesSpecialPrice: Number(raw.wales_special_price || 0),
    wales_special_price: Number(raw.wales_special_price || 0),
    englandSpecialPrice: Number(raw.england_special_price || 0),
    england_special_price: Number(raw.england_special_price || 0),
    cartonSize: raw.carton_size || "",
    image: getDisplayProductImage(raw),
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

const PRODUCTS_PER_PAGE = 20;


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

const mapDeliveredOrderForCustomerLedger = (order = {}) => ({
  dbId: order.id,
  orderId: order.order_number,
  customerAccountId: order.customer_account_id || "",
  customer_account_id: order.customer_account_id || "",
  customerBranchId: order.customer_branch_id || order.branch_id || "",
  customer_branch_id: order.customer_branch_id || order.branch_id || "",
  customerName: order.company_name,
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
  finalTotal: Number(
    order.final_total ||
      order.finalTotal ||
      order.total_amount ||
      order.order_total ||
      order.total ||
      0
  ),
  vatTotal: Number(order.vat_total || order.total_vat || order.vat || 0),
  createdAt: order.created_at,
  deliveredAt: order.delivered_at || order.updated_at || order.created_at,
  status: order.status,
  items: (order.order_items || []).map((item) => ({
    dbId: item.id,
    id: item.product_id,
    productCode:
      item.product_code ||
      item.productCode ||
      item.sku ||
      item.code ||
      item.products?.product_code ||
      item.products?.code ||
      item.product?.product_code ||
      item.product?.code ||
      "",
    product_code:
      item.product_code ||
      item.productCode ||
      item.sku ||
      item.code ||
      item.products?.product_code ||
      item.products?.code ||
      item.product?.product_code ||
      item.product?.code ||
      "",
    products: item.products || null,
    product: item.product || item.products || null,
    name: item.product_name,
    productName: item.product_name,
    qty: Number(item.qty || item.quantity || 0),
    quantity: Number(item.quantity || item.qty || 0),
    selectedPrice: Number(item.price || item.unit_price || 0),
    price: Number(item.price || item.unit_price || 0),
    unit_price: Number(item.unit_price || item.price || 0),
    lineTotal: Number(item.line_total || item.lineTotal || 0),
    line_total: Number(item.line_total || item.lineTotal || 0),
    net_total: Number(item.net_total || item.netTotal || 0),
    gross_total: Number(item.gross_total || item.grossTotal || 0),
    vatRate: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
    vat_percent: Number(item.vat_percent || item.vatPercent || item.vat_rate || 20),
    vatTotal: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
    vat_total: Number(item.vat_total || item.vatTotal || item.vat_amount || 0),
    sourceStatus: item.source_status || item.status || "In Stock",
    source_status: item.source_status || item.status || "In Stock",
    pickedQty: Number(item.picked_qty || item.qty || item.quantity || 0),
    includeInPicking: item.include_in_picking !== false,
    include_in_picking: item.include_in_picking !== false,
  })),
});

const isDeliveredInvoiceStatus = (status) =>
  ["delivered", "confirmed", "delivery confirmed", "completed"].includes(
    String(status || "").trim().toLowerCase()
  );

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

const isOrderSelectableCustomer = (customer) => {
  return isOperationalCustomer(customer);
};

const customerMatchesSearch = (customer, searchTerm) => {
  const search = String(searchTerm || "").trim().toLowerCase();
  if (!search) return true;

  return [
    customer?.account_name,
    customer?.contact_name,
    customer?.phone,
    customer?.postcode,
    customer?.town_city,
    customer?.city,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(search));
};

const getAllowedPriceModesForCustomer = (customer, pricingSettings = {}) => {
  if (!customer) return ["vat"];

  const modes = [];
  if (customer.allow_vat !== false) modes.push("vat");
  if (customer.allow_server === true) modes.push("server");
  if (customer.allow_manager === true && pricingSettings?.show_manager_offer) {
    modes.push("manager");
  }
  if (customer.allow_super === true && pricingSettings?.show_super_offer) {
    modes.push("super");
  }

  return modes.length ? modes : ["vat"];
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

const loadSalesRepOutstanding = async ({
  customer,
  selectedBranchId = "",
}) => {
  if (!customer) {
    return {
      creditSnapshot: null,
      outstandingState: { totalOutstanding: 0, branchOutstanding: {} },
    };
  }

  const creditSnapshot = await loadCentralPaymentSnapshot({
    customerAccountId: customer.id,
    customerName: customer.account_name,
    customer,
    selectedBranchId,
  });
  const branchOutstanding = Object.fromEntries(
    (creditSnapshot.branchSummaries || []).flatMap((branch) => {
      const entries = [[String(branch.branchId || ""), branch.outstanding]];
      if (branch.branchName) entries.push([branch.branchName, branch.outstanding]);
      return entries;
    })
  );

  return {
    creditSnapshot,
    outstandingState: {
      totalOutstanding: creditSnapshot.customerSummary?.outstanding || 0,
      branchOutstanding,
    },
  };
};

export default function CustomerOrder({ userProfile, onLogout, onProfileRefresh, activeDuty = "" }) {

const loggedInUser =
  JSON.parse(localStorage.getItem("loggedInUser") || "null") ||
  JSON.parse(localStorage.getItem("fairchoice_user") || "null");


  const activeUser = userProfile || loggedInUser || {};
  const role = normalizeStaffRole(activeUser?.role || activeUser?.access_level || "Customer");
  const normalizedRole = String(role || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const isCustomer = normalizedRole === "customer";
  const isBrandPartner = normalizedRole === "brandpartner" || normalizedRole === "partner";
  const activeUsername = String(activeUser?.username || activeUser?.staff_username || activeUser?.email || activeUser?.name || "").trim().toLowerCase();
  const isNisstajAdmin = activeUsername === "nisstaj_admin";
  const dutyRestricted = Boolean(activeDuty) && !isNisstajAdmin && !isCustomer;
  const isAdmin = isNisstajAdmin || (dutyRestricted ? activeDuty === "admin" : isAdminStaffRole(role));
  const isSalesRep = isNisstajAdmin ? canAccessPage(activeUser, "page.order.sales_rep") : (dutyRestricted ? activeDuty === "sales_rep" : canAccessPage(activeUser, "page.order.sales_rep"));
  const isWarehouse = dutyRestricted ? activeDuty === "warehouse" : canAccessPage(activeUser, "page.operations.warehouse");
  const isDriver = dutyRestricted ? activeDuty === "driver" : canAccessPage(activeUser, "page.operations.driver");
  const salesRouteMode = activeDuty === "sales_rep" && !isNisstajAdmin;
  const promotionAudienceType = resolvePromotionAudienceType({
    activeUser,
    normalizedRole,
    isSalesRep,
    salesRouteMode,
  });
  const canCollectCash = isSalesRep && hasFcPermission(activeUser, FC_PERMISSIONS.PAYMENTS_COLLECT_CASH);
  const canManualCheckoutDiscount = canPerform(activeUser, "orders.discount.change");
  const basePermissions = activeUser?.effective_permissions || activeUser?.permissions || {};
  const dutyAllowsPage = (item) => {
    if (!dutyRestricted) return canAccessPage(activeUser, item.key);
    if (activeDuty === "sales_rep") {
      return item.key === "page.order.sales_rep" || item.key === "page.accounts.expenses";
    }
    if (activeDuty === "driver") {
      return item.key === "page.operations.driver" || item.key === "page.accounts.expenses";
    }
    if (activeDuty === "warehouse") {
      return (
        (item.key.startsWith("page.operations.") && item.key !== "page.operations.driver") ||
        item.key === "page.accounts.expenses"
      );
    }
    if (activeDuty === "admin") {
      if (isBrandPartner) {
        return ["page.order.sales_rep", "page.reports.brand_performance"].includes(item.key);
      }
      return item.key !== "page.order.sales_rep" && item.key !== "page.operations.driver" && canAccessPage(activeUser, item.key);
    }
    return false;
  };
  const dutyPermissions = dutyRestricted
    ? Object.fromEntries(PAGE_REGISTRY.map((item) => [item.key, dutyAllowsPage(item)]))
    : {};
  const backOfficeUser = dutyRestricted
    ? { ...activeUser, effective_permissions: { ...basePermissions, ...dutyPermissions, all_access: false } }
    : activeUser;
  const defaultBackOfficePage =
    PAGE_REGISTRY.find((item) => canAccessPage(backOfficeUser, item.key))?.route || "orders";

  

 const portalRoleState = {
   isAdmin,
   isSalesRep,
   isWarehouse,
   isDriver,
   isCustomer,
   canCollectCash,
 };
 const [page, setPage] = useState(() => {
   if (dutyRestricted) {
     if (activeDuty === "sales_rep") return "order";
     if (activeDuty === "warehouse") return "warehouse";
     if (activeDuty === "driver") return "driver";
     if (activeDuty === "admin") return defaultBackOfficePage;
   }
   return resolveCustomerPortalPage({ hash: window.location.hash, ...portalRoleState });
 });
 const [accessControlStaffId, setAccessControlStaffId] = useState("");
 const [pickingOrderId, setPickingOrderId] = useState(null);

  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [salesRouteRows, setSalesRouteRows] = useState([]);
  const [salesRouteLoading, setSalesRouteLoading] = useState(false);
  const [showSalesRouteModal, setShowSalesRouteModal] = useState(false);
  const [activeRouteAssignmentId, setActiveRouteAssignmentId] = useState(null);
  const [salesRouteExceptionMode, setSalesRouteExceptionMode] = useState(false);
  const [showRouteExceptionForm, setShowRouteExceptionForm] = useState(false);
  const [routeExceptionReason, setRouteExceptionReason] = useState("");
  const [routeExceptionNote, setRouteExceptionNote] = useState("");
  const [salesRouteCountryFilter, setSalesRouteCountryFilter] = useState("All");
  const [salesRoutePage, setSalesRoutePage] = useState(1);
  const [showNoOrderForm, setShowNoOrderForm] = useState(false);
  const [noOrderReason, setNoOrderReason] = useState("");
  const [noOrderNote, setNoOrderNote] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [salesPaymentCustomerSearch, setSalesPaymentCustomerSearch] = useState("");
  const [salesReturnCustomerSearch, setSalesReturnCustomerSearch] = useState("");
  const [salesReturnForm, setSalesReturnForm] = useState({
    customerId: "",
    branchId: "",
    previousInvoiceNumber: "",
    previousInvoiceDate: "",
  });
  const [salesReturnSubmitting, setSalesReturnSubmitting] = useState(false);
  const [salesReturnCreated, setSalesReturnCreated] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedCustomerAccount, setSelectedCustomerAccount] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [paymentHistoryBranchId, setPaymentHistoryBranchId] = useState("");
  const [customerLedger, setCustomerLedger] = useState([]);
  const [customerOpeningBalance, setCustomerOpeningBalance] = useState(0);
  const [customerCreditSnapshot, setCustomerCreditSnapshot] = useState(null);
  const [branchOutstandingRows, setBranchOutstandingRows] = useState([]);

  const [salesPaymentForm, setSalesPaymentForm] = useState({
  customerId: "",
  branchId: "",
  amount: "",
  paymentType: "Cash",
  whoPaid: "",
  collectionDate: new Date().toISOString().split("T")[0],
  notes: "",
  paymentIntentId: createPaymentIntentId(),
});
const [salesOutstandingSnapshot, setSalesOutstandingSnapshot] = useState({
  totalOutstanding: 0,
  branchOutstanding: {},
});



const [savingSalesPayment, setSavingSalesPayment] = useState(false);

const activeCustomerAccounts = useMemo(
  () => customerAccounts.filter(isOrderSelectableCustomer),
  [customerAccounts]
);

const selectedSalesPaymentCustomer = activeCustomerAccounts.find(
  (customer) => String(customer.id) === String(salesPaymentForm.customerId)
);
const filteredSalesPaymentCustomers = activeCustomerAccounts.filter((customer) =>
  customerMatchesSearch(customer, salesPaymentCustomerSearch)
);
const selectedSalesPaymentBranches = (
  selectedSalesPaymentCustomer?.customer_branches || []
).filter((branch) => branch.active !== false);
const selectedSalesPaymentBranch =
  selectedSalesPaymentBranches.find(
    (branch) => String(branch.id) === String(salesPaymentForm.branchId)
  ) || null;
const filteredSalesReturnCustomers = activeCustomerAccounts.filter((customer) =>
  customerMatchesSearch(customer, salesReturnCustomerSearch)
);
const selectedSalesReturnCustomer = activeCustomerAccounts.find(
  (customer) => String(customer.id) === String(salesReturnForm.customerId)
);
const selectedSalesReturnBranches = (
  selectedSalesReturnCustomer?.customer_branches || []
).filter((branch) => branch.active !== false);
const selectedSalesReturnBranch =
  selectedSalesReturnBranches.find(
    (branch) => String(branch.id) === String(salesReturnForm.branchId)
  ) || null;

useEffect(() => {
  let active = true;

  const loadSalesOutstanding = async () => {
    if (!selectedSalesPaymentCustomer) {
      setSalesOutstandingSnapshot({ totalOutstanding: 0, branchOutstanding: {} });
      return;
    }

    try {
      const { outstandingState } = await loadSalesRepOutstanding({
        customer: selectedSalesPaymentCustomer,
        selectedBranchId: selectedSalesPaymentBranch?.id || "",
      });

      if (active) setSalesOutstandingSnapshot(outstandingState);
    } catch (error) {
      console.error("Sales outstanding load error:", error);
      if (active) setSalesOutstandingSnapshot({ totalOutstanding: 0, branchOutstanding: {} });
    }
  };

  loadSalesOutstanding();

  return () => {
    active = false;
  };
}, [selectedSalesPaymentCustomer?.id, selectedSalesPaymentBranch?.id]);

  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
 

  const [priceMode, setPriceMode] = useState("vat");
  const [companyName, setCompanyName] = useState("");

  const [manualCountry, setManualCountry] = useState("Wales");

  const [pricingSettings, setPricingSettings] = useState({
    server_discount_percent: 2,
    manager_discount_percent: 2.5,
    admin_offer_discount_percent: 3.5,
    super_discount_percent: 3.5,
    show_manager_offer: true,
    show_super_offer: true,
  });

const refreshSalesRoute = useCallback(async () => {
  if (!salesRouteMode) return;
  setSalesRouteLoading(true);
  try {
    setSalesRouteRows(await loadTodaysSalesRoute({ customers: activeCustomerAccounts, currentUser: activeUser }));
  } catch (error) {
    console.error("Sales route loading error:", error);
    setSalesRouteRows([]);
  } finally {
    setSalesRouteLoading(false);
  }
}, [salesRouteMode, activeCustomerAccounts, activeUser?.staff_id, activeUser?.id]);

useEffect(() => {
  if (salesRouteMode && activeCustomerAccounts.length) void refreshSalesRoute();
}, [salesRouteMode, activeCustomerAccounts.length, refreshSalesRoute]);

const filteredSalesRouteRows = useMemo(() =>
  salesRouteRows.filter((routeRow) =>
    salesRouteCountryFilter === "All" ||
    String(routeRow.branch?.country || routeRow.customer?.country || routeRow.customer?.account_country || "Unknown") === salesRouteCountryFilter
  ), [salesRouteRows, salesRouteCountryFilter]
);
const salesRoutePageCount = Math.max(1, Math.ceil(filteredSalesRouteRows.length / 30));
const currentSalesRoutePage = Math.min(salesRoutePage, salesRoutePageCount);
const visibleSalesRouteRows = filteredSalesRouteRows.slice((currentSalesRoutePage - 1) * 30, currentSalesRoutePage * 30);
useEffect(() => { setSalesRoutePage(1); }, [salesRouteCountryFilter, salesRouteRows.length]);

const resetSalesRouteCustomer = useCallback(() => {
  setSelectedCustomerId("");
  setSelectedCustomerAccount(null);
  setSelectedBranchId("");
  setSelectedBranch(null);
  setCompanyName("");
  setActiveRouteAssignmentId(null);
  setSalesRouteExceptionMode(false);
  setShowRouteExceptionForm(false);
  setRouteExceptionReason("");
  setRouteExceptionNote("");
  setCustomerDetailsExpanded(false);
  setShowNoOrderForm(false);
  setNoOrderReason("");
  setNoOrderNote("");
  setPage("order");
}, []);

const openSalesRouteCustomer = useCallback((routeRow) => {
  const customer = routeRow?.customer;
  if (!customer) return;
  const branch = routeRow?.branch || null;
  setSelectedCustomerId(customer.id);
  setSelectedCustomerAccount(customer);
  setSelectedBranchId(branch?.id || "");
  setSelectedBranch(branch);
  setCompanyName(customer.account_name || "");
  setActiveRouteAssignmentId(routeRow.id);
  setSalesRouteExceptionMode(false);
  setRouteExceptionReason("");
  setRouteExceptionNote("");
  setCustomerDetailsExpanded(false);
  setOrderPaymentChoice("cash_now");
  setOrderBankProofFile(null);
  setOrderPaymentIntentId(createPaymentIntentId());
  setShowSalesRouteModal(false);
  const modes = getAllowedPriceModesForCustomer(customer, pricingSettings);
  const defaultMode = String(customer.default_price_mode || "vat").toLowerCase();
  setPriceMode(modes.includes(defaultMode) ? defaultMode : modes[0] || "vat");
  setPage("order");
}, [pricingSettings]);

const confirmSalesRouteNoOrder = async () => {
  if (!selectedCustomerAccount) return;
  if (!noOrderReason) return alert("Select a No Order reason.");
  if (noOrderReason === "Other" && !noOrderNote.trim()) return alert("Enter a note for Other.");
  await recordSalesRouteVisit({
    customerAccountId: selectedCustomerAccount.id,
    customerBranchId: selectedBranch?.id || null,
    staffId: activeUser?.staff_id || activeUser?.id || null,
    staffName: activeUser?.staff_name || activeUser?.name || activeUser?.username || "",
    outcome: "NO_ORDER",
    reason: noOrderReason,
    note: noOrderNote,
    routeAssignmentId: activeRouteAssignmentId,
  });
  resetSalesRouteCustomer();
  await refreshSalesRoute();
};

const confirmSalesRouteException = () => {
  if (!routeExceptionReason) return alert("Select an exception reason.");
  if (routeExceptionReason === "Other" && !routeExceptionNote.trim()) return alert("Enter a note for Other.");
  setSelectedCustomerId("");
  setSelectedCustomerAccount(null);
  setSelectedBranchId("");
  setSelectedBranch(null);
  setCompanyName("");
  setActiveRouteAssignmentId(null);
  setSalesRouteExceptionMode(true);
  setShowRouteExceptionForm(false);
  setCustomerDetailsExpanded(true);
  setPage("order");
};


  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productError, setProductError] = useState("");
  const [homepageItems, setHomepageItems] = useState([]);
  const [homepageMessages, setHomepageMessages] = useState([]);
  const [homepageLoading, setHomepageLoading] = useState(false);
  const [homepageSalesMetrics, setHomepageSalesMetrics] = useState({});
  const [showHomepage, setShowHomepage] = useState(true);
  const [homepageSelectionType, setHomepageSelectionType] = useState("");
  const [homepageBrowseTitle, setHomepageBrowseTitle] = useState("");
  const [homepagePromotionTarget, setHomepagePromotionTarget] = useState("");
  const [homepageProductSetIds, setHomepageProductSetIds] = useState([]);
  const [promotionRules, setPromotionRules] = useState([]);
  const [productDisplayMessages, setProductDisplayMessages] = useState([]);
  const [customerDetailsExpanded, setCustomerDetailsExpanded] = useState(false);
  const [isCartEditing, setIsCartEditing] = useState(false);
  const [cartNotice, setCartNotice] = useState("");
  const [submissionFeedback, setSubmissionFeedback] = useState("");
  const salesCheckoutPaymentRequired = isSalesRep && !isCustomer;
  const [orderPaymentChoice, setOrderPaymentChoice] = useState(() =>
    salesCheckoutPaymentRequired ? "cash_now" : "no_payment"
  );
  const [orderBankProofFile, setOrderBankProofFile] = useState(null);
  const [orderPaymentIntentId, setOrderPaymentIntentId] = useState(() => createPaymentIntentId());
  const lastCartProductIdRef = useRef("");
  const browseScrollPositionRef = useRef(0);
  const productHighlightTimerRef = useRef(null);
  const portalHistoryInitializedRef = useRef(false);
  const activePortalViewRef = useRef("home");

const cartStorageKey = getCustomerCartStorageKey(activeUser);
const orderSubmissionStorageKey = `${cartStorageKey}:submission`;

const [cart, setCart] = useState(() => {
  try {
    const savedCart =
      localStorage.getItem(cartStorageKey) || localStorage.getItem(LEGACY_CART_KEY);
    return savedCart ? JSON.parse(savedCart) : [];
  } catch {
    return [];
  }
});

const cartRef = useRef(cart);
const centralCartMutationQueueRef = useRef(Promise.resolve());
const centralCartMutatingRef = useRef(false);
const centralCartLoadedScopeRef = useRef("");
const [centralCartId, setCentralCartId] = useState(null);

useEffect(() => {
  cartRef.current = cart;
}, [cart]);

useEffect(
  () => () => {
    if (productHighlightTimerRef.current) {
      clearTimeout(productHighlightTimerRef.current);
    }
  },
  []
);

useEffect(() => {
  if (!cartNotice) return undefined;
  const noticeTimer = setTimeout(() => setCartNotice(""), 2500);
  return () => clearTimeout(noticeTimer);
}, [cartNotice]);


useEffect(() => {
  localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  localStorage.removeItem(LEGACY_CART_KEY);
}, [cart, cartStorageKey]);

const applyCartPromotions = (cartLines) =>
  applyCustomerOrderPromotions({
    cartLines,
    promotionRules,
    products,
    priceMode,
    audienceType: promotionAudienceType,
  });

const refreshPromotionRules = async () => {
  try {
    const rules = await getActivePromotionRules();
    setPromotionRules(rules || []);
  } catch (error) {
    console.error("Promotion rules loading error:", error);
  }
};

const refreshProductDisplayMessages = async () => {
  try {
    const { data, error } = await supabase
      .from("product_display_messages")
      .select("*")
      .eq("active", true)
      .order("updated_at", { ascending: false });

    if (error) throw error;
    setProductDisplayMessages(data || []);
  } catch {
    setProductDisplayMessages([]);
  }
};

useEffect(() => {
  setCart((oldCart) => {
    const recalculatedCart = applyCustomerOrderPromotions({
      cartLines: oldCart,
      promotionRules,
      products,
      priceMode,
      audienceType: promotionAudienceType,
    });

    return JSON.stringify(recalculatedCart) === JSON.stringify(oldCart)
      ? oldCart
      : recalculatedCart;
  });
}, [promotionRules, products, priceMode, promotionAudienceType]);

const loadDeliveredOrdersForCustomerLedger = async (customerName, customerId) => {
  if (!customerName && !customerId) return [];

  let query = supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: true })
    .limit(250);

  if (customerId) {
    query = query.eq("customer_account_id", customerId);
  } else {
    query = query.eq("company_name", customerName);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Delivered order invoice fallback loading error:", error);
    return [];
  }

  const deliveredOrders = (data || [])
    .filter((order) => isDeliveredInvoiceStatus(order.status))
    .map(mapDeliveredOrderForCustomerLedger);
  const processingQueueOrders = await loadProcessingQueueOrders({
    customerAccountId: customerId,
    customerName,
  });

  return mergeOperationalOrders(deliveredOrders, processingQueueOrders);
};

const mergeDeliveredOrderInvoicesIntoLedger = (ledgerRows = [], deliveredOrders = []) => {
  const deliveredOrdersByReference = new Map(
    deliveredOrders
      .map((order) => [String(order.orderId || "").trim(), order])
      .filter(([referenceNo]) => Boolean(referenceNo))
  );
  const ledgerRowsWithOrders = (ledgerRows || []).map((row) => {
    const type = String(row.entry_type || row.transaction_type || "")
      .trim()
      .toUpperCase();
    const referenceNo = String(row.reference_no || row.order_number || "").trim();

    if (type === "INVOICE" && deliveredOrdersByReference.has(referenceNo)) {
      return {
        ...row,
        __order: deliveredOrdersByReference.get(referenceNo),
      };
    }

    return row;
  });
  const invoiceReferences = new Set(
    ledgerRowsWithOrders
      .filter(
        (row) =>
          String(row.entry_type || row.transaction_type || "")
            .trim()
            .toUpperCase() === "INVOICE"
      )
      .map((row) => String(row.reference_no || row.order_number || "").trim())
      .filter(Boolean)
  );

  const fallbackInvoiceRows = deliveredOrders
    .filter((order) => {
      const referenceNo = String(order.orderId || "").trim();
      return referenceNo && !invoiceReferences.has(referenceNo);
    })
    .map((order) => {
      const totals = calculateDocumentTotals(order.items || [], order);
      const createdAt = order.deliveredAt || order.createdAt || new Date().toISOString();

      return {
        id: `delivered-invoice-${order.orderId}`,
        created_at: createdAt,
        entry_type: "INVOICE",
        transaction_type: "INVOICE",
        reference_no: order.orderId,
        order_number: order.orderId,
        description: "Invoice",
        debit: totals.grandTotal,
        credit: 0,
        amount: totals.grandTotal,
        invoice_amount: totals.grandTotal,
        invoice_total: totals.grandTotal,
        paid_amount: 0,
        remaining_amount: totals.grandTotal,
        invoice_status: "UNPAID",
        customer_name: order.companyName || order.customerName || "",
        customer_account_id: order.customerAccountId || order.customer_account_id || null,
        customer_branch_id: order.customerBranchId || order.customer_branch_id || null,
        branch_id: order.customerBranchId || order.customer_branch_id || null,
        branch_name: order.branchName || null,
        price_mode: order.priceMode || null,
        order_price_mode: order.priceMode || null,
        __order: order,
      };
    });

  return [...ledgerRowsWithOrders, ...fallbackInvoiceRows].sort((a, b) => {
    const aTime = new Date(a.created_at || 0).getTime();
    const bTime = new Date(b.created_at || 0).getTime();
    if (aTime !== bTime) return aTime - bTime;

    const aType = String(a.entry_type || a.transaction_type || "").toUpperCase();
    const bType = String(b.entry_type || b.transaction_type || "").toUpperCase();
    if (aType === "INVOICE" && bType !== "INVOICE") return -1;
    if (aType !== "INVOICE" && bType === "INVOICE") return 1;
    return 0;
  });
};

const loadCustomerCreditSnapshot = async (
  customer = selectedCustomerAccount,
  branchId = paymentHistoryBranchId
) => {
  const customerName = customer?.account_name || companyName;

  if (!customerName || !customer?.id) {
    setCustomerLedger([]);
    setCustomerOpeningBalance(0);
    setCustomerCreditSnapshot(null);
    setBranchOutstandingRows([]);
    return null;
  }

  try {
    const selectedSnapshot = await loadReadOnlyCustomerCreditSnapshot({
      customerAccountId: customer.id,
      customerName,
      customer,
      selectedBranchId: branchId || "",
    });

    const historyRows = (selectedSnapshot.transactionHistory || []).map((row) => ({
      ...row,
      created_at: row.date,
      payment_date: row.date,
      entry_type: row.type,
      transaction_type: row.type,
      reference_no: row.reference,
      debit: row.amount > 0 ? row.amount : 0,
      credit: row.amount < 0 ? Math.abs(row.amount) : 0,
      running_balance: row.runningBalance,
      branch_id: row.branchId,
      customer_branch_id: row.branchId,
      branch_name: row.branchName,
      payment_type: row.paymentMethod,
      paid_by: row.paidBy,
      invoice_status: row.status,
      payment_status: row.status,
    }));

    setCustomerLedger(historyRows);
    setCustomerOpeningBalance(
      Number(
        (branchId
          ? selectedSnapshot.branchSummary?.openingBalance
          : selectedSnapshot.customerSummary?.openingBalance) || 0
      )
    );
    setCustomerCreditSnapshot(selectedSnapshot);

    setBranchOutstandingRows(
      (selectedSnapshot.branchSummaries || []).map((branch) => ({
        id: branch.branchId || "main-unassigned",
        branchName: branch.branchName,
        outstanding: Number(branch.outstanding || 0),
      }))
    );

    return {
      ...selectedSnapshot,
      ledgerRows: historyRows,
      openingBalance: Number(
        (branchId
          ? selectedSnapshot.branchSummary?.openingBalance
          : selectedSnapshot.customerSummary?.openingBalance) || 0
      ),
    };
  } catch (ledgerError) {
    console.error("Customer credit loading error:", ledgerError);
    alert(`Could not load payment history.\n\n${ledgerError.message || "Unknown error"}`);
    setCustomerLedger([]);
    setCustomerOpeningBalance(0);
    setCustomerCreditSnapshot(null);
    setBranchOutstandingRows([]);
    return null;
  }
};
const fetchCustomerLedger = () => loadCustomerCreditSnapshot(selectedCustomerAccount, paymentHistoryBranchId);

useEffect(() => {
  if (selectedCustomerAccount && (page === "paymentHistory" || page === "order")) {
    fetchCustomerLedger();
  }
}, [page, selectedCustomerAccount?.id, userProfile?.customer_account_id, paymentHistoryBranchId]);

  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const orderSubmissionLockRef = useRef(false);

  useEffect(() => {
    if (!isSubmittingOrder) return undefined;

    const warnBeforeLeaving = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isSubmittingOrder]);
  const [orders, setOrders] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState({});
  const [returnOrder, setReturnOrder] = useState(null);

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Products");
  const [selectedSubCategory, setSelectedSubCategory] =
    useState("All Sub Categories");
  const [selectedBrand, setSelectedBrand] = useState("All Brands");
  const [selectedSeries, setSelectedSeries] = useState("All Series");
  const [productView, setProductView] = useState(() =>
    globalThis.matchMedia?.("(max-width: 639px)")?.matches ? "list" : "grid"
  );
  const [productPage, setProductPage] = useState(1);

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
    const searchFilteredCustomers = activeCustomerAccounts.filter((customer) =>
      customerMatchesSearch(customer, customerSearchTerm)
    );

    if (!isSalesRep) return searchFilteredCustomers;

    return searchFilteredCustomers.filter((customer) =>
      customerMatchesCountry(customer, orderCountry)
    );
  }, [activeCustomerAccounts, customerSearchTerm, isSalesRep, orderCountry]);

  const filteredBranchesForSelectedCustomer = useMemo(
    () =>
      getCountryFilteredBranches(
        selectedCustomerAccount,
        orderCountry,
        isSalesRep
      ),
    [selectedCustomerAccount, orderCountry, isSalesRep]
  );

  const allowedPriceModes = useMemo(
    () =>
      isAdmin || isSalesRep
        ? ["vat", "server", "manager", "super"]
        : getAllowedPriceModesForCustomer(selectedCustomerAccount, pricingSettings),
    [isAdmin, isSalesRep, pricingSettings, selectedCustomerAccount]
  );
  const showPriceModeSelector =
    isAdmin || isSalesRep || allowedPriceModes.length > 1;
  const salesReturnOrder = selectedSalesReturnCustomer
    ? {
        orderId: salesReturnForm.previousInvoiceNumber || `SALES-RETURN-${Date.now()}`,
        order_number: salesReturnForm.previousInvoiceNumber || "",
        previousInvoiceNumber: salesReturnForm.previousInvoiceNumber,
        previousInvoiceDate: salesReturnForm.previousInvoiceDate,
        companyName: selectedSalesReturnCustomer.account_name,
        company_name: selectedSalesReturnCustomer.account_name,
        customerAccountId: selectedSalesReturnCustomer.id,
        customer_account_id: selectedSalesReturnCustomer.id,
        customerBranchId: selectedSalesReturnBranch?.id || null,
        customer_branch_id: selectedSalesReturnBranch?.id || null,
        branchName: selectedSalesReturnBranch?.branch_name || "",
        branch_name: selectedSalesReturnBranch?.branch_name || "",
      }
    : null;

const getActivePromotionPriceRule = (product) =>
  findActivePromotionPriceRule({
    product,
    promotionRules,
    priceMode,
    audienceType: promotionAudienceType,
  });

const getPromotionPrice = (product) =>
  getActivePromotionPrice({
    product,
    promotionRules,
    priceMode,
    audienceType: promotionAudienceType,
  });

const getPriceDetails = (product) =>
  getProductPriceDetailsForMode(product, priceMode, orderCountry, pricingSettings);

const getPrice = (product) =>
  getProductPriceForMode(product, priceMode, orderCountry, pricingSettings);

const normalizeHomepageCategoryType = (value) =>
  String(value || "main_category").trim().toLowerCase();


const HOMEPAGE_PROMOTION_TARGET_SEPARATOR = "::";
const parseHomepagePromotionDestination = (rawValue) => {
  const value = String(rawValue || "").trim();
  const [type, ...rest] = value.split(HOMEPAGE_PROMOTION_TARGET_SEPARATOR);
  if (["main_category", "sub_category", "brand", "series", "product"].includes(type) && rest.length) {
    return { type, value: rest.join(HOMEPAGE_PROMOTION_TARGET_SEPARATOR) };
  }
  return { type: "promotion_flag", value };
};

const normalizeHomepagePromotionTarget = (value) =>
  String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");

const productMatchesHomepagePromotion = (product, targetValue) => {
  const destination = parseHomepagePromotionDestination(targetValue);
  if (destination.type === "main_category") return String(product.category || "") === destination.value;
  if (destination.type === "sub_category") return String(product.subCategory || "") === destination.value;
  if (destination.type === "brand") return String(product.brand || "") === destination.value;
  if (destination.type === "series") return String(product.series || "") === destination.value;
  if (destination.type === "product") return String(product.id || "") === String(destination.value);

  const target = normalizeHomepagePromotionTarget(destination.value);
  if (target === "promotion" || target === "is_promotion") return product.isPromotion === true;
  if (target === "new" || target === "is_new") return product.isNew === true;
  if (target === "reduced" || target === "is_reduced") return product.isReduced === true;
  if (target === "recommended") return product.recommended === true;
  if (target === "top_seller" || target === "top seller") return product.topSeller === true;
  return false;
};

const findHomepagePriceProduct = (item) => {
  const categoryType = normalizeHomepageCategoryType(item.categoryType);

  return products.find((product) => {
    if (!isActiveProduct(product)) return false;
    if (orderCountry === "England" && !product.availableInEngland) return false;
    if (orderCountry === "Wales" && !product.availableInWales) return false;

    if (categoryType === "sub_category") {
      return product.subCategory === item.targetValue;
    }

    if (categoryType === "brand") {
      return product.brand === item.targetValue;
    }

    if (categoryType === "series") {
      return product.series === item.targetValue;
    }

    if (categoryType === "promotion") {
      return productMatchesHomepagePromotion(product, item.targetValue);
    }

    return product.category === item.targetValue;
  });
};

const getProductDisplayMessage = (product = {}) => {
  const candidates = [
    ["product", product.id],
    ["product", product.productCode || product.product_code],
    ["series", product.series],
    ["brand", product.brand],
    ["sub_category", product.subCategory || product.sub_category],
    ["main_category", product.category || product.main_category],
  ];

  const match = candidates.reduce((found, [targetType, targetValue]) => {
    if (found || !targetValue) return found;
    return productDisplayMessages.find(
      (message) =>
        message.active !== false &&
        message.target_type === targetType &&
        String(message.target_value || "").trim().toLowerCase() ===
          String(targetValue || "").trim().toLowerCase()
    );
  }, null);

  return match
    ? {
        text: match.message,
        color: match.color,
      }
    : null;
};

const getHomepageDisplayPrice = (item) => {
  return getHomepagePriceForMode(item.price, priceMode, pricingSettings);
};

const getHomepageCardProducts = (item) => {
  const categoryType = normalizeHomepageCategoryType(item.categoryType);
  if (categoryType === "custom_link") return [];
  return products.filter((product) => {
    if (!isActiveProduct(product)) return false;
    if (orderCountry === "England" && !product.availableInEngland) return false;
    if (orderCountry === "Wales" && !product.availableInWales) return false;
    if (categoryType === "sub_category") return product.subCategory === item.targetValue;
    if (categoryType === "brand") return product.brand === item.targetValue;
    if (categoryType === "series") return product.series === item.targetValue;
    if (categoryType === "promotion") return productMatchesHomepagePromotion(product, item.targetValue);
    return product.category === item.targetValue;
  });
};

const homepageCategoryCards = homepageItems.map((item) => {
  const matchingProducts = getHomepageCardProducts(item);
  const brandNames = new Set(
    matchingProducts.map((product) => String(product.brand || "").trim()).filter(Boolean)
  );
  return {
    ...item,
    productCount: matchingProducts.length,
    brandCount: brandNames.size,
  };
});

const messageContextProduct = products.find((product) => {
  if (!isActiveProduct(product)) return false;
  if (selectedSubCategory !== "All Sub Categories" && product.subCategory === selectedSubCategory) return true;
  if (selectedSeries !== "All Series" && product.series === selectedSeries) return true;
  if (selectedBrand !== "All Brands" && product.brand === selectedBrand) return true;
  return false;
});
const messageSelectedCategory =
  selectedCategory !== "All Products"
    ? selectedCategory
    : messageContextProduct?.category || selectedCategory;

const matchingHomepageMessages = getMatchingHomepageMessages(homepageMessages, {
  selectedCategory: messageSelectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
});
const selectedProductNotices = getMatchingHomepageMessages(homepageMessages, {
  selectedProductId: selectedImage?.id,
}).filter((message) => message.targetType === "product");

const recordCustomerPortalView = useCallback(
  (view, portalPage = "order") => {
    if (!isCustomer || !view) return;
    activePortalViewRef.current = view;
    const nextState = buildCustomerPortalHistoryState(
      window.history.state,
      { page: portalPage, view }
    );
    const action = getCustomerPortalHistoryAction(
      window.history.state,
      view
    );
    if (action === "push") {
      window.history.pushState(nextState, "", window.location.href);
    } else if (action === "replace") {
      window.history.replaceState(nextState, "", window.location.href);
    }
  },
  [isCustomer]
);

const restoreCustomerHome = useCallback(() => {
  activePortalViewRef.current = "home";
  setShowHomepage(true);
  setHomepageSelectionType("");
  setHomepageBrowseTitle("");
  setHomepagePromotionTarget("");
  setHomepageProductSetIds([]);
  setPage("order");
  setSelectedCategory("All Products");
  setSelectedSubCategory("All Sub Categories");
  setSelectedBrand("All Brands");
  setSelectedSeries("All Series");
  setSearch("");
  setProductPage(1);
  setSelectedImage(null);
  setIsCartEditing(false);

  if (isCustomer || isSalesRep) {
    const homeHash = getCustomerPortalHash("order", {
      isCustomer,
      isSalesRep,
    });
    window.history.replaceState(
      buildCustomerPortalHistoryState(window.history.state, {
        page: "order",
        view: "home",
      }),
      "",
      homeHash || window.location.href
    );
  }

  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}, [
  isCustomer,
  isSalesRep,
  setHomepageBrowseTitle,
  setHomepagePromotionTarget,
  setHomepageSelectionType,
  setIsCartEditing,
  setPage,
  setProductPage,
  setSearch,
  setSelectedBrand,
  setSelectedCategory,
  setSelectedImage,
  setSelectedSeries,
  setSelectedSubCategory,
  setShowHomepage,
]);

const goToCustomerHome = useCallback(() => {
  if (
    isCustomer &&
    window.history.state?.fairchoicePortal === true &&
    window.history.state?.view !== "home"
  ) {
    window.history.back();
    return;
  }
  restoreCustomerHome();
}, [isCustomer, restoreCustomerHome]);

useEffect(() => {
  if (!isCustomer || portalHistoryInitializedRef.current) return;
  portalHistoryInitializedRef.current = true;
  const initialUrl = window.location.href;
  const startsAtHome = isCustomerPortalHomeView({
    page,
    showHomepage,
    hasSelectedProduct: Boolean(selectedImage),
  });

  window.history.replaceState(
    buildCustomerPortalHistoryState(window.history.state, {
      page: "order",
      view: "home",
    }),
    "",
    initialUrl
  );

  if (!startsAtHome) {
    activePortalViewRef.current = selectedImage ? "product" : page;
    window.history.pushState(
      buildCustomerPortalHistoryState(window.history.state, {
        page,
        view: selectedImage ? "product" : page,
      }),
      "",
      initialUrl
    );
  }
}, [isCustomer, page, selectedImage, showHomepage]);

useEffect(() => {
  if (!isCustomer) return undefined;
  const handlePortalPopState = () => {
    const isAtHome = isCustomerPortalHomeView({
      page,
      showHomepage,
      hasSelectedProduct: Boolean(selectedImage),
    });
    if (activePortalViewRef.current !== "home" || !isAtHome) {
      restoreCustomerHome();
    }
  };

  window.addEventListener("popstate", handlePortalPopState);
  return () => window.removeEventListener("popstate", handlePortalPopState);
}, [isCustomer, page, restoreCustomerHome, selectedImage, showHomepage]);

const updateHomepageSearch = (value) => {
  if (!String(search || "").trim() && String(value || "").trim()) {
    recordCustomerPortalView("search");
  }
  setSearch(value);
};

const openProductDetails = (product) => {
  recordCustomerPortalView("product");
  setSelectedImage(product);
};

const openCustomerCart = () => {
  recordCustomerPortalView("cart");
  changeCartEditing(true);
};

const openCustomerCheckout = () => {
  recordCustomerPortalView("checkout");
  changeCartEditing(true);
};

const openHomepageItem = (item) => {
  const categoryType = normalizeHomepageCategoryType(item.categoryType);

  if (categoryType === "custom_link") {
    const target = String(item.targetValue || "").trim();
    if (/^(https?:\/\/|\/(?!\/)|#)/i.test(target)) {
      window.location.assign(target);
    } else {
      console.warn("Blocked unsafe homepage custom link:", target);
    }
    return;
  }

  recordCustomerPortalView(categoryType);
  setShowHomepage(false);
  setHomepageSelectionType(categoryType);
  setHomepageBrowseTitle(
    item.title || item.description || item.targetValue || "Products"
  );
  setHomepagePromotionTarget("");
  setHomepageProductSetIds([]);
  setSearch("");
  setSelectedBrand("All Brands");
  setSelectedSeries("All Series");

  if (categoryType === "product_set") {
    setSelectedCategory("All Products");
    setSelectedSubCategory("All Sub Categories");
    setHomepageProductSetIds((item.productIds || []).map(String));
    return;
  }

  if (categoryType === "sub_category") {
    const targetSubCategory = item.targetValue || "All Sub Categories";
    const parentCategory =
      products.find((product) => isActiveProduct(product) && product.subCategory === targetSubCategory)?.category ||
      "All Products";
    setSelectedCategory(parentCategory);
    setSelectedSubCategory(targetSubCategory);
    return;
  }

  if (categoryType === "flavour") {
    setSelectedCategory("All Products");
    setSelectedSubCategory("All Sub Categories");
    setSelectedBrand("All Brands");
    setSelectedSeries("All Series");
    setSearch(item.targetValue || "");
    return;
  }

  if (categoryType === "series") {
    setSelectedCategory("All Products");
    setSelectedSubCategory("All Sub Categories");
    setSelectedBrand("All Brands");
    setSelectedSeries(item.targetValue || "All Series");
    return;
  }

  if (categoryType === "promotion") {
    const destination = parseHomepagePromotionDestination(item.targetValue);
    setHomepagePromotionTarget("");
    setSearch("");
    setSelectedCategory("All Products");
    setSelectedSubCategory("All Sub Categories");
    setSelectedBrand("All Brands");
    setSelectedSeries("All Series");

    if (destination.type === "main_category") {
      setSelectedCategory(destination.value || "All Products");
      return;
    }
    if (destination.type === "sub_category") {
      const parentCategory = products.find((product) => isActiveProduct(product) && product.subCategory === destination.value)?.category || "All Products";
      setSelectedCategory(parentCategory);
      setSelectedSubCategory(destination.value || "All Sub Categories");
      return;
    }
    if (destination.type === "brand") {
      setSelectedBrand(destination.value || "All Brands");
      return;
    }
    if (destination.type === "series") {
      setSelectedSeries(destination.value || "All Series");
      return;
    }
    if (destination.type === "product") {
      const product = products.find((candidate) => isActiveProduct(candidate) && String(candidate.id) === String(destination.value));
      if (product) openProductDetails(product);
      return;
    }

    setHomepagePromotionTarget(destination.value || "");
    return;
  }

  if (categoryType === "brand") {
    setSelectedCategory("All Products");
    setSelectedSubCategory("All Sub Categories");
    setSelectedBrand(item.targetValue || "All Brands");
    return;
  }

  setSelectedCategory(item.targetValue || "All Products");
  setSelectedSubCategory("All Sub Categories");
};

const recalculateCartItemForPriceMode = (item, nextQty = item.qty) => {
  const quantity = Math.max(1, Number(nextQty || 1));
  const priceDetails = getPriceDetails(item);
  const selectedPrice = Number(priceDetails.price || 0);
  const exVatPrice = Number(priceDetails.exVatPrice ?? selectedPrice);
  const vatRate = Number(priceDetails.vatRate ?? getVatRate(item.vatType || item.vat_type));
  const vatAmount = Number(priceDetails.vatAmount || 0);
  const incVatPrice = Number(priceDetails.grossPrice ?? selectedPrice);
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
    specialPriceApplied: Boolean(priceDetails.usesSpecialPrice),
    special_price_applied: Boolean(priceDetails.usesSpecialPrice),
    specialPrice: Number(priceDetails.specialPrice || 0),
    special_price: Number(priceDetails.specialPrice || 0),
    specialPriceSource: priceDetails.specialPriceSource || "",
    special_price_source: priceDetails.specialPriceSource || "",
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

const getCentralCartScope = () => {
  const customerAccountId = selectedCustomerAccount?.id || null;
  const customerBranchId = selectedBranch?.id || null;
  const branchCount = selectedCustomerAccount
    ? getCustomerBranches(selectedCustomerAccount).filter((branch) => branch.active !== false).length
    : 0;

  if (!customerAccountId) return null;
  if (branchCount > 0 && !customerBranchId) return null;

  return { customerAccountId, customerBranchId };
};

const buildCartFromCentralItems = (items = []) => {
  const normalCart = items
    .map((serverItem) => {
      const product = products.find(
        (candidate) => String(candidate.id) === String(serverItem.product_id)
      );
      if (!product) return null;
      return recalculateCartItemForPriceMode(
        {
          ...product,
          sourceStatus:
            Number(product.stock || 0) < Number(serverItem.quantity || 0)
              ? "Need Supplier"
              : "In Stock",
          includeInPicking: true,
          pickedQty: Math.min(
            Number(product.stock || 0),
            Number(serverItem.quantity || 0)
          ),
        },
        Number(serverItem.quantity || 0)
      );
    })
    .filter(Boolean);

  return applyCartPromotions(normalCart);
};

const loadCentralCartForCurrentScope = async ({ seedLocal = false } = {}) => {
  if (!CENTRAL_CART_ENABLED) return null;
  const scope = getCentralCartScope();
  if (!scope) return null;

  const remote = await loadCentralCart({
    profile: activeUser,
    ...scope,
  });

  setCentralCartId(remote.cartId);

  const localNormalCart = cartRef.current.filter((item) => !item.isPromotionFree);
  if (seedLocal && remote.items.length === 0 && localNormalCart.length > 0) {
    for (const item of localNormalCart) {
      await setCentralCartItemQuantity({
        profile: activeUser,
        cartId: remote.cartId,
        productId: item.id,
        quantity: Number(item.qty || item.quantity || 0),
      });
    }
    return loadCentralCartForCurrentScope({ seedLocal: false });
  }

  setCart(buildCartFromCentralItems(remote.items));
  return remote;
};

const ensureCentralCartForCurrentScope = async () => {
  if (!CENTRAL_CART_ENABLED) return null;
  if (centralCartId) return centralCartId;
  const remote = await loadCentralCartForCurrentScope({ seedLocal: true });
  return remote?.cartId || null;
};

const queueCentralCartMutation = (mutation) => {
  if (!CENTRAL_CART_ENABLED) return;

  centralCartMutationQueueRef.current = centralCartMutationQueueRef.current
    .catch(() => undefined)
    .then(async () => {
      centralCartMutatingRef.current = true;
      try {
        const cartId = await ensureCentralCartForCurrentScope();
        if (!cartId) return;
        await mutation(cartId);
      } finally {
        centralCartMutatingRef.current = false;
      }
    })
    .catch((error) => {
      console.error("Central cart sync error:", error);
      setCartNotice("Cart kept on this device; server sync needs retry.");
    });
};

useEffect(() => {
  if (!CENTRAL_CART_ENABLED || products.length === 0) return;
  const scope = getCentralCartScope();
  if (!scope) {
    setCentralCartId(null);
    return;
  }

  const scopeKey = `${scope.customerAccountId}:${scope.customerBranchId || "ACCOUNT"}`;
  if (centralCartLoadedScopeRef.current === scopeKey) return;
  centralCartLoadedScopeRef.current = scopeKey;
  setCentralCartId(null);

  loadCentralCartForCurrentScope({ seedLocal: true }).catch((error) => {
    centralCartLoadedScopeRef.current = "";
    console.error("Central cart load error:", error);
    setCartNotice("Using saved device cart; server cart could not be loaded.");
  });
}, [selectedCustomerAccount?.id, selectedBranch?.id, products.length]);

useEffect(() => {
  if (!CENTRAL_CART_ENABLED || !centralCartId) return undefined;

  const refresh = () => {
    if (document.visibilityState !== "visible" || centralCartMutatingRef.current) return;
    loadCentralCartForCurrentScope().catch((error) =>
      console.error("Central cart refresh error:", error)
    );
  };

  const timer = window.setInterval(refresh, 15000);
  window.addEventListener("focus", refresh);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener("focus", refresh);
  };
}, [centralCartId, selectedCustomerAccount?.id, selectedBranch?.id, products.length]);


useEffect(() => {
  const syncPageFromHash = () => {
    const resolvedPage = resolveCustomerPortalPage({
        hash: window.location.hash,
        isAdmin,
        isSalesRep,
        isWarehouse,
        isDriver,
        isCustomer,
        canCollectCash,
      });
    setPage(
      isAdmin
        ? (canAccessPage(backOfficeUser, resolvedPage) ? resolvedPage : defaultBackOfficePage)
        : !isSalesRep && !isWarehouse && !isDriver && !isCustomer
        ? defaultBackOfficePage
        : resolvedPage
    );
  };

  window.addEventListener("hashchange", syncPageFromHash);
  const syncTimer = window.setTimeout(syncPageFromHash, 0);
  return () => {
    window.clearTimeout(syncTimer);
    window.removeEventListener("hashchange", syncPageFromHash);
  };
}, [isAdmin, isSalesRep, isWarehouse, isDriver, isCustomer, canCollectCash, defaultBackOfficePage]);

useEffect(() => {
  const roleState = { isAdmin, isSalesRep, isWarehouse, isDriver, isCustomer, canCollectCash };

  if (!isCustomerPortalPageAllowed(page, roleState)) return;

  const nextHash = getCustomerPortalHash(page, roleState);
  if (nextHash && window.location.hash !== nextHash) {
    window.history.replaceState(window.history.state, "", nextHash);
  }
}, [page, isAdmin, isSalesRep, isWarehouse, isDriver, isCustomer, canCollectCash]);



  useEffect(() => {
    if (!supabase) {
      setProductError("Supabase is not configured.");
      return;
    }

  
    fetchPricingSettings();
    refreshPromotionRules();
    refreshProductDisplayMessages();

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
        const data = await getCustomerAccounts({ operationalOnly: !isCustomer });
        setCustomerAccounts(data || []);
      } catch (error) {
        console.error("Customer loading error:", error);
      }
    }

    loadCustomerAccounts();
  }, [isCustomer]);

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
    setCustomerDetailsExpanded(getCustomerBranches(customer).length > 0);
    setCompanyName(customer.account_name);
    setPriceMode(String(customer.default_price_mode || "vat").toLowerCase());
  }, [isCustomer, userProfile?.customer_account_id, customerAccounts]);

  useEffect(() => {
    if (!selectedCustomerAccount) return;

    if (filteredBranchesForSelectedCustomer.length === 1) {
      setSelectedBranchId(filteredBranchesForSelectedCustomer[0].id);
      setSelectedBranch(filteredBranchesForSelectedCustomer[0]);
      setCustomerDetailsExpanded(false);
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
      setCustomerDetailsExpanded(true);
      setCompanyName("");
      setPriceMode("vat");
      setCart([]);
      localStorage.removeItem(cartStorageKey);
      localStorage.removeItem(orderSubmissionStorageKey);
      return;
    }

    if (
      selectedBranch &&
      normalizeCountry(selectedBranch.country) !== normalizeCountry(orderCountry)
    ) {
      setSelectedBranchId("");
      setSelectedBranch(null);
    }
  }, [
    isSalesRep,
    orderCountry,
    selectedCustomerAccount,
    selectedBranch,
    cartStorageKey,
    orderSubmissionStorageKey,
  ]);

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

  const fetchHomepageContent = async () => {
    setHomepageLoading(true);

    const [itemsResult, messagesResult] = await Promise.allSettled([
      getHomepageItems(),
      getActiveHomepageMessages(),
    ]);
    if (itemsResult.status === "fulfilled") {
      setHomepageItems(itemsResult.value || []);
    } else {
      console.error("Homepage loading error:", itemsResult.reason);
      setHomepageItems([]);
    }
    if (messagesResult.status === "fulfilled") {
      setHomepageMessages(messagesResult.value || []);
    } else {
      console.error("Homepage message loading error:", messagesResult.reason);
      setHomepageMessages([]);
    }

    setHomepageLoading(false);
  };

  const fetchHomepageSalesAnalytics = async () => {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          id,
          created_at,
          status,
          customer_country,
          order_items(
            product_id,
            product_code,
            product_name,
            flavour,
            qty,
            line_total
          )
        `)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000);

      if (error) throw error;

      const metrics = {};
      const now = Date.now();
      const currentCountry = normalizeCountry(orderCountry);

      for (const order of data || []) {
        if (!isDeliveredInvoiceStatus(order.status)) continue;

        const soldCountry = normalizeCountry(order.customer_country || "");
        if (currentCountry && soldCountry && soldCountry !== currentCountry) continue;

        const createdAt = new Date(order.created_at || 0).getTime();
        const ageDays = Number.isFinite(createdAt)
          ? Math.max(0, (now - createdAt) / (24 * 60 * 60 * 1000))
          : 90;

        for (const item of order.order_items || []) {
          const aliases = [
            item.product_id ? `id:${String(item.product_id)}` : "",
            item.product_code ? `code:${String(item.product_code).trim().toLowerCase()}` : "",
            item.product_name ? `name:${String(item.product_name).trim().toLowerCase()}` : "",
          ].filter(Boolean);
          if (!aliases.length) continue;

          let metric = aliases.map((key) => metrics[key]).find(Boolean);
          if (!metric) {
            metric = {
              units90: 0,
              units30: 0,
              units7: 0,
              revenue90: 0,
              orders90: 0,
            };
          }
          aliases.forEach((key) => { metrics[key] = metric; });

          const qty = Math.max(0, Number(item.qty || 0));
          if (!qty) continue;
          metric.units90 += qty;
          metric.orders90 += 1;
          metric.revenue90 += Math.max(0, Number(item.line_total || 0));
          if (ageDays <= 30) metric.units30 += qty;
          if (ageDays <= 7) metric.units7 += qty;
        }
      }

      Object.values(metrics).forEach((metric) => {
        metric.velocityScore =
          Number(metric.units90 || 0) +
          Number(metric.units30 || 0) * 1.5 +
          Number(metric.units7 || 0) * 3;
      });

      setHomepageSalesMetrics(metrics);
    } catch (error) {
      console.error("Homepage sales analytics loading error:", error);
      setHomepageSalesMetrics({});
    }
  };

  useEffect(() => {
    if (!supabase) return;
    // Load the visible ordering experience first. Products were previously
    // requested once here and again by the mount effect, which delayed entry.
    void Promise.all([fetchProducts(), fetchHomepageContent()]);
  }, [orderCountry]);

  useEffect(() => {
    if (!supabase || (!isCustomer && !isSalesRep)) return undefined;

    // Sales analytics power the homepage ranking carousels, but they are not
    // required for the first paint. Defer the 90-day order scan until the
    // browser is idle so header, products and homepage content appear first.
    const loadAnalytics = () => {
      void fetchHomepageSalesAnalytics();
    };

    if (typeof window.requestIdleCallback === "function") {
      const idleId = window.requestIdleCallback(loadAnalytics, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(idleId);
    }

    const timerId = window.setTimeout(loadAnalytics, 250);
    return () => window.clearTimeout(timerId);
  }, [orderCountry, isCustomer, isSalesRep]);

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

const fetchOrders = async ({ throwOnError = false } = {}) => {
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
      delivery_country: order.delivery_country || "",
      branch_country: order.branch_country || "",
      customer_country: order.customer_country || "",
      country: order.country || "",
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
      picking_status: order.picking_status || "Not Started",
      picking_locked_by: order.picking_locked_by || null,
      picking_locked_by_name: order.picking_locked_by_name || null,
      picking_locked_at: order.picking_locked_at || null,

      driverName: order.driver_name || "",
      deliveredAt: order.delivered_at || "",
      paymentType: order.payment_type || "",
      paymentAmount: Number(order.payment_amount || 0),
      paymentCollected: order.payment_collected || "",
      payment_collected: order.payment_collected || "",
      collectionType: order.collection_type || "",
      collection_type: order.collection_type || "",
      resolvedCollectionType: order.resolved_collection_type || "",
      resolved_collection_type: order.resolved_collection_type || "",
      outstandingCollectionStatus: order.outstanding_collection_status || "",
      outstanding_collection_status: order.outstanding_collection_status || "",
      transactionReason: order.transaction_reason || "",
      transaction_reason: order.transaction_reason || "",
      paymentAppliesTo: order.payment_applies_to || "",
      payment_applies_to: order.payment_applies_to || "",
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
        pickingAction: item.picking_action || null,
        picking_action: item.picking_action || null,
        pickingOrderedQty: Number(item.picking_ordered_qty ?? item.qty ?? 0),
        picking_ordered_qty: Number(item.picking_ordered_qty ?? item.qty ?? 0),
        pickingInStockQty: Number(item.picking_in_stock_qty || 0),
        picking_in_stock_qty: Number(item.picking_in_stock_qty || 0),
        pickingPreOrderQty: Number(item.picking_pre_order_qty || 0),
        picking_pre_order_qty: Number(item.picking_pre_order_qty || 0),
        pickingReplacedQty: Number(item.picking_replaced_qty || 0),
        picking_replaced_qty: Number(item.picking_replaced_qty || 0),
        replacementProductId: item.replacement_product_id || null,
        replacement_product_id: item.replacement_product_id || null,
        replacementProductCode: item.replacement_product_code || null,
        replacement_product_code: item.replacement_product_code || null,
        replacementProductName: item.replacement_product_name || null,
        replacement_product_name: item.replacement_product_name || null,
      })),
    }));

    const processingQueueOrders = (await loadProcessingQueueOrders()).map((order) => ({
      ...order,
      createdAt: order.createdAt
        ? new Date(order.createdAt).toLocaleString()
        : order.created_at,
    }));

    setOrders(mergeOperationalOrders(mappedOrders, processingQueueOrders));
  } catch (error) {
    console.error("Orders loading error:", error);
    if (throwOnError) throw error;
  }
};

const openBackOffice = async () => {
  console.info("[BackOfficeNavigation] click", {
    staffId: activeUser?.staff_id || activeUser?.id || null,
    loginUserId: activeUser?.login_user_id || activeUser?.id || null,
    role: activeUser?.role || activeUser?.access_level || null,
    active: activeUser?.active !== false,
  });

  const brandPartnerAdminDuty = isBrandPartner && activeDuty === "admin";

  if (!brandPartnerAdminDuty && !isAdminStaffRole(activeUser?.role || activeUser?.access_level)) {
    console.warn("[BackOfficeNavigation] access denied", {
      reason: "non_admin_role",
      role: activeUser?.role || activeUser?.access_level || null,
    });
    alert("Back Office access is restricted to active administrators.");
    return;
  }

  try {
    const loginUserId = activeUser?.login_user_id || activeUser?.id;
    if (!loginUserId) throw new Error("The authenticated staff login ID is missing.");

    const loginResult = await supabase
      .from("login_users")
      .select("id, username, role, staff_id, permissions, active")
      .eq("id", loginUserId)
      .eq("active", true)
      .maybeSingle();

    if (loginResult.error) throw loginResult.error;
    if (!loginResult.data) throw new Error("The staff login is inactive or unavailable.");
    if (!loginResult.data.staff_id) {
      throw new Error("This staff login is not linked to an individual staff record.");
    }

    const staffResult = await supabase
      .from("staff_users")
      .select("*")
      .eq("id", loginResult.data.staff_id)
      .eq("active", true)
      .maybeSingle();

    if (staffResult.error) throw staffResult.error;
    const staffProfile = buildLegacyStaffProfile(loginResult.data, staffResult.data);
    const access = resolveBackOfficeAccess(staffProfile);

    if (!access.allowed && !brandPartnerAdminDuty) {
      console.warn("[BackOfficeNavigation] access denied", {
        staffId: staffProfile?.staff_id || null,
        loginUserId,
        role: staffProfile?.role || null,
        reason: access.reason,
      });
      alert(access.reason);
      return;
    }

    onProfileRefresh?.(
      mergeAuthenticatedProfile(activeUser, staffProfile)
    );
    window.history.replaceState(null, "", "#admin");
    setPage("orders");

    try {
      await fetchOrders({ throwOnError: true });
    } catch (ordersError) {
      console.error("[BackOfficeNavigation] orders failed to load", {
        staffId: staffProfile.staff_id,
        loginUserId,
        message: ordersError?.message || String(ordersError),
        code: ordersError?.code || null,
      });
      alert(`Back Office opened, but orders could not be loaded.\n\n${ordersError.message || "Unknown error"}`);
    }
  } catch (error) {
    console.error("[BackOfficeNavigation] profile resolution failed", {
      staffId: activeUser?.staff_id || activeUser?.id || null,
      loginUserId: activeUser?.login_user_id || activeUser?.id || null,
      role: activeUser?.role || activeUser?.access_level || null,
      message: error?.message || String(error),
      code: error?.code || null,
    });
    alert(`Back Office could not be opened.\n\n${error.message || "The staff profile could not be loaded."}`);
  }
};

  const changeOrderStatus = async (
    orderNumber,
    status,
    { preserveSupplyState = false } = {}
  ) => {
    try {
      const existingOrder = orders.find(
        (order) => String(order.orderId) === String(orderNumber)
      );
      if (
        status === "Received" &&
        existingOrder?.status !== "Received" &&
        !preserveSupplyState
      ) {
        await reversePreOrderSupplyForReceivedOrder({
          order: existingOrder,
          user: loggedInUser,
          updateOrderItem,
          restorePreOrderSplit,
        });
      }
      const updatedOrder = await updateOrderStatus(orderNumber, status);

      if (!isActivePreOrderSupplyOrder({ status })) {
        clearPendingPreOrderActionsForOrder(orderNumber);
      }

      if (shouldCreateInvoiceForStatus(status)) {
        await createOrUpdateInvoiceForDeliveredOrder({
          order: {
            ...(existingOrder || {}),
            ...(updatedOrder || {}),
            orderId: existingOrder?.orderId || updatedOrder?.order_number || orderNumber,
            items: existingOrder?.items || [],
            deliveredAt:
              updatedOrder?.delivered_at ||
              existingOrder?.deliveredAt ||
              new Date().toISOString(),
          },
          confirmedBy:
            updatedOrder?.delivered_confirmed_by ||
            existingOrder?.delivered_confirmed_by ||
            null,
          currentUser: loggedInUser,
        });
      }

      setOrders((oldOrders) =>
        oldOrders.map((order) =>
          order.orderId === orderNumber
            ? {
                ...order,
                status,
                deliveredAt: updatedOrder?.delivered_at || order.deliveredAt,
              }
            : order
        )
      );

      if (shouldCreateInvoiceForStatus(status) && page === "paymentHistory") {
        await fetchCustomerLedger();
      }
    } catch (error) {
      console.error("Status update error:", error);
      alert("Could not update order status.");
    }
  };

  const updateOrderExtraFields = async (orderNumber, updates) => {
    try {
      console.log("[CustomerOrder] updateOrderExtraFields", { orderNumber, updates });
      await updateOrderFields(orderNumber, updates);
      await fetchOrders();
    } catch (error) {
      console.error("Order update error:", error);
      alert("Could not update order details.");
    }
  };

  const effectiveSelectedCategory =
    selectedCategory !== "All Products"
      ? selectedCategory
      : selectedSubCategory !== "All Sub Categories"
        ? products.find((product) => isActiveProduct(product) && product.subCategory === selectedSubCategory)?.category ||
          "All Products"
        : "All Products";

  const subCategories = [
  "All Sub Categories",
  ...new Set(
    products
      .filter(
        (p) =>
          isActiveProduct(p) &&
          (effectiveSelectedCategory === "All Products" ||
          p.category === effectiveSelectedCategory)
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
          isActiveProduct(p) &&
          (effectiveSelectedCategory === "All Products" ||
            p.category === effectiveSelectedCategory) &&
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
          isActiveProduct(p) &&
          (effectiveSelectedCategory === "All Products" ||
            p.category === effectiveSelectedCategory) &&
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
        isActiveProduct(product) &&
        (!homepageProductSetIds.length ||
          homepageProductSetIds.includes(String(product.id))) &&
        (!homepagePromotionTarget ||
          productMatchesHomepagePromotion(product, homepagePromotionTarget)) &&
        (effectiveSelectedCategory === "All Products" ||
          productCategory === effectiveSelectedCategory) &&
        (selectedSubCategory === "All Sub Categories" ||
          productSubCategory === selectedSubCategory) &&
        (selectedBrand === "All Brands" ||
          productBrand === selectedBrand) &&
        (selectedSeries === "All Series" ||
          productSeries === selectedSeries) &&
        (homepageSelectionType !== "promotion" ||
          selectedSeries === "All Series" ||
          productMatchesPromotionPosterSeries({
            product,
            promotionRules,
            series: selectedSeries,
            priceMode,
          })) &&
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
  search,
  orderCountry,
  selectedCategory,
  effectiveSelectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
  homepagePromotionTarget,
  homepageProductSetIds,
  homepageSelectionType,
  promotionRules,
  priceMode,
]);

const totalProductPages = Math.max(
  1,
  Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE)
);

const visibleProducts = filteredProducts.slice(
  (productPage - 1) * PRODUCTS_PER_PAGE,
  productPage * PRODUCTS_PER_PAGE
);

const homepageSearchKeyword = search.trim().toLowerCase();
const homepageSearchProducts = useMemo(() => {
  if (!homepageSearchKeyword) return [];

  return sortOrderProductsByAvailability(
    products.filter((product) => {
      if (!isActiveProduct(product)) return false;
      if (orderCountry === "England" && !product.availableInEngland) return false;
      if (orderCountry === "Wales" && !product.availableInWales) return false;

      return [
        product.name,
        product.productCode,
        product.brand,
        product.series,
        product.flavour,
      ].some((value) => String(value || "").toLowerCase().includes(homepageSearchKeyword));
    })
  );
}, [homepageSearchKeyword, orderCountry, products]);
const homepageTotalProductPages = Math.max(
  1,
  Math.ceil(homepageSearchProducts.length / PRODUCTS_PER_PAGE)
);
const homepageVisibleSearchProducts = homepageSearchProducts.slice(
  (productPage - 1) * PRODUCTS_PER_PAGE,
  productPage * PRODUCTS_PER_PAGE
);

useEffect(() => {
  setProductPage(1);
}, [
  search,
  orderCountry,
  selectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
]);

const getHomepageSubtitle = (item) => {
  switch (String(item.description || "").trim().toLowerCase()) {
    case "big puff pre-filled kits-vape":
      return "Premium Disposable Vape Kits";

    case "pre-filled pod kits - refill":
      return "Replacement Pod Systems";

    case "smoking accessories":
      return "Smoking & Rolling Accessories";

    case "candy with fun toys assorted":
      return "Kids Candy & Novelty Toys";

    case "household items - cleaning, shoe accessories, house essentials":
      return "Cleaning & Home Essentials";

    default:
      return "Browse our latest products";
  }
};

  const rememberCartProduct = (productId) => {
    lastCartProductIdRef.current = String(productId || "");
  };

  const returnToProductBrowsing = () => {
    const productId = lastCartProductIdRef.current;
    const productCard = [...document.querySelectorAll("[data-product-id]")].find(
      (element) => String(element.dataset.productId || "") === productId
    );

    if (!productCard) {
      window.scrollTo({ top: browseScrollPositionRef.current, behavior: "smooth" });
      setCartNotice("Cart updated");
      return;
    }

    productCard.scrollIntoView({ behavior: "smooth", block: "start" });
    productCard.classList.add("ring-4", "ring-orange-400", "ring-offset-2");
    if (productHighlightTimerRef.current) {
      clearTimeout(productHighlightTimerRef.current);
    }
    productHighlightTimerRef.current = setTimeout(() => {
      productCard.classList.remove("ring-4", "ring-orange-400", "ring-offset-2");
    }, 1800);
  };

  const changeCartEditing = (nextEditing) => {
    if (nextEditing) {
      recordCustomerPortalView("cart");
      browseScrollPositionRef.current = window.scrollY;
      setIsCartEditing(true);
      requestAnimationFrame(() => {
        document.querySelector(".cart-panel")?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
      return;
    }

    setIsCartEditing(false);
    requestAnimationFrame(returnToProductBrowsing);
  };

  const addToCart = (product, qty = 1) => {
  const quantity = Math.max(1, Number(qty || 1));
  rememberCartProduct(product.id);
  browseScrollPositionRef.current = window.scrollY;
  setCartNotice("");

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

  queueCentralCartMutation((cartId) =>
    incrementCentralCartItem({
      profile: activeUser,
      cartId,
      productId: product.id,
      delta: quantity,
    })
  );
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
    queueCentralCartMutation((cartId) =>
      incrementCentralCartItem({
        profile: activeUser,
        cartId,
        productId: id,
        delta: 1,
      })
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
    queueCentralCartMutation((cartId) =>
      incrementCentralCartItem({
        profile: activeUser,
        cartId,
        productId: id,
        delta: -1,
      })
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
    queueCentralCartMutation((cartId) =>
      setCentralCartItemQuantity({
        profile: activeUser,
        cartId,
        productId: id,
        quantity,
      })
    );
  };

  const removeItem = (id) => {
    setCart((oldCart) =>
      applyCartPromotions(
        oldCart.filter((item) => !item.isPromotionFree && item.id !== id)
      )
    );
    queueCentralCartMutation((cartId) =>
      removeCentralCartItem({
        profile: activeUser,
        cartId,
        productId: id,
      })
    );
  };

  const promotionDiscountAmount = getPromotionDiscountAmount(cart);
  const effectiveOrderDiscountPercent = canManualCheckoutDiscount
    ? Number(orderDiscountPercent || 0)
    : 0;

  const cartTotals = calculateCartTotals(cart, {
    priceMode,
    discountPercent: effectiveOrderDiscountPercent,
    promotionDiscountAmount,
  });
  const discountAmount = cartTotals.discountAmount;
  const finalTotal = cartTotals.totalAmount;
  const orderPaymentChoiceValid = salesCheckoutPaymentRequired
    ? orderPaymentChoice === "cash_now" ||
      (orderPaymentChoice === "bank_transfer_now" && Boolean(orderBankProofFile))
    : orderPaymentChoice === "no_payment";

const selectedCustomerBranches = (selectedCustomerAccount?.customer_branches || []).filter(
  (branch) => branch.active !== false
);
const getPaymentMetadata = (row = {}) => {
  const metadata = row.metadata || row.payment_metadata || row.meta || {};
  if (metadata && typeof metadata === "object") return metadata;
  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return {};
};

const normalizeCustomerCollectionType = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

  if (["OUTSTANDING_PAYMENT", "PREVIOUS_BALANCE", "PREVIOUS_CREDIT_BALANCE"].includes(normalized)) {
    return "OUTSTANDING_PAYMENT";
  }
  if (["PART_PAYMENT", "PARTIAL_PAYMENT"].includes(normalized)) {
    return "PART_PAYMENT";
  }
  if (["UNALLOCATED_PAYMENT", "UNKNOWN_PAYMENT"].includes(normalized)) {
    return "UNALLOCATED_PAYMENT";
  }
  return normalized || "TODAY_INVOICE";
};

const getEffectiveCustomerCollectionType = (row = {}) => {
  const metadata = getPaymentMetadata(row);
  const collectionType = normalizeCustomerCollectionType(
    row.collection_type ||
      row.collectionType ||
      metadata.collection_type ||
      row.transaction_reason ||
      metadata.transaction_reason ||
      row.payment_applies_to ||
      metadata.payment_applies_to
  );

  if (collectionType !== "UNALLOCATED_PAYMENT") return collectionType;

  return normalizeCustomerCollectionType(
    row.resolved_collection_type ||
      row.resolvedCollectionType ||
      metadata.resolved_collection_type
  );
};

const getCustomerCollectionLabel = (row = {}) => {
  switch (getEffectiveCustomerCollectionType(row)) {
    case "OUTSTANDING_PAYMENT":
      return "Outstanding Payment";
    case "PART_PAYMENT":
      return "Part Payment";
    case "TODAY_INVOICE":
      return "Today's Invoice";
    default:
      return "Payment";
  }
};

const sortCustomerPaymentHistory = (rows = []) => {
  const originalPosition = new Map(
    rows.map((row, index) => [row, index])
  );

  return [...rows].sort((a, b) => {
    const aDate = new Date(
      a.orderingTimestamp ||
        a.ordering_timestamp ||
        a.created_at ||
        a.date ||
        a.payment_date ||
        a.invoice_date ||
        0
    ).getTime();
    const bDate = new Date(
      b.orderingTimestamp ||
        b.ordering_timestamp ||
        b.created_at ||
        b.date ||
        b.payment_date ||
        b.invoice_date ||
        0
    ).getTime();

    if (aDate !== bDate) return bDate - aDate;

    return originalPosition.get(a) - originalPosition.get(b);
  });
};

const displayedCustomerLedgerRowsWithBalance = sortCustomerPaymentHistory(
  customerLedger
).map((row) => ({
  row,
  debit: Number(row.debit || 0),
  credit: Number(row.credit || 0),
  balance: Number(row.running_balance || 0),
}));

const customerCreditSummary = paymentHistoryBranchId
  ? customerCreditSnapshot?.branchSummary || {}
  : customerCreditSnapshot?.customerSummary || {};
const customerLastPayment = Number(
  customerCreditSummary.lastPaymentAmount || 0
);
const isFinalOrderStatus = (status) =>
  ["delivered", "confirmed", "delivery confirmed", "completed"].includes(
    String(status || "").trim().toLowerCase()
  );

const shouldCreateInvoiceForStatus = (status) =>
  ["delivered", "confirmed", "delivery confirmed"].includes(
    String(status || "").trim().toLowerCase()
  );

const selectedCustomerAccountId = String(selectedCustomerAccount?.id || "");
const selectedCustomerName = String(
  selectedCustomerAccount?.account_name || companyName || ""
).trim().toLowerCase();

const completedCustomerOrdersFromOrders = orders.filter((order) => {
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

const completedCustomerOrders = [
  ...completedCustomerOrdersFromOrders,
  ...customerLedger
    .map((row) => row.__order)
    .filter(Boolean)
    .filter(
      (order) =>
        !completedCustomerOrdersFromOrders.some(
          (existingOrder) =>
            String(existingOrder.orderId || "") === String(order.orderId || "")
        )
    ),
].sort(
  (a, b) =>
    new Date(b.deliveredAt || b.createdAt || 0).getTime() -
    new Date(a.deliveredAt || a.createdAt || 0).getTime()
);

const getInvoiceOrderForLedgerRow = (row = {}) => {
  if (row.__order) return row.__order;

  const referenceNo = String(row.reference_no || row.order_number || "").trim();
  if (!referenceNo) return null;

  return completedCustomerOrders.find(
    (order) => String(order.orderId || "").trim() === referenceNo
  );
};

const getInvoiceLedgerRowForOrder = (order = {}) => {
  const orderReference = String(order.orderId || order.order_number || "").trim();
  if (!orderReference) return null;

  return allocatedCustomerLedger.find((row) => {
    const type = String(row.entry_type || row.transaction_type || "")
      .trim()
      .toUpperCase();
    const reference = String(row.reference_no || row.order_number || "").trim();
    return type === "INVOICE" && reference === orderReference;
  });
};

const getCustomerInvoiceStatus = (row = {}) => {
  const status = normalizeInvoicePaymentStatus(
    row.payment_status ||
      row.paymentStatus ||
      row.invoice_status ||
      row.invoiceStatus ||
      row.status ||
      ""
  );

  if (status === "PAID" || status === "UNPAID") {
    return status;
  }
  if (status === "PART PAID" || status === "PARTIALLY PAID") {
    return "PART PAID";
  }

  const invoiceTotal = Number(
    row.invoice_total ||
      row.invoiceTotal ||
      row.invoice_amount ||
      row.debit ||
      row.amount ||
      0
  );
  const paidAmount = Number(row.paid_amount || row.paidAmount || 0);

  if (paidAmount > 0 && invoiceTotal > 0 && paidAmount < invoiceTotal) {
    return "PART PAID";
  }

  return paidAmount >= invoiceTotal && invoiceTotal > 0 ? "PAID" : "UNPAID";
};

  const toggleOrderExpanded = (orderId) => {
    setExpandedOrders((old) => ({
      ...old,
      [orderId]: !old[orderId],
    }));
  };

  const saveSalesRepCollection = async () => {
  if (savingSalesPayment) return;

  const customer = selectedSalesPaymentCustomer;
  const salesCustomerBranches = selectedSalesPaymentBranches;
  const selectedSalesBranch = selectedSalesPaymentBranch;
  const paymentAmount = Number(salesPaymentForm.amount || 0);
  const selectedBranchOutstanding = selectedSalesBranch
    ? Number(
        salesOutstandingSnapshot.branchOutstanding[selectedSalesBranch.id] ??
          salesOutstandingSnapshot.branchOutstanding[selectedSalesBranch.branch_name] ??
          0
      )
    : Number(salesOutstandingSnapshot.totalOutstanding || 0);

  if (!customer) {
    alert("Please select customer.");
    return;
  }

  if (salesCustomerBranches.length > 0 && !selectedSalesBranch) {
    alert("Please select branch / shop.");
    return;
  }

  if (!(paymentAmount > 0)) {
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
    const now = new Date();
    const localToday = new Date(
      now.getTime() - now.getTimezoneOffset() * 60000
    )
      .toISOString()
      .split("T")[0];

    const selectedCollectionDate = String(
      salesPaymentForm.collectionDate || ""
    ).trim();

    const paymentDate =
      !selectedCollectionDate || selectedCollectionDate === localToday
        ? now.toISOString()
        : `${selectedCollectionDate}T12:00:00`;

    const unallocatedOutstanding = Math.max(
      0,
      selectedBranchOutstanding - paymentAmount
    );

    await postCanonicalCustomerPayment({
      customerAccountId: customer.id,
      customerBranchId: selectedSalesBranch?.id || null,
      amount: paymentAmount,
      paymentDate,
      paymentMethod: salesPaymentForm.paymentType,
      paymentSource: CANONICAL_PAYMENT_SOURCES.SALES_REP,
      paymentReference: "SALES_REP_COLLECTION",
      paidBy: salesPaymentForm.whoPaid,
      collectorName:
        activeUser.staff_name ||
        activeUser.name ||
        activeUser.username ||
        "",
      collectorStaffId: activeUser.staff_id || activeUser.id || null,
      collectorRole:
        activeUser.role || activeUser.access_level || "Sales Rep",
      paymentIntentId: salesPaymentForm.paymentIntentId,
      notes: [
        selectedSalesBranch
          ? `Branch: ${selectedSalesBranch.branch_name}`
          : "",
        salesPaymentForm.collectionDate
          ? `Collection date: ${salesPaymentForm.collectionDate}`
          : "",
        unallocatedOutstanding > 0
          ? `Partial collection - unallocated outstanding remaining: ${formatCurrency(
              unallocatedOutstanding
            )}`
          : "",
        salesPaymentForm.notes || "",
      ]
        .filter(Boolean)
        .join("`n"),
      metadata: {
        payment_applies_to: "SALES_REP_COLLECTION",
        allocation_mode: "CANONICAL_FIFO",
        collection_status:
          unallocatedOutstanding > 0
            ? "PARTIAL_COLLECTION"
            : "COLLECTION",
        unallocated_outstanding_amount: unallocatedOutstanding,
      },
      allocations: [],
    });

    const { outstandingState } = await loadSalesRepOutstanding({
      customer,
      selectedBranchId: selectedSalesBranch?.id || "",
    });

    setSalesOutstandingSnapshot(outstandingState);

    if (
      String(selectedCustomerAccount?.id || "") ===
      String(customer.id || "")
    ) {
      await loadCustomerCreditSnapshot(selectedCustomerAccount);
    }

    alert("Collection saved successfully.");

    setSalesPaymentForm({
      customerId: customer.id,
      branchId: selectedSalesBranch?.id || "",
      amount: "",
      paymentType: "Cash",
      whoPaid: "",
      collectionDate: new Date().toISOString().split("T")[0],
      notes: "",
      paymentIntentId: createPaymentIntentId(),
    });
  } catch (error) {
    alert(error.message);
  } finally {
    setSavingSalesPayment(false);
  }
};

const submitOrder = async () => {
  if (isSubmittingOrder || orderSubmissionLockRef.current) return;

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

  if (!orderPaymentChoiceValid) {
    alert(
      salesCheckoutPaymentRequired
        ? "Customer payment is required. Select Cash Paid, or Bank Transfer Paid and attach the payment screenshot."
        : "Please continue with No Payment Now. Card payment is not available in this checkout."
    );
    return;
  }

  const belowCostSpecialLines = paidCartForOrder.filter((item) => {
    if (!item.specialPriceApplied && !item.special_price_applied) return false;
    const unitPrice = Number(
      item.selectedPrice ?? item.price ?? item.unit_price ?? item.unitPrice ?? 0
    );
    const costPrice = Number(item.costPrice ?? item.cost_price ?? 0);
    return costPrice > 0 && unitPrice > 0 && unitPrice < costPrice;
  });

  if (belowCostSpecialLines.length > 0) {
    const message =
      "Special price is below cost price for:\n\n" +
      belowCostSpecialLines
        .map((item) => {
          const unitPrice = Number(
            item.selectedPrice ?? item.price ?? item.unit_price ?? item.unitPrice ?? 0
          );
          const costPrice = Number(item.costPrice ?? item.cost_price ?? 0);
          return `${item.name || item.productName || item.product_name || "Product"}: ${formatCurrency(unitPrice)} vs cost ${formatCurrency(costPrice)}`;
        })
        .join("\n");

    if (!isNisstajAdmin) {
      alert(`${message}\n\nOnly nisstaj_admin can approve below-cost special pricing.`);
      return;
    }

    if (!window.confirm(`${message}\n\nApprove below-cost special pricing?`)) {
      return;
    }
  }

  let checkoutBankProofDataUrl = "";
  if (salesCheckoutPaymentRequired && orderPaymentChoice === "bank_transfer_now") {
    try {
      checkoutBankProofDataUrl = await readCheckoutBankProofDataUrl(orderBankProofFile);
    } catch (proofError) {
      alert(proofError?.message || "Could not read the bank payment screenshot.");
      return;
    }
  }

  orderSubmissionLockRef.current = true;
  setIsSubmittingOrder(true);
  setSubmissionFeedback("sending");
  let requiresReauthentication = false;
  let submissionOrderNumber = "";

  try {
    await refreshSupabaseSessionIfNeeded();

  const accountStatus = getCustomerStatusLabel(
    selectedCustomerAccount?.account_status ||
      selectedCustomerAccount?.status ||
      "Active"
  );

  const creditSnapshot = await loadCustomerCreditSnapshot(selectedCustomerAccount);
  if (!creditSnapshot) {
    throw new Error("FairChoice could not verify the latest account balance. Please try again.");
  }
  const { ledgerRows = customerLedger, openingBalance = customerOpeningBalance } = creditSnapshot;
  const creditSummary = calculateCustomerCredit(
    selectedCustomerAccount,
    ledgerRows,
    openingBalance
  );
  const creditLimit = creditSummary.creditLimit;
  const outstandingBalance = creditSummary.outstanding;

  const orderTotal = roundMoney(finalTotal || 0);
  const projectedBalance = outstandingBalance + orderTotal;

  if (accountStatus === "On Hold") {
    setSubmissionFeedback("");
    alert("Customer account is On Hold. Order cannot be submitted.");
    return;
  }

  if (accountStatus === "Inactive") {
    setSubmissionFeedback("");
    alert("Customer account is Inactive. Please contact Accounts.");
    return;
  }

  if (!salesCheckoutPaymentRequired && creditLimit > 0 && projectedBalance > creditLimit) {
    setSubmissionFeedback("");
    alert(
      `Credit limit exceeded.\n\n` +
        `Credit Limit: ${formatCurrency(creditLimit)}\n` +
        `Outstanding Balance: ${formatCurrency(outstandingBalance)}\n` +
        `Current Order: ${formatCurrency(orderTotal)}\n` +
        `Projected Balance: ${formatCurrency(projectedBalance)}`
    );
    return;
  }

    const submissionFingerprint = JSON.stringify({
      customerAccountId: selectedCustomerAccount.id,
      customerBranchId: selectedBranch?.id || null,
      priceMode,
      paymentChoice: orderPaymentChoice,
      total: orderTotal,
      discountPercent: Number(effectiveOrderDiscountPercent || 0),
      cart: paidCartForOrder.map((item) => ({
        id: item.id,
        qty: Number(item.qty || 0),
        price: Number(item.selectedPrice ?? item.price ?? 0),
      })),
    });
    let savedSubmission = null;

    try {
      savedSubmission = JSON.parse(localStorage.getItem(orderSubmissionStorageKey) || "null");
    } catch {
      savedSubmission = null;
    }

    submissionOrderNumber =
      savedSubmission?.fingerprint === submissionFingerprint && savedSubmission?.orderNumber
        ? savedSubmission.orderNumber
        : `ORD-${Date.now()}-${globalThis.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;

    localStorage.setItem(
      orderSubmissionStorageKey,
      JSON.stringify({ orderNumber: submissionOrderNumber, fingerprint: submissionFingerprint })
    );

    const orderRequest = buildCustomerOrderRequest({
      orderNumber: submissionOrderNumber,
      customer: selectedCustomerAccount,
      branch: selectedBranch,
      priceMode,
      cart,
      finalTotal,
      effectiveOrderDiscountPercent,
      discountAmount,
      canManualCheckoutDiscount,
      userProfile,
      orderCountry,
      creditLimit,
    });

    let createdOrder;
    const submittingCentralCartId = CENTRAL_CART_ENABLED && !salesRouteMode
      ? await ensureCentralCartForCurrentScope()
      : null;

    if (submittingCentralCartId) {
      await centralCartMutationQueueRef.current.catch(() => undefined);
      await beginCentralCartSubmission({
        profile: activeUser,
        cartId: submittingCentralCartId,
        orderNumber: submissionOrderNumber,
      });
    }

    try {
      createdOrder = await createCustomerOrderWithSessionRetry({
        orderRequest,
        createOrder: createCustomerOrder,
        isAuthError: isOrderAuthError,
        refreshSession: () => supabase.auth.refreshSession(),
        promotionRunContext: {
          cart,
          customer: selectedCustomerAccount,
          branch: selectedBranch,
          actor: activeUser,
          audienceType: promotionAudienceType,
          country: orderCountry,
          profile: activeUser,
        },
      });
    } catch (error) {
      if (submittingCentralCartId) {
        await cancelCentralCartSubmission({
          profile: activeUser,
          cartId: submittingCentralCartId,
          orderNumber: submissionOrderNumber,
        }).catch((cancelError) =>
          console.error("Central cart submission rollback error:", cancelError)
        );
      }
      throw error;
    }

    const { orderNumber } = createdOrder;

    if (salesCheckoutPaymentRequired) {
      const checkoutPaymentMethod =
        orderPaymentChoice === "bank_transfer_now" ? "Bank Transfer" : "Cash";
      try {
        await postCanonicalCustomerPayment({
          customerAccountId: selectedCustomerAccount.id,
          customerBranchId: selectedBranch?.id || null,
          amount: orderTotal,
          paymentDate: new Date().toISOString(),
          paymentMethod: checkoutPaymentMethod,
          paymentSource: CANONICAL_PAYMENT_SOURCES.ORDER_PAYMENT,
          paymentReference: orderNumber,
          paidBy: selectedCustomerAccount.account_name || selectedCustomerAccount.company_name || "Customer",
          paymentIntentId: orderPaymentIntentId,
          notes: `Paid sales checkout for ${orderNumber}`,
          metadata: {
            payment_applies_to: "ORDER_CHECKOUT",
            order_number: orderNumber,
            bank_proof_data_url: checkoutBankProofDataUrl || null,
            bank_proof_name: orderBankProofFile?.name || null,
            bank_proof_mime_type: orderBankProofFile?.type || null,
          },
          allocations: [],
        });
      } catch (paymentError) {
        await updateOrderStatus(orderNumber, "Cancelled").catch((cancelError) =>
          console.error("Paid checkout rollback failed:", cancelError)
        );
        if (submittingCentralCartId) {
          await cancelCentralCartSubmission({
            profile: activeUser,
            cartId: submittingCentralCartId,
            orderNumber,
          }).catch((cancelError) =>
            console.error("Central cart payment rollback error:", cancelError)
          );
        }
        localStorage.removeItem(orderSubmissionStorageKey);
        setOrderPaymentIntentId(createPaymentIntentId());
        throw new Error(`Payment was not accepted, so the order was cancelled: ${paymentError?.message || "Unknown payment error"}`);
      }
    }

    if (submittingCentralCartId) {
      await finalizeCentralCartSubmission({
        profile: activeUser,
        cartId: submittingCentralCartId,
        orderNumber,
      }).catch((error) => {
        // Do not fail an order that already exists. The cart RPC auto-recovers
        // SUBMITTING carts when it later sees the matching order number.
        console.error("Central cart finalization error:", error);
      });
      setCentralCartId(null);
      centralCartLoadedScopeRef.current = "";
    }

const newOrder = {
    orderId: orderNumber,
    customerName: selectedCustomerAccount.account_name,
    companyName: selectedCustomerAccount.account_name,

    branchName: selectedBranch?.branch_name || "",

   deliveryAddress: selectedBranch?.delivery_address || "",
   priceMode,
   total: finalTotal,
   discount_percent: effectiveOrderDiscountPercent,
    discount_amount: canManualCheckoutDiscount ? Number(discountAmount || 0) : 0,
   discount_applied_by_name:
    canManualCheckoutDiscount ? userProfile?.full_name || userProfile?.name || "" : "",
   createdAt: new Date().toLocaleString(),
   status: "Received",
   paymentStatus: salesCheckoutPaymentRequired
     ? orderPaymentChoice === "bank_transfer_now" ? "PENDING_VERIFICATION" : "PAID"
     : "UNPAID",
   paymentChoice: orderPaymentChoice,
   items: paidCartForOrder,
    };

    setOrders((oldOrders) => [newOrder, ...oldOrders]);

    if (salesRouteMode) {
      await recordSalesRouteVisit({
        customerAccountId: selectedCustomerAccount.id,
        customerBranchId: selectedBranch?.id || null,
        staffId: activeUser?.staff_id || activeUser?.id || null,
        staffName: activeUser?.staff_name || activeUser?.name || activeUser?.username || "",
        outcome: "ORDER_PLACED",
        orderNumber,
        reason: salesRouteExceptionMode ? `Exception order â€” ${routeExceptionReason}` : "",
        note: salesRouteExceptionMode ? routeExceptionNote : "",
        routeAssignmentId: activeRouteAssignmentId,
      });
    }

    localStorage.removeItem(cartStorageKey);
    localStorage.removeItem(orderSubmissionStorageKey);

    setCart([]);
    setIsCartEditing(false);
    setOrderPaymentChoice(salesCheckoutPaymentRequired ? "cash_now" : "no_payment");
    setOrderBankProofFile(null);
    setOrderPaymentIntentId(createPaymentIntentId());
    setOrderDiscountPercent(0);

    if (!isCustomer) {
      if (salesRouteMode) {
        resetSalesRouteCustomer();
        await refreshSalesRoute();
      } else {
        setSelectedCustomerId("");
        setSelectedCustomerAccount(null);
        setSelectedBranchId("");
        setSelectedBranch(null);
        setCompanyName("");
      }
    }

    await fetchProducts();

    setSubmissionFeedback("success");

    alert(
  `Ã¢Å“â€¦ Order Submitted Successfully

Order Number: ${formatDisplayOrderId(orderNumber)}

Thank you for your order.

Your order has been received and is being processed by FairChoice.

Please quote your Order Number if you need assistance.`

);
  } catch (error) {
    requiresReauthentication = isOrderAuthError(error);
    setSubmissionFeedback("error");
    console.error("[OrderSubmission] failed", {
      event: "customer_order_submission_failed",
      timestamp: new Date().toISOString(),
      orderNumber: submissionOrderNumber || null,
      customerAccountId: selectedCustomerAccount?.id || null,
      customerBranchId: selectedBranch?.id || null,
      status: error?.status || error?.statusCode || null,
      code: error?.code || null,
      message: error?.message || String(error),
      online: navigator.onLine,
    });
    alert(
      String(error?.message || "").startsWith("Payment was not accepted")
        ? error.message
        : "We could not submit the order.\nPlease check your connection and try again."
    );
  } finally {
    orderSubmissionLockRef.current = false;
    setIsSubmittingOrder(false);
  }

  if (requiresReauthentication && onLogout) {
    await onLogout();
  }
};

const recalculateOrder = (order, updatedItems) => {
  const totals = calculateOrderTotals(updatedItems, {
    priceMode: order.priceMode || order.price_mode,
    discountPercent: order.discount_percent,
  });

  return {
    ...order,
    items: updatedItems,
    total: totals.totalAmount,
    finalTotal: totals.totalAmount,
    vat_total: totals.vatTotal,
    discount_amount: totals.discountAmount,
  };
};


const saveOrderTotalsToDatabase = async (orderId, items, order = {}) => {
  const totals = calculateOrderTotals(items || [], {
    priceMode: order.priceMode || order.price_mode,
    discountPercent: order.discount_percent,
  });

  const { error } = await supabase
    .from("orders")
  .update({
  subtotal: roundMoney(totals.netTotal).toFixed(2),
  net_total: roundMoney(totals.netTotal).toFixed(2),
  order_total: roundMoney(totals.grandTotal).toFixed(2),
  grand_total: roundMoney(totals.grandTotal).toFixed(2),
  vat_total: roundMoney(totals.vatTotal).toFixed(2),
  discount_percent: totals.discountPercent,
  discount_amount: roundMoney(totals.discountAmount).toFixed(2),
  updated_at: new Date().toISOString(),
})
    .eq("order_number", orderId);

  if (error) {
    console.error("Order total update error:", error);
  }
};

const getCalculatedOrderItemForSave = (item, order = {}) =>
  calculateCartOrderItems([item], {
    priceMode: order.priceMode || order.price_mode,
  })[0] || item;

const updateOrderItem = async (orderId, itemId, updates) => {
  const order = orders.find((entry) => entry.orderId === orderId);
  try {
    const result = await updateReceivedOrderItemWithPromotions({ order, itemId, updates });
    await fetchOrders();
    return result;
  } catch (error) {
    console.error("Update received-order item error:", error);
    alert("Could not update order item: " + (error?.message || "Promotion recalculation failed."));
    return false;
  }
};

const restorePreOrderSplit = async (orderId, originalItemId, addedItemId, restoreQty) => {
  const order = orders.find((entry) => String(entry.orderId) === String(orderId));
  const finalItems = (order?.items || []).map((item) => {
    const itemId = String(item.dbId || item.id || "");
    const changes = itemId === String(originalItemId)
      ? { qty: restoreQty, pickedQty: 0, sourceStatus: "Need Supplier", includeInPicking: false }
      : itemId === String(addedItemId)
        ? { qty: 0, pickedQty: 0, sourceStatus: "Need Supplier", includeInPicking: false }
        : null;
    if (!changes) return item;
    const merged = { ...item, ...changes };
    const calculated = getCalculatedOrderItemForSave(merged, order);
    return {
      ...merged,
      lineTotal: calculated.line_total, line_total: calculated.line_total,
      netTotal: calculated.net_total, net_total: calculated.net_total,
      grossTotal: calculated.gross_total, gross_total: calculated.gross_total,
      vatTotal: calculated.vat_total, vat_total: calculated.vat_total,
    };
  });
  const targets = finalItems.filter((item) =>
    [String(originalItemId), String(addedItemId)].includes(String(item.dbId || item.id || "")),
  );
  if (!order || targets.length !== 2) return false;
  for (const item of targets) {
    const { error } = await supabase.from("order_items").update({
      qty: Number(item.qty || 0),
      picked_qty: 0,
      source_status: "Need Supplier",
      include_in_picking: false,
      line_total: Number(item.line_total || 0).toFixed(2),
      net_total: Number(item.net_total || 0).toFixed(2),
      gross_total: Number(item.gross_total || 0).toFixed(2),
      vat_amount: Number(item.vat_total || 0).toFixed(2),
    }).eq("id", item.dbId || item.id);
    if (error) return false;
  }
  await saveOrderTotalsToDatabase(orderId, finalItems, order);
  await fetchOrders();
  return true;
};
const addOrderItem = async (orderId, newItem) => {
  const order = orders.find((entry) => entry.orderId === orderId);

  try {
    const result = await addReceivedOrderItemWithPromotions({ order, newItem });
    await fetchOrders();
    return result;
  } catch (error) {
    console.error("Add received-order item error:", error);
    alert("Could not add order item: " + (error?.message || "Promotion recalculation failed."));
    return null;
  }
};

const splitPreOrderItem = async (orderId, itemId, allocatedQty, remainingQty) => {
  const order = orders.find((o) => o.orderId === orderId);
  const item = order?.items?.find((currentItem) => {
    const currentKey =
      currentItem.dbId || currentItem.id || currentItem.productId || currentItem.product_id;
    return String(currentKey) === String(itemId);
  });

  if (!order?.dbId || !item) {
    alert("Order item not found for pre-order split.");
    return null;
  }

  const price = roundMoney(item.price || item.selectedPrice || item.unit_price || item.unitPrice || 0);
  const availableItem = getCalculatedOrderItemForSave(
    {
      ...item,
      qty: allocatedQty,
      pickedQty: allocatedQty,
      price,
      selectedPrice: price,
      unit_price: price,
      unitPrice: price,
      sourceStatus: "In Stock",
      includeInPicking: true,
    },
    order
  );

  const remainingItem = getCalculatedOrderItemForSave(
    {
      ...item,
      qty: remainingQty,
      pickedQty: 0,
      price,
      selectedPrice: price,
      unit_price: price,
      unitPrice: price,
      sourceStatus: "Need Supplier",
      includeInPicking: false,
    },
    order
  );

  const { error: updateError } = await supabase
    .from("order_items")
    .update({
      qty: remainingQty,
      picked_qty: 0,
      source_status: "Need Supplier",
      include_in_picking: false,
      line_total: remainingItem.line_total.toFixed(2),
      net_total: remainingItem.net_total.toFixed(2),
      gross_total: remainingItem.gross_total.toFixed(2),
      vat_amount: remainingItem.vat_total.toFixed(2),
    })
    .eq("id", item.dbId || itemId);

  if (updateError) {
    console.error("Pre-order split update error:", updateError);
    alert(updateError.message);
    return null;
  }

  const { data, error: insertError } = await supabase
    .from("order_items")
    .insert({
      order_id: order.dbId,
      product_id: item.productId || item.product_id || item.id,
      product_name: item.name || item.productName || item.product_name,
      brand: item.brand || "",
      series: item.series || "",
      flavour: item.flavour || "",
      carton_size: item.cartonSize || item.carton_size || "",
      qty: allocatedQty,
      picked_qty: allocatedQty,
      price: availableItem.price.toFixed(2),
      line_total: availableItem.line_total.toFixed(2),
      net_total: availableItem.net_total.toFixed(2),
      gross_total: availableItem.gross_total.toFixed(2),
      vat_amount: availableItem.vat_total.toFixed(2),
      source_status: "In Stock",
      include_in_picking: true,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Pre-order split insert error:", insertError);
    alert(insertError.message);
    return null;
  }

  const updatedItems = (order.items || []).map((currentItem) => {
    const currentKey =
      currentItem.dbId || currentItem.id || currentItem.productId || currentItem.product_id;
    if (String(currentKey) !== String(itemId)) return currentItem;

    return {
      ...currentItem,
      qty: remainingQty,
      pickedQty: 0,
      sourceStatus: "Need Supplier",
      includeInPicking: false,
      lineTotal: remainingItem.line_total,
      line_total: remainingItem.line_total,
      netTotal: remainingItem.net_total,
      net_total: remainingItem.net_total,
      grossTotal: remainingItem.gross_total,
      gross_total: remainingItem.gross_total,
      vatTotal: remainingItem.vat_total,
      vat_total: remainingItem.vat_total,
    };
  });

  updatedItems.push({
    ...item,
    dbId: data?.id,
    id: data?.id,
    qty: allocatedQty,
    pickedQty: allocatedQty,
    sourceStatus: "In Stock",
    includeInPicking: true,
    lineTotal: availableItem.line_total,
    line_total: availableItem.line_total,
    netTotal: availableItem.net_total,
    net_total: availableItem.net_total,
    grossTotal: availableItem.gross_total,
    gross_total: availableItem.gross_total,
    vatTotal: availableItem.vat_total,
    vat_total: availableItem.vat_total,
  });

  await saveOrderTotalsToDatabase(orderId, updatedItems, order);
  await fetchOrders();
  return data;
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
      image_url: isPlaceholderProductImage(productFormForSave.image)
        ? ""
        : String(productFormForSave.image || "").trim(),
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
    const totals = calculateDocumentTotals(order.items || [], order);
    const printableItems = sortPrintItems(totals.invoiceItems);

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
          <div><b>Price:</b> ${getPriceModeLabel(order.priceMode)}</div>
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

  const openCustomerInvoiceDocument = async (
    order,
    invoiceStatus = "UNPAID",
    download = false
  ) => {
    try {
      const freshOrder = await fetchInvoiceOrderFromDb(order);
      const hasEmbeddedOrderItems =
        Array.isArray(order?.items) || Array.isArray(order?.order_items);
      if (!freshOrder && !hasEmbeddedOrderItems) {
        throw new Error("This invoice is not linked to an order document.");
      }

      const watermark = getCustomerInvoiceWatermark(invoiceStatus);
      const resolvedOrder = await withResolvedInvoicePaymentStatus({
        ...(freshOrder || order),
        _documentPaymentStatus: watermark,
        documentPaymentStatus: watermark,
        invoicePaymentStatus: invoiceStatus,
      });

      if (download) {
        await downloadCentralInvoice(resolvedOrder);
        return;
      }

      await previewCentralInvoice(resolvedOrder);
    } catch (error) {
      console.error("Invoice document error:", error);
      alert(
        `Could not ${download ? "download" : "open"} invoice: ${
          error.message || error
        }`
      );
    }
  };

  const openPickingOrder = async (order) => {
    try {
      await claimOrderForPicking(order.orderId, loggedInUser);
      await fetchOrders();
      setPickingOrderId(order.orderId);
      setPage("picking");
    } catch (error) {
      alert(error.message || "This order cannot be opened for picking.");
    }
  };

  const closePickingOrder = () => {
    setPickingOrderId(null);
    setPage("orders");
  };

  const activePickingOrder = orders.find(
    (order) => String(order.orderId) === String(pickingOrderId)
  );

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
        pricingSettings={pricingSettings}
        openPickingOrder={openPickingOrder}
      />
    )}

    {page === "picking" && activePickingOrder && (
      <OrderPicking
        order={activePickingOrder}
        products={products}
        currentUser={loggedInUser}
        onExit={closePickingOrder}
        onRefresh={fetchOrders}
      />
    )}

    {page === "warehouse" && (
      <Warehouse
        orders={orders}
        printPickingList={printPickingList}
        changeOrderStatus={changeOrderStatus}
        updateOrderExtraFields={updateOrderExtraFields}
        refreshOrders={fetchOrders}
      />
    )}

    {page === "preOrderSupply" && (
      <PreOrderSupply
        orders={orders}
        products={products}
        updateOrderItem={updateOrderItem}
        addOrderItem={addOrderItem}
        splitPreOrderItem={splitPreOrderItem}
        restorePreOrderSplit={restorePreOrderSplit}
        refreshOrders={fetchOrders}
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
    {page === "salesRouteSetup" && <SalesRouteSetup currentUser={activeUser} />}
    {page === "homePageImages" && <HomePageImages currentUser={activeUser} />}

    {page === "products" && (
      <AdminProducts
        products={products}
        productForm={productForm}
        setProductForm={setProductForm}
        editingId={editingId}
        saveProduct={saveProduct}
        fetchProducts={fetchProducts}
        editProduct={editProduct}
        pricingSettings={pricingSettings}
      />
    )}

    {page === "credit" && <CustomerCredit />}
    {page === "centralPayment" && (
      <CentralPayment
        currentUser={activeUser}
        onInvalidSession={onLogout}
      />
    )}
    {page === "branchSeparation" && <BranchSeparation />}
    {page === "orderSalesInvoices" && <OrderSalesInvoices />}
    {page === "invoicesPortal" && <InvoicesPortal />}
    {page === "returnsPortal" && <ReturnsPortal />}
    {page === "weeklyAccount" && <WeeklyAccount currentUser={activeUser} />}
    {page === "supplierAccounts" && <SupplierAccounts user={activeUser} />}
    {page === "expenses" && <Expenses />}
    {page === "profitPortal" && (
      <ProfitAnalysisReport currentUser={activeUser} />
    )}
    {page === "totalCreditOutstanding" && <AllCreditOutstanding customers={customerAccounts} />}
    {page === "productLineAnalysis" && (
      <ProductLineAnalysisReport currentUser={activeUser} />
    )}
    {page === "brandPerformance" && <BrandPerformanceReport currentUser={activeUser} />}
    {page === "purchasePlanning" && (
      <PurchasePlanningReport products={products} currentUser={activeUser} />
    )}
    {page === "warehouseActivity" && (
      <WarehouseActivityReport currentUser={activeUser} />
    )}
    {page === "salesRouteAnalysis" && <SalesRouteAnalysisReport currentUser={activeUser} />}
    {page === "stockhistory" && <StockHistory />}
    {page === "stockTaking" && (
      <StockTaking products={products} fetchProducts={fetchProducts} />
    )}

    {page === "stockreceipts" && (
      <StockReceipts products={products} fetchProducts={fetchProducts} />
    )}

    {page === "staff" && <Staff currentUser={activeUser} onOpenAccessControl={(staffId) => { setAccessControlStaffId(staffId); setPage("accessControl"); }} />}
    {page === "staffLogin" && <StaffLogin initialStaffId={accessControlStaffId} onOpenAccessControl={(staffId) => { setAccessControlStaffId(staffId); setPage("accessControl"); }} />}
    {page === "customerLogin" && <CustomerLogin />}
    {(page === "accessControl" || page === "loginSetup") && <AccessControl initialStaffId={accessControlStaffId} />}
    {page === "suppliers" && <Suppliers user={activeUser} />}
    {page === "pricingRule" && (
  <PricingRule
    pricingSettings={pricingSettings}
    fetchPricingSettings={fetchPricingSettings}
  />
)}
  {page === "priceManagement" && (
  <PriceManagement
    products={products || []}
    fetchProducts={fetchProducts}
    pricingSettings={pricingSettings}
  />
)}

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

const brandPartnerReadOnlyOrder = isBrandPartner && activeDuty === "admin";

const portalPageIsAllowed = page === "order" && !isCustomer
  ? (isSalesRep || brandPartnerReadOnlyOrder)
  : isCustomerPortalPageAllowed(page, portalRoleState);

  const isBackOfficePage = Boolean(PAGE_BY_ROUTE[page]) || ["picking", "stockhistory", "stockreceipts", "loginSetup"].includes(page);

  if (!isCustomer && isBackOfficePage && page !== "order") {
    return (
      <BackOfficeLayout
        page={page}
        setPage={setPage}
        fetchOrders={fetchOrders}
        currentUser={backOfficeUser}
        isAdmin={isAdmin}
        isSalesRep={isSalesRep}
        isWarehouse={isWarehouse}
        isDriver={isDriver}
        isCustomer={isCustomer}
        onLogout={onLogout}
      >
        {backOfficeContent}
      </BackOfficeLayout>
    );
  }

  return (
    <div className="customer-portal-shell min-h-screen bg-slate-100 p-4 pb-40">
      <div className="customer-portal-container max-w-7xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden">
        
        {!((isSalesRep || isCustomer) && page === "order") && (
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
        onClick={async () => {
          if (window.confirm("Log out now?")) {
            await onLogout?.();
          }
        }}
        className="logout-btn border border-white/30 px-3 py-1 rounded-lg text-xs font-medium hover:bg-white/10 transition whitespace-nowrap"
      >
        Logout
      </button>

      {isCustomer && (
        <div className="customer-nav-buttons flex gap-2">
          <button
            onClick={goToCustomerHome}
            className={`order-tab-btn btn-secondary bg-white text-blue-800 px-3 py-1 rounded-lg text-xs font-bold ${page === "order" ? "active" : ""}`}
          >
            Order
          </button>

          <button
            onClick={async () => {
              await fetchCustomerLedger();
              recordCustomerPortalView("paymentHistory", "paymentHistory");
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
          onClick={openBackOffice}
          className="back-office-btn mb-4 rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-800"
        >
          Back Office
        </button>
      )}

      {isSalesRep && (
        <div className="customer-nav-buttons flex gap-1 sm:gap-2">
          {salesRouteMode && (
            <button onClick={resetSalesRouteCustomer} className="payment-history-tab-btn btn-primary bg-white/10 border border-white/30 text-white px-2 sm:px-3 py-1 rounded-lg text-xs font-bold">Route</button>
          )}
          <button onClick={() => setPage("order")} className={`order-tab-btn btn-secondary bg-white text-blue-800 px-2 sm:px-3 py-1 rounded-lg text-xs font-bold ${page === "order" ? "active" : ""}`}>Order</button>
          <button type="button" onClick={() => { window.location.hash = "promotion-run"; }} className="payment-history-tab-btn border border-emerald-200 bg-emerald-500 text-white px-2 sm:px-3 py-1 rounded-lg text-xs font-bold">Promotion Run</button>
          {salesRouteMode && <button onClick={() => setPage("expenses")} className={`payment-history-tab-btn bg-white/10 border border-white/30 text-white px-2 sm:px-3 py-1 rounded-lg text-xs font-bold ${page === "expenses" ? "active" : ""}`}>Expenses</button>}
          {canCollectCash && (
            <button onClick={() => { if (salesRouteMode && selectedCustomerAccount) setSalesPaymentForm((f) => ({ ...f, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" })); setPage("salesCashCollection"); }} className={`payment-history-tab-btn btn-primary bg-white/10 border border-white/30 text-white px-2 sm:px-3 py-1 rounded-lg text-xs font-bold ${page === "salesCashCollection" ? "active" : ""}`}>Collection</button>
          )}
          <button onClick={() => { if (salesRouteMode && selectedCustomerAccount) setSalesReturnForm((f) => ({ ...f, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" })); setPage("salesReturn"); }} className={`payment-history-tab-btn btn-primary bg-white/10 border border-white/30 text-white px-2 sm:px-3 py-1 rounded-lg text-xs font-bold ${page === "salesReturn" ? "active" : ""}`}>Return</button>
          {salesRouteMode && selectedCustomerAccount && !salesRouteExceptionMode && (
            <button onClick={() => setShowNoOrderForm(true)} className="payment-history-tab-btn border border-amber-200 bg-amber-400 text-slate-950 px-2 sm:px-3 py-1 rounded-lg text-xs font-bold">No Order</button>
          )}
        </div>
      )}
    </div>
  </div>

</div>
        )}

        {showSalesRouteModal && salesRouteMode && (
          <div
            className="fixed inset-0 z-[90] flex items-end bg-slate-950/60 p-0 sm:items-center sm:justify-center sm:p-4"
            onMouseDown={(event) => event.target === event.currentTarget && setShowSalesRouteModal(false)}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="sales-route-modal-title"
              className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl"
            >
              <div className="flex items-start justify-between gap-3 border-b px-4 py-4">
                <div>
                  <h2 id="sales-route-modal-title" className="text-xl font-black text-slate-900 sm:text-2xl">Todayâ€™s Route</h2>
                  <p className="mt-1 text-sm text-slate-500">Tap a customer to start their order. Completed visits remain marked.</p>
                </div>
                <button type="button" onClick={() => setShowSalesRouteModal(false)} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700">Close</button>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-b bg-slate-50 px-4 py-3">
                <select
                  className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold"
                  value={salesRouteCountryFilter}
                  onChange={(event) => setSalesRouteCountryFilter(event.target.value)}
                >
                  <option value="All">All countries</option>
                  {[...new Set(salesRouteRows.map((row) => row.branch?.country || row.customer?.country || row.customer?.account_country).filter(Boolean))].sort().map((country) => (
                    <option key={country} value={country}>{country}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setShowSalesRouteModal(false); setShowRouteExceptionForm(true); }}
                  className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-black text-white"
                >
                  Exception Order
                </button>
                <button type="button" onClick={refreshSalesRoute} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold">Refresh</button>
              </div>

              <div className="overflow-y-auto p-3 sm:p-4">
                {salesRouteLoading ? (
                  <div className="p-8 text-center text-slate-500">Loading routeâ€¦</div>
                ) : salesRouteRows.length ? (
                  <>
                    <div className="grid gap-2">
                      {visibleSalesRouteRows.map((routeRow) => {
                        const completed = routeRow.status !== "NOT_VISITED";
                        return (
                          <button
                            key={routeRow.id}
                            type="button"
                            disabled={completed}
                            onClick={() => openSalesRouteCustomer(routeRow)}
                            className={`grid min-h-[72px] grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-2xl border p-3 text-left sm:grid-cols-[44px_minmax(0,1fr)_auto] ${completed ? "bg-slate-100 opacity-70" : "bg-white hover:border-blue-600 hover:bg-blue-50"}`}
                          >
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-950 text-base font-black text-white">{routeRow.visit_sequence || "â€¢"}</span>
                            <span className="min-w-0">
                              <strong className="block truncate text-base text-slate-900">{routeRow.customer.account_name}</strong>
                              <span className="mt-0.5 block truncate text-sm text-slate-500">{routeRow.branch?.branch_name || "Main account"} Â· {routeRow.branch?.postcode || routeRow.customer.postcode || routeRow.customer.town_city || "Location not set"}</span>
                            </span>
                            <span className={`col-start-2 w-fit rounded-full px-2.5 py-1 text-xs font-bold sm:col-start-auto ${completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{completed ? (routeRow.status === "ORDER_PLACED" ? "Order placed" : "No order") : "Tap to order"}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                      <span className="mr-auto text-slate-500">Showing {filteredSalesRouteRows.length ? (currentSalesRoutePage - 1) * 30 + 1 : 0}â€“{Math.min(currentSalesRoutePage * 30, filteredSalesRouteRows.length)} of {filteredSalesRouteRows.length}</span>
                      <button className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={currentSalesRoutePage <= 1} onClick={() => setSalesRoutePage((pageNumber) => Math.max(1, pageNumber - 1))}>Previous</button>
                      <span className="font-bold">{currentSalesRoutePage} / {salesRoutePageCount}</span>
                      <button className="min-h-10 rounded-lg border px-3 disabled:opacity-40" disabled={currentSalesRoutePage >= salesRoutePageCount} onClick={() => setSalesRoutePage((pageNumber) => Math.min(salesRoutePageCount, pageNumber + 1))}>Next</button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl bg-amber-50 p-6 text-center text-amber-900">
                    <strong className="text-base">No customers assigned to todayâ€™s route.</strong>
                    <div className="mt-1 text-sm">Admin can add customers in Sales Route Setup.</div>
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {showRouteExceptionForm && salesRouteMode && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
              <h3 className="text-xl font-bold">Exception Order â€” Outside Todayâ€™s Route</h3>
              <p className="mt-1 text-sm text-slate-500">Use this only when an order must be taken from a customer who is not on todayâ€™s assigned route. The reason is recorded.</p>
              <label className="mt-4 block text-sm font-bold">Reason<select className="mt-1 w-full rounded-xl border p-3" value={routeExceptionReason} onChange={(e) => setRouteExceptionReason(e.target.value)}><option value="">Select reason</option>{EXCEPTION_ORDER_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
              <label className="mt-3 block text-sm font-bold">Note<textarea className="mt-1 w-full rounded-xl border p-3" rows="3" value={routeExceptionNote} onChange={(e) => setRouteExceptionNote(e.target.value)} placeholder="Optional note; required for Other" /></label>
              <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowRouteExceptionForm(false)} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button onClick={confirmSalesRouteException} className="rounded-xl bg-red-600 px-4 py-2 font-bold text-white">Continue to Normal Order</button></div>
            </div>
          </div>
        )}

        {showNoOrderForm && salesRouteMode && selectedCustomerAccount && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
              <h3 className="text-xl font-bold">Confirm Visit â€” No Order</h3>
              <p className="mt-1 text-sm text-slate-500">{selectedCustomerAccount.account_name}{selectedBranch?.branch_name ? ` Â· ${selectedBranch.branch_name}` : ""}</p>
              <label className="mt-4 block text-sm font-bold">Reason<select className="mt-1 w-full rounded-xl border p-3" value={noOrderReason} onChange={(e)=>setNoOrderReason(e.target.value)}><option value="">Select reason</option>{NO_ORDER_REASONS.map(reason=><option key={reason} value={reason}>{reason}</option>)}</select></label>
              <label className="mt-3 block text-sm font-bold">Note<textarea className="mt-1 w-full rounded-xl border p-3" rows="3" value={noOrderNote} onChange={(e)=>setNoOrderNote(e.target.value)} placeholder="Optional note; required for Other" /></label>
              <div className="mt-4 flex justify-end gap-2"><button onClick={()=>setShowNoOrderForm(false)} className="rounded-xl border px-4 py-2 font-bold">Cancel</button><button onClick={confirmSalesRouteNoOrder} className="rounded-xl bg-amber-500 px-4 py-2 font-bold text-slate-950">Confirm No Order</button></div>
            </div>
          </div>
        )}

        {!portalPageIsAllowed && (
          <div className="m-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-slate-800">
            <p className="font-bold">Opening the Order page...</p>
            <p className="mt-1 text-sm">The requested page is not available for this login.</p>
          </div>
        )}

        {(isSalesRep || isCustomer || brandPartnerReadOnlyOrder) && page === "order" && (
          <div className="customer-order-page p-3 md:p-4 pb-32 md:pb-40 grid grid-cols-1 lg:grid-cols-4 gap-3 md:gap-4">

            <div className="lg:col-span-4">
                <HomeCategoryGrid
                  headerOnly
                  items={homepageCategoryCards}
                  loading={false}
                  search={search}
                  productResultCount={0}
                  onSearchChange={updateHomepageSearch}
                  onBrowse={openHomepageItem}
                  onHome={goToCustomerHome}
                  cartItemCount={cart.filter((item) => !item.isPromotionFree).reduce((sum, item) => sum + Number(item.qty || 0), 0)}
                  onCartClick={openCustomerCart}
                  menuItems={
                    isSalesRep
                      ? [
                          { label: "Route", hidden: !salesRouteMode, onClick: () => setShowSalesRouteModal(true) },
                          { label: "Order", onClick: () => setPage("order") },
                          { label: "Promotion Run", onClick: () => { window.location.hash = "promotion-run"; } },
                          { label: "Expenses", hidden: !salesRouteMode, onClick: () => setPage("expenses") },
                          { label: "Cash Collection", hidden: !canCollectCash, onClick: () => { if (salesRouteMode && selectedCustomerAccount) { setSalesPaymentForm((form) => ({ ...form, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" })); } setPage("salesCashCollection"); } },
                          { label: "Return", onClick: () => { if (salesRouteMode && selectedCustomerAccount) { setSalesReturnForm((form) => ({ ...form, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" })); } setPage("salesReturn"); } },
                          { label: "No Order", hidden: !salesRouteMode || !selectedCustomerAccount || salesRouteExceptionMode, onClick: () => setShowNoOrderForm(true) },
                          { label: "Back Office", hidden: !(isAdminStaffRole(activeUser?.role || activeUser?.access_level) || (isBrandPartner && activeDuty === "admin")), divider: true, onClick: openBackOffice },
                          { label: "Logout", divider: true, danger: true, onClick: async () => { if (window.confirm("Log out now?")) await onLogout?.(); } },
                        ]
                      : isCustomer
                      ? [
                          { label: "Order", onClick: goToCustomerHome },
                          { label: "Payment History", onClick: async () => { await fetchCustomerLedger(); recordCustomerPortalView("paymentHistory", "paymentHistory"); setPage("paymentHistory"); } },
                          { label: "Logout", divider: true, danger: true, onClick: async () => { if (window.confirm("Log out now?")) await onLogout?.(); } },
                        ]
                      : []
                  }
                />
              </div>

            {selectedCustomerAccount && (
              <div className="lg:col-span-4 overflow-x-auto border-y border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 [scrollbar-width:none] sm:px-4">
                <div className="flex min-w-max items-center gap-5 font-semibold">
                  <span><strong>Credit Limit:</strong> {formatCurrency(selectedCustomerAccount?.credit_limit)}</span>
                  <span><strong>Credit Balance:</strong> {formatCurrency(getCreditBalance(selectedCustomerAccount, customerLedger, customerOpeningBalance))}</span>
                  <span className="inline-flex items-center gap-1.5"><strong>Customer:</strong> {selectedCustomerAccount.account_name}{!isCustomer && (<button type="button" title="Change customer" aria-label="Change customer" onClick={() => { if (salesRouteMode && !salesRouteExceptionMode) { resetSalesRouteCustomer(); setShowSalesRouteModal(true); } else { setCustomerDetailsExpanded(true); setTimeout(() => document.getElementById("order-customer-details")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); } }} className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900">✎</button>)}</span>
                  <span><strong>Branch:</strong> {selectedBranch?.branch_name || "Main account"}</span>
                  <span><strong>Address:</strong> {getCustomerAddress(selectedCustomerAccount, selectedBranch)}</span>
                </div>
              </div>
            )}

            {!showHomepage && (
            <div className="lg:col-span-4">
<ProductFilters
  search={search}
  setSearch={(value) => {
    setSearch(value);
    if (String(value || "").trim()) setShowHomepage(false);
  }}
  selectedCategory={selectedCategory}
  browseTitle={homepageBrowseTitle}
  brands={brands}
  selectedBrand={selectedBrand}
  seriesList={seriesList}
  selectedSeries={selectedSeries}
  subCategories={subCategories}
  selectedSubCategory={selectedSubCategory}

  setSelectedSubCategory={(value) => {
    setShowHomepage(false);
    setSelectedSubCategory(value);
    setSelectedBrand("All Brands");
    setSelectedSeries("All Series");
  }}

  setSelectedBrand={(value) => {
    setShowHomepage(false);
    setSelectedBrand(value);
    setSelectedSeries("All Series");
  }}

  setSelectedSeries={(value) => {
    setShowHomepage(false);
    setSelectedSeries(value);
  }}
  resultCount={filteredProducts.length}
  onBackToCategories={goToCustomerHome}
  onClearAll={() => setProductPage(1)}
/>

            </div>
            )}

 <div className="lg:col-span-4 bg-slate-50 rounded-2xl p-3 md:p-4">

  {salesRouteMode && salesRouteExceptionMode && (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm">
      <div><strong>Exception Order</strong><div className="text-xs text-red-800">{routeExceptionReason}{routeExceptionNote ? ` Â· ${routeExceptionNote}` : ""}</div></div>
      <button onClick={() => { resetSalesRouteCustomer(); setShowSalesRouteModal(true); }} className="rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-bold text-red-700">Cancel & Return to Route</button>
    </div>
  )}

  {(!salesRouteMode || salesRouteExceptionMode || selectedCustomerAccount) && (!selectedCustomerAccount || customerDetailsExpanded) && (
  <div id="order-customer-details" className="transition-all duration-200">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3 text-sm font-bold">

    <div className="grid w-full grid-cols-1 items-center gap-2 text-slate-700 md:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
      <div className="font-semibold truncate">
        Address: {getCustomerAddress(selectedCustomerAccount, selectedBranch)}
      </div>
      <div className="whitespace-nowrap">
        Credit Balance {formatCurrency(getCreditBalance(selectedCustomerAccount, customerLedger, customerOpeningBalance))}
      </div>
      <div className="whitespace-nowrap">
        Credit Limit {formatCurrency(selectedCustomerAccount?.credit_limit)}
      </div>
    </div>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-[minmax(150px,0.8fr)_minmax(230px,1.2fr)_minmax(230px,1fr)_minmax(120px,0.45fr)] gap-3 mb-3 items-end">
   {!isCustomer && (!salesRouteMode || salesRouteExceptionMode) && (
  <div>
    <label className="font-bold text-sm block mb-1">
      Search
    </label>

    <input
      className="border rounded-xl p-3 w-full"
      value={customerSearchTerm}
      onChange={(e) => setCustomerSearchTerm(e.target.value)}
      placeholder="Search customer"
    />
  </div>
    )}

   {!isCustomer && (!salesRouteMode || salesRouteExceptionMode) && (
  <div>
    <label className="font-bold text-sm block mb-1">
      Customer Details
    </label>

    <select
      className="border rounded-xl p-3 w-full"
      value={selectedCustomerId}
      onChange={(e) => {
        const customerId = e.target.value;

        const customer = activeCustomerAccounts.find(
          (c) => String(c.id) === String(customerId)
        );

        setSelectedCustomerId(customerId);
        setSelectedCustomerAccount(customer || null);
        setSelectedBranchId("");
        setSelectedBranch(null);
        setOrderPaymentChoice(salesCheckoutPaymentRequired ? "cash_now" : "no_payment");
        setOrderBankProofFile(null);
        setOrderPaymentIntentId(createPaymentIntentId());
        setCustomerDetailsExpanded(
          !customer || getCustomerBranches(customer).length > 0
        );

        if (customer) {
          setCompanyName(customer.account_name);

          const allowedModes = isAdmin
            ? ["vat", "server", "manager", "super"]
            : getAllowedPriceModesForCustomer(customer, pricingSettings);

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
      <option value="">
        {customerSearchTerm && !filteredCustomersForSalesRep.length
          ? "No matching active customers"
          : "Select Customer"}
      </option>

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
   const showBranchSelector = (!salesRouteMode || salesRouteExceptionMode) && (!isCustomer || activeBranches.length > 1);

   if (!showBranchSelector && !showPriceModeSelector) return null;

   return (
   <div
  className="flex flex-col gap-3 md:flex-row md:items-end"
  style={{ alignItems: "flex-end" }}
>
      {showBranchSelector && (
        <div className="min-w-0 md:min-w-[230px]">
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
              setCustomerDetailsExpanded(!branch);
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
      )}

      {showPriceModeSelector && (
  <div
    style={{
      width: "150px",
      minWidth: "150px",
      flexShrink: 0,
    }}
  >
    <label
      className="font-bold text-sm block mb-1"
      style={{ whiteSpace: "nowrap" }}
    >
      Price Mode
    </label>

    <select
      value={priceMode}
      onChange={(e) => setPriceMode(e.target.value)}
      className="border rounded-xl p-3 font-bold bg-white text-slate-700"
      style={{
        width: "150px",
        minWidth: "150px",
      }}
    >
      {allowedPriceModes.includes("vat") && (
        <option value="vat">Ex.VAT</option>
      )}

      {allowedPriceModes.includes("server") && (
        <option value="server">Inc.VAT</option>
      )}

      {allowedPriceModes.includes("manager") && (
        <option value="manager">Manager Offer</option>
      )}

      {allowedPriceModes.includes("super") && (
        <option value="super">Admin Offer</option>
      )}
    </select>
  </div>
)}
    </div>
  );
})()}

{(isAdmin || isSalesRep) && (
  <div className="md:max-w-[150px]">
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
  </div>
  )}


{!showHomepage && (
<div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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
)}

</div>

            <div className="lg:col-span-4">
              {showHomepage ? (
                <HomeCategoryGrid
                  hideHeader
                  items={homepageCategoryCards}
                  loading={homepageLoading || productsLoading}
                  search={search}
                  productResultCount={homepageSearchProducts.length}
                  onSearchChange={updateHomepageSearch}
                  onBrowse={openHomepageItem}
                  onHome={goToCustomerHome}
                  cartItemCount={cart.filter((item) => !item.isPromotionFree).reduce((sum, item) => sum + Number(item.qty || 0), 0)}
                  onCartClick={openCustomerCart}
                  products={products}
                  salesMetrics={homepageSalesMetrics}
                  getProductPrice={getPrice}
                  onProductClick={openProductDetails}
                  menuItems={
                    isSalesRep
                      ? [
                          { label: "Route", hidden: !salesRouteMode, onClick: () => setShowSalesRouteModal(true) },
                          { label: "Order", onClick: () => setPage("order") },
                          { label: "Promotion Run", onClick: () => { window.location.hash = "promotion-run"; } },
                          { label: "Expenses", hidden: !salesRouteMode, onClick: () => setPage("expenses") },
                          {
                            label: "Cash Collection",
                            hidden: !canCollectCash,
                            onClick: () => {
                              if (salesRouteMode && selectedCustomerAccount) {
                                setSalesPaymentForm((form) => ({ ...form, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" }));
                              }
                              setPage("salesCashCollection");
                            },
                          },
                          {
                            label: "Return",
                            onClick: () => {
                              if (salesRouteMode && selectedCustomerAccount) {
                                setSalesReturnForm((form) => ({ ...form, customerId: selectedCustomerAccount.id, branchId: selectedBranch?.id || "" }));
                              }
                              setPage("salesReturn");
                            },
                          },
                          { label: "No Order", hidden: !salesRouteMode || !selectedCustomerAccount || salesRouteExceptionMode, onClick: () => setShowNoOrderForm(true) },
                          {
                            label: "Logout",
                            divider: true,
                            danger: true,
                            onClick: async () => {
                              if (window.confirm("Log out now?")) await onLogout?.();
                            },
                          },
                        ]
                      : []
                  }
                >
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 md:gap-3">
                    {homepageVisibleSearchProducts.map((product) => {
                      const activePromotionPriceRule = getActivePromotionPriceRule(product);
                      return (
                        <ProductCard
                          key={product.id}
                          product={{
                            ...product,
                            isPromotion: product.isPromotion || Boolean(activePromotionPriceRule),
                            promotionName: activePromotionPriceRule?.promotion_name || product.promotionName,
                            displayMessage: getProductDisplayMessage(product),
                          }}
                          addToCart={addToCart}
                          onImageClick={openProductDetails}
                          price={getPrice(product)}
                          cartQty={cart.find((item) => item.id === product.id)?.qty || 0}
                          onAdd={addToCart}
                        />
                      );
                    })}
                  </div>
                  {homepageSearchProducts.length > 0 && (
                    <div className="mt-4 flex items-center justify-center gap-3">
                      <button type="button" onClick={() => setProductPage((pageNumber) => Math.max(1, pageNumber - 1))} disabled={productPage <= 1} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                      <span className="text-sm font-bold text-slate-600">Page {productPage} of {homepageTotalProductPages}</span>
                      <button type="button" onClick={() => setProductPage((pageNumber) => Math.min(homepageTotalProductPages, pageNumber + 1))} disabled={productPage >= homepageTotalProductPages} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
                    </div>
                  )}
                </HomeCategoryGrid>
              ) : (
                <>
              <HomepageTargetMessages messages={matchingHomepageMessages} />
              {productsLoading && products.length === 0 && (
                <div className="bg-slate-50 border rounded-3xl p-5 mb-4" role="status" aria-live="polite">
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
                        displayMessage: getProductDisplayMessage(product),
                      }}
                      addToCart={addToCart}
                      onImageClick={openProductDetails}
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
                        displayMessage: getProductDisplayMessage(product),
                      }}
                      addToCart={addToCart}
                      onImageClick={openProductDetails}
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

              {filteredProducts.length > 0 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setProductPage((pageNumber) => Math.max(1, pageNumber - 1))
                    }
                    disabled={productPage <= 1}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>

                  <span className="text-sm font-bold text-slate-600">
                    Page {productPage} of {totalProductPages}
                  </span>

                  <button
                    type="button"
                    onClick={() =>
                      setProductPage((pageNumber) =>
                        Math.min(totalProductPages, pageNumber + 1)
                      )
                    }
                    disabled={productPage >= totalProductPages}
                    className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              )}
                </>
              )}
            </div>

           {isCartEditing && (
             <div className="lg:col-span-4">
               <Cart
                cart={cart}
                total={finalTotal}
                originalTotal={cartTotals.subtotal}
                orderDiscountPercent={effectiveOrderDiscountPercent}
                setOrderDiscountPercent={setOrderDiscountPercent}
                discountAmount={discountAmount}
                promotionDiscountAmount={promotionDiscountAmount}
                canDiscount={canManualCheckoutDiscount}
                priceMode={priceMode}
                onSubmit={submitOrder}
                isSubmitting={isSubmittingOrder}
                onIncrease={increaseQty}
                onDecrease={decreaseQty}
                onRemove={removeItem}
                onChangeQty={changeQty}
                editing
                onEditingChange={changeCartEditing}
                onItemEdited={rememberCartProduct}
                paymentChoice={orderPaymentChoice}
                onPaymentChoiceChange={(choice) => {
                  setOrderPaymentChoice(choice);
                  if (choice !== "bank_transfer_now") setOrderBankProofFile(null);
                }}
                paymentChoiceValid={orderPaymentChoiceValid}
                requireImmediatePayment={salesCheckoutPaymentRequired}
                bankProofFile={orderBankProofFile}
                onBankProofChange={setOrderBankProofFile}
                reviewMode
                hideSubmit
              />
             </div>
           )}
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
          <div className="text-xs text-slate-500 font-bold">Total Outstanding</div>
          <div className="text-2xl font-bold text-red-600">
            {formatCurrency(customerCreditSummary.outstanding)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <div className="border rounded-xl p-3 bg-slate-50">
          <div className="text-xs font-bold text-slate-500">Opening Balance</div>
          <div className="text-lg font-extrabold">
            {formatCurrency(customerOpeningBalance)}
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-slate-50">
          <div className="text-xs font-bold text-slate-500">Available Credit</div>
          <div className="text-lg font-extrabold">
            {formatCurrency(customerCreditSummary.availableCredit)}
          </div>
        </div>
        <div className="border rounded-xl p-3 bg-slate-50">
          <div className="text-xs font-bold text-slate-500">Credit Limit</div>
          <div className="text-lg font-extrabold">
            {formatCurrency(customerCreditSummary.creditLimit)}
          </div>
        </div>
        {customerLastPayment > 0 && (
          <div className="border rounded-xl p-3 bg-slate-50">
            <div className="text-xs font-bold text-slate-500">Last Payment</div>
            <div className="text-lg font-extrabold text-green-700">
              {formatCurrency(customerLastPayment)}
            </div>
          </div>
        )}
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
            {displayedCustomerLedgerRowsWithBalance.map(({ row, debit, credit, balance }) => {
              const type = String(
                row.entry_type || row.transaction_type || ""
              ).toUpperCase();

              const isInvoice = type === "INVOICE";
              const isPayment = type === "PAYMENT";

              const status = isInvoice ? getCustomerInvoiceStatus(row) : "";
              const invoiceOrder = isInvoice ? getInvoiceOrderForLedgerRow(row) : null;
              const invoiceActionTarget = invoiceOrder || row;
              const displayBalance = balance;

              return (
                <tr key={row.id} className="border-b">
                  <td className="p-3">
                    {row.type === "OPENING" ? "-" : new Date(row.created_at).toLocaleDateString("en-GB")}
                  </td>

                  <td className="p-3 font-bold">
                    {type === "OPENING" ? "Opening Balance" : isInvoice ? "Invoice" : "Payment"}

                    {row.branch_name && (
                      <div className="text-xs text-slate-500 font-normal mt-1">
                        Branch: {row.branch_name}
                      </div>
                    )}

                    {isPayment && (
                      <div className="text-xs text-slate-500 font-normal mt-1">
                        Type: {row.payment_type || "-"}<br />
                        Who Paid: {row.paid_by || "-"}<br />
                        Collection Type: {getCustomerCollectionLabel(row)}
                      </div>
                    )}
                  </td>

                  <td className="p-3">
                    {type === "OPENING" ? (
                      <span className="font-bold">Opening Balance</span>
                    ) : isInvoice ? (
                      <span className="bg-red-100 text-red-700 px-2 py-1 rounded-lg text-xs font-bold">
                        {status || "UNPAID"}
                      </span>
                    ) : (
                      <span className="font-bold">Payment Received</span>
                    )}
                  </td>

                  <td
                    className={`p-3 text-right font-bold ${
                      isPayment ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {isPayment ? "-" : ""}
                    {formatCurrency(isPayment ? credit : debit)}
                  </td>

                  <td className="p-3 text-right font-bold">{formatCurrency(displayBalance)}
                  </td>

                  <td className="p-3 text-center">
                    {isInvoice ? (
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {getInvoiceActionForStatus(status) === "VIEW" && (
                        <button
                          type="button"
                          onClick={() =>
                            openCustomerInvoiceDocument(
                              invoiceActionTarget,
                              status,
                              false
                            )
                          }
                          className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          View Invoice
                        </button>
                        )}
                        {getInvoiceActionForStatus(status) === "DOWNLOAD" && (
                        <button
                          type="button"
                          onClick={() =>
                            openCustomerInvoiceDocument(
                              invoiceActionTarget,
                              status,
                              true
                            )
                          }
                          className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                        >
                          Download Invoice
                        </button>
                        )}
                      </div>
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
       {isSalesRep && canCollectCash && page === "salesCashCollection" && (
  <div className="p-4">
    <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3">
      <h2 className="text-xl font-bold">
        Sales Rep Cash Collection
      </h2>

      {salesRouteMode && selectedCustomerAccount ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><strong>{selectedCustomerAccount.account_name}</strong><div className="text-xs text-slate-500">{selectedBranch?.branch_name || "Main account"}</div></div>
      ) : <>
        <input value={salesPaymentCustomerSearch} onChange={(e) => setSalesPaymentCustomerSearch(e.target.value)} placeholder="Search customer" className="w-full border rounded-xl p-3" />
        <select value={salesPaymentForm.customerId} onChange={(e) => setSalesPaymentForm({ ...salesPaymentForm, customerId: e.target.value, branchId: "" })} className="w-full border rounded-xl p-3"><option value="">Select Customer</option>{filteredSalesPaymentCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.account_name}</option>)}</select>
        {selectedSalesPaymentBranches.length > 0 && <select value={salesPaymentForm.branchId} onChange={(e) => setSalesPaymentForm({ ...salesPaymentForm, branchId: e.target.value })} className="w-full border rounded-xl p-3"><option value="">Select Branch / Shop</option>{selectedSalesPaymentBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}{branch.postcode ? ` - ${branch.postcode}` : ""}</option>)}</select>}
      </>}

      {selectedSalesPaymentCustomer && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div className="border rounded-xl p-3 bg-slate-50">
            <div className="text-xs font-bold text-slate-500">
              Customer outstanding
            </div>
            <div className="text-xl font-extrabold text-red-700">
              {formatCurrency(salesOutstandingSnapshot.totalOutstanding || 0)}
            </div>
          </div>

          {selectedSalesPaymentBranch && (
            <div className="border rounded-xl p-3 bg-slate-50">
              <div className="text-xs font-bold text-slate-500">
                Selected branch outstanding
              </div>
              <div className="text-xl font-extrabold text-red-700">
                {formatCurrency(
                  salesOutstandingSnapshot.branchOutstanding[
                    selectedSalesPaymentBranch.id
                  ] ??
                    salesOutstandingSnapshot.branchOutstanding[
                      selectedSalesPaymentBranch.branch_name
                    ] ??
                    0
                )}
              </div>
            </div>
          )}
        </div>
      )}

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

       {isSalesRep && page === "salesCreditHistory" && (
        <CustomerCredit readOnly />
       )}

       {isSalesRep && page === "salesReturn" && (
  <div className="p-4">
    <div className="bg-white border rounded-2xl p-4 shadow-sm space-y-3">
      <h2 className="text-xl font-bold">Sales Rep Return</h2>

      {salesRouteMode && selectedCustomerAccount ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3"><strong>{selectedCustomerAccount?.account_name}</strong><div className="text-xs text-slate-500">{selectedBranch?.branch_name || "Main account"}</div></div>
      ) : <>
        <input disabled={salesReturnSubmitting || salesReturnCreated} value={salesReturnCustomerSearch} onChange={(e) => setSalesReturnCustomerSearch(e.target.value)} placeholder="Search customer" className="w-full border rounded-xl p-3" />
        <select disabled={salesReturnSubmitting || salesReturnCreated} value={salesReturnForm.customerId} onChange={(e) => setSalesReturnForm({ ...salesReturnForm, customerId: e.target.value, branchId: "" })} className="w-full border rounded-xl p-3"><option value="">Select Customer</option>{filteredSalesReturnCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.account_name}</option>)}</select>
        {selectedSalesReturnBranches.length > 0 && <select disabled={salesReturnSubmitting || salesReturnCreated} value={salesReturnForm.branchId} onChange={(e) => setSalesReturnForm({ ...salesReturnForm, branchId: e.target.value })} className="w-full border rounded-xl p-3"><option value="">Select Branch / Shop</option>{selectedSalesReturnBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.branch_name}{branch.postcode ? ` - ${branch.postcode}` : ""}</option>)}</select>}
      </>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-xs font-bold text-slate-500">Previous Invoice Number</span>
          <input
          disabled={salesReturnSubmitting || salesReturnCreated}
          value={salesReturnForm.previousInvoiceNumber}
          onChange={(e) =>
            setSalesReturnForm({
              ...salesReturnForm,
              previousInvoiceNumber: e.target.value,
            })
          }
          placeholder="Previous invoice number"
          className="w-full border rounded-xl p-3 disabled:bg-slate-100"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs font-bold text-slate-500">Previous Invoice Date</span>
          <input
          disabled={salesReturnSubmitting || salesReturnCreated}
          type="date"
          value={salesReturnForm.previousInvoiceDate}
          onChange={(e) =>
            setSalesReturnForm({
              ...salesReturnForm,
              previousInvoiceDate: e.target.value,
            })
          }
          className="w-full border rounded-xl p-3 disabled:bg-slate-100"
          />
        </label>
      </div>

      {salesReturnOrder ? (
        <div className="rounded-2xl border bg-slate-50">
          <ReturnRequestModal
            order={salesReturnOrder}
            source="SALES_REP_PORTAL"
            currentUser={activeUser}
            catalogProducts={products.filter(isActiveProduct)}
            pricingSettings={pricingSettings}
            country={orderCountry}
            allowCatalogProducts
            embedded
            onSubmittingChange={setSalesReturnSubmitting}
            onCreatedReturnChange={(createdReturn) => {
              const created = Boolean(createdReturn?.id);
              setSalesReturnCreated(created);
              if (created) {
                setSalesReturnForm((current) => ({
                  ...current,
                  branchId: "",
                  previousInvoiceNumber: "",
                  previousInvoiceDate: "",
                }));
              }
            }}
            onCreateAnother={() => {
              setSalesReturnCreated(false);
              setSalesReturnForm((current) => ({
                ...current,
                branchId: "",
                previousInvoiceNumber: "",
                previousInvoiceDate: "",
              }));
            }}
            onSaved={async () => {
              await fetchOrders();
              await fetchCustomerLedger();
            }}
          />
        </div>
      ) : (
        <div className="rounded-xl border bg-slate-50 p-4 text-sm font-bold text-slate-500">
          Select a customer to search products and create a return.
        </div>
      )}
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

              <HomepageTargetMessages messages={selectedProductNotices} />

              <button
                onClick={() => setSelectedImage(null)}
                className="mt-4 w-full bg-blue-600 text-white py-3 rounded-xl font-bold"
              >
                Close
              </button>
              
            </div>
          </div>
        )}

      {page === "order" && (isSalesRep || isCustomer) && (
  <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-white p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-xl sm:p-3">
    <div className="mx-auto flex max-w-7xl items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-[88px] shrink-0">
          <div className="text-xs text-slate-500">
            {cart.filter((item) => !item.isPromotionFree).reduce((sum, item) => sum + item.qty, 0)} Items
          </div>
          <div className="whitespace-nowrap text-lg font-bold sm:text-xl">
            {formatCurrency(finalTotal)}
          </div>
          {cart.length > 0 && (
            <button
              onClick={async () => {
                if (!window.confirm("Clear all cart items?")) return;
                const itemsToClear = cartRef.current.filter((item) => !item.isPromotionFree);
                if (CENTRAL_CART_ENABLED) {
                  const cartId = await ensureCentralCartForCurrentScope();
                  if (cartId) {
                    await centralCartMutationQueueRef.current.catch(() => undefined);
                    centralCartMutatingRef.current = true;
                    try {
                      for (const item of itemsToClear) {
                        await removeCentralCartItem({ profile: activeUser, cartId, productId: item.id });
                      }
                    } catch (error) {
                      console.error("Central cart clear error:", error);
                      alert("Could not clear the server cart. Please try again.");
                      return;
                    } finally {
                      centralCartMutatingRef.current = false;
                    }
                  }
                }
                localStorage.removeItem(cartStorageKey);
                localStorage.removeItem(orderSubmissionStorageKey);
                setCart([]);
                setIsCartEditing(false);
                setOrderPaymentChoice(salesCheckoutPaymentRequired ? "cash_now" : "no_payment");
                setOrderBankProofFile(null);
                setOrderPaymentIntentId(createPaymentIntentId());
              }}
              className="mt-0.5 text-[11px] text-red-600 underline"
            >
              Clear Cart
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.confirm("Submit this order?")) submitOrder();
          }}
          disabled={cart.filter((item) => !item.isPromotionFree).length === 0 || isSubmittingOrder || !orderPaymentChoiceValid}
          className="min-h-10 shrink-0 rounded-xl border-2 border-orange-400 bg-slate-700 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5"
        >
          {isSubmittingOrder ? "Submitting..." : "Submit Order"}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={goToCustomerHome}
          className="min-h-10 rounded-xl border-2 border-blue-950 bg-blue-950 px-2.5 py-2 text-xs font-bold text-white hover:bg-blue-800 sm:px-4 sm:text-sm"
        >
          <span aria-hidden="true">âŒ‚</span> Home
        </button>
        <button
          type="button"
          onClick={() => {
            if (isCartEditing) changeCartEditing(false);
            else openCustomerCheckout();
          }}
          className="min-h-10 rounded-xl bg-green-600 px-2.5 py-2 text-xs font-bold text-white hover:bg-green-700 sm:px-4 sm:text-sm"
        >
          {isCartEditing ? "Close Cart" : "Checkout"}
        </button>
      </div>
    </div>
  </div>
)}

{(isCustomer || isSalesRep || (isAdmin && page === "order")) && (
  <div className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-3 z-50 flex gap-2 sm:right-4">
    <button
      type="button"
      aria-label="Scroll to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="min-h-12 rounded-full bg-orange-500 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-orange-600 sm:px-5"
    >
      <span aria-hidden="true">â†‘</span> Top
    </button>
  </div>
)}

<div className="sr-only" aria-live="polite">{cartNotice}</div>
{cartNotice && (
  <div className="fixed bottom-40 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-lg">
    {cartNotice}
  </div>
)}

{isSubmittingOrder && (
  <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="status" aria-live="assertive">
    <div className="w-full max-w-md rounded-3xl bg-white p-6 text-center shadow-2xl">
      <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-orange-200 border-t-orange-600" aria-hidden="true" />
      <h2 className="text-xl font-extrabold text-slate-900">Sending your order.</h2>
      <p className="mt-2 text-slate-700">This may take a few seconds.</p>
      <p className="mt-1 font-bold text-slate-900">Please do not close or refresh this page.</p>
    </div>
  </div>
)}

{submissionFeedback === "success" && (
  <div className="fixed left-1/2 top-4 z-[85] flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-xl" role="status" aria-live="polite">
    <span>Order submitted successfully.</span>
    <button type="button" onClick={() => setSubmissionFeedback("")} className="min-h-10 rounded-lg border border-white/50 px-3">Close</button>
  </div>
)}
{submissionFeedback === "error" && (
  <div className="fixed left-1/2 top-4 z-[85] flex w-[calc(100%_-_2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-2xl bg-red-700 px-4 py-3 font-bold text-white shadow-xl" role="alert" aria-live="assertive">
    <span>We could not submit the order. Please check your connection and try again.</span>
    <button type="button" onClick={() => setSubmissionFeedback("")} className="min-h-10 shrink-0 rounded-lg border border-white/50 px-3">Close</button>
  </div>
)}

      </div>

      {returnOrder && (
        <ReturnRequestModal
          order={returnOrder}
          source={isSalesRep ? "SALES_REP_PORTAL" : "CUSTOMER_PAYMENT_HISTORY"}
          currentUser={activeUser}
          catalogProducts={products.filter(isActiveProduct)}
          pricingSettings={pricingSettings}
          country={orderCountry}
          allowCatalogProducts={isSalesRep && page === "salesReturn"}
          onClose={() => setReturnOrder(null)}
          onSaved={async () => {
            await fetchOrders();
            await fetchCustomerLedger();
          }}
        />
      )}
    </div>
  );
}

