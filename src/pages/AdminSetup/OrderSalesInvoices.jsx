import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase";
import { fetchInvoiceOrderFromDb } from "../../services/centralInvoiceEngine";
import { formatCurrency } from "../../utils/currency";

const VAT_RATE = 0.2;
const VAT_DIVISOR = 1 + VAT_RATE;

const getLoggedInUser = () =>
  JSON.parse(
    localStorage.getItem("loggedInUser") ||
      localStorage.getItem("fairchoice_user") ||
      "null"
  );

const isAdminUser = (user) => {
  const role = String(user?.role || user?.access_level || "").toLowerCase();
  return role.includes("admin");
};

const isNisstajAdmin = (user) =>
  String(user?.username || "").trim().toLowerCase() === "nisstaj_admin";

const normalizePriceMode = (priceMode) =>
  String(priceMode || "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");

const isServerManagerQueueRow = (row = {}) => {
  const mode = normalizePriceMode(row.price_mode || row.transaction_snapshot?.price_mode);
  return mode === "server" || mode === "manager";
};

const getLineItems = (row = {}) => {
  const freshOrder = row._freshOrder || row.__order || {};
  const snapshot = row.transaction_snapshot || {};
  if (Array.isArray(freshOrder.order_items)) return freshOrder.order_items;
  if (Array.isArray(freshOrder.items)) return freshOrder.items;
  if (Array.isArray(row.line_items)) return row.line_items;
  if (Array.isArray(snapshot.order_items)) return snapshot.order_items;
  if (Array.isArray(snapshot.items)) return snapshot.items;
  return [];
};

const getProductCode = (line = {}) =>
  line.product_code ||
  line.productCode ||
  line.sku ||
  line.code ||
  line.products?.product_code ||
  line.products?.code ||
  line.products?.sku ||
  line.product?.product_code ||
  line.product?.code ||
  line.product?.sku ||
  "";

const enrichQueueRowsWithProductCodes = async (rows = []) => {
  const lines = rows.flatMap(getLineItems);
  const missingProductIds = [
    ...new Set(
      lines
        .filter((line) => !getProductCode(line))
        .map((line) => line.product_id || line.productId || line.id)
        .filter(Boolean)
        .map(String)
    ),
  ];

  const missingNames = [
    ...new Set(
      lines
        .filter((line) => !getProductCode(line))
        .map((line) => String(getDescription(line)).trim())
        .filter(Boolean)
    ),
  ];

  if (!missingProductIds.length && !missingNames.length) return rows;

  let productsById = {};
  let productsByName = {};

  if (missingProductIds.length) {
    const { data } = await supabase
      .from("products")
      .select("id, product_name, product_code, code, sku")
      .in("id", missingProductIds);

    productsById = Object.fromEntries(
      (data || []).map((product) => [String(product.id), product])
    );
  }

  if (missingNames.length) {
    const { data } = await supabase
      .from("products")
      .select("id, product_name, product_code, code, sku")
      .in("product_name", missingNames);

    const groupedByName = (data || []).reduce((groups, product) => {
      const key = String(product.product_name || "").trim().toLowerCase();
      if (!key) return groups;
      groups[key] = [...(groups[key] || []), product];
      return groups;
    }, {});

    productsByName = Object.fromEntries(
      Object.entries(groupedByName)
        .filter(([, matches]) => matches.length === 1)
        .map(([name, matches]) => [name, matches[0]])
    );
  }

  const enrichLine = (line) => {
    if (getProductCode(line)) return line;

    const product =
      productsById[String(line.product_id || line.productId || line.id)] ||
      productsByName[String(getDescription(line)).trim().toLowerCase()] ||
      null;
    const productCode = getProductCode({ product, products: product });

    return {
      ...line,
      product_code: productCode || line.product_code || "",
      productCode: productCode || line.productCode || "",
      product: line.product || product,
      products: line.products || product,
    };
  };

  return rows.map((row) => ({
    ...row,
    line_items: Array.isArray(row.line_items)
      ? row.line_items.map(enrichLine)
      : row.line_items,
    transaction_snapshot: row.transaction_snapshot
      ? {
          ...row.transaction_snapshot,
          order_items: Array.isArray(row.transaction_snapshot.order_items)
            ? row.transaction_snapshot.order_items.map(enrichLine)
            : row.transaction_snapshot.order_items,
          items: Array.isArray(row.transaction_snapshot.items)
            ? row.transaction_snapshot.items.map(enrichLine)
            : row.transaction_snapshot.items,
        }
      : row.transaction_snapshot,
  }));
};

const getDescription = (line = {}) =>
  line.product_name || line.productName || line.name || line.description || "";

const getQty = (line = {}) =>
  Number(line.qty ?? line.quantity ?? line.picked_qty ?? line.pickedQty ?? 0);

const getGrossLineTotal = (line = {}) => {
  const directTotal =
    line.gross_total ??
    line.grossTotal ??
    line.line_total ??
    line.lineTotal ??
    line.total ??
    line.amount;

  if (directTotal !== null && directTotal !== undefined && directTotal !== "") {
    return Number(directTotal || 0);
  }

  return getQty(line) * Number(line.price ?? line.unit_price ?? line.selectedPrice ?? 0);
};

const getQueueGrossTotal = (row = {}, lines = []) => {
  if ((row._freshOrder || row.__order) && lines.length) {
    return lines.reduce((sum, line) => sum + getGrossLineTotal(line), 0);
  }

  const gross =
    row._freshOrder?.final_total ??
    row._freshOrder?.order_total ??
    row._freshOrder?.total_amount ??
    row._freshOrder?.total ??
    row.__order?.final_total ??
    row.__order?.order_total ??
    row.__order?.total_amount ??
    row.__order?.total ??
    row.grand_total ??
    row.transaction_snapshot?.order_total ??
    row.transaction_snapshot?.final_total ??
    row.transaction_snapshot?.total_amount ??
    row.transaction_snapshot?.total;

  if (gross !== null && gross !== undefined && gross !== "") return Number(gross || 0);
  return lines.reduce((sum, line) => sum + getGrossLineTotal(line), 0);
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function buildVatInvoice(row = {}) {
  const lines = getLineItems(row).map((line) => {
    const qty = getQty(line);
    const gross = roundMoney(getGrossLineTotal(line));
    const net = roundMoney(gross / VAT_DIVISOR);
    const vat = roundMoney(gross - net);

    return {
      ...line,
      productCode: getProductCode(line),
      description: getDescription(line),
      qty,
      unitGross: qty > 0 ? roundMoney(gross / qty) : 0,
      gross,
      net,
      vat,
    };
  });

  const grossTotal = roundMoney(getQueueGrossTotal(row, lines));
  const netTotal = roundMoney(grossTotal / VAT_DIVISOR);
  const vatTotal = roundMoney(grossTotal - netTotal);

  return {
    rawRow: row,
    id: row.id,
    orderId: row.order_id || row._freshOrder?.id,
    orderNumber:
      row._freshOrder?.order_number ||
      row._freshOrder?.orderId ||
      row.order_number ||
      row.transaction_snapshot?.order_number ||
      "-",
    customerName:
      row._freshOrder?.company_name ||
      row._freshOrder?.companyName ||
      row.customer_name ||
      row.transaction_snapshot?.company_name ||
      "-",
    branchName:
      row._freshOrder?.delivery_branch_name ||
      row._freshOrder?.branch_name ||
      row._freshOrder?.branchName ||
      row.branch_name ||
      row.transaction_snapshot?.delivery_branch_name ||
      row.transaction_snapshot?.branch_name ||
      "",
    priceMode:
      row._freshOrder?.price_mode ||
      row._freshOrder?.priceMode ||
      row.price_mode ||
      row.transaction_snapshot?.price_mode ||
      "",
    confirmedAt:
      row._freshOrder?.delivered_at ||
      row._freshOrder?.updated_at ||
      row.confirmed_at ||
      row.transaction_snapshot?.delivered_at ||
      row.transaction_snapshot?.updated_at ||
      row.queued_at,
    queuedAt: row.queued_at,
    queueStatus: row.queue_status,
    lines,
    totalQty: lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    totalLines: lines.filter((line) => Number(line.qty || 0) > 0).length,
    netTotal,
    vatTotal,
    grossTotal,
  };
}

function printVatInvoice(invoice) {
  const rows = invoice.lines
    .map(
      (line) => `
        <tr>
          <td class="code">${escapeHtml(line.productCode)}</td>
          <td>${escapeHtml(line.description)}</td>
          <td class="right">${line.qty}</td>
          <td class="right">${formatCurrency(line.unitGross)}</td>
          <td class="right">20%</td>
          <td class="right">${formatCurrency(line.net)}</td>
          <td class="right">${formatCurrency(line.vat)}</td>
          <td class="right">${formatCurrency(line.gross)}</td>
        </tr>
      `
    )
    .join("");

  const html = `
    <html>
      <head>
        <title>Sales Invoice ${escapeHtml(invoice.orderNumber)}</title>
        <style>
          @page { size: A4; margin: 14mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; }
          .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 12px; }
          h1 { margin: 0; font-size: 24px; letter-spacing: 0; }
          h2 { margin: 0 0 8px; font-size: 18px; }
          .muted { color: #4b5563; font-size: 12px; line-height: 1.45; }
          .title { text-align: right; }
          .panel-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 16px 0; }
          .panel { border: 1px solid #f3c27a; }
          .panel-title { background: #fde7c2; padding: 7px 9px; font-weight: 700; }
          .panel-body { padding: 9px; font-size: 13px; line-height: 1.55; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { background: #dbeafe; color: #111; text-align: left; }
          th, td { border: 1px solid #d1d5db; padding: 6px; vertical-align: top; }
          .right { text-align: right; }
          .code { white-space: nowrap; max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
          .summary { display: grid; grid-template-columns: 1fr 280px; gap: 18px; margin-top: 18px; align-items: start; }
          .small-boxes { display: flex; gap: 10px; }
          .small-box { border: 1px solid #d1d5db; padding: 8px 10px; min-width: 130px; }
          .totals { border: 1px solid #f3c27a; }
          .totals div { display: flex; justify-content: space-between; padding: 8px 10px; border-bottom: 1px solid #e5e7eb; }
          .totals div:last-child { border-bottom: 0; background: #dbeafe; font-weight: 800; }
          .footer { border-top: 1px solid #111; margin-top: 26px; padding-top: 8px; font-size: 11px; color: #374151; display: flex; justify-content: space-between; gap: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h2>Fair Choice Cash and Carry</h2>
            <div class="muted">
              Unit 1, Fair Choice Cash and Carry<br />
              Newport, United Kingdom<br />
              VAT Registration No. GB 489728125
            </div>
          </div>
          <div class="title">
            <h1>SALES INVOICE</h1>
            <div class="muted">Server/Manager VAT View</div>
          </div>
        </div>

        <div class="panel-row">
          <div class="panel">
            <div class="panel-title">Customer</div>
            <div class="panel-body">
              <strong>${escapeHtml(invoice.customerName)}</strong><br />
              ${escapeHtml(invoice.branchName || "-")}
            </div>
          </div>
          <div class="panel">
            <div class="panel-title">Invoice Details</div>
            <div class="panel-body">
              <strong>Invoice No:</strong> ${escapeHtml(invoice.orderNumber)}<br />
              <strong>Date:</strong> ${escapeHtml(formatDate(invoice.confirmedAt))}<br />
              <strong>Price Mode:</strong> ${escapeHtml(String(invoice.priceMode).toUpperCase())}
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Description</th>
              <th class="right">Qty</th>
              <th class="right">Unit Gross</th>
              <th class="right">VAT %</th>
              <th class="right">Net</th>
              <th class="right">VAT</th>
              <th class="right">Gross</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8">No line items found.</td></tr>'}</tbody>
        </table>

        <div class="summary">
          <div class="small-boxes">
            <div class="small-box"><strong>Total Quantity</strong><br />${invoice.totalQty}</div>
            <div class="small-box"><strong>Total Lines</strong><br />${invoice.totalLines}</div>
          </div>
          <div class="totals">
            <div><span>Net Total</span><strong>${formatCurrency(invoice.netTotal)}</strong></div>
            <div><span>VAT Total</span><strong>${formatCurrency(invoice.vatTotal)}</strong></div>
            <div><span>Grand Total</span><strong>${formatCurrency(invoice.grossTotal)}</strong></div>
          </div>
        </div>

        <div class="footer">
          <span>Thank you for your business.</span>
          <span>Registered in England and Wales No. 16350457</span>
          <span>Page 1</span>
        </div>
        <script>window.print();</script>
      </body>
    </html>
  `;

  const win = window.open("", "_blank", "width=980,height=760");
  if (!win) {
    alert("Popup blocked. Please allow popups to print this invoice.");
    return;
  }

  win.document.write(html);
  win.document.close();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-GB");
}

function getProcessingQueueLoadErrorMessage(error = {}) {
  const message = String(error.message || error.details || "");
  if (
    message.toLowerCase().includes("processing_queue") &&
    message.toLowerCase().includes("schema cache")
  ) {
    return (
      "ProcessingQueue table is not available in Supabase schema cache. " +
      "Run supabase/migrations/20260705_processing_queue_vat.sql in Supabase, then reload the PostgREST/schema cache."
    );
  }

  return error.message || "Could not load sales invoices.";
}

async function refreshQueueRowsFromOrders(rows = []) {
  const refreshedRows = await Promise.all(
    rows.map(async (row) => {
      const reference =
        row.order_number ||
        row.transaction_snapshot?.order_number ||
        row.transaction_snapshot?.orderId;

      if (!reference) return row;

      try {
        const freshOrder = await fetchInvoiceOrderFromDb(reference);
        return freshOrder ? { ...row, _freshOrder: freshOrder } : row;
      } catch (error) {
        console.warn("Could not refresh sales invoice order:", reference, error);
        return row;
      }
    })
  );

  return refreshedRows;
}

function getDraftTotals(draft = {}) {
  const lines = draft.lines || [];
  const grossTotal = roundMoney(
    lines.reduce((sum, line) => sum + Number(line.gross || 0), 0)
  );
  const netTotal = roundMoney(grossTotal / VAT_DIVISOR);
  const vatTotal = roundMoney(grossTotal - netTotal);

  return {
    totalQty: lines.reduce((sum, line) => sum + Number(line.qty || 0), 0),
    totalLines: lines.filter((line) => Number(line.qty || 0) > 0).length,
    grossTotal,
    netTotal,
    vatTotal,
  };
}

function getEditDraft(invoice = {}) {
  return {
    customerName: invoice.customerName || "",
    branchName: invoice.branchName || "",
    lines: (invoice.lines || []).map((line) => ({
      original: line,
      productCode: line.productCode || "",
      description: line.description || "",
      qty: Number(line.qty || 0),
      gross: Number(line.gross || 0),
    })),
  };
}

function buildSavedLine(line = {}) {
  const original = line.original || {};
  const qty = Number(line.qty || 0);
  const gross = roundMoney(line.gross);
  const unitGross = qty > 0 ? roundMoney(gross / qty) : 0;

  return {
    ...original,
    product_code: line.productCode || "",
    productCode: line.productCode || "",
    product_name: line.description || "",
    productName: line.description || "",
    name: line.description || "",
    qty,
    quantity: qty,
    picked_qty: qty,
    pickedQty: qty,
    price: unitGross,
    unit_price: unitGross,
    selectedPrice: unitGross,
    line_total: gross,
    lineTotal: gross,
    gross_total: gross,
    grossTotal: gross,
  };
}

export default function OrderSalesInvoices() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState(null);
  const [savingId, setSavingId] = useState("");
  const user = getLoggedInUser();
  const canView = isAdminUser(user);
  const canEdit = isNisstajAdmin(user);

  const loadRows = async () => {
    if (!canView) return;

    setLoading(true);
    setError("");

    const { data, error: loadError } = await supabase
      .from("processing_queue")
      .select("*")
      .order("confirmed_at", { ascending: false, nullsFirst: false })
      .order("queued_at", { ascending: false });

      if (loadError) {
        setError(getProcessingQueueLoadErrorMessage(loadError));
        setRows([]);
      } else {
      const freshRows = await refreshQueueRowsFromOrders(
        (data || []).filter(isServerManagerQueueRow)
      );
      const enrichedRows = await enrichQueueRowsWithProductCodes(freshRows);
      setRows(enrichedRows.map(buildVatInvoice));
    }

    setLoading(false);
  };

  useEffect(() => {
    loadRows();
  }, [canView]);

  const startEdit = (row) => {
    if (!canEdit) return;
    setEditingId(row.id);
    setEditDraft(getEditDraft(row));
  };

  const cancelEdit = () => {
    setEditingId("");
    setEditDraft(null);
  };

  const updateDraftField = (field, value) => {
    setEditDraft((current) => ({ ...current, [field]: value }));
  };

  const updateDraftLine = (index, field, value) => {
    setEditDraft((current) => ({
      ...current,
      lines: (current?.lines || []).map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line
      ),
    }));
  };

  const saveEdit = async (row) => {
    if (!canEdit || !editDraft || savingId) return;

    const totals = getDraftTotals(editDraft);
    const savedLines = (editDraft.lines || []).map(buildSavedLine);
    const payload = {
      customer_name: editDraft.customerName || null,
      branch_name: editDraft.branchName || null,
      line_items: savedLines,
      subtotal: totals.netTotal,
      net_total: totals.netTotal,
      vat_total: totals.vatTotal,
      grand_total: totals.grossTotal,
      total_quantity: totals.totalQty,
      total_lines: totals.totalLines,
      updated_at: new Date().toISOString(),
    };

    setSavingId(row.id);
    setError("");

    const { error: saveError } = await supabase
      .from("processing_queue")
      .update(payload)
      .eq("id", row.id);

    setSavingId("");

    if (saveError) {
      setError(saveError.message || "Could not save invoice edits.");
      return;
    }

    cancelEdit();
    await loadRows();
  };

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter((row) =>
      [
        row.orderNumber,
        row.customerName,
        row.branchName,
        row.priceMode,
        row.queueStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [rows, search]);

  if (!canView) {
    return (
      <div className="p-5">
        <div className="bg-white border rounded-lg p-5 text-slate-700">
          Admin access is required to view Server/Manager sales invoices.
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Invoices</h1>
          <p className="text-sm text-slate-500">
            Server and Manager price mode VAT view from ProcessingQueue.
          </p>
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search invoice, customer, branch..."
          className="border rounded-lg px-3 py-2 w-full md:w-80"
        />
      </div>

      {error && <div className="bg-red-50 text-red-700 border border-red-200 p-3 rounded-lg">{error}</div>}

      <div className="bg-white border rounded-lg overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>
              <th className="text-left p-3">Invoice / Order</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Branch</th>
              <th className="text-left p-3">Price Mode</th>
              <th className="text-left p-3">Date</th>
              <th className="text-right p-3">Net</th>
              <th className="text-right p-3">VAT</th>
              <th className="text-right p-3">Grand Total</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-5 text-center text-slate-500">
                  Loading invoices...
                </td>
              </tr>
            ) : filteredRows.length ? (
              filteredRows.map((row) => {
                const isEditing = editingId === row.id && editDraft;
                const draftTotals = isEditing ? getDraftTotals(editDraft) : null;

                return (
                  <Fragment key={row.id}>
                    <tr key={row.id} className="border-b last:border-b-0">
                      <td className="p-3 font-semibold">{row.orderNumber}</td>
                      <td className="p-3">{row.customerName}</td>
                      <td className="p-3">{row.branchName || "-"}</td>
                      <td className="p-3">{String(row.priceMode || "").toUpperCase()}</td>
                      <td className="p-3">{formatDate(row.confirmedAt || row.queuedAt)}</td>
                      <td className="p-3 text-right">{formatCurrency(row.netTotal)}</td>
                      <td className="p-3 text-right">{formatCurrency(row.vatTotal)}</td>
                      <td className="p-3 text-right font-bold">{formatCurrency(row.grossTotal)}</td>
                      <td className="p-3 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => printVatInvoice(row)}
                            className="bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-bold"
                          >
                            Print
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-bold"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isEditing && (
                      <tr key={`${row.id}-editor`} className="bg-slate-50 border-b">
                        <td colSpan={9} className="p-4">
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <label className="text-sm font-bold">
                                Customer
                                <input
                                  value={editDraft.customerName}
                                  onChange={(event) =>
                                    updateDraftField("customerName", event.target.value)
                                  }
                                  className="mt-1 w-full border rounded-lg px-3 py-2 font-normal"
                                />
                              </label>
                              <label className="text-sm font-bold">
                                Branch
                                <input
                                  value={editDraft.branchName}
                                  onChange={(event) =>
                                    updateDraftField("branchName", event.target.value)
                                  }
                                  className="mt-1 w-full border rounded-lg px-3 py-2 font-normal"
                                />
                              </label>
                            </div>

                            <div className="overflow-auto border rounded-lg bg-white">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-100">
                                  <tr>
                                    <th className="text-left p-2">Product Code</th>
                                    <th className="text-left p-2">Description</th>
                                    <th className="text-right p-2">Qty</th>
                                    <th className="text-right p-2">Gross</th>
                                    <th className="text-right p-2">Net</th>
                                    <th className="text-right p-2">VAT</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(editDraft.lines || []).map((line, index) => {
                                    const gross = roundMoney(line.gross);
                                    const net = roundMoney(gross / VAT_DIVISOR);
                                    const vat = roundMoney(gross - net);

                                    return (
                                      <tr key={`${row.id}-line-${index}`} className="border-t">
                                        <td className="p-2">
                                          <input
                                            value={line.productCode}
                                            onChange={(event) =>
                                              updateDraftLine(index, "productCode", event.target.value)
                                            }
                                            className="w-full border rounded px-2 py-1"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <input
                                            value={line.description}
                                            onChange={(event) =>
                                              updateDraftLine(index, "description", event.target.value)
                                            }
                                            className="w-full border rounded px-2 py-1"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <input
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={line.qty}
                                            onChange={(event) =>
                                              updateDraftLine(index, "qty", Number(event.target.value || 0))
                                            }
                                            className="w-24 border rounded px-2 py-1 text-right"
                                          />
                                        </td>
                                        <td className="p-2">
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={line.gross}
                                            onChange={(event) =>
                                              updateDraftLine(index, "gross", Number(event.target.value || 0))
                                            }
                                            className="w-28 border rounded px-2 py-1 text-right"
                                          />
                                        </td>
                                        <td className="p-2 text-right">{formatCurrency(net)}</td>
                                        <td className="p-2 text-right">{formatCurrency(vat)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>

                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="text-sm text-slate-700">
                                Total Qty: <strong>{draftTotals.totalQty}</strong> | Total Lines:{" "}
                                <strong>{draftTotals.totalLines}</strong> | Net:{" "}
                                <strong>{formatCurrency(draftTotals.netTotal)}</strong> | VAT:{" "}
                                <strong>{formatCurrency(draftTotals.vatTotal)}</strong> | Grand Total:{" "}
                                <strong>{formatCurrency(draftTotals.grossTotal)}</strong>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  className="border px-4 py-2 rounded-lg text-sm font-bold"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => saveEdit(row)}
                                  disabled={savingId === row.id}
                                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60"
                                >
                                  {savingId === row.id ? "Saving..." : "Save"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr>
                <td colSpan={9} className="p-5 text-center text-slate-500">
                  No Server/Manager sales invoices found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
