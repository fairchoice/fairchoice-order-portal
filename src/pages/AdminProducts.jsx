import { useEffect, useState } from "react";

import { supabase } from "../services/supabase";
import { getActiveStockLocations } from "../services/locationStock";
import { formatCurrency } from "../utils/currency";




export default function AdminProducts({
  products,
  productForm,
  setProductForm,
  editingId,
  saveProduct,
  fetchProducts,
  editProduct,
  pricingSettings = {},
}) {

const [imageFile, setImageFile] = useState(null);
const [uploadingImage, setUploadingImage] = useState(false);

const handleImageUpload = async () => {
  if (!imageFile) {
    alert("Please choose an image first");
    return;
  }

  if (!productForm.productCode) {
    alert("Please enter product code before uploading image");
    return;
  }

  setUploadingImage(true);

  try {
    const fileExt = imageFile.name.split(".").pop();
    const fileName = `${productForm.productCode}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(fileName, imageFile, {
        cacheControl: "3600",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

    updateField("image", data.publicUrl);

    alert("Image uploaded successfully");
  } catch (err) {
    alert("Image upload failed: " + err.message);
  }

  setUploadingImage(false);
};


  const [activeTab, setActiveTab] = useState("edit");
  
  const [productOptions, setProductOptions] = useState([]);
  const [accountCodes, setAccountCodes] = useState([]);
  const [stockLocations, setStockLocations] = useState([]);

  const [suppliers, setSuppliers] = useState([]);

  const fetchSuppliers = async () => {
  const { data } = await supabase
    .from("suppliers")
    .select("*")
    .order("supplier_name");

  setSuppliers(data || []);
    };

      useEffect(() => {
    fetchProductOptions();
    fetchSuppliers();
    fetchAccountCodes();
    fetchStockLocations();
      }, []);

  const updateField = (field, value) => {
    setProductForm({
      ...productForm,
      [field]: value,
    });
  };

  const updateLocationStock = (locationId, field, value) => {
    setProductForm({
      ...productForm,
      locationStocks: {
        ...(productForm.locationStocks || {}),
        [locationId]: {
          ...(productForm.locationStocks?.[locationId] || {}),
          [field]: value,
        },
      },
    });
  };
  
  const getDefaultAccountsForCategory = (category) => {
    const selectedCategory = String(category || "").trim().toLowerCase();

    if (!selectedCategory) {
      return {
        salesAccount: "",
        purchaseAccount: "",
      };
    }

    const salesAccount = accountCodes.find(
      (account) =>
        String(account.account_type || "").toLowerCase() === "sales" &&
        String(account.main_category || "").trim().toLowerCase() === selectedCategory
    );

    const purchaseAccount = accountCodes.find(
      (account) =>
        String(account.account_type || "").toLowerCase() === "purchase" &&
        String(account.main_category || "").trim().toLowerCase() === selectedCategory
    );

    return {
      salesAccount: salesAccount?.account_code || "",
      purchaseAccount: purchaseAccount?.account_code || "",
    };
  };

  const handleCategoryChange = (category) => {
    const defaultAccounts = getDefaultAccountsForCategory(category);

    setProductForm({
      ...productForm,
      category,
      salesAccount: defaultAccounts.salesAccount,
      purchaseAccount: defaultAccounts.purchaseAccount,
    });
  };
 const resetForm = () => {
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
      vatType: "20",
      availableInEngland: true,
      availableInWales: true,
      cartonSize: "",
      image: "",
      stock: "",
      lowStockAlert: "",
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
  };

  const fetchProductOptions = async () => {
  const { data, error } = await supabase
    .from("product_options")
    .select("*")
    .eq("active", true)
    .order("option_name");

  if (!error) setProductOptions(data || []);
};

const fetchAccountCodes = async () => {
  const { data, error } = await supabase
    .from("account_codes")
    .select("*")
    .eq("active", true)
    .order("account_code");

  if (!error) setAccountCodes(data || []);
};

const fetchStockLocations = async () => {
  try {
    const locations = await getActiveStockLocations();
    setStockLocations(locations || []);
  } catch (error) {
    console.error("Stock location loading error:", error);
  }
};



useEffect(() => {
  fetchProductOptions();
}, []);

useEffect(() => {
  if (!productForm.category || accountCodes.length === 0) return;
  if (productForm.salesAccount && productForm.purchaseAccount) return;

  const defaultAccounts = getDefaultAccountsForCategory(productForm.category);
  if (!defaultAccounts.salesAccount && !defaultAccounts.purchaseAccount) return;

  setProductForm((old) => ({
    ...old,
    salesAccount: old.salesAccount || defaultAccounts.salesAccount,
    purchaseAccount: old.purchaseAccount || defaultAccounts.purchaseAccount,
  }));
}, [
  accountCodes,
  productForm.category,
  productForm.salesAccount,
  productForm.purchaseAccount,
]);

const mainCategories = productOptions.filter(
  (o) => o.option_type === "main_category"
);

const subCategories = productOptions.filter(
  (o) => o.option_type === "sub_category"
);

const brands = productOptions.filter(
  (o) => o.option_type === "brand"
);

const seriesList = productOptions.filter(
  (o) => o.option_type === "series"
);

const selectedCategoryKey = String(productForm.category || "").trim().toLowerCase();

const salesAccountsForCategory = accountCodes.filter(
  (account) =>
    String(account.account_type || "").toLowerCase() === "sales" &&
    String(account.main_category || "").trim().toLowerCase() === selectedCategoryKey
);

const purchaseAccountsForCategory = accountCodes.filter(
  (account) =>
    String(account.account_type || "").toLowerCase() === "purchase" &&
    String(account.main_category || "").trim().toLowerCase() === selectedCategoryKey
);

const [productSearch, setProductSearch] = useState("");
const [statusFilter, setStatusFilter] = useState("active");
const [stockFilter, setStockFilter] = useState("all");
const [selectedProductIds, setSelectedProductIds] = useState([]);
const [pageSize, setPageSize] = useState(20);
const [currentPage, setCurrentPage] = useState(1);
const [priceBrand, setPriceBrand] = useState("");
const [priceSeries, setPriceSeries] = useState("");
const [priceSearch, setPriceSearch] = useState("");
const [pricePage, setPricePage] = useState(1);
const [priceDrafts, setPriceDrafts] = useState({});
const [bulkNewVatPrice, setBulkNewVatPrice] = useState("");

const [visibleColumns, setVisibleColumns] = useState({
  code: true,
  name: true,
  category: true,
  subCategory: true,
  brand: true,
  series: true,
  vatPrice: true,
  stock: true,
  lowStock: true,
  status: true,
});

const filteredAdminProducts = (products || []).filter((p) => {
  const keyword = productSearch.trim().toLowerCase();

  const matchesSearch =
    keyword === "" ||
    String(p.productCode || "").toLowerCase().includes(keyword) ||
    String(p.name || "").toLowerCase().includes(keyword) ||
    String(p.category || "").toLowerCase().includes(keyword) ||
    String(p.subCategory || "").toLowerCase().includes(keyword) ||
    String(p.brand || "").toLowerCase().includes(keyword) ||
    String(p.series || "").toLowerCase().includes(keyword);

  const isActive = p.active !== false;

  const matchesStatus =
    statusFilter === "all" ||
    (statusFilter === "active" && isActive) ||
    (statusFilter === "inactive" && !isActive);

  const stock = Number(p.stock || 0);
  const lowStockAlert = Number(p.lowStockAlert || 0);

  const matchesStock =
    stockFilter === "all" ||
    (stockFilter === "out" && stock <= 0) ||
    (stockFilter === "low" && stock > 0 && stock <= lowStockAlert);

  return matchesSearch && matchesStatus && matchesStock;
});

useEffect(() => {
  setCurrentPage(1);
  setSelectedProductIds([]);
}, [productSearch, statusFilter, stockFilter, pageSize, products]);

useEffect(() => {
  setPricePage(1);
}, [priceBrand, priceSeries, priceSearch, products]);

const totalPages = Math.max(1, Math.ceil(filteredAdminProducts.length / pageSize));
const safeCurrentPage = Math.min(currentPage, totalPages);
const pagedProducts = filteredAdminProducts.slice(
  (safeCurrentPage - 1) * pageSize,
  safeCurrentPage * pageSize
);
const allPagedProductsSelected =
  pagedProducts.length > 0 &&
  pagedProducts.every((product) => selectedProductIds.includes(product.id));

const toggleProductSelect = (id) => {
  setSelectedProductIds((old) =>
    old.includes(id) ? old.filter((x) => x !== id) : [...old, id]
  );
};

const toggleSelectAllProducts = () => {
  if (allPagedProductsSelected) {
    const pagedProductIds = pagedProducts.map((p) => p.id);
    setSelectedProductIds((old) =>
      old.filter((id) => !pagedProductIds.includes(id))
    );
  } else {
    setSelectedProductIds((old) => [
      ...new Set([...old, ...pagedProducts.map((p) => p.id)]),
    ]);
  }
};

const bulkUpdateStatus = async (status) => {
  if (selectedProductIds.length === 0) {
    alert("Please select products first.");
    return;
  }

  const cleanStatus = String(status || "active").trim().toLowerCase();

  const confirmText =
    cleanStatus === "active"
      ? "Mark selected products as Active?"
      : "Mark selected products as Inactive?";

  if (!window.confirm(confirmText)) return;

  const { error } = await supabase
    .from("products")
    .update({ status: cleanStatus })
    .in("id", selectedProductIds);

  if (error) {
    alert("Bulk update failed: " + error.message);
    return;
  }

  setSelectedProductIds([]);
  await fetchProducts();
};

const vatSellingPrice = Number(productForm.vatPrice || 0);
const costPrice = Number(productForm.costPrice || 0);
const grossProfit = vatSellingPrice - costPrice;
const marginPercent =
  vatSellingPrice > 0 ? (grossProfit / vatSellingPrice) * 100 : 0;
const markupPercent = costPrice > 0 ? (grossProfit / costPrice) * 100 : 0;

const PRICE_PAGE_SIZE = 20;

const getProductVatValue = (product = {}) =>
  Number(product.vatPrice ?? product.vat_price ?? product.price ?? 0);

const getProductCostValue = (product = {}) =>
  Number(product.costPrice ?? product.cost_price ?? 0);

const getDraftVatPrice = (product = {}) => {
  const draft = priceDrafts[product.id];
  return draft === undefined ? getProductVatValue(product) : Number(draft || 0);
};

const getMarginPercent = (sellPrice, costValue) => {
  const selling = Number(sellPrice || 0);
  const cost = Number(costValue || 0);
  return selling > 0 ? ((selling - cost) / selling) * 100 : 0;
};

const getServerPreview = (product = {}, vatPriceOverride) =>
  getProductPriceForMode(
    {
      ...product,
      vatPrice: vatPriceOverride,
      vat_price: vatPriceOverride,
    },
    "server",
    "",
    pricingSettings
  );

const priceManagementProducts = (products || []).filter((product) => {
  const search = priceSearch.trim().toLowerCase();
  const matchesBrand = !priceBrand || String(product.brand || "") === priceBrand;
  const matchesSeries = !priceSeries || String(product.series || "") === priceSeries;
  const matchesSearch =
    !search ||
    String(product.productCode || product.product_code || "").toLowerCase().includes(search) ||
    String(product.name || product.productName || product.product_name || "").toLowerCase().includes(search) ||
    String(product.flavour || "").toLowerCase().includes(search);

  return matchesBrand && matchesSeries && matchesSearch;
});

const priceTotalPages = Math.max(1, Math.ceil(priceManagementProducts.length / PRICE_PAGE_SIZE));
const safePricePage = Math.min(pricePage, priceTotalPages);
const pagedPriceProducts = priceManagementProducts.slice(
  (safePricePage - 1) * PRICE_PAGE_SIZE,
  safePricePage * PRICE_PAGE_SIZE
);

const updateProductVatPrice = async (product, nextVatPrice) => {
  const cleanPrice = roundMoney(nextVatPrice);

  if (!product?.id || cleanPrice <= 0) {
    alert("Enter a valid new VAT price.");
    return;
  }

  if (
    !window.confirm(
      `Update ${product.name || product.productName || product.product_name} VAT price from ${formatCurrency(getProductVatValue(product))} to ${formatCurrency(cleanPrice)}?`
    )
  ) {
    return;
  }

  const { error } = await supabase
    .from("products")
    .update({ vat_price: cleanPrice.toFixed(2) })
    .eq("id", product.id);

  if (error) {
    alert("Price update failed: " + error.message);
    return;
  }

  setPriceDrafts((old) => {
    const next = { ...old };
    delete next[product.id];
    return next;
  });

  await fetchProducts();
};

const bulkUpdateBrandSeriesVatPrice = async () => {
  const cleanPrice = roundMoney(bulkNewVatPrice);

  if (!priceBrand || !priceSeries) {
    alert("Select both Brand and Series for bulk price update.");
    return;
  }

  if (cleanPrice <= 0) {
    alert("Enter a valid new VAT price.");
    return;
  }

  const affectedProducts = priceManagementProducts.filter(
    (product) => String(product.brand || "") === priceBrand && String(product.series || "") === priceSeries
  );

  if (affectedProducts.length === 0) {
    alert("No products found for this Brand and Series.");
    return;
  }

  if (
    !window.confirm(
      `Bulk update ${affectedProducts.length} product(s) for ${priceBrand} / ${priceSeries} to VAT price ${formatCurrency(cleanPrice)}?`
    )
  ) {
    return;
  }

  const { error } = await supabase
    .from("products")
    .update({ vat_price: cleanPrice.toFixed(2) })
    .eq("brand", priceBrand)
    .eq("series", priceSeries);

  if (error) {
    alert("Bulk price update failed: " + error.message);
    return;
  }

  setBulkNewVatPrice("");
  setPriceDrafts({});
  await fetchProducts();
};
const productLabelOptions = [
  { value: "", label: "No Label" },
  { value: "isNew", label: "New" },
  { value: "isPromotion", label: "Promotion" },
  { value: "isReduced", label: "Reduced" },
  { value: "comingSoon", label: "Coming Soon" },
  { value: "recommended", label: "Recommended" },
  { value: "topSeller", label: "Top Seller" },
];

const selectedProductLabel =
  [
    "comingSoon",
    "isNew",
    "isPromotion",
    "isReduced",
    "recommended",
    "topSeller",
  ].find((key) => productForm[key] === true) || "";

const updateProductLabel = (labelValue) => {
  setProductForm({
    ...productForm,
    isNew: labelValue === "isNew",
    isPromotion: labelValue === "isPromotion",
    isReduced: labelValue === "isReduced",
    comingSoon: labelValue === "comingSoon",
    recommended: labelValue === "recommended",
    topSeller: labelValue === "topSeller",
  });
};

  return (
    <div className="p-5 bg-slate-50 min-h-screen">
      <div className="flex items-center gap-3 mb-5">
        <h2 className="text-2xl font-bold">Products</h2>
        <button
          onClick={() => {
            resetForm();
            setActiveTab("add");
          }}
          className="bg-green-600 text-white px-4 py-2 rounded-xl font-bold"
        >
          Add New Product
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
            {[
        ["add", "Add Product"],
        ["edit", "Product List"],
      ].map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`p-3 rounded-xl font-bold ${
              activeTab === tab
                ? "bg-blue-600 text-white"
                : "bg-white border text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "add" && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">
            {editingId ? "Edit Product" : "Add Product"}
          </h3>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <section className="bg-white border rounded-2xl p-4 xl:col-span-2">
              <h4 className="text-lg font-bold mb-4">Product Information</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  className="input-box"
                  placeholder="Product Name"
                  value={productForm?.name || ""}
                  onChange={(e) => updateField("name", e.target.value)}
                />

                <input
                  className="input-box"
                  placeholder="Product Code"
                  value={productForm?.productCode || ""}
                  onChange={(e) => updateField("productCode", e.target.value)}
                />

                <select
                  className="input-box"
                  value={productForm?.category || ""}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                >
                  <option value="">Select Main Category</option>
                  {mainCategories.map((item) => (
                    <option key={item.id} value={item.option_name}>
                      {item.option_name}
                    </option>
                  ))}
                </select>

                <select
                  className="input-box"
                  value={productForm.subCategory || ""}
                  onChange={(e) => updateField("subCategory", e.target.value)}
                >
                  <option value="">Select Sub Category</option>
                  {subCategories.map((item) => (
                    <option key={item.id} value={item.option_name}>
                      {item.option_name}
                    </option>
                  ))}
                </select>

                <select
                  className="input-box"
                  value={productForm.brand || ""}
                  onChange={(e) => updateField("brand", e.target.value)}
                >
                  <option value="">Select Brand</option>
                  {brands.map((item) => (
                    <option key={item.id} value={item.option_name}>
                      {item.option_name}
                    </option>
                  ))}
                </select>

                <select
                  className="input-box"
                  value={productForm.series || ""}
                  onChange={(e) => updateField("series", e.target.value)}
                >
                  <option value="">Select Series</option>
                  {seriesList.map((item) => (
                    <option key={item.id} value={item.option_name}>
                      {item.option_name}
                    </option>
                  ))}
                </select>

                <input
                  className="input-box"
                  placeholder="Flavour"
                  value={productForm.flavour || ""}
                  onChange={(e) => updateField("flavour", e.target.value)}
                />

                <input
                  className="input-box"
                  placeholder="Weight / Size"
                  value={productForm.cartonSize || ""}
                  onChange={(e) => updateField("cartonSize", e.target.value)}
                />
              </div>

              <p className="text-xs text-slate-500 mt-3">
                Pieces Per Box is not wired to a saved product field yet, so it has not been added here.
              </p>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Product Image</h4>

              <div className="space-y-3">
                <div className="border rounded-xl p-3 bg-slate-50">
                  {productForm.image ? (
                    <img
                      src={productForm.image}
                      alt=""
                      className="w-full max-h-48 object-contain rounded-xl border bg-white"
                    />
                  ) : (
                    <div className="h-40 rounded-xl border bg-white flex items-center justify-center text-sm text-slate-500">
                      Image Preview
                    </div>
                  )}
                </div>

                <input
                  className="input-box"
                  placeholder="Image URL"
                  value={productForm.image || ""}
                  onChange={(e) => updateField("image", e.target.value)}
                />

                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files[0])}
                  className="w-full text-sm"
                />

                <button
                  type="button"
                  onClick={handleImageUpload}
                  disabled={uploadingImage}
                  className="bg-slate-800 text-white px-4 py-2 rounded-xl font-bold disabled:bg-slate-400"
                >
                  {uploadingImage ? "Uploading..." : "Upload Image"}
                </button>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Selling Information</h4>

              <div className="space-y-4">
                <input
                  className="input-box"
                  type="number"
                  placeholder="VAT Selling Price"
                  value={productForm.vatPrice || ""}
                  onChange={(e) => updateField("vatPrice", e.target.value)}
                />

                <input
                  className="input-box"
                  type="number"
                  placeholder="Special Price"
                  value={productForm.cashPrice || ""}
                  onChange={(e) => updateField("cashPrice", e.target.value)}
                />

                <input
                  className="input-box"
                  type="number"
                  placeholder="Wales Special Price"
                  value={productForm.walesSpecialPrice || ""}
                  onChange={(e) => updateField("walesSpecialPrice", e.target.value)}
                />

                <input
                  className="input-box"
                  type="number"
                  placeholder="England Special Price"
                  value={productForm.englandSpecialPrice || ""}
                  onChange={(e) => updateField("englandSpecialPrice", e.target.value)}
                />

                <select
                  className="input-box"
                  value={productForm.vatType || "20"}
                  onChange={(e) => updateField("vatType", e.target.value)}
                >
                  <option value="20">VAT 20%</option>
                  <option value="5">VAT 5%</option>
                  <option value="0">VAT 0%</option>
                  <option value="exempt">VAT Exempt</option>
                </select>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Margin Analysis</h4>

              <div className="grid grid-cols-1 gap-3">
                <div className="border rounded-xl p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 font-bold">Gross Profit</div>
                  <div className="text-xl font-bold">
                    {formatCurrency(grossProfit)}
                  </div>
                </div>

                <div className="border rounded-xl p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 font-bold">Margin %</div>
                  <div className="text-xl font-bold">
                    {marginPercent.toFixed(2)}%
                  </div>
                </div>

                <div className="border rounded-xl p-3 bg-slate-50">
                  <div className="text-xs text-slate-500 font-bold">Markup %</div>
                  <div className="text-xl font-bold">
                    {markupPercent.toFixed(2)}%
                  </div>
                </div>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Inventory</h4>

              <div className="space-y-4">
                {stockLocations.length === 0 && (
                  <p className="text-sm text-slate-500">
                    No active stock locations found.
                  </p>
                )}

                {stockLocations.map((location) => {
                  const locationStock =
                    productForm.locationStocks?.[location.id] || {};

                  return (
                    <div
                      key={location.id}
                      className="rounded-xl border border-slate-200 p-3"
                    >
                      <div className="mb-2 text-sm font-bold text-slate-700">
                        {location.location_name}
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <input
                          className="input-box"
                          type="number"
                          placeholder="Stock Quantity"
                          value={locationStock.qty || ""}
                          onChange={(e) =>
                            updateLocationStock(location.id, "qty", e.target.value)
                          }
                        />

                        <input
                          className="input-box"
                          type="number"
                          placeholder="Low Stock Alert"
                          value={locationStock.lowStockAlert || ""}
                          onChange={(e) =>
                            updateLocationStock(
                              location.id,
                              "lowStockAlert",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Availability</h4>

              <div className="space-y-3">
                <label className="checkbox-box">
                  <input
                    type="checkbox"
                    checked={productForm.availableInEngland === true}
                    onChange={(e) => updateField("availableInEngland", e.target.checked)}
                  />
                  England
                </label>

                <label className="checkbox-box">
                  <input
                    type="checkbox"
                    checked={productForm.availableInWales === true}
                    onChange={(e) => updateField("availableInWales", e.target.checked)}
                  />
                  Wales
                </label>

                <label className="checkbox-box">
                  <input
                    type="checkbox"
                    checked={productForm.availableFromSupplier !== false}
                    onChange={(e) => updateField("availableFromSupplier", e.target.checked)}
                  />
                  Alternative Supplier
                </label>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Purchasing</h4>

              <div className="space-y-4">
                <input
                  className="input-box"
                  type="number"
                  placeholder="Cost Price"
                  value={productForm.costPrice || ""}
                  onChange={(e) => updateField("costPrice", e.target.value)}
                />

                <select
                  className="input-box"
                  value={productForm.supplierName || ""}
                  onChange={(e) => updateField("supplierName", e.target.value)}
                >
                  <option value="">Select Supplier</option>

                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.supplier_name}>
                      {supplier.supplier_name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4">
              <h4 className="text-lg font-bold mb-4">Accounting</h4>

              <div className="space-y-4">
                <select
                  className="input-box"
                  value={productForm.salesAccount || ""}
                  onChange={(e) => updateField("salesAccount", e.target.value)}
                >
                  <option value="" disabled>
                    {productForm.category ? "Select Sales Account" : "Select Main Category first"}
                  </option>
                  {salesAccountsForCategory.map((account) => (
                    <option key={account.id} value={account.account_code}>
                      {account.account_code} - {account.account_name}
                    </option>
                  ))}
                </select>

                <select
                  className="input-box"
                  value={productForm.purchaseAccount || ""}
                  onChange={(e) => updateField("purchaseAccount", e.target.value)}
                >
                  <option value="" disabled>
                    {productForm.category ? "Select Purchase Account" : "Select Main Category first"}
                  </option>
                  {purchaseAccountsForCategory.map((account) => (
                    <option key={account.id} value={account.account_code}>
                      {account.account_code} - {account.account_name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="bg-white border rounded-2xl p-4 xl:col-span-2">
              <h4 className="text-lg font-bold mb-4">Product Labels</h4>

              <div className="space-y-4">
                <select
                  className="input-box"
                  value={selectedProductLabel}
                  onChange={(e) => updateProductLabel(e.target.value)}
                >
                  {productLabelOptions.map((label) => (
                    <option key={label.value || "none"} value={label.value}>
                      {label.label}
                    </option>
                  ))}
                </select>

                <label className="checkbox-box">
                  <input
                    type="checkbox"
                    checked={productForm.active !== false}
                    onChange={(e) => updateField("active", e.target.checked)}
                  />
                  Active
                </label>
              </div>

              <p className="text-xs text-slate-500 mt-3">
                Select one display label only. Active uses the product status field.
              </p>
            </section>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            {editingId && (
              <button onClick={resetForm} className="px-5 py-3 rounded-xl bg-slate-200 font-bold">
                Cancel
              </button>
            )}

            <button onClick={saveProduct} className="px-6 py-3 rounded-xl bg-blue-600 text-white font-bold">
              {editingId ? "Update Product" : "Save Product"}
            </button>
          </div>
        </div>
      )}


      {activeTab === "edit" && (
  <div className="bg-white rounded-2xl shadow-sm p-5 overflow-auto">
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
      <h3 className="text-xl font-bold">Edit Products</h3>

      <button
        onClick={fetchProducts}
        className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold"
      >
        Refresh
      </button>
    </div>

    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
      <input
        className="input-box"
        placeholder="Search product..."
        value={productSearch}
        onChange={(e) => setProductSearch(e.target.value)}
      />

      <select
        className="input-box"
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value)}
      >
        <option value="active">Active Products</option>
        <option value="inactive">Inactive Products</option>
        <option value="all">All Products</option>
      </select>

      <select
        className="input-box"
        value={stockFilter}
        onChange={(e) => setStockFilter(e.target.value)}
      >
        <option value="all">All Stock</option>
        <option value="out">Out of Stock</option>
        <option value="low">Low Stock</option>
      </select>

      

      <select
        className="input-box"
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
      >
        <option value={20}>20 per page</option>
        <option value={50}>50 per page</option>
        <option value={100}>100 per page</option>
      </select>
    </div>

    <div className="border rounded-2xl p-3 mb-4 bg-slate-50">
      <div className="font-bold mb-2">Show / Hide Columns</div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
        {Object.keys(visibleColumns).map((key) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={visibleColumns[key]}
              onChange={(e) =>
                setVisibleColumns({
                  ...visibleColumns,
                  [key]: e.target.checked,
                })
              }
            />
            {key}
          </label>
        ))}
      </div>
    </div>

    <div className="mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
  <div className="text-sm font-bold text-slate-600">
    {selectedProductIds.length} selected / {filteredAdminProducts.length} found
  </div>

  <div>
    {statusFilter === "active" && (
      <button
        onClick={() => bulkUpdateStatus("inactive")}
        disabled={selectedProductIds.length === 0}
        className="bg-red-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
      >
        Inactive
      </button>
    )}

    {statusFilter === "inactive" && (
      <button
        onClick={() => bulkUpdateStatus("active")}
        disabled={selectedProductIds.length === 0}
        className="bg-green-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
      >
        Active
      </button>
    )}

    {statusFilter === "all" && (
      <div className="flex gap-2">
        <button
          onClick={() => bulkUpdateStatus("active")}
          disabled={selectedProductIds.length === 0}
          className="bg-green-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
        >
          Active
        </button>

        <button
          onClick={() => bulkUpdateStatus("inactive")}
          disabled={selectedProductIds.length === 0}
          className="bg-red-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
        >
          Inactive
        </button>
      </div>
    )}
  </div>
</div>

    <table className="w-full text-left text-sm border-collapse">
      <thead>
        <tr className="bg-slate-100 border">
          <th className="p-2 border">
            <input
              type="checkbox"
              checked={
                allPagedProductsSelected
              }
              onChange={toggleSelectAllProducts}
            />
          </th>

          {visibleColumns.code && <th className="p-2 border">Code</th>}
          {visibleColumns.name && <th className="p-2 border">Product Name</th>}
          {visibleColumns.category && <th className="p-2 border">Category</th>}
          {visibleColumns.subCategory && <th className="p-2 border">Sub Category</th>}
          {visibleColumns.brand && <th className="p-2 border">Brand</th>}
          {visibleColumns.series && <th className="p-2 border">Series</th>}
          {visibleColumns.vatPrice && <th className="p-2 border text-right">VAT Price</th>}
          {visibleColumns.stock && <th className="p-2 border text-right">Stock</th>}
          {visibleColumns.lowStock && <th className="p-2 border text-right">Low Alert</th>}
          {visibleColumns.status && <th className="p-2 border">Status</th>}
          <th className="p-2 border">Action</th>
        </tr>
      </thead>

      <tbody>
        {pagedProducts.map((p) => {
          const stock = Number(p.stock || 0);
          const lowStockAlert = Number(p.lowStockAlert || 0);
          const isActive = p.active !== false;

          return (
            <tr key={p.id} className="border hover:bg-slate-50">
              <td className="p-2 border">
                <input
                  type="checkbox"
                  checked={selectedProductIds.includes(p.id)}
                  onChange={() => toggleProductSelect(p.id)}
                />
              </td>

              {visibleColumns.code && (
                <td className="p-2 border font-bold">{p.productCode}</td>
              )}

              {visibleColumns.name && (
                <td className="p-2 border">{p.name}</td>
              )}

              {visibleColumns.category && (
                <td className="p-2 border">{p.category}</td>
              )}

              {visibleColumns.subCategory && (
                <td className="p-2 border">{p.subCategory}</td>
              )}

              {visibleColumns.brand && (
                <td className="p-2 border">{p.brand}</td>
              )}

              {visibleColumns.series && (
                <td className="p-2 border">{p.series}</td>
              )}

              {visibleColumns.vatPrice && (
                <td className="p-2 border text-right">
                  {formatCurrency(p.vatPrice)}
                </td>
              )}

              {visibleColumns.stock && (
                <td
                  className={`p-2 border text-right font-bold ${
                    stock <= 0
                      ? "text-red-600"
                      : stock <= lowStockAlert
                      ? "text-orange-600"
                      : "text-green-700"
                  }`}
                >
                  {stock}
                </td>
              )}

              {visibleColumns.lowStock && (
                <td className="p-2 border text-right">{lowStockAlert}</td>
              )}

              {visibleColumns.status && (
                <td className="p-2 border">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}
                  >
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </td>
              )}

              <td className="p-2 border">
                <button
                  onClick={() => {
                    editProduct(p);
                    setActiveTab("add");
                  }}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold"
                >
                  Edit
                </button>
              </td>
            </tr>
          );
        })}

        {filteredAdminProducts.length === 0 && (
          <tr>
            <td colSpan="20" className="p-5 text-center text-slate-500">
              No products found.
            </td>
          </tr>
        )}
      </tbody>
    </table>
    <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
      <div className="text-sm font-bold text-slate-600">
        Page {safeCurrentPage} of {totalPages}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
          disabled={safeCurrentPage <= 1}
          className="bg-white border px-4 py-2 rounded-xl font-bold disabled:bg-slate-100 disabled:text-slate-400"
        >
          Previous
        </button>

        <button
          type="button"
          onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
          disabled={safeCurrentPage >= totalPages}
          className="bg-white border px-4 py-2 rounded-xl font-bold disabled:bg-slate-100 disabled:text-slate-400"
        >
          Next
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
