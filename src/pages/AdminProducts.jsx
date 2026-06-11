import { useEffect, useState } from "react";

import * as XLSX from "xlsx";
import { supabase } from "../services/supabase";



export default function AdminProducts({
  products,
  productForm,
  setProductForm,
  editingId,
  saveProduct,
  fetchProducts,
  editProduct,
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


  const [activeTab, setActiveTab] = useState("add");
  const [productOptions, setProductOptions] = useState([]);

  const updateField = (field, value) => {
    setProductForm({
      ...productForm,
      [field]: value,
    });
  };

  const [importing, setImporting] = useState(false);
  const [updatingCodes, setUpdatingCodes] = useState(false);

  const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const toBool = (value) => {
  if (value === true) return true;
  if (value === false) return false;
  const v = String(value || "").toLowerCase().trim();
  return ["true", "yes", "y", "1"].includes(v);
};

const handleImportExcel = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setImporting(true);

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const cleanedRows = rows.map((row) => ({
      product_code: row.product_code || row.productCode || row["Product Code"] || "",
      main_category: row.main_category || row.category || row.Category || "",
      sub_category: row.sub_category || row.subCategory || row["Sub Category"] || "",
      brand: row.brand || row.Brand || "",
      series: row.series || row.Series || "",
      flavour: row.flavour || row.Flavour || "",
      product_name: row.product_name || row.name || row["Product Name"] || "",
      cash_price: Number(row.cash_price || row.cashPrice || row["Cash Price"] || 0),
      vat_price: Number(row.vat_price || row.vatPrice || row["VAT Price"] || 0),
      carton_size: String(row.carton_size || row.cartonSize || row["Carton Size"] || ""),
      image_url: row.image_url || row.image || row["Image URL"] || "",
      stock: Number(row.stock || row.Stock || 0),
      low_stock_alert: Number(row.low_stock_alert || row.lowStockAlert || row["Low Stock Alert"] || 10),
      status: row.status || row.Status || "active",
      show_in_england: toBool(row.show_in_england ?? row["Show In England"] ?? true),
      show_in_wales: toBool(row.show_in_wales ?? row["Show In Wales"] ?? true),
      vat_type: String(row.vat_type || row.vatType || row["VAT Type"] || "20"),
      available_in_england: toBool(row.available_in_england ?? row["Available In England"] ?? true),
      available_in_wales: toBool(row.available_in_wales ?? row["Available In Wales"] ?? true),
      available_from_supplier: toBool(row.available_from_supplier ?? row["Available From Supplier"] ?? true),
    }));

    const validRows = cleanedRows.filter((p) => p.product_name && p.product_code);

    const validCategories = productOptions
  .filter((o) => o.option_type === "main_category")
  .map((o) => normalize(o.option_name));

  const validSubCategories = productOptions
    .filter((o) => o.option_type === "sub_category")
    .map((o) => normalize(o.option_name));

  const validBrands = productOptions
    .filter((o) => o.option_type === "brand")
    .map((o) => normalize(o.option_name));

  const validSeries = productOptions
    .filter((o) => o.option_type === "series")
    .map((o) => normalize(o.option_name));

  const validationErrors = [];

  validRows.forEach((row, index) => {
  const rowNumber = index + 2;

  if (
    row.main_category &&
    !validCategories.includes(normalize(row.main_category))
  ) {
    validationErrors.push(
      `Row ${rowNumber}: Category "${row.main_category}" not found in Product Settings`
    );
  }

  if (
    row.sub_category &&
    !validSubCategories.includes(normalize(row.sub_category))
  ) {
    validationErrors.push(
      `Row ${rowNumber}: Sub Category "${row.sub_category}" not found in Product Settings`
    );
  }

  if (
    row.brand &&
    !validBrands.includes(normalize(row.brand))
  ) {
    validationErrors.push(
      `Row ${rowNumber}: Brand "${row.brand}" not found in Product Settings`
    );
  }

  if (
    row.series &&
    !validSeries.includes(normalize(row.series))
  ) {
    validationErrors.push(
      `Row ${rowNumber}: Series "${row.series}" not found in Product Settings`
    );
  }
});

if (validationErrors.length > 0) {
  alert(
    "Import Stopped.\n\n" +
    validationErrors.slice(0, 20).join("\n") +
    "\n\nPlease fix Product Settings or Excel file first."
  );

  setImporting(false);
  e.target.value = "";
  return;
}

    if (validRows.length === 0) {
      alert("No valid products found in Excel file.");
      setImporting(false);
      e.target.value = "";
      return;
    }

    const productCodes = validRows.map((p) => p.product_code);

    const { data: existingProducts, error: existingError } = await supabase
      .from("products")
      .select("id, product_code, stock")
      .in("product_code", productCodes);

    if (existingError) throw existingError;

    const oldStockMap = {};
    (existingProducts || []).forEach((product) => {
      oldStockMap[product.product_code] = {
        id: product.id,
        stock: Number(product.stock || 0),
      };
    });

    const { data: savedProducts, error } = await supabase
      .from("products")
      .upsert(validRows, {
        onConflict: "product_code",
      })
      .select("id, product_code, stock");

    if (error) throw error;

    const stockMovements = [];

    (savedProducts || []).forEach((product) => {
      const importedRow = validRows.find(
        (row) => row.product_code === product.product_code
      );

      if (!importedRow) return;

      const oldStock = oldStockMap[product.product_code]?.stock ?? 0;
      const newStock = Number(importedRow.stock || 0);
      const qtyChange = newStock - oldStock;

      if (qtyChange !== 0) {
        stockMovements.push({
          product_id: product.id,
          movement_type: "IMPORT",
          qty: qtyChange,
          stock_before: oldStock,
          stock_after: newStock,
          note: "Excel Import",
        });
      }
    });

  
    

    if (stockMovements.length > 0) {
      const { error: movementError } = await supabase
        .from("stock_movements")
        .insert(stockMovements);

      if (movementError) throw movementError;
    }

    alert(
      `${validRows.length} products imported successfully. ${stockMovements.length} stock movements recorded.`
    );

    fetchProducts();
    setActiveTab("edit");
  } catch (err) {
    alert("Import failed: " + err.message);
  }

  setImporting(false);
  e.target.value = "";
};

const handleBulkCodeUpdate = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  setUpdatingCodes(true);

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    let updatedCount = 0;

    for (const row of rows) {
      const productName = row.product_name || "";
      const oldCode = row.old_product_code || "";
      const newCode = row.new_product_code || "";

      if (!productName || !oldCode || !newCode) continue;

      const { data: product } = await supabase
        .from("products")
        .select("id")
        .eq("product_name", productName)
        .eq("product_code", oldCode)
        .single();

      if (!product) continue;

      const { error } = await supabase
        .from("products")
        .update({
          product_code: newCode,
        })
        .eq("id", product.id);

      if (!error) updatedCount++;
    }

    alert(`${updatedCount} product codes updated successfully.`);

    await fetchProducts();
  } catch (err) {
    alert("Bulk code update failed: " + err.message);
  }

  setUpdatingCodes(false);
  e.target.value = "";
};

 /* ==========================
   Export and Import Tabs
========================== */
const handleExportExcel = () => {
  const exportData = products.map((p) => ({
    product_code: p.productCode,
    main_category: p.category,
    sub_category: p.subCategory,
    brand: p.brand,
    series: p.series,
    flavour: p.flavour,
    product_name: p.name,
    cash_price: p.cashPrice,
    vat_price: p.vatPrice,
    carton_size: p.cartonSize,
    image_url: p.image,
    stock: p.stock,
    low_stock_alert: p.lowStockAlert,
    vat_type: p.vatType,
    available_in_england: p.availableInEngland,
    available_in_wales: p.availableInWales,
    available_from_supplier: p.availableFromSupplier,
  }));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

  XLSX.writeFile(
    workbook,
    `fairchoice-products-${new Date().toISOString().slice(0, 10)}.xlsx`
  );
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
      vatType: "20",
      availableInEngland: true,
      availableInWales: true,
      cartonSize: "",
      image: "",
      stock: "",
      lowStockAlert: "",
      availableFromSupplier: true,
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



useEffect(() => {
  fetchProductOptions();
}, []);

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
const [productSearch, setProductSearch] = useState("");
const [statusFilter, setStatusFilter] = useState("active");
const [stockFilter, setStockFilter] = useState("all");
const [selectedProductIds, setSelectedProductIds] = useState([]);

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

const toggleProductSelect = (id) => {
  setSelectedProductIds((old) =>
    old.includes(id) ? old.filter((x) => x !== id) : [...old, id]
  );
};

const toggleSelectAllProducts = () => {
  if (selectedProductIds.length === filteredAdminProducts.length) {
    setSelectedProductIds([]);
  } else {
    setSelectedProductIds(filteredAdminProducts.map((p) => p.id));
  }
};

const bulkUpdateStatus = async (status) => {
  if (selectedProductIds.length === 0) {
    alert("Please select products first.");
    return;
  }

  const confirmText =
    status === "Active"
      ? "Mark selected products as Active?"
      : "Mark selected products as Inactive?";

  if (!window.confirm(confirmText)) return;

  const { error } = await supabase
    .from("products")
    .update({ status })
    .in("id", selectedProductIds);

  if (error) {
    alert("Bulk update failed: " + error.message);
    return;
  }

  setSelectedProductIds([]);
  await fetchProducts();
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-5">
  {["add", "edit", "export", "import", "codeupdate"].map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`p-3 rounded-xl font-bold ${
        activeTab === tab
          ? "bg-blue-600 text-white"
          : "bg-white border text-slate-700"
      }`}
    >
      {tab === "add" && "Add Product"}
      {tab === "edit" && "Edit Products"}
      {tab === "export" && "Export Excel"}
      {tab === "import" && "Import Excel"}
      {tab === "codeupdate" && "Bulk Code Update"}
    </button>
  ))}
</div>

      {activeTab === "codeupdate" && (
  <div className="bg-white rounded-2xl shadow-sm p-5">
    <h3 className="text-xl font-bold mb-4">
      Bulk Code Update
    </h3>

    <p className="mb-4 text-slate-600">
      Excel columns required:
      product_name,
      old_product_code,
      new_product_code
    </p>

    <label className="inline-block cursor-pointer">
      <input
        type="file"
        accept=".xlsx,.csv"
        onChange={handleBulkCodeUpdate}
        disabled={updatingCodes}
        className="hidden"
      />

      <div className="bg-orange-600 hover:bg-orange-700 text-white font-bold px-6 py-4 rounded-xl">
        Upload Code Update File
      </div>
    </label>

    {updatingCodes && (
      <div className="mt-4">
        Updating product codes...
      </div>
    )}
  </div>
)}

      {activeTab === "add" && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">
            {editingId ? "Edit Product" : "Add Product"}
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
  <input
    className="input-box"
    placeholder="Product Name"
    value={productForm?.name || ""}
    onChange={(e) => updateField("name", e.target.value)}
  />

  <input
    className="input-box"
    placeholder="SKU / Product Code"
    value={productForm?.productCode || ""}
    onChange={(e) => updateField("productCode", e.target.value)}
  />

 <select
  className="input-box"
  value={productForm?.category || ""}
  onChange={(e) => updateField("category", e.target.value)}
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
    placeholder="Carton Size"
    value={productForm.cartonSize || ""}
    onChange={(e) => updateField("cartonSize", e.target.value)}
  />

<div className="md:col-span-2 border rounded-xl p-3">
  <label className="font-bold text-sm block mb-2">
    Product Image
  </label>

  {productForm.image && (
    <img
      src={productForm.image}
      alt=""
      className="w-24 h-24 object-cover rounded-xl mb-3 border"
    />
  )}

  <input
    className="input-box mb-2"
    placeholder="Image URL"
    value={productForm.image || ""}
    onChange={(e) => updateField("image", e.target.value)}
  />

  <input
    type="file"
    accept="image/*"
    onChange={(e) => setImageFile(e.target.files[0])}
    className="mb-2"
  />

  <button
    type="button"
    onClick={handleImageUpload}
    disabled={uploadingImage}
    className="bg-slate-800 text-white px-4 py-2 rounded-xl font-bold"
  >
    {uploadingImage ? "Uploading..." : "Upload Image"}
  </button>
</div>

    <input
    className="input-box"
    type="number"
    placeholder="VAT Net Price"
    value={productForm.vatPrice || ""}
    onChange={(e) => updateField("vatPrice", e.target.value)}
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

  <input
    className="input-box"
    type="number"
    placeholder="Stock Quantity"
    value={productForm.stock || ""}
    onChange={(e) => updateField("stock", e.target.value)}
  />

  <input
    className="input-box"
    type="number"
    placeholder="Low Stock Alert"
    value={productForm.lowStockAlert || ""}
    onChange={(e) => updateField("lowStockAlert", e.target.value)}
  />

  <label className="checkbox-box">
    <input
      type="checkbox"
      checked={productForm.availableInEngland === true}
      onChange={(e) => updateField("availableInEngland", e.target.checked)}
    />
    Available in England
  </label>

  <label className="checkbox-box">
    <input
      type="checkbox"
      checked={productForm.availableInWales === true}
      onChange={(e) => updateField("availableInWales", e.target.checked)}
    />
    Available in Wales
  </label>
</div>

          <label className="checkbox-box">
          <input
            type="checkbox"
            checked={productForm.availableFromSupplier !== false}
            onChange={(e) => updateField("availableFromSupplier", e.target.checked)}
          />
          Available from Different Supplier when stock is 0
        </label>

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
    {selectedProductIds.length} selected / {filteredAdminProducts.length} shown
  </div>

  <div>
    {statusFilter === "active" && (
      <button
        onClick={() => bulkUpdateStatus("Inactive")}
        disabled={selectedProductIds.length === 0}
        className="bg-red-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
      >
        Inactive
      </button>
    )}

    {statusFilter === "inactive" && (
      <button
        onClick={() => bulkUpdateStatus("Active")}
        disabled={selectedProductIds.length === 0}
        className="bg-green-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
      >
        Active
      </button>
    )}

    {statusFilter === "all" && (
      <div className="flex gap-2">
        <button
          onClick={() => bulkUpdateStatus("Active")}
          disabled={selectedProductIds.length === 0}
          className="bg-green-600 text-white px-5 py-2 rounded-xl font-bold disabled:bg-slate-300"
        >
          Active
        </button>

        <button
          onClick={() => bulkUpdateStatus("Inactive")}
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
                filteredAdminProducts.length > 0 &&
                selectedProductIds.length === filteredAdminProducts.length
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
        {filteredAdminProducts.map((p) => {
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
                  £{Number(p.vatPrice || 0).toFixed(2)}
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
  </div>
)}

       
      {activeTab === "export" && (
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">Export Products</h3>
          <button
          onClick={handleExportExcel}
          className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
        >
          Export to Excel
        </button>
        </div>
      )}

    {activeTab === "import" && (
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <h3 className="text-xl font-bold mb-4">Import Products</h3>

    <div className="space-y-4">
      <label className="inline-block cursor-pointer">
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={handleImportExcel}
          disabled={importing}
          className="hidden"
        />

        <div className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-4 rounded-xl text-center min-w-[220px]">
          📊 Upload Excel File
        </div>
      </label>

      <p className="text-sm text-slate-500">
        Supported files: .xlsx and .csv
      </p>

      {importing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="font-bold text-blue-700">
            Importing products...
          </p>
        </div>
      )}
    
        </div>
            
        </div>
      )}
    </div>
  );
}