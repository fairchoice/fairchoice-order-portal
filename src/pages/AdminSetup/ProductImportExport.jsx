import { useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../services/supabase";

const PRODUCT_COLUMNS = [
  ["Product ID", "id"],
  ["Product Code", "product_code"],
  ["Product Name", "product_name"],
  ["Main Category", "main_category"],
  ["Sub Category", "sub_category"],
  ["Brand", "brand"],
  ["Series", "series"],
  ["Cash Price", "cash_price"],
  ["VAT Price", "vat_price"],
  ["Carton Size", "carton_size"],
  ["Stock", "stock"],
  ["Low Stock Alert", "low_stock_alert"],
  ["Status", "status"],
  ["Available In Wales", "available_in_wales"],
  ["Available In England", "available_in_england"],
  ["Available From Supplier", "available_from_supplier"],
  ["Image URL", "image_url"],
  ["Recommended", "recommended"],
  ["Top Seller", "top_seller"],
  ["Wales Special Price", "wales_special_price"],
  ["England Special Price", "england_special_price"],
];

const EDITABLE_PRODUCT_FIELDS = PRODUCT_COLUMNS
  .map(([, field]) => field)
  .filter((field) => field !== "id" && field !== "product_code");

const PRODUCT_FIELD_LABELS = PRODUCT_COLUMNS.reduce((labels, [label, field]) => {
  labels[field] = label;
  return labels;
}, {});

const NUMBER_FIELDS = new Set([
  "cash_price",
  "vat_price",
  "stock",
  "low_stock_alert",
  "wales_special_price",
  "england_special_price",
]);

const BOOLEAN_FIELDS = new Set([
  "available_in_wales",
  "available_in_england",
  "available_from_supplier",
  "recommended",
  "top_seller",
]);

const LEGACY_FIELD_ALIASES = {
  productCode: "product_code",
  product_name: "product_name",
  productName: "product_name",
  name: "product_name",
  category: "main_category",
  subCategory: "sub_category",
  cashPrice: "cash_price",
  vatPrice: "vat_price",
  cartonSize: "carton_size",
  lowStockAlert: "low_stock_alert",
  availableInWales: "available_in_wales",
  availableInEngland: "available_in_england",
  availableFromSupplier: "available_from_supplier",
  image: "image_url",
  imageUrl: "image_url",
  walesSpecialPrice: "wales_special_price",
  englandSpecialPrice: "england_special_price",
};

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeText = (value) => String(value || "").trim();
const normalizeCompare = (value) => String(value ?? "").trim();

const getImportLabelFields = (label) => ({
  ...(label
    ? {
        is_new: label === "new",
        is_promotion: label === "promotion",
        is_reduced: label === "reduced",
        coming_soon: label === "comingSoon",
        recommended: label === "recommended",
        top_seller: label === "topSeller",
      }
    : {}),
});

const toBoolValue = (value, defaultValue = false) => {
  if (value === true || value === false) return value;
  if (value == null || value === "") return defaultValue;

  const text = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;

  return null;
};

const toNumberValue = (value) => {
  if (value == null || value === "") return 0;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const pickCell = (row, label, field) => {
  const candidates = [
    label,
    field,
    normalizeHeader(label),
    normalizeHeader(field),
    ...Object.entries(LEGACY_FIELD_ALIASES)
      .filter(([, mapped]) => mapped === field)
      .map(([alias]) => alias),
  ];

  const key = Object.keys(row).find((rowKey) =>
    candidates.some(
      (candidate) => normalizeHeader(rowKey) === normalizeHeader(candidate)
    )
  );

  return key ? row[key] : "";
};

const formatPreviewValue = (value) => {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  if (value == null) return "";
  return String(value);
};

export default function ProductImportExport({ products = [], fetchProducts }) {
  const [productOptions, setProductOptions] = useState([]);
  const [importing, setImporting] = useState(false);
  const [updatingCodes, setUpdatingCodes] = useState(false);
  const [importLabel, setImportLabel] = useState("");
  const [importMode, setImportMode] = useState("update");
  const [productImportPreview, setProductImportPreview] = useState(null);
  const [selectedImportFileName, setSelectedImportFileName] = useState("");

  useEffect(() => {
    fetchProductOptions();
  }, []);

  const fetchProductOptions = async () => {
    const { data, error } = await supabase
      .from("product_options")
      .select("*")
      .eq("active", true)
      .order("option_name");

    if (!error) setProductOptions(data || []);
  };

  const validateOption = (errors, rowNumber, field, value, optionType, label) => {
    if (!value) return;

    const validValues = productOptions
      .filter((option) => option.option_type === optionType)
      .map((option) => normalizeText(option.option_name).toLowerCase());

    if (!validValues.includes(normalizeText(value).toLowerCase())) {
      errors.push({
        rowNumber,
        field,
        message: `${label} "${value}" not found in Product Settings`,
      });
    }
  };

  const parseProductRow = (row, rowNumber) => {
    const errors = [];
    const parsed = {};

    PRODUCT_COLUMNS.forEach(([label, field]) => {
      const rawValue = pickCell(row, label, field);

      if (field === "id") {
        parsed.id = normalizeText(rawValue);
        return;
      }

      if (NUMBER_FIELDS.has(field)) {
        const numberValue = toNumberValue(rawValue);
        if (numberValue === null) {
          errors.push({ rowNumber, field, message: `${label} must be numeric` });
        } else {
          parsed[field] = numberValue;
        }
        return;
      }

      if (BOOLEAN_FIELDS.has(field)) {
        const boolValue = toBoolValue(rawValue, field.startsWith("available_"));
        if (boolValue === null) {
          errors.push({
            rowNumber,
            field,
            message: `${label} must be TRUE or FALSE`,
          });
        } else {
          parsed[field] = boolValue;
        }
        return;
      }

      parsed[field] = normalizeText(rawValue);
    });

    parsed.status = parsed.status || "Active";

    if (!parsed.product_code) {
      errors.push({ rowNumber, field: "product_code", message: "Product Code is required" });
    }

    if (!parsed.product_name) {
      errors.push({ rowNumber, field: "product_name", message: "Product Name is required" });
    }

    validateOption(errors, rowNumber, "main_category", parsed.main_category, "main_category", "Main Category");
    validateOption(errors, rowNumber, "sub_category", parsed.sub_category, "sub_category", "Sub Category");
    validateOption(errors, rowNumber, "brand", parsed.brand, "brand", "Brand");
    validateOption(errors, rowNumber, "series", parsed.series, "series", "Series");

    return { parsed, errors };
  };

  const handleImportExcel = async (event, mode = "update") => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportMode(mode);
    setSelectedImportFileName(file.name);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const { data: dbProducts, error: dbError } = await supabase
        .from("products")
        .select("*");

      if (dbError) throw dbError;

      const byCode = new Map(
        (dbProducts || []).map((product) => [
          normalizeText(product.product_code).toLowerCase(),
          product,
        ])
      );
      const seenCodes = new Map();
      const errors = [];
      const creates = [];
      const updates = [];
      const changedFields = [];
      let unchangedCount = 0;
      let foundCount = 0;

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const { parsed, errors: rowErrors } = parseProductRow(row, rowNumber);
        const addBlockingError = (field, message) => {
          errors.push({
            rowNumber,
            field,
            productCode: parsed.product_code || "",
            productName: parsed.product_name || "",
            message,
          });
        };

        errors.push(
          ...rowErrors.map((error) => ({
            ...error,
            productCode: parsed.product_code || "",
            productName: parsed.product_name || "",
          }))
        );

        const codeKey = normalizeText(parsed.product_code).toLowerCase();
        if (codeKey) {
          if (seenCodes.has(codeKey)) {
            addBlockingError(
              "product_code",
              `Duplicate Product Code found in file: ${parsed.product_code}`
            );
          }
          seenCodes.set(codeKey, rowNumber);
        }

        if (rowErrors.length) return;

        const existing = byCode.get(codeKey);

        if (existing) {
          if (mode === "new") {
            addBlockingError(
              "product_code",
              `Duplicate Product Code exists in database: ${parsed.product_code}`
            );
            return;
          }

          foundCount += 1;

          if (parsed.id && String(parsed.id) !== String(existing.id)) {
            addBlockingError(
              "id",
              `Product ID does not match Product Code ${parsed.product_code}`
            );
            return;
          }

          const changes = {};
          EDITABLE_PRODUCT_FIELDS.forEach((field) => {
            const oldValue = existing[field];
            const newValue = parsed[field];

            if (NUMBER_FIELDS.has(field)) {
              if (Number(oldValue || 0) !== Number(newValue || 0)) {
                changes[field] = newValue;
              }
              return;
            }

            if (BOOLEAN_FIELDS.has(field)) {
              if (Boolean(oldValue) !== Boolean(newValue)) {
                changes[field] = newValue;
              }
              return;
            }

            if (normalizeCompare(oldValue) !== normalizeCompare(newValue)) {
              changes[field] = newValue;
            }
          });

          if (Object.keys(changes).length) {
            Object.entries(changes).forEach(([field, newValue]) => {
              changedFields.push({
                rowNumber,
                productCode: parsed.product_code,
                productName: parsed.product_name || existing.product_name || "",
                field,
                fieldLabel: PRODUCT_FIELD_LABELS[field] || field,
                oldValue: existing[field],
                newValue,
              });
            });

            updates.push({
              id: existing.id,
              rowNumber,
              productCode: parsed.product_code,
              productName: parsed.product_name || existing.product_name || "",
              oldStock: Number(existing.stock || 0),
              newStock: Number(parsed.stock || 0),
              changes,
            });
          } else {
            unchangedCount += 1;
          }

          return;
        }

        if (mode === "update") {
          addBlockingError(
            "product_code",
            `Product Code ${parsed.product_code} does not exist. Use Add New Product import instead.`
          );
          return;
        }

        creates.push({
          rowNumber,
          payload: {
            ...parsed,
            ...getImportLabelFields(importLabel),
          },
        });
      });

      setProductImportPreview({
        mode,
        rowsChecked: rows.length,
        foundCount,
        creates,
        updates,
        changedFields,
        unchangedCount,
        errors,
      });
    } catch (error) {
      alert("Import preview failed: " + error.message);
    }

    setImporting(false);
  };

  const confirmProductImport = async () => {
    if (!productImportPreview) return;

    const validActionCount =
      productImportPreview.mode === "update"
        ? productImportPreview.updates.length
        : productImportPreview.creates.length;

    if (validActionCount === 0) return;

    const ok = window.confirm(
      [
        `Rows checked: ${productImportPreview.rowsChecked}`,
        `Products found: ${productImportPreview.foundCount}`,
        `Products updated: ${productImportPreview.updates.length}`,
        `Products unchanged: ${productImportPreview.unchangedCount}`,
        `Blocking Errors: ${productImportPreview.errors.length}`,
        productImportPreview.mode === "update"
          ? "Apply these updates now?"
          : "Apply this import now?",
      ].join("\n")
    );

    if (!ok) return;

    setImporting(true);

    try {
      for (const item of productImportPreview.updates) {
        const { error } = await supabase
          .from("products")
          .update(item.changes)
          .eq("id", item.id);

        if (error) throw error;
      }

      if (productImportPreview.mode !== "update" && productImportPreview.creates.length) {
        const payload = productImportPreview.creates.map((item) => {
          const { id, ...productPayload } = item.payload;
          return productPayload;
        });

        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }

      const stockMovements = productImportPreview.updates
        .filter((item) => item.oldStock !== item.newStock)
        .map((item) => ({
          product_id: item.id,
          movement_type: "IMPORT",
          qty: item.newStock - item.oldStock,
          stock_before: item.oldStock,
          stock_after: item.newStock,
          note: "Excel Import",
        }));

      if (stockMovements.length) {
        const { error } = await supabase
          .from("stock_movements")
          .insert(stockMovements);

        if (error) throw error;
      }

      console.log("Product import applied", productImportPreview);
      const skippedRows = productImportPreview.errors.length;
      alert(
        productImportPreview.mode === "update"
          ? `${productImportPreview.updates.length} products updated successfully.\n${skippedRows} rows skipped due to errors.`
          : `${productImportPreview.creates.length} products created successfully.\n${skippedRows} rows skipped due to errors.`
      );
      setProductImportPreview(null);
      setSelectedImportFileName("");

      if (typeof fetchProducts === "function") {
        await fetchProducts();
      }
    } catch (error) {
      alert("Import failed: " + error.message);
    }

    setImporting(false);
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
      "Product ID": p.id,
      "Product Code": p.productCode,
      "Product Name": p.name,
      "Main Category": p.category,
      "Sub Category": p.subCategory,
      Brand: p.brand,
      Series: p.series,
      "Cash Price": p.cashPrice,
      "VAT Price": p.vatPrice,
      "Carton Size": p.cartonSize,
      Stock: p.stock,
      "Low Stock Alert": p.lowStockAlert,
      Status: p.active === false ? "Inactive" : "Active",
      "Available In Wales": p.availableInWales,
      "Available In England": p.availableInEngland,
      "Available From Supplier": p.availableFromSupplier,
      "Image URL": p.image,
      Recommended: p.recommended,
      "Top Seller": p.topSeller,
      "Wales Special Price": p.walesSpecialPrice,
      "England Special Price": p.englandSpecialPrice,
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

    XLSX.writeFile(
      workbook,
      `fairchoice-products-${new Date().toISOString().slice(0, 10)}.xlsx`
    );
  };

  const downloadProductTemplate = () => {
    const templateRow = PRODUCT_COLUMNS.reduce((row, [label]) => {
      row[label] = "";
      return row;
    }, {});

    const worksheet = XLSX.utils.json_to_sheet([templateRow]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
    XLSX.writeFile(workbook, "fairchoice-product-import-template.xlsx");
  };

  const downloadErrorReport = () => {
    if (!productImportPreview?.errors?.length) return;

    const reportRows = productImportPreview.errors.map((error) => ({
      "Product Code": error.productCode || "",
      "Product Name": error.productName || "",
      "Error Reason": error.message || "",
      Row: error.rowNumber || "",
      Field: error.field || "",
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(reportRows),
      "Blocking Errors"
    );
    XLSX.writeFile(workbook, "fairchoice-product-import-errors.xlsx");
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
            Download the current product list as an Excel file. Product Code is the protected update identity.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportExcel}
              className="bg-green-600 text-white px-5 py-3 rounded-xl font-bold"
            >
              Export to Excel
            </button>
            <button
              onClick={downloadProductTemplate}
              className="bg-slate-700 text-white px-5 py-3 rounded-xl font-bold"
            >
              Download Product Import Template
            </button>
          </div>
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

          <label className="mb-3 inline-block cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => handleImportExcel(event, "update")}
              disabled={importing}
              className="hidden"
            />

            <div className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-4 rounded-xl text-center min-w-[220px]">
              Update Products From File
            </div>
          </label>

          <label className="inline-block cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => handleImportExcel(event, "new")}
              disabled={importing}
              className="hidden"
            />

            <div className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-4 rounded-xl text-center min-w-[220px]">
              Add New Products From File
            </div>
          </label>

          <p className="text-sm text-slate-500 mt-4">
            File is checked first. Product Code cannot be changed. No database updates happen until confirm.
          </p>

          {importing && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-4">
              <p className="font-bold text-blue-700">Checking import...</p>
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

      {productImportPreview && (
        <div className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
          {(() => {
            const validActionCount =
              productImportPreview.mode === "update"
                ? productImportPreview.updates.length
                : productImportPreview.creates.length;

            return (
              <>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h3 className="text-xl font-bold">
                {productImportPreview.mode === "update" ? "Update Preview" : "Import Preview"}
              </h3>
              <p className="text-sm text-slate-500">{selectedImportFileName}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setProductImportPreview(null)}
                className="rounded-xl border px-4 py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmProductImport}
                disabled={validActionCount === 0 || importing}
                className="rounded-xl bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300"
              >
                {productImportPreview.mode === "update" ? "Confirm Update" : "Confirm Import"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">Rows checked</div>
              <div className="text-2xl font-bold">{productImportPreview.rowsChecked}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">Products found</div>
              <div className="text-2xl font-bold">{productImportPreview.foundCount}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">Updated</div>
              <div className="text-2xl font-bold">{productImportPreview.updates.length}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">Unchanged</div>
              <div className="text-2xl font-bold">{productImportPreview.unchangedCount}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs font-bold text-slate-500">Blocking Errors</div>
              <div className="text-2xl font-bold text-red-600">{productImportPreview.errors.length}</div>
            </div>
          </div>

          {productImportPreview.changedFields?.length > 0 && (
            <div className="mt-4 overflow-auto rounded-xl border">
              <div className="border-b bg-green-50 px-3 py-2 text-sm font-bold text-green-800">
                Valid Updates
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 text-left">Product Code</th>
                    <th className="p-2 text-left">Product Name</th>
                    <th className="p-2 text-left">Field Changed</th>
                    <th className="p-2 text-left">Old Value</th>
                    <th className="p-2 text-left">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {productImportPreview.changedFields.map((change, index) => (
                    <tr
                      key={`${change.productCode}-${change.field}-${index}`}
                      className="border-t"
                    >
                      <td className="p-2 font-bold">{change.productCode}</td>
                      <td className="p-2">{change.productName}</td>
                      <td className="p-2">{change.fieldLabel}</td>
                      <td className="p-2">{formatPreviewValue(change.oldValue)}</td>
                      <td className="p-2">{formatPreviewValue(change.newValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {productImportPreview.errors.length > 0 && (
            <div className="mt-4 overflow-auto rounded-xl border">
              <div className="flex items-center justify-between gap-3 border-b bg-red-50 px-3 py-2">
                <div className="text-sm font-bold text-red-700">
                  Blocking Errors
                </div>
                <button
                  type="button"
                  onClick={downloadErrorReport}
                  className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700"
                >
                  Download Error Report
                </button>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-red-50 text-red-700">
                  <tr>
                    <th className="p-2 text-left">Product Code</th>
                    <th className="p-2 text-left">Product Name</th>
                    <th className="p-2 text-left">Error Reason</th>
                    <th className="p-2 text-left">Row</th>
                    <th className="p-2 text-left">Field</th>
                  </tr>
                </thead>
                <tbody>
                  {productImportPreview.errors.map((error, index) => (
                    <tr key={`${error.rowNumber}-${error.field}-${index}`} className="border-t">
                      <td className="p-2">{error.productCode || "-"}</td>
                      <td className="p-2">{error.productName || "-"}</td>
                      <td className="p-2">{error.message}</td>
                      <td className="p-2">{error.rowNumber}</td>
                      <td className="p-2">{error.field}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
