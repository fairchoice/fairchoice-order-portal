import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../services/supabase";

export default function ProductImportExport({ products = [], fetchProducts }) {
  const [productOptions, setProductOptions] = useState([]);
  const [importing, setImporting] = useState(false);
  const [updatingCodes, setUpdatingCodes] = useState(false);
  const [importLabel, setImportLabel] = useState("");

  const getImportLabelFields = (label) => ({
    is_new: label === "new",
    is_promotion: label === "promotion",
    is_reduced: label === "reduced",
    coming_soon: label === "comingSoon",
    recommended: label === "recommended",
    top_seller: label === "topSeller",
  });

  useEffect(() => {
    fetchProductOptions();
  }, []);

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

  const fetchProductOptions = async () => {
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("active", true)
      .order("option_name");

    if (!error) setProductOptions(data || []);
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
        ...getImportLabelFields(importLabel),
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

        if (row.main_category && !validCategories.includes(normalize(row.main_category))) {
          validationErrors.push(
            `Row ${rowNumber}: Category "${row.main_category}" not found in Product Settings`
          );
        }

        if (row.sub_category && !validSubCategories.includes(normalize(row.sub_category))) {
          validationErrors.push(
            `Row ${rowNumber}: Sub Category "${row.sub_category}" not found in Product Settings`
          );
        }

        if (row.brand && !validBrands.includes(normalize(row.brand))) {
          validationErrors.push(
            `Row ${rowNumber}: Brand "${row.brand}" not found in Product Settings`
          );
        }

        if (row.series && !validSeries.includes(normalize(row.series))) {
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

      if (typeof fetchProducts === "function") {
        await fetchProducts();
      }
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

      if (typeof fetchProducts === "function") {
        await fetchProducts();
      }
    } catch (err) {
      alert("Bulk code update failed: " + err.message);
    }

    setUpdatingCodes(false);
    e.target.value = "";
  };

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

  return (
    <div className="p-5 bg-slate-50 min-h-screen">
      <div className="mb-5">
        <h2 className="text-2xl font-bold">Product Import / Export</h2>
        <p className="text-sm text-slate-600">
          Export products, import product spreadsheets and bulk update product codes.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">Export Products</h3>
          <p className="text-sm text-slate-600 mb-4">
            Download the current product list as an Excel file.
          </p>

          <button
            onClick={handleExportExcel}
            className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
          >
            Export to Excel
          </button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">Import Products</h3>

          <select
            className="input-box mb-4"
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
          >
            <option value="">No Label</option>
            <option value="new">New Product</option>
            <option value="promotion">Promotion Product</option>
            <option value="comingSoon">Coming Soon</option>
            <option value="recommended">Recommended Product</option>
            <option value="topSeller">Top Seller</option>
            <option value="reduced">Reduced</option>
          </select>

          <label className="inline-block cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={handleImportExcel}
              disabled={importing}
              className="hidden"
            />

            <div className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-4 rounded-xl text-center min-w-[220px]">
              Upload Excel File
            </div>
          </label>

          <p className="text-sm text-slate-500 mt-4">
            Supported files: .xlsx and .csv
          </p>

          {importing && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-4">
              <p className="font-bold text-blue-700">Importing products...</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h3 className="text-xl font-bold mb-4">Bulk Code Update</h3>

          <p className="mb-4 text-slate-600">
            Excel columns required: product_name, old_product_code,
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

          {updatingCodes && <div className="mt-4">Updating product codes...</div>}
        </div>
      </div>
    </div>
  );
}
