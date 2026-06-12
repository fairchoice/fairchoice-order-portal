import { useEffect, useMemo, useState } from "react";
import { supabase } from "../services/supabase.js";

import ProductCard from "../components/ProductCard";
import ProductFilters from "../components/ProductFilters";
import Cart from "../components/Cart.jsx";

import { getProducts } from "../services/products";
import AdminProducts from "./AdminProducts";
import AdminOrders from "./AdminOrders";
import Warehouse from "./Warehouse";
import Driver from "./Driver";
import StockReceipts from "./StockReceipts";
import StockHistory from "./StockHistory";
import AdminConfig from "./AdminConfig";
import CustomerCredit from "./CustomerCredit";

import { getCustomerAccounts } from "../services/customerManagement";

import {
  getOrders,
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
    cartonSize: raw.carton_size || "",
    image: raw.image_url || "https://placehold.co/400x300?text=Product",
    stock: Number(raw.stock || 0),
    lowStockAlert: Number(raw.low_stock_alert || 10),
    active: String(raw.status || "Active").toLowerCase() !== "inactive",
    availableInEngland: raw.available_in_england === true,
    availableInWales: raw.available_in_wales === true,
    vatType: raw.vat_type || "20",
    availableFromSupplier: raw.available_from_supplier !== false,
    recommended: raw.recommended === true,
    topSeller: raw.top_seller === true,
  };
}
export default function CustomerOrder({ userProfile }) {
  const role = userProfile?.role || "Customer";
  const normalizedRole = (role || "").replace(/\s+/g, "").toLowerCase();

  const isAdmin = normalizedRole === "admin";
  const isSalesRep = normalizedRole === "salesrep";
  const isWarehouse = normalizedRole === "warehouse";
  const isDriver = normalizedRole === "driver";
  const isCustomer = normalizedRole === "customer";

  const [page, setPage] = useState(() => {
    if (window.location.hash === "#admin") return "orders";
    if (window.location.hash === "#products") return "products";
    if (window.location.hash === "#warehouse") return "warehouse";
    if (window.location.hash === "#driver") return "driver";
    if (window.location.hash === "#stock-receipts") return "stockreceipts";
    if (window.location.hash === "#stockhistory") return "stockhistory";
    if (window.location.hash === "#config") return "config";
    if (window.location.hash === "#credit") return "credit";
    return "order";
  });

  const [customerAccounts, setCustomerAccounts] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [selectedCustomerAccount, setSelectedCustomerAccount] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);

  const [priceMode, setPriceMode] = useState("vat");
  const [companyName, setCompanyName] = useState("");

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

  const [cart, setCart] = useState([]);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [orders, setOrders] = useState([]);
  const [expandedOrders, setExpandedOrders] = useState({});

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All Products");
  const [selectedSubCategory, setSelectedSubCategory] =
    useState("All Sub Categories");
  const [selectedBrand, setSelectedBrand] = useState("All Brands");
  const [selectedSeries, setSelectedSeries] = useState("All Series");

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
    cartonSize: "",
    image: "",
    stock: "",
    lowStockAlert: "10",
    availableInEngland: true,
    availableInWales: true,
    vatType: "20",
    availableFromSupplier: true,
  });

  const orderCountry =
    selectedBranch?.country || selectedCustomerAccount?.country || "Wales";

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

  const getPrice = (product) => {
  const exVatPrice = Number(product.vatPrice || 0);
  const vatRate = getVatRate(product.vatType);
  const incVatPrice = exVatPrice + exVatPrice * (vatRate / 100);

  // Ex. VAT mode: product card shows uploaded/imported VAT price only
  if (priceMode === "vat") {
    return exVatPrice;
  }

  // Server / Manager / Super: calculate after VAT, then discount, then round
  const discounts = {
    server: pricingSettings.server_discount_percent,
    manager: pricingSettings.manager_discount_percent,
    super: pricingSettings.super_discount_percent,
  };

  const discount = Number(discounts[priceMode] || 0);
  const discountedPrice = incVatPrice * (1 - discount / 100);

  return roundToFairQuarter(discountedPrice);
};

  useEffect(() => {
    if (isWarehouse) setPage("orders");
    if (isDriver) setPage("driver");
    if (isSalesRep) setPage("order");
    if (isCustomer) setPage("order");
  }, [isWarehouse, isDriver, isSalesRep, isCustomer]);

  useEffect(() => {
    if (!supabase) {
      setProductError("Supabase is not configured.");
      return;
    }

    fetchProducts();
    fetchPricingSettings();

    if (
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
        console.log("CUSTOMERS LOADED:", data);
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

    const branches = (selectedCustomerAccount.customer_branches || []).filter(
      (b) => b.active !== false
    );

    if (branches.length === 1) {
      setSelectedBranchId(branches[0].id);
      setSelectedBranch(branches[0]);
    }
  }, [selectedCustomerAccount]);

  const fetchProducts = async () => {
    setProductError("");
    setProductsLoading(true);

    try {
      const data = await getProducts();

      setProducts(
        (data || [])
          .map(normalizeProduct)
          .filter((p) => p.name)
      );
    } catch (error) {
      console.error("Product loading error:", error);
      setProductError(error.message);
      setProducts([]);
    }

    setProductsLoading(false);
  };

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
      const data = await getOrders();

      const mappedOrders = (data || []).map((order) => ({
        dbId: order.id,
        orderId: order.order_number,
        customerName: order.company_name,
        phoneNumber: "",
        companyName: order.company_name,
        deliveryAddress:
          order.delivery_address || order.delivery_postcode || order.postcode || "",
        priceMode: order.price_mode || "vat",
        total: Number(order.order_total || 0),
        createdAt: new Date(order.created_at).toLocaleString(),
        status: order.status,

        driverName: order.driver_name || "",
        deliveredAt: order.delivered_at || "",
        paymentType: order.payment_type || "",
        paymentAmount: Number(order.payment_amount || 0),
        paymentCollected: order.payment_collected || "",
        paidBy: order.paid_by || "",

        items: (order.order_items || []).map((item) => ({
          dbId: item.id,
          id: item.product_id,
          name: item.product_name,
          brand: item.brand || "",
          series: item.series || "",
          flavour: item.flavour || "",
          cartonSize: item.carton_size || "",
          qty: Number(item.qty || 0),
          selectedPrice: Number(item.price || 0),
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
<<<<<<< HEAD
    "All Sub Categories",
    ...new Set(
      products
        .filter(
          (p) =>
            selectedCategory === "All Products" ||
            p.category === selectedCategory
        )
        .map((p) => p.subCategory)
        .filter(Boolean)
    ),
  ];

const brands = [
  "All Brands",
  ...new Set(
    products
      .filter(
        (p) =>
          selectedCategory === "All Products" ||
          p.category === selectedCategory
      )
      .map((p) => p.brand)
      .filter(Boolean)
  ),
];

  const seriesList = [
  "All Series",
=======
  "All Sub Categories",
>>>>>>> test
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
  const noFiltersSelected =
  selectedCategory === "All Products" &&
  selectedSubCategory === "All Sub Categories" &&
  selectedBrand === "All Brands" &&
  selectedSeries === "All Series" &&
  search.trim() === "";

const baseProducts = noFiltersSelected
  ? products
      .filter((p) => p.recommended === true || p.topSeller === true)
      .slice(0, 10)
  : products;

  return baseProducts.filter((product) => {
    if (
      (orderCountry === "England" && !product.availableInEngland) ||
      (orderCountry === "Wales" && !product.availableInWales)
    ) {
      return false;
    }

    const keyword = search.trim().toLowerCase();

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
        productBrand.toLowerCase().includes(keyword) ||
        productSeries.toLowerCase().includes(keyword) ||
        String(product.flavour || "").toLowerCase().includes(keyword))
    );
  });
}, [
  products,
  selectedCategory,
  selectedSubCategory,
  selectedBrand,
  selectedSeries,
  search,
  orderCountry,
]);

  const addToCart = (product, qty = 1) => {
  const quantity = Math.max(1, Number(qty || 1));

  const exVatPrice = Number(product.vatPrice || 0);
const vatRate = getVatRate(product.vatType);
const vatAmount = exVatPrice * (vatRate / 100);
const incVatPrice = exVatPrice + vatAmount;

  const selectedPrice = getPrice(product);

  setCart((oldCart) => {
    const found = oldCart.find((item) => item.id === product.id);

    if (found) {
      const newQty = found.qty + quantity;

      return oldCart.map((item) =>
        item.id === product.id
          ? {
              ...item,
              qty: newQty,
              selectedPrice,
              exVatPrice,
              vatRate,
              vatAmount,
              incVatPrice,
              sourceStatus:
                product.stock < newQty ? "Need Supplier" : "In Stock",
              pickedQty: Math.min(product.stock, newQty),
            }
          : item
      );
    }

    return [
      ...oldCart,
      {
        ...product,
        qty: quantity,
        selectedPrice,
        exVatPrice,
        vatRate,
        vatAmount,
        incVatPrice,
        sourceStatus:
          product.stock < quantity ? "Need Supplier" : "In Stock",
        includeInPicking: true,
        pickedQty: Math.min(product.stock, quantity),
      },
    ];
  });
};

  const increaseQty = (id) => {
    setCart((oldCart) =>
      oldCart.map((item) =>
        item.id === id
          ? {
              ...item,
              qty: item.qty + 1,
              sourceStatus:
                item.stock < item.qty + 1 ? "Need Supplier" : "In Stock",
              pickedQty: Math.min(item.stock, item.qty + 1),
            }
          : item
      )
    );
  };

  const decreaseQty = (id) => {
    setCart((oldCart) =>
      oldCart
        .map((item) =>
          item.id === id
            ? {
                ...item,
                qty: item.qty - 1,
                pickedQty: Math.min(item.stock, item.qty - 1),
              }
            : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const changeQty = (id, value) => {
    const quantity = Math.max(1, Number(value || 1));

    setCart((oldCart) =>
      oldCart.map((item) =>
        item.id === id
          ? {
              ...item,
              qty: quantity,
              sourceStatus:
                item.stock < quantity ? "Need Supplier" : "In Stock",
              pickedQty: Math.min(item.stock, quantity),
            }
          : item
      )
    );
  };

  const removeItem = (id) => {
    setCart((oldCart) => oldCart.filter((item) => item.id !== id));
  };

  const total = cart.reduce((sum, item) => {
  const qty = Number(item.qty || 0);

  if (priceMode === "vat") {
    const exVatPrice = Number(item.exVatPrice || item.vatPrice || 0);
    const vatRate = getVatRate(item.vatRate || item.vatType);
    return sum + (exVatPrice + exVatPrice * (vatRate / 100)) * qty;
  }

  return sum + Number(item.selectedPrice || 0) * qty;
}, 0);

  const toggleOrderExpanded = (orderId) => {
    setExpandedOrders((old) => ({
      ...old,
      [orderId]: !old[orderId],
    }));
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

  if (cart.length === 0) {
    alert("Please add at least one product.");
    return;
  }

  const creditLimit = Number(selectedCustomerAccount?.credit_limit || 0);
  const outstandingBalance = Number(
    selectedCustomerAccount?.outstanding_balance || 0
  );
  const orderTotal = Number(total || 0);

  if (creditLimit > 0 && outstandingBalance + orderTotal > creditLimit) {
    alert(
      `Order exceeds customer credit limit.\n\nOutstanding Balance: £${outstandingBalance.toFixed(
        2
      )}\nOrder Total: £${orderTotal.toFixed(
        2
      )}\nCredit Limit: £${creditLimit.toFixed(2)}`
    );
    return;
  }

  setIsSubmittingOrder(true);

  try {
    const { orderNumber } = await createCustomerOrder({
      companyName: selectedCustomerAccount.account_name,
      priceMode,
      cart,
      total,
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
      phoneNumber: "",
      companyName: selectedCustomerAccount.account_name,
      deliveryAddress: selectedBranch?.delivery_address || "",
      priceMode,
      total,
      createdAt: new Date().toLocaleString(),
      status: "Received",
      items: cart,
    };

    setOrders((oldOrders) => [newOrder, ...oldOrders]);
    setCart([]);

    if (!isCustomer) {
      setSelectedCustomerId("");
      setSelectedCustomerAccount(null);
      setSelectedBranchId("");
      setSelectedBranch(null);
      setCompanyName("");
    }

    await fetchProducts();

    alert(
  `✅ Order Submitted Successfully

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

  const updateOrderItem = (orderId, itemId, updates) => {
    setOrders((oldOrders) =>
      oldOrders.map((order) => {
        if (order.orderId !== orderId) return order;

        return {
          ...order,
          items: order.items.map((item) => {
            const itemKey = item.id || item.productId || item.product_id;

            if (String(itemKey) !== String(itemId)) return item;

            return {
              ...item,
              ...updates,
            };
          }),
        };
      })
    );
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

    const payload = {
      product_code: productForm.productCode,
      product_name: productForm.name,
      main_category: productForm.category,
      sub_category: productForm.subCategory,
      brand: productForm.brand,
      series: productForm.series,
      flavour: productForm.flavour,
      cash_price: 0,
      vat_price: Number(productForm.vatPrice),
      carton_size: productForm.cartonSize,
      image_url:
        productForm.image || "https://placehold.co/400x300?text=Product",
      stock: Number(productForm.stock || 0),
      low_stock_alert: Number(productForm.lowStockAlert || 10),
      status: "Active",
      available_in_england: productForm.availableInEngland,
      available_in_wales: productForm.availableInWales,
      vat_type: productForm.vatType,
      available_from_supplier: productForm.availableFromSupplier !== false,
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
      cartonSize: "",
      image: "",
      stock: "",
      lowStockAlert: "10",
      availableInEngland: true,
      availableInWales: true,
      vatType: "20",
      availableFromSupplier: true,
    });

    await fetchProducts();
    alert("Product saved.");
  };

  const editProduct = (product) => {
    setEditingId(product.id);

    setProductForm({
      productCode: product.productCode,
      name: product.name,
      category: product.category,
      subCategory: product.subCategory,
      brand: product.brand,
      series: product.series,
      flavour: product.flavour,
      cashPrice: product.cashPrice,
      vatPrice: product.vatPrice,
      cartonSize: product.cartonSize,
      image: product.image,
      stock: product.stock,
      lowStockAlert: product.lowStockAlert,
      availableInEngland: product.availableInEngland === true,
      availableInWales: product.availableInWales === true,
      vatType: product.vatType || "20",
      availableFromSupplier: product.availableFromSupplier !== false,
    });

    setPage("products");
  };

  const printPickingList = (order) => {
    const printableItems = order.items.filter(
      (item) => item.includeInPicking !== false
    );

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
              ${item.pickedQty ?? item.qty}
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
          <div><b>Total Items:</b> ${printableItems.reduce(
            (s, i) => s + Number(i.pickedQty ?? i.qty),
            0
          )}</div>
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

  return (
    <div className="min-h-screen bg-slate-100 p-4 pb-40">
      <div className="max-w-7xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-950 to-blue-700 text-white px-6 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">FairChoice Order Portal</h1>
            <p className="text-blue-100">
              {isAdmin
                ? "Backoffice product and order management"
                : "Customer order form"}
            </p>
          </div>

          {isAdmin && (
  <div className="flex flex-wrap gap-2">
    <button onClick={() => setPage("order")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Sales Rep Order Form
    </button>

    <button onClick={() => setPage("products")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Products
    </button>

    <button onClick={() => { setPage("orders"); fetchOrders(); }} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Received Orders
    </button>

    <button onClick={() => setPage("warehouse")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Warehouse
    </button>

    <button onClick={() => setPage("driver")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Driver
    </button>

    <button onClick={() => setPage("config")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Admin Config
    </button>
  </div>
)}

{isWarehouse && (
  <div className="flex flex-wrap gap-2">

    <button
      onClick={() => setPage("orders")}
      className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold"
    >
      Received Orders
    </button>

    <button
      onClick={() => setPage("warehouse")}
      className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold"
    >
      Warehouse
    </button>

  </div>
)}

{isDriver && (
  <div className="flex flex-wrap gap-2">
    <button onClick={() => setPage("driver")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Driver
    </button>
  </div>
)}

{isSalesRep && (
  <div className="flex flex-wrap gap-2">
    <button onClick={() => setPage("order")} className="bg-white text-blue-800 px-4 py-2 rounded-xl font-semibold">
      Sales Rep Order Form
    </button>
  </div>
)}
        </div>

        {(isAdmin || isSalesRep || isCustomer) && page === "order" && (
          <div className="p-3 md:p-4 pb-32 md:pb-40 grid grid-cols-1 lg:grid-cols-4 gap-3 md:gap-4">
            
 <div className="lg:col-span-4 bg-slate-50 rounded-2xl p-3 md:p-4">
  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-3 text-sm font-bold">
    <div>
      Customer Order Form
    </div>

    <div className="text-slate-700">
      {selectedCustomerAccount?.address || "-"}
    </div>

    <div className="text-slate-700">
      Credit Limit £
      {Number(selectedCustomerAccount?.credit_limit || 0).toFixed(2)}
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
      <option value="super">Super Offer</option>
    )}
</select>
  </div>

  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
    <div>
      <label className="font-bold text-sm block mb-1">
        Customer Details
      </label>

      {isCustomer ? (
        <div className="border rounded-xl p-3 bg-slate-100 font-bold">
          {selectedCustomerAccount?.account_name || "Customer Account"}
        </div>
      ) : (
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

          {customerAccounts.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.account_name}
            </option>
          ))}
        </select>
      )}
    </div>

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

          const branch =
            selectedCustomerAccount?.customer_branches?.find(
              (b) => String(b.id) === String(branchId)
            );

          setSelectedBranchId(branchId);
          setSelectedBranch(branch || null);
        }}
      >
        <option value="">Select Branch / Shop</option>

        {(selectedCustomerAccount?.customer_branches || [])
          .filter((b) => b.active !== false)
          .map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.branch_name} - {branch.postcode}
            </option>
          ))}
      </select>
    </div>
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

</div>

            <div className="lg:col-span-3">
              {productsLoading && (
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

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
                {filteredProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    addToCart={addToCart}
                    onImageClick={setSelectedImage}
                    price={getPrice(product)}
                    cartQty={
                      cart.find((item) => item.id === product.id)?.qty || 0
                    }
                    onAdd={addToCart}
                  />
                ))}
              </div>
            </div>

            <Cart
             cart={cart}
                total={total}
                priceMode={priceMode}
                onSubmit={submitOrder}
                isSubmitting={isSubmittingOrder}
              onIncrease={increaseQty}
              onDecrease={decreaseQty}
              onRemove={removeItem}
              onChangeQty={changeQty}
            />
          </div>
        )}

        {isAdmin && page === "credit" && <CustomerCredit />}

        {isAdmin && page === "products" && (
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

        {(isAdmin || isWarehouse) && page === "orders" && (
          <AdminOrders
            orders={orders}
            expandedOrders={expandedOrders}
            toggleOrderExpanded={toggleOrderExpanded}
            printPickingList={printPickingList}
            updateOrderItem={updateOrderItem}
            changeOrderStatus={changeOrderStatus}
          />
        )}

        {(isAdmin || isWarehouse) && page === "warehouse" && (
          <Warehouse
            orders={orders}
            printPickingList={printPickingList}
            changeOrderStatus={changeOrderStatus}
            updateOrderItem={updateOrderItem}
            updateOrderExtraFields={updateOrderExtraFields}
          />
        )}

              {(isAdmin || isDriver) && page === "driver" && (
          <Driver
            orders={orders}
            changeOrderStatus={changeOrderStatus}
            updateOrderItem={updateOrderItem}
            updateOrderExtraFields={updateOrderExtraFields}
          />
        )}

        {isAdmin && page === "stockhistory" && <StockHistory />}

        {isAdmin && page === "stockreceipts" && (
          <StockReceipts products={products} fetchProducts={fetchProducts} />
        )}

        {isAdmin && page === "config" && <AdminConfig />}

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


     
      {page === "order" && (
  <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t shadow-xl p-3">
    <div className="max-w-7xl mx-auto flex items-center justify-between">
      <div>
        <div className="text-xs text-slate-500">
          {cart.reduce((sum, item) => sum + item.qty, 0)} Items
        </div>

        <div className="font-bold text-xl">
          £{total.toFixed(2)}
        </div>
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
  className="fixed bottom-20 right-3 z-50 bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-full shadow-lg opacity-80 hover:opacity-100"
>
  ↑ Top
</button>

      </div>
    </div>
  );
}
