import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../services/supabase.js";
import { formatCurrency } from "../../utils/currency";

export default function StockReceipts({ products = [], fetchProducts }) {
  const [suppliers, setSuppliers] = useState([]);
  const [receipts, setReceipts] = useState([]);

  const [activeTab, setActiveTab] = useState("import");
  const [importType, setImportType] = useState("main");

  const [previewRows, setPreviewRows] = useState([]);
  const [importErrors, setImportErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [fileMessage, setFileMessage] = useState("");

  const [localTotalAmount, setLocalTotalAmount] = useState("");

  const [productId, setProductId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [purchaseType, setPurchaseType] = useState("Supplier Invoice");
  const [paymentMethod, setPaymentMethod] = useState("Account");
  const [qtyReceived, setQtyReceived] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [vatApplicable, setVatApplicable] = useState(true);
  const [vatPercent, setVatPercent] = useState(20);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedProduct = useMemo(() => {
    return products.find((p) => String(p.id) === String(productId));
  }, [products, productId]);

  const totalCost = useMemo(() => {
    const qty = Number(qtyReceived || 0);
    const cost = Number(costPrice || 0);
    const vat = vatApplicable ? 1 + Number(vatPercent || 0) / 100 : 1;
    return qty * cost * vat;
  }, [qtyReceived, costPrice, vatApplicable, vatPercent]);

  const normalizeKey = (key) =>
    String(key || "")
      .trim()
      .toLowerCase()
      .replaceAll(" ", "_")
      .replaceAll("-", "_");

  const getValue = (row, keys) => {
    for (const key of keys) {
      const foundKey = Object.keys(row).find((k) => normalizeKey(k) === key);
      if (foundKey) return row[foundKey];
    }
    return "";
  };

  const findProductByCode = (code) => {
  const cleanCode = String(code || "").trim().toLowerCase();

  if (!cleanCode) return null;

  return products.find(
    (p) =>
      String(p.productCode || "").trim().toLowerCase() === cleanCode ||
      String(p.product_code || "").trim().toLowerCase() === cleanCode
  );
};

  const fetchSuppliers = async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("active", true)
      .order("supplier_name", { ascending: true });

    if (error) {
      console.error("Supplier loading error:", error);
      return;
    }

    setSuppliers(data || []);
  };

  const fetchReceipts = async () => {
    const { data, error } = await supabase
      .from("stock_receipts")
      .select(`
        *,
        products (
          product_name,
          product_code,
          brand,
          series
        )
      `)
      .order("received_date", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Receipt loading error:", error);
      return;
    }

    setReceipts(data || []);
  };

  useEffect(() => {
    fetchSuppliers();
    fetchReceipts();
  }, []);

  const handlePurchaseTypeChange = (value) => {
    setPurchaseType(value);

    if (value === "Supplier Invoice") {
      setVatApplicable(true);
      setVatPercent(20);
    }

    if (value === "Local Purchase" || value === "Stock Adjustment") {
      setVatApplicable(false);
      setVatPercent(0);
    }
  };

  const resetManualForm = () => {
    setProductId("");
    setSupplierName("");
    setInvoiceNumber("");
    setPurchaseType("Supplier Invoice");
    setPaymentMethod("Account");
    setQtyReceived("");
    setCostPrice("");
    setVatApplicable(true);
    setVatPercent(20);
    setNotes("");
  };

  const saveManualReceipt = async () => {
    if (!productId || !qtyReceived) {
      alert("Please select product and quantity.");
      return;
    }

    if (purchaseType !== "Stock Adjustment" && (!supplierName || !costPrice)) {
      alert("Please enter supplier and cost price.");
      return;
    }

    if (!selectedProduct) {
      alert("Selected product not found.");
      return;
    }

    const qty = Number(qtyReceived);
    const cost = purchaseType === "Stock Adjustment" ? 0 : Number(costPrice);
    const vat = purchaseType === "Supplier Invoice" ? Number(vatPercent || 0) : 0;

    if (qty <= 0) {
      alert("Quantity must be more than 0.");
      return;
    }

    if (purchaseType === "Supplier Invoice" && (!vatPercent || vat <= 0)) {
      alert("Check the VAT percentage/type.");
      return;
    }

    const stockBefore = Number(selectedProduct.stock || 0);
    const stockAfter = stockBefore + qty;

    const receiptTotal =
      purchaseType === "Stock Adjustment"
        ? 0
        : qty * cost * (vatApplicable ? 1 + vat / 100 : 1);

    setSaving(true);

    try {
      const { data: receipt, error: receiptError } = await supabase
        .from("stock_receipts")
        .insert({
          product_id: productId,
          supplier_name: supplierName.trim(),
          invoice_number: invoiceNumber.trim(),
          purchase_type: purchaseType,
          payment_method: purchaseType === "Stock Adjustment" ? null : paymentMethod,
          qty_received: qty,
          cost_price: cost,
          vat_applicable: purchaseType === "Supplier Invoice",
          vat_percent: vat,
          total_cost: receiptTotal,
          notes,
          source_type: "Manual",
          received_date: new Date().toISOString(),
        })
        .select()
        .single();

      if (receiptError) throw receiptError;

      const { error: productError } = await supabase
        .from("products")
        .update({ stock: stockAfter })
        .eq("id", productId);

      if (productError) throw productError;

      const { error: movementError } = await supabase.from("stock_movements").insert({
        product_id: productId,
        movement_type: "STOCK_IN",
        qty,
        stock_before: stockBefore,
        stock_after: stockAfter,
        note: `${purchaseType}${invoiceNumber ? ` / Invoice ${invoiceNumber}` : ""}`,
      });

      if (movementError) throw movementError;

      const { error: layerError } = await supabase.from("inventory_layers").insert({
        product_id: productId,
        stock_receipt_id: receipt.id,
        purchase_type: purchaseType,
        supplier_name: supplierName.trim(),
        invoice_number: invoiceNumber.trim(),
        qty_received: qty,
        qty_remaining: qty,
        cost_price: cost,
        vat_applicable: purchaseType === "Supplier Invoice",
        vat_percent: vat,
        total_cost: receiptTotal,
        received_date: new Date().toISOString(),
      });

      if (layerError) throw layerError;

      alert("Stock receipt saved.");
      resetManualForm();
      await fetchReceipts();
      await fetchProducts?.();
    } catch (error) {
      console.error("Manual stock receipt error:", error);
      alert("Stock receipt failed. Check Supabase columns and permissions.");
    }

    setSaving(false);
  };

  const handleExcelUpload = async (event) => {    
  const file = event.target.files?.[0];
  if (!file) return;

  setPreviewRows([]);
  setImportErrors([]);
  setFileMessage("");
  setLocalTotalAmount("");

  const fileName = file.name.toLowerCase();

  let detectedImportType = "";

  if (fileName.includes("main_purchase")) {
    detectedImportType = "main";
  }

  if (fileName.includes("local_purchase")) {
    detectedImportType = "local";
  }

  if (!detectedImportType) {
    alert("File name must be Main_Purchase.xlsx or Local_Purchase.xlsx");
    event.target.value = "";
    return;
  }

  setImportType(detectedImportType);

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  
  if (!rows.length) {
    alert("Excel file is empty.");
    return;
  }

  const mapped = rows.map((row, index) => {
    const productCode = getValue(row, ["product_code", "code", "productcode"]);
    const productName = getValue(row, ["product_name", "product", "name"]);
    const qty = Number(
      getValue(row, ["qty_received", "quantity", "qty", "stock_quantity"]) || 0
    );

    const cost = Number(
      getValue(row, ["cost_price", "cost", "unit_cost", "price"]) || 0
    );

    const supplier = getValue(row, ["supplier_name", "supplier"]);
    const invoice = getValue(row, ["invoice_number", "invoice", "reference"]);
    const payment = getValue(row, ["payment_method", "payment"]);

    const vatValue = getValue(row, ["vat_applicable", "vat", "vat_type"]);
    const vatPercentValue = getValue(row, [
      "vat_percent",
      "vat_percentage",
      "vat_%",
    ]);

    const matchedProduct = findProductByCode(productCode);

    return {
      rowNumber: index + 2,
      product_code: String(productCode || "").trim(),
      product_name: String(productName || "").trim(),
      qty_received: qty,
      cost_price: cost,
      supplier_name: String(supplier || "").trim(),
      invoice_number: String(invoice || "").trim(),
      purchase_type:
        detectedImportType === "local" ? "Local Purchase" : "Supplier Invoice",
      payment_method: String(payment || "").trim(),
      vat_applicable_raw: vatValue,
      vat_percent_raw: vatPercentValue,
      product_id: matchedProduct?.id || null,
      current_stock: Number(matchedProduct?.stock || 0),
      matched_name: matchedProduct?.name || "",
    };
  });

  const errors = [];

  mapped.forEach((row) => {
    if (!row.product_code) {
      errors.push(`Row ${row.rowNumber}: Product Code is missing.`);
    }

    if (!row.product_id) {
      errors.push(`Row ${row.rowNumber}: Product Code not found: ${row.product_code}`);
    }

    if (!row.qty_received || row.qty_received <= 0) {
      errors.push(`Row ${row.rowNumber}: Qty Received must be more than 0.`);
    }

    if (detectedImportType === "main") {
      if (!row.cost_price || row.cost_price <= 0) {
        errors.push(`Row ${row.rowNumber}: Cost Price is missing.`);
      }

      if (!row.vat_percent_raw || Number(row.vat_percent_raw) <= 0) {
        errors.push(`Row ${row.rowNumber}: Check the VAT percentage/type.`);
      }
    }
  });

  setPreviewRows(mapped);
  setImportErrors(errors);

  if (detectedImportType === "local") {
    setFileMessage(
      "File uploaded successfully. Please enter total purchase amount before continuing."
    );
  } else {
    setFileMessage(
      "Main Purchase file uploaded successfully. Please check preview before importing."
    );
  }
};

  const importExcelRows = async () => {
    if (!previewRows.length) {
      alert("Please upload Excel file first.");
      return;
    }

    if (importErrors.length > 0) {
      alert("Please fix import errors before continuing.");
      return;
    }

    if (importType === "local") {
      const amount = Number(localTotalAmount || 0);

      if (!amount) {
        alert("Please enter total purchase amount before continuing.");
        return;
      }

      if (amount <= 0) {
        alert("Total purchase amount must be greater than zero.");
        return;
      }
    }

    setImporting(true);

    const importBatchId = crypto.randomUUID();
    const stockMap = new Map();

    products.forEach((p) => {
      stockMap.set(String(p.id), Number(p.stock || 0));
    });

    try {
      const totalLocalQty = previewRows.reduce(
        (sum, row) => sum + Number(row.qty_received || 0),
        0
      );

      const localCostPerUnit =
        importType === "local"
          ? Number(localTotalAmount || 0) / Number(totalLocalQty || 1)
          : 0;

      for (const row of previewRows) {
        const qty = Number(row.qty_received || 0);

        const purchaseTypeValue =
          importType === "local" ? "Local Purchase" : "Supplier Invoice";

        const cost =
          importType === "local" ? Number(localCostPerUnit.toFixed(4)) : Number(row.cost_price);

        const vatApplicableValue = importType === "main";
        const vatPercentValue =
          importType === "main" ? Number(row.vat_percent_raw || 0) : 0;

        const lineTotal =
          importType === "local"
            ? Number((qty * cost).toFixed(2))
            : Number((qty * cost * (1 + vatPercentValue / 100)).toFixed(2));

        const stockBefore = Number(stockMap.get(String(row.product_id)) || 0);
        const stockAfter = stockBefore + qty;
        stockMap.set(String(row.product_id), stockAfter);

        const { data: receipt, error: receiptError } = await supabase
          .from("stock_receipts")
          .insert({
            product_id: row.product_id,
            supplier_name:
              importType === "local"
                ? "Local Purchase"
                : row.supplier_name || supplierName || "",
            invoice_number:
              importType === "local"
                ? row.invoice_number || invoiceNumber || ""
                : row.invoice_number || "",
            purchase_type: purchaseTypeValue,
            payment_method:
              importType === "local"
                ? paymentMethod || "Cash"
                : row.payment_method || "Account",
            qty_received: qty,
            cost_price: cost,
            vat_applicable: vatApplicableValue,
            vat_percent: vatPercentValue,
            total_cost: lineTotal,
            notes:
              importType === "local"
                ? `Local purchase total amount: ${formatCurrency(localTotalAmount)}`
                : row.notes || "",
            source_type: importType === "local" ? "Local Excel Import" : "Main Supplier Excel Import",
            import_batch_id: importBatchId,
            received_date: new Date().toISOString(),
          })
          .select()
          .single();

        if (receiptError) throw receiptError;

        const { error: productError } = await supabase
          .from("products")
          .update({ stock: stockAfter })
          .eq("id", row.product_id);

        if (productError) throw productError;

        const { error: movementError } = await supabase.from("stock_movements").insert({
          product_id: row.product_id,
          movement_type: "STOCK_IN",
          qty,
          stock_before: stockBefore,
          stock_after: stockAfter,
          note: `${purchaseTypeValue} import / Batch ${importBatchId}`,
        });

        if (movementError) throw movementError;

        const { error: layerError } = await supabase.from("inventory_layers").insert({
          product_id: row.product_id,
          stock_receipt_id: receipt.id,
          purchase_type: purchaseTypeValue,
          supplier_name:
            importType === "local"
              ? "Local Purchase"
              : row.supplier_name || supplierName || "",
          invoice_number: row.invoice_number || invoiceNumber || "",
          qty_received: qty,
          qty_remaining: qty,
          cost_price: cost,
          vat_applicable: vatApplicableValue,
          vat_percent: vatPercentValue,
          total_cost: lineTotal,
          received_date: new Date().toISOString(),
        });

        if (layerError) throw layerError;
      }

      alert("Stock import completed successfully.");

      setPreviewRows([]);
      setImportErrors([]);
      setFileMessage("");
      setLocalTotalAmount("");

      await fetchReceipts();
      await fetchProducts?.();
    } catch (error) {
      console.error("Excel import error:", error);
      alert("Import failed. Check Supabase columns, permissions, and Excel file.");
    }

    setImporting(false);
  };
  
  return (
  <div className="p-4 bg-slate-50 min-h-screen">
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="bg-white rounded-2xl shadow p-4">
        <h2 className="text-2xl font-bold">Stock Receipts / Stock In</h2>
        <p className="text-slate-500 text-sm">
          Import supplier invoices, local purchases, update stock, and create FIFO cost layers.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow p-2 flex gap-2">
        <button
          onClick={() => setActiveTab("import")}
          className={`px-4 py-3 rounded-xl font-bold ${
            activeTab === "import" ? "bg-blue-700 text-white" : "bg-slate-100"
          }`}
        >
          Excel Import
        </button>

        <button
          onClick={() => setActiveTab("manual")}
          className={`px-4 py-3 rounded-xl font-bold ${
            activeTab === "manual" ? "bg-blue-700 text-white" : "bg-slate-100"
          }`}
        >
          Manual Entry
        </button>
      </div>

      {activeTab === "import" && (
        <div className="bg-white rounded-2xl shadow p-4 space-y-4">
          <div>
            <h3 className="text-xl font-bold">Upload Purchase File</h3>
            <p className="text-sm text-slate-500 mt-1">
              Upload Main_Purchase.xlsx or Local_Purchase.xlsx.
            </p>
          </div>

          <label className="block w-full bg-blue-700 text-white text-center rounded-xl py-4 font-bold text-lg cursor-pointer">
            Upload Purchase File
           <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onClick={(e) => {
                e.target.value = "";
              }}
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>

          {fileMessage && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 font-semibold">
              {fileMessage}
            </div>
          )}

          {importType === "local" && previewRows.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-4">
              <label className="font-bold text-sm">
                Total Purchase Amount *
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={localTotalAmount}
                onChange={(e) => setLocalTotalAmount(e.target.value)}
                placeholder="Enter total purchase amount"
                className="border rounded-xl p-3 w-full mt-2"
              />

              {!Number(localTotalAmount || 0) && (
                <div className="text-red-600 font-bold text-sm mt-2">
                  Please enter total purchase amount before continuing.
                </div>
              )}
            </div>
          )}

          {importErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4">
              <h3 className="font-bold text-red-700 mb-2">Import Errors</h3>

              <div className="space-y-1 text-sm text-red-700">
                {importErrors.map((error, index) => (
                  <div key={index}>{error}</div>
                ))}
              </div>
            </div>
          )}

          {previewRows.length > 0 && (
            <div className="border rounded-2xl p-4 overflow-x-auto">
              <h3 className="font-bold text-xl mb-3">Excel Preview</h3>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border p-2 text-left">Row</th>
                    <th className="border p-2 text-left">Code</th>
                    <th className="border p-2 text-left">Product</th>
                    <th className="border p-2 text-right">Qty</th>
                    <th className="border p-2 text-right">Cost</th>
                    <th className="border p-2 text-right">VAT %</th>
                    <th className="border p-2 text-left">Matched</th>
                  </tr>
                </thead>

                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td className="border p-2">{row.rowNumber}</td>
                      <td className="border p-2">{row.product_code}</td>
                      <td className="border p-2">{row.product_name}</td>
                      <td className="border p-2 text-right">{row.qty_received}</td>

                      <td className="border p-2 text-right">
                        {importType === "local"
                          ? "-"
                          : formatCurrency(row.cost_price)}
                      </td>

                      <td className="border p-2 text-right">
                        {importType === "local" ? "0" : row.vat_percent_raw}
                      </td>

                      <td className="border p-2">
                        {row.product_id ? (
                          <span className="text-green-700 font-bold">
                            {row.matched_name}
                          </span>
                        ) : (
                          <span className="text-red-700 font-bold">
                            Not Found
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                onClick={importExcelRows}
                disabled={
                  importing ||
                  importErrors.length > 0 ||
                  (importType === "local" && Number(localTotalAmount || 0) <= 0)
                }
                className="mt-4 w-full bg-blue-700 text-white rounded-xl py-4 font-bold text-lg disabled:bg-slate-400"
              >
                {importing ? "Importing..." : "Import Stock"}
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "manual" && (
        <div className="bg-white rounded-2xl shadow p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="font-bold text-sm">Purchase Type</label>
            <select
              className="border rounded-xl p-3 w-full mt-1"
              value={purchaseType}
              onChange={(e) => handlePurchaseTypeChange(e.target.value)}
            >
              <option>Supplier Invoice</option>
              <option>Local Purchase</option>
              <option>Stock Adjustment</option>
            </select>
          </div>

          <div>
            <label className="font-bold text-sm">Product</label>
            <select
              className="border rounded-xl p-3 w-full mt-1"
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
            >
              <option value="">Select product</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.productCode ? `${product.productCode} - ` : ""}
                  {product.name} / Stock: {product.stock || 0}
                </option>
              ))}
            </select>
          </div>

          {purchaseType !== "Stock Adjustment" && (
            <>
              <div>
                <label className="font-bold text-sm">Supplier</label>
                <select
                  className="border rounded-xl p-3 w-full mt-1"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                >
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.supplier_name}>
                      {supplier.supplier_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-bold text-sm">Invoice / Reference</label>
                <input
                  className="border rounded-xl p-3 w-full mt-1"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Invoice number"
                />
              </div>

              <div>
                <label className="font-bold text-sm">Payment Method</label>
                <select
                  className="border rounded-xl p-3 w-full mt-1"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option>Cash</option>
                  <option>Bank Transfer</option>
                  <option>Account</option>
                  <option>Card</option>
                </select>
              </div>

              <div>
                <label className="font-bold text-sm">Cost Price Per Unit</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="border rounded-xl p-3 w-full mt-1"
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </>
          )}

          <div>
            <label className="font-bold text-sm">Qty Received</label>
            <input
              type="number"
              min="1"
              className="border rounded-xl p-3 w-full mt-1"
              value={qtyReceived}
              onChange={(e) => setQtyReceived(e.target.value)}
              placeholder="0"
            />
          </div>

          {purchaseType === "Supplier Invoice" && (
            <div>
              <label className="font-bold text-sm">VAT %</label>
              <input
                type="number"
                className="border rounded-xl p-3 w-full mt-1"
                value={vatPercent}
                onChange={(e) => setVatPercent(e.target.value)}
              />
            </div>
          )}

          <div className="md:col-span-2">
            <label className="font-bold text-sm">Notes</label>
            <textarea
              className="border rounded-xl p-3 w-full mt-1"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
            />
          </div>

          <div className="md:col-span-2 bg-slate-100 rounded-2xl p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-slate-500">Current Stock</div>
                <div className="text-xl font-bold">
                  {selectedProduct ? selectedProduct.stock || 0 : "-"}
                </div>
              </div>

              <div>
                <div className="text-slate-500">New Stock</div>
                <div className="text-xl font-bold">
                  {selectedProduct
                    ? Number(selectedProduct.stock || 0) + Number(qtyReceived || 0)
                    : "-"}
                </div>
              </div>

              <div>
                <div className="text-slate-500">Total Cost</div>
                <div className="text-xl font-bold">{formatCurrency(totalCost)}</div>
              </div>
            </div>
          </div>

          <button
            onClick={saveManualReceipt}
            disabled={saving}
            className="md:col-span-2 bg-blue-700 text-white rounded-xl py-4 font-bold text-lg disabled:bg-slate-400"
          >
            {saving ? "Saving..." : "Receive Stock"}
          </button>
        </div>
      )}
    </div>
  </div>
);
  
}
