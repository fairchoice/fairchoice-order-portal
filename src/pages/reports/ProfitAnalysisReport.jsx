import { useCallback, useEffect, useMemo, useState } from "react";
import { loadProfitAnalysis } from "../../services/profitAnalysis.js";
import * as XLSX from "xlsx";

const money = (value) => `£${Number(value || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number = (value) => Number(value || 0).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const pct = (value) => `${Number(value || 0).toFixed(2)}%`;
const dateText = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("en-GB") : "-";

const today = () => new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = () => {
  const value = new Date();
  value.setDate(value.getDate() - 30);
  return value.toISOString().slice(0, 10);
};

const tabs = [
  ["overview", "Overview"],
  ["sales", "Sales Profit"],
  ["products", "Product Profitability"],
  ["customers", "Customer Profitability"],
  ["expenses", "Expenses"],
  ["returns", "Returns Impact"],
  ["priceModes", "Price Mode Analysis"],
  ["countries", "Country Analysis"],
  ["exports", "Financial Pack / Downloads"],
];


const PROFILE_STORAGE_KEY = "fairchoice_profit_external_profile_v1";
const blankProfile = {
  businessName: "FairChoice",
  legalName: "",
  companyNumber: "",
  vatNumber: "",
  address: "",
  postcode: "",
  contactName: "",
  phone: "",
  email: "",
  website: "",
  yearsTrading: "",
  preparedFor: "",
  purpose: "Bank / Loan Application",
  fundingAmount: "",
  notes: "",
};

const safeFileName = (value) => String(value || "FairChoice").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "FairChoice";

const confirmExport = (label) => window.confirm(`Download / open ${label}?`);

const reportHelp = {
  "Financial Summary": "Summary of sales, COGS, gross profit, expenses, returns and net profit/loss for the selected period.",
  "Sales Profit": "Order-level sales, COGS, gross profit and margin for the selected period.",
  "Product Profitability": "Sales, COGS, gross profit and margin by product for the selected period.",
  "Customer Profitability": "Sales, returns, COGS, gross profit and margin by customer for the selected period.",
  "Expenses": "Approved operating expenses included in the selected Profit Analysis period.",
  "Expense Categories": "Operating expenses grouped by category for the selected period.",
  "Returns": "Confirmed returns and their estimated profit impact for the selected period.",
  "Price Mode Analysis": "Profitability grouped by the price modes included in the current report.",
  "Country Analysis": "Sales, COGS and gross profit grouped by country.",
  "Daily Trend": "Daily sales and profitability trend for the selected reporting period.",
};

const autoWidth = (rows = []) => {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0] || {});
  return keys.map((key) => ({ wch: Math.min(45, Math.max(String(key).length + 2, ...rows.map((row) => String(row?.[key] ?? "").length + 2))) }));
};

const addSheet = (workbook, name, rows) => {
  const data = Array.isArray(rows) && rows.length ? rows : [{ Message: "No matching data for this period" }];
  const sheet = XLSX.utils.json_to_sheet(data);
  sheet["!cols"] = autoWidth(data);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
};

function Card({ label, value, note, negative = false }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${negative ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {note ? <div className="mt-1 text-xs text-slate-500">{note}</div> : null}
    </div>
  );
}

function TableShell({ children }) {
  return <div className="overflow-auto rounded-xl border border-slate-200 bg-white">{children}</div>;
}

function Header({ children }) {
  return <th className="whitespace-nowrap bg-slate-100 px-3 py-2 text-left text-[11px] font-bold uppercase text-slate-600">{children}</th>;
}

function Cell({ children, right = false }) {
  return <td className={`whitespace-nowrap border-t border-slate-100 px-3 py-2 text-xs ${right ? "text-right" : "text-left"}`}>{children}</td>;
}

function EmptyRow({ colSpan }) {
  return <tr><td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-slate-500">No matching profit data for this period.</td></tr>;
}

export default function ProfitAnalysisReport({ currentUser }) {
  const [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState({ dateFrom: thirtyDaysAgo(), dateTo: today(), country: "All", customer: "", product: "", priceMode: "All" });
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState(() => {
    try { return { ...blankProfile, ...JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || "{}") }; } catch { return blankProfile; }
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await loadProfitAnalysis(currentUser, filters));
    } catch (loadError) {
      console.error("Profit Analysis load error:", loadError);
      setError(loadError?.message || "Could not load Profit Analysis.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, filters]);

  useEffect(() => { void load(); }, []);
  useEffect(() => { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile)); }, [profile]);

  const summary = report?.summary || {};
  const rows = report?.rows || {};
  const rule = report?.rule || {};
  const exclusions = report?.exclusions || {};
  const warnings = report?.warnings || [];
  const isNisstajAdmin = rule.full_internal_view === true;
  const isLoss = Number(summary.net_profit || 0) < 0;

  const trendMax = useMemo(() => Math.max(1, ...(rows.trend || []).flatMap((row) => [Math.abs(Number(row.net_sales || 0)), Math.abs(Number(row.gross_profit || 0)), Math.abs(Number(row.net_profit || 0))])), [rows.trend]);

  const profileRows = () => [
    { Field: "Business Name", Value: profile.businessName },
    { Field: "Legal Name", Value: profile.legalName },
    { Field: "Company Number", Value: profile.companyNumber },
    { Field: "VAT Number", Value: profile.vatNumber },
    { Field: "Address", Value: profile.address },
    { Field: "Postcode", Value: profile.postcode },
    { Field: "Contact Name", Value: profile.contactName },
    { Field: "Phone", Value: profile.phone },
    { Field: "Email", Value: profile.email },
    { Field: "Website", Value: profile.website },
    { Field: "Years Trading", Value: profile.yearsTrading },
    { Field: "Prepared For", Value: profile.preparedFor },
    { Field: "Purpose", Value: profile.purpose },
    { Field: "Funding Amount Requested", Value: profile.fundingAmount },
    { Field: "Notes", Value: profile.notes },
  ];

  const summaryRows = () => [
    { Metric: "Period From", Value: dateText(filters.dateFrom) },
    { Metric: "Period To", Value: dateText(filters.dateTo) },
    { Metric: "Country", Value: filters.country },
    { Metric: "Adjusted Net Sales", Value: Number(summary.adjusted_net_sales || 0) },
    { Metric: "COGS", Value: Number(summary.adjusted_cogs || 0) },
    { Metric: "Gross Profit", Value: Number(summary.gross_profit || 0) },
    { Metric: "Gross Margin %", Value: Number(summary.gross_margin_pct || 0) },
    { Metric: "Operating Expenses", Value: Number(summary.expenses || 0) },
    { Metric: "Net Profit / Loss", Value: Number(summary.net_profit || 0) },
    { Metric: "Net Margin %", Value: Number(summary.net_margin_pct || 0) },
    { Metric: "Returns / Credits", Value: Number(summary.returns_net || 0) },
    { Metric: "VAT (information only)", Value: Number(summary.adjusted_vat || 0) },
    { Metric: "Delivered Orders", Value: Number(summary.order_count || 0) },
    { Metric: "Units Sold", Value: Number(summary.qty_sold || 0) },
    { Metric: "Average Order", Value: Number(summary.average_order_value || 0) },
  ];

  const exportRows = {
    Sales_Profit: rows.sales || [],
    Product_Profitability: rows.products || [],
    Customer_Profitability: rows.customers || [],
    Expenses: rows.expenses || [],
    Expense_Categories: rows.expense_categories || [],
    Returns: rows.returns || [],
    Price_Mode_Analysis: rows.price_modes || [],
    Country_Analysis: rows.countries || [],
    Daily_Trend: rows.trend || [],
  };

  const downloadWorkbook = () => {
    if (!confirmExport("the Complete Excel Financial Pack")) return;
    const workbook = XLSX.utils.book_new();
    addSheet(workbook, "Business Profile", profileRows());
    addSheet(workbook, "Financial Summary", summaryRows());
    Object.entries(exportRows).forEach(([name, data]) => addSheet(workbook, name.replaceAll("_", " "), data));
    XLSX.writeFile(workbook, `${safeFileName(profile.businessName)}-Financial-Pack-${filters.dateFrom}-to-${filters.dateTo}.xlsx`);
  };

  const downloadSection = (name, data) => {
    if (!confirmExport(`${name} report`)) return;
    const workbook = XLSX.utils.book_new();
    addSheet(workbook, name, data);
    XLSX.writeFile(workbook, `${safeFileName(profile.businessName)}-${safeFileName(name)}-${filters.dateFrom}-to-${filters.dateTo}.xlsx`);
  };

  const downloadProfileTemplate = () => {
    if (!confirmExport("the Business Profile Template")) return;
    const workbook = XLSX.utils.book_new();
    addSheet(workbook, "Business Profile", profileRows());
    XLSX.writeFile(workbook, `${safeFileName(profile.businessName)}-Business-Profile-Template.xlsx`);
  };

  const importProfile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const imported = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      const values = Object.fromEntries(imported.map((row) => [String(row.Field || "").trim(), row.Value ?? ""]));
      const mapping = {
        "Business Name": "businessName", "Legal Name": "legalName", "Company Number": "companyNumber", "VAT Number": "vatNumber",
        "Address": "address", "Postcode": "postcode", "Contact Name": "contactName", "Phone": "phone", "Email": "email",
        "Website": "website", "Years Trading": "yearsTrading", "Prepared For": "preparedFor", "Purpose": "purpose",
        "Funding Amount Requested": "fundingAmount", "Notes": "notes",
      };
      setProfile((old) => {
        const next = { ...old };
        Object.entries(mapping).forEach(([label, key]) => { if (Object.hasOwn(values, label)) next[key] = String(values[label] ?? ""); });
        return next;
      });
    } catch (importError) {
      console.error("Business profile import error:", importError);
      alert("Could not import the business profile sheet.");
    }
  };

  const printExternalPack = () => {
    if (!confirmExport("the Printable / PDF Financial Pack")) return;
    const popup = window.open("", "_blank", "width=1100,height=850");
    if (!popup) { alert("Please allow pop-ups to open the printable financial pack."); return; }
    try { popup.opener = null; } catch {}
    const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    popup.document.write(`<!doctype html><html><head><title>${esc(profile.businessName)} Financial Pack</title><style>body{font-family:Arial,sans-serif;color:#0f172a;margin:36px}h1{margin:0 0 4px}h2{margin-top:28px;border-bottom:2px solid #0f172a;padding-bottom:6px}.muted{color:#64748b}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}.box{border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-top:12px}.metric{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0}.metric:last-child{border:0}.profit{font-size:22px;font-weight:700}.footer{margin-top:38px;font-size:11px;color:#64748b}@media print{button{display:none}}</style></head><body><h1>${esc(profile.businessName || "FairChoice")}</h1><div class="muted">Financial Performance Summary · ${esc(dateText(filters.dateFrom))} to ${esc(dateText(filters.dateTo))}</div>${profile.preparedFor ? `<div class="box"><b>Prepared for:</b> ${esc(profile.preparedFor)}<br><b>Purpose:</b> ${esc(profile.purpose)}${profile.fundingAmount ? `<br><b>Funding requested:</b> ${esc(profile.fundingAmount)}` : ""}</div>` : ""}<h2>Business Profile</h2><div class="grid">${profileRows().filter((r) => r.Value).map((r) => `<div><b>${esc(r.Field)}:</b> ${esc(r.Value)}</div>`).join("")}</div><h2>Financial Summary</h2><div class="box"><div class="metric"><span>Adjusted Net Sales</span><b>${money(summary.adjusted_net_sales)}</b></div><div class="metric"><span>COGS</span><b>${money(summary.adjusted_cogs)}</b></div><div class="metric"><span>Gross Profit</span><b>${money(summary.gross_profit)} (${pct(summary.gross_margin_pct)})</b></div><div class="metric"><span>Operating Expenses</span><b>${money(summary.expenses)}</b></div><div class="metric profit"><span>Net Profit / Loss</span><span>${money(summary.net_profit)} (${pct(summary.net_margin_pct)})</span></div><div class="metric"><span>Returns / Credits</span><b>${money(summary.returns_net)}</b></div><div class="metric"><span>Delivered Orders</span><b>${number(summary.order_count)}</b></div><div class="metric"><span>Average Order</span><b>${money(summary.average_order_value)}</b></div></div><h2>Management Notes</h2><div class="box">${esc(profile.notes || "Financial information generated from FairChoice operational records for the selected reporting period.")}</div><div class="footer">Generated from FairChoice Profit Analysis. VAT is shown for information and is not treated as profit. This management report should be reviewed with the business's accountant where formal statutory accounts are required.</div><script>window.onload=()=>setTimeout(()=>window.print(),200);<\/script></body></html>`);
    popup.document.close();
    popup.focus();
  };

  return (
    <div className="space-y-4 p-3 md:p-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Profit Analysis</h1>
            <p className="mt-1 text-sm text-slate-600">Sales, COGS, returns, expenses and final profit/loss in one report.</p>
          </div>

        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-xs font-semibold text-slate-600">Date From<input type="date" value={filters.dateFrom} onChange={(e) => setFilters((old) => ({ ...old, dateFrom: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Date To<input type="date" value={filters.dateTo} onChange={(e) => setFilters((old) => ({ ...old, dateTo: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Country<select value={filters.country} onChange={(e) => setFilters((old) => ({ ...old, country: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>All</option><option>Wales</option><option>England</option></select></label>
          <label className="text-xs font-semibold text-slate-600">Customer<input value={filters.customer} onChange={(e) => setFilters((old) => ({ ...old, customer: e.target.value }))} placeholder="Customer name" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          <label className="text-xs font-semibold text-slate-600">Product<input value={filters.product} onChange={(e) => setFilters((old) => ({ ...old, product: e.target.value }))} placeholder="Name or code" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{loading ? "Calculating…" : "Run Profit Analysis"}</button>
          <button type="button" onClick={() => setFilters({ dateFrom: thirtyDaysAgo(), dateTo: today(), country: "All", customer: "", product: "", priceMode: "All" })} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Reset</button>
          <button type="button" onClick={() => setTab("exports")} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white">Financial Pack / Downloads</button>
          <span className="text-xs text-slate-500">COGS: weighted historical receipt cost to sale date; product cost used only when receipt history is unavailable.</span>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div> : null}
      {warnings.map((warning) => <div key={warning} className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{warning}</div>)}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <Card label="Adjusted Net Sales" value={money(summary.adjusted_net_sales)} note={`${number(summary.order_count)} delivered orders`} />
        <Card label="COGS" value={money(summary.adjusted_cogs)} note={`${number(summary.qty_sold)} units sold`} />
        <Card label="Gross Profit" value={money(summary.gross_profit)} note={`${pct(summary.gross_margin_pct)} margin`} negative={Number(summary.gross_profit || 0) < 0} />
        <Card label="Expenses" value={money(summary.expenses)} note={`${pct(summary.expense_ratio_pct)} of sales`} />
        <Card label="Net Profit / Loss" value={money(summary.net_profit)} note={`${pct(summary.net_margin_pct)} net margin`} negative={isLoss} />
        <Card label="Returns" value={money(summary.returns_net)} note={`${number(summary.return_qty)} units`} />
        <Card label="VAT" value={money(summary.adjusted_vat)} note="Information only · not profit" />
        <Card label="Average Order" value={money(summary.average_order_value)} note="After returns" />
      </div>

      {isNisstajAdmin ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Card label="Excluded Inc. Sales" value={money(exclusions.inc_vat_sales_net)} note={`${number(exclusions.inc_vat_order_count)} orders identified by internal rule`} />
          <Card label="Excluded 'paper' Expenses" value={money(exclusions.paper_expenses)} note={`${number(exclusions.paper_expense_count)} expenses identified by internal rule`} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
        {tabs.map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{label}</button>)}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-4 text-sm font-bold text-slate-800">Daily Profit Trend</div>
            <div className="space-y-2">
              {(rows.trend || []).slice(-31).map((row) => {
                const net = Number(row.net_profit || 0);
                const width = Math.max(1, Math.round(Math.abs(net) / trendMax * 100));
                return <div key={row.day} className="grid grid-cols-[78px_1fr_110px] items-center gap-2 text-xs"><span>{dateText(row.day)}</span><div className="h-3 rounded bg-slate-100"><div className={`h-3 rounded ${net < 0 ? "bg-red-500" : "bg-emerald-600"}`} style={{ width: `${width}%` }} /></div><span className={`text-right font-bold ${net < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(net)}</span></div>;
              })}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-bold text-slate-800">Profit Waterfall</div>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between"><span>Delivered Net Sales</span><b>{money(summary.sales_net)}</b></div>
              <div className="flex justify-between text-red-700"><span>Less Returns / Credits</span><b>- {money(summary.returns_net)}</b></div>
              <div className="border-t pt-2 flex justify-between"><span>Adjusted Net Sales</span><b>{money(summary.adjusted_net_sales)}</b></div>
              <div className="flex justify-between text-red-700"><span>Less COGS</span><b>- {money(summary.adjusted_cogs)}</b></div>
              <div className="border-t pt-2 flex justify-between"><span>Gross Profit</span><b>{money(summary.gross_profit)}</b></div>
              <div className="flex justify-between text-red-700"><span>Less Operating Expenses</span><b>- {money(summary.expenses)}</b></div>
              <div className={`border-t pt-3 flex justify-between text-lg font-extrabold ${isLoss ? "text-red-700" : "text-emerald-700"}`}><span>Net Profit / Loss</span><span>{money(summary.net_profit)}</span></div>
            </div>
          </div>
        </div>
      )}

      {tab === "sales" && <TableShell><table className="min-w-full"><thead><tr><Header>Date</Header><Header>Order</Header><Header>Customer</Header><Header>Branch</Header><Header>Country</Header><Header>Mode</Header><Header>Qty</Header><Header>Net Sales</Header><Header>VAT</Header><Header>COGS</Header><Header>Gross Profit</Header><Header>Margin</Header></tr></thead><tbody>{(rows.sales || []).length ? rows.sales.map((r) => <tr key={r.id}><Cell>{dateText(r.sale_date)}</Cell><Cell>{r.order_number}</Cell><Cell>{r.customer_name}</Cell><Cell>{r.branch_name || "-"}</Cell><Cell>{r.country}</Cell><Cell>{r.price_mode}</Cell><Cell right>{number(r.qty)}</Cell><Cell right>{money(r.net_sales)}</Cell><Cell right>{money(r.vat_sales)}</Cell><Cell right>{money(r.cogs)}</Cell><Cell right>{money(r.gross_profit)}</Cell><Cell right>{pct(r.margin_pct)}</Cell></tr>) : <EmptyRow colSpan={12} />}</tbody></table></TableShell>}

      {tab === "products" && <TableShell><table className="min-w-full"><thead><tr><Header>Code</Header><Header>Product</Header><Header>Category</Header><Header>Qty Sold</Header><Header>Returned</Header><Header>Net Sales</Header><Header>COGS</Header><Header>Profit</Header><Header>Margin</Header></tr></thead><tbody>{(rows.products || []).length ? rows.products.map((r) => <tr key={r.product_id || r.product_code}><Cell>{r.product_code}</Cell><Cell>{r.product_name}</Cell><Cell>{r.category}</Cell><Cell right>{number(r.qty_sold)}</Cell><Cell right>{number(r.return_qty)}</Cell><Cell right>{money(r.net_sales)}</Cell><Cell right>{money(r.cogs)}</Cell><Cell right>{money(r.gross_profit)}</Cell><Cell right>{pct(r.margin_pct)}</Cell></tr>) : <EmptyRow colSpan={9} />}</tbody></table></TableShell>}

      {tab === "customers" && <TableShell><table className="min-w-full"><thead><tr><Header>Customer</Header><Header>Branch</Header><Header>Country</Header><Header>Orders</Header><Header>Returns</Header><Header>Net Sales</Header><Header>COGS</Header><Header>Profit</Header><Header>Margin</Header></tr></thead><tbody>{(rows.customers || []).length ? rows.customers.map((r, i) => <tr key={`${r.customer_account_id}-${r.customer_branch_id}-${i}`}><Cell>{r.customer_name}</Cell><Cell>{r.branch_name || "-"}</Cell><Cell>{r.country}</Cell><Cell right>{number(r.orders)}</Cell><Cell right>{money(r.returns_net)}</Cell><Cell right>{money(r.net_sales)}</Cell><Cell right>{money(r.cogs)}</Cell><Cell right>{money(r.gross_profit)}</Cell><Cell right>{pct(r.margin_pct)}</Cell></tr>) : <EmptyRow colSpan={9} />}</tbody></table></TableShell>}

      {tab === "expenses" && <div className="space-y-4"><TableShell><table className="min-w-full"><thead><tr><Header>Date</Header><Header>Category</Header><Header>Reason</Header><Header>Reference</Header><Header>Staff</Header><Header>Status</Header><Header>Amount</Header></tr></thead><tbody>{(rows.expenses || []).length ? rows.expenses.map((r) => <tr key={r.id}><Cell>{dateText(r.expense_date)}</Cell><Cell>{r.category || "-"}</Cell><Cell>{r.reason || "-"}</Cell><Cell>{r.reference || "-"}</Cell><Cell>{r.collector_name || "-"}</Cell><Cell>{r.status}</Cell><Cell right>{money(r.amount)}</Cell></tr>) : <EmptyRow colSpan={7} />}</tbody></table></TableShell><TableShell><table className="min-w-full"><thead><tr><Header>Expense Category</Header><Header>Records</Header><Header>Amount</Header><Header>% of Sales</Header></tr></thead><tbody>{(rows.expense_categories || []).map((r) => <tr key={r.category}><Cell>{r.category}</Cell><Cell right>{number(r.records)}</Cell><Cell right>{money(r.amount)}</Cell><Cell right>{pct(r.pct_of_sales)}</Cell></tr>)}</tbody></table></TableShell></div>}

      {tab === "returns" && <TableShell><table className="min-w-full"><thead><tr><Header>Date</Header><Header>Return</Header><Header>Customer</Header><Header>Product</Header><Header>Qty</Header><Header>Return Value</Header><Header>Cost Recovered</Header><Header>Profit Impact</Header></tr></thead><tbody>{(rows.returns || []).length ? rows.returns.map((r) => <tr key={`${r.id}-${r.product_code}`}><Cell>{dateText(r.return_date)}</Cell><Cell>{r.return_number}</Cell><Cell>{r.customer_name}</Cell><Cell>{r.product_code} · {r.product_name}</Cell><Cell right>{number(r.qty)}</Cell><Cell right>{money(r.return_net)}</Cell><Cell right>{money(r.cost_recovered)}</Cell><Cell right>{money(r.profit_impact)}</Cell></tr>) : <EmptyRow colSpan={8} />}</tbody></table></TableShell>}

      {tab === "priceModes" && <TableShell><table className="min-w-full"><thead><tr><Header>Price Mode</Header><Header>Orders</Header><Header>Qty</Header><Header>Net Sales</Header><Header>COGS</Header><Header>Profit</Header><Header>Margin</Header></tr></thead><tbody>{(rows.price_modes || []).length ? rows.price_modes.map((r) => <tr key={r.price_mode}><Cell>{r.price_mode === "SERVER" ? "Inc. / SERVER" : r.price_mode}</Cell><Cell right>{number(r.orders)}</Cell><Cell right>{number(r.qty)}</Cell><Cell right>{money(r.net_sales)}</Cell><Cell right>{money(r.cogs)}</Cell><Cell right>{money(r.gross_profit)}</Cell><Cell right>{pct(r.margin_pct)}</Cell></tr>) : <EmptyRow colSpan={7} />}</tbody></table></TableShell>}

      {tab === "countries" && <TableShell><table className="min-w-full"><thead><tr><Header>Country</Header><Header>Orders</Header><Header>Qty</Header><Header>Returns</Header><Header>Net Sales</Header><Header>COGS</Header><Header>Gross Profit</Header><Header>Margin</Header></tr></thead><tbody>{(rows.countries || []).length ? rows.countries.map((r) => <tr key={r.country}><Cell>{r.country}</Cell><Cell right>{number(r.orders)}</Cell><Cell right>{number(r.qty)}</Cell><Cell right>{money(r.returns_net)}</Cell><Cell right>{money(r.net_sales)}</Cell><Cell right>{money(r.cogs)}</Cell><Cell right>{money(r.gross_profit)}</Cell><Cell right>{pct(r.margin_pct)}</Cell></tr>) : <EmptyRow colSpan={8} />}</tbody></table></TableShell>}

      {tab === "exports" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div><h2 className="text-lg font-extrabold text-slate-900">External Financial Pack</h2><p className="text-sm text-slate-600">Prepare clean reports for banks, lenders, investors, accountants or other third parties.</p></div>
              <div className="flex flex-wrap gap-2"><button type="button" title="Download the complete external financial workbook. You will be asked to confirm first." onClick={downloadWorkbook} className="cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md">Download Complete Excel Pack</button><button type="button" title="Open the printable financial summary for printing or saving as PDF. You will be asked to confirm first." onClick={printExternalPack} className="cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:shadow-md">Open Printable / PDF Pack</button></div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2"><h3 className="font-bold text-slate-900">Business / Application Profile</h3><span title="Optional. Complete this only when preparing a pack for a bank, lender, investor, accountant or another third party. General business details are saved in this browser; application-specific fields can be changed for each pack." className="cursor-help rounded-full border border-slate-300 px-1.5 text-xs font-bold text-slate-600">i</span></div>
              <p className="mt-1 text-xs text-slate-500"><b>Optional.</b> Use this when preparing a pack for a bank, lender, investor, accountant or another third party. Complete the general business details once; change Prepared For, Funding Amount, Purpose and Notes for each application. The profile is saved in this browser and included in exported packs.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" title="Download an editable Business Profile template. Confirmation is required before download." onClick={downloadProfileTemplate} className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold transition hover:bg-slate-100 hover:shadow-sm">Download Profile Template</button><label title="Import a previously completed Business Profile spreadsheet." className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold transition hover:bg-slate-100 hover:shadow-sm">Import Profile Sheet<input type="file" accept=".xlsx,.xls" onChange={importProfile} className="hidden" /></label></div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {[
                  ["businessName","Business Name"],["legalName","Legal Name"],["companyNumber","Company Number"],["vatNumber","VAT Number"],
                  ["address","Business Address"],["postcode","Postcode"],["contactName","Contact Name"],["phone","Phone"],
                  ["email","Email"],["website","Website"],["yearsTrading","Years Trading"],["preparedFor","Prepared For / Bank / Investor"],
                  ["fundingAmount","Funding Amount Requested"],
                ].map(([key,label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input value={profile[key]} onChange={(e) => setProfile((old) => ({ ...old, [key]: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>)}
                <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Purpose<select value={profile.purpose} onChange={(e) => setProfile((old) => ({ ...old, purpose: e.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"><option>Bank / Loan Application</option><option>Investor Review</option><option>Accountant / Finance Review</option><option>Grant / Funding Application</option><option>Other Third Party</option></select></label>
                <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Notes<textarea value={profile.notes} onChange={(e) => setProfile((old) => ({ ...old, notes: e.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-bold text-slate-900">Download Reports Separately</h3>
              <p className="mt-1 text-xs text-slate-500">Each download uses the current Profit Analysis date and filters.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button type="button" title={reportHelp["Financial Summary"]} onClick={() => downloadSection("Financial Summary", summaryRows())} className="cursor-pointer rounded-lg border border-slate-300 px-3 py-3 text-left text-sm font-bold transition hover:border-slate-500 hover:bg-slate-50 hover:shadow-sm">Financial Summary</button>
                {Object.entries(exportRows).map(([name,data]) => { const label = name.replaceAll("_", " "); return <button key={name} type="button" title={reportHelp[label] || `Download ${label} for the current period and filters.`} onClick={() => downloadSection(label, data)} className="cursor-pointer rounded-lg border border-slate-300 px-3 py-3 text-left text-sm font-bold transition hover:border-slate-500 hover:bg-slate-50 hover:shadow-sm">{label}</button>; })}
              </div>
              <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b>External document rule:</b> exported packs show financial results only. Internal access messages and internal calculation-rule banners are not printed in the bank/investor pack.</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
