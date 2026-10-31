import { useCallback, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  canManageSupplierSetup,
  loadSupplierSetup,
  saveSupplier,
  setSupplierActive,
  SUPPLIER_PAYMENT_METHODS,
  SUPPLIER_PRICING_BASES,
  deactivateSupplierProductPricing,
  loadSupplierProductPricing,
  saveSupplierProductPricing,
  bulkSaveSupplierProductPricing,
  validateSupplier,
} from "../../services/suppliers";

const emptySupplierForm = {
  supplier_name: "",
  company_legal_name: "",
  contact_name: "",
  supplier_reference: "",
  email: "",
  mobile: "",
  telephone: "",
  vat_number: "",
  vat_registered: true,
  import_agent: false,
  reverse_charge: false,
  address_line_1: "",
  address_line_2: "",
  city: "",
  county: "",
  postcode: "",
  country: "United Kingdom",
  account_default: "5000 - Cost of Sales - Goods",
  payment_terms: "",
  default_payment_method: "",
  bank_payment_reference: "",
  credit_limit: "",
  credit_terms_enabled: false,
  credit_terms_days: "30",
  credit_terms_type: "DAYS_AFTER_INVOICE",
  account_on_hold: false,
  bank_account_name: "",
  bank_sort_code: "",
  bank_account_number: "",
  bank_bic_swift: "",
  bank_iban: "",
  notes: "",
};

function supplierToForm(supplier) {
  return {
    ...emptySupplierForm,
    ...Object.fromEntries(
      Object.keys(emptySupplierForm).map((field) => [
        field,
        supplier?.[field] ?? "",
      ]),
    ),
    address_line_1:
      supplier?.address_line_1 || supplier?.address || "",
  };
}

function displayAddress(supplier) {
  const structured = [
    supplier.address_line_1,
    supplier.address_line_2,
    supplier.city,
    supplier.county,
    supplier.postcode,
    supplier.country,
  ]
    .filter(Boolean)
    .join(", ");
  return structured || supplier.address || "—";
}

export default function Suppliers({ user }) {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [editingSupplier, setEditingSupplier] = useState(undefined);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState("");
  const [formErrors, setFormErrors] = useState({});
  const [pricingData, setPricingData] = useState({ products: [], rows: [] });
  const [pricingHistory, setPricingHistory] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingPage, setPricingPage] = useState(1);
  const [productSearch, setProductSearch] = useState("");
  const [pricingImport, setPricingImport] = useState(null);
  const [pricingForm, setPricingForm] = useState({ productId: "", pricingBasis: "STANDARD", unitCost: "", effectiveFrom: new Date().toISOString().slice(0,10), note: "" });

  const allowed = canManageSupplierSetup(user);

  const refreshSuppliers = useCallback(async (preferredId = null) => {
    setPageError("");
    try {
      const rows = await loadSupplierSetup(user, { includeInactive: true });
      setSuppliers(rows);
      if (preferredId && rows.some((supplier) => supplier.id === preferredId)) {
        setSelectedId(preferredId);
      } else {
        setSelectedId(rows[0]?.id || null);
      }
    } catch (error) {
      setPageError(error.message || "Suppliers could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!allowed) return undefined;
    const refreshTimer = window.setTimeout(() => {
      void refreshSuppliers();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [allowed, refreshSuppliers]);

  const selectedSupplier =
    suppliers.find((supplier) => supplier.id === selectedId) || null;

  const refreshPricing = useCallback(async (supplierId = selectedId, history = pricingHistory) => {
    if (!supplierId) { setPricingData({ products: [], rows: [] }); return; }
    setPricingLoading(true);
    try { setPricingData(await loadSupplierProductPricing(user, supplierId, history)); }
    catch (error) { setPageError(error.message || "Supplier pricing could not be loaded."); }
    finally { setPricingLoading(false); }
  }, [pricingHistory, selectedId, user]);

  useEffect(() => { setPricingPage(1); void refreshPricing(); }, [refreshPricing]);

  async function handlePricingSave(event) {
    event.preventDefault();
    if (!selectedSupplier) return;
    setPricingSaving(true); setPageError("");
    try {
      await saveSupplierProductPricing({ supplierId: selectedSupplier.id, ...pricingForm }, user);
      setPricingForm((current) => ({ ...current, unitCost: "", note: "" }));
      await refreshPricing(selectedSupplier.id, pricingHistory);
    } catch (error) { setPageError(error.message || "Supplier pricing could not be saved."); }
    finally { setPricingSaving(false); }
  }

  async function handlePricingDeactivate(row) {
    setPricingSaving(true); setPageError("");
    try { await deactivateSupplierProductPricing(row.id, user); await refreshPricing(selectedSupplier?.id, pricingHistory); }
    catch (error) { setPageError(error.message || "Supplier pricing could not be deactivated."); }
    finally { setPricingSaving(false); }
  }

  function openCreate() {
    setEditingSupplier(null);
    setSupplierForm(emptySupplierForm);
    setFormErrors({});
  }

  function openEdit(supplier) {
    setEditingSupplier(supplier);
    setSupplierForm(supplierToForm(supplier));
    setFormErrors({});
  }

  function closeForm() {
    setEditingSupplier(undefined);
    setSupplierForm(emptySupplierForm);
    setFormErrors({});
  }

  function updateField(field, value) {
    setSupplierForm((current) => ({ ...current, [field]: value }));
    setFormErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleSave(event) {
    event.preventDefault();
    const validation = validateSupplier(supplierForm);
    if (!validation.valid) {
      setFormErrors(validation.errors);
      return;
    }
    if (!allowed) {
      setPageError("You do not have permission to manage Supplier Setup.");
      return;
    }

    setSaving(true);
    setPageError("");
    try {
      const saved = await saveSupplier(
        supplierForm,
        user,
        editingSupplier?.id || null,
      );
      closeForm();
      await refreshSuppliers(saved?.id || editingSupplier?.id);
    } catch (error) {
      setFormErrors(error.validationErrors || {});
      setPageError(error.message || "The supplier could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(supplier) {
    if (!allowed) {
      setPageError("You do not have permission to manage Supplier Setup.");
      return;
    }

    setSaving(true);
    setPageError("");
    try {
      await setSupplierActive(supplier.id, supplier.active === false, user);
      await refreshSuppliers(supplier.id);
    } catch (error) {
      setPageError(error.message || "Supplier status could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-xl font-bold text-slate-900">Supplier Setup</h2>
        <p className="mt-2 text-sm text-slate-600">
          You do not have permission to access Supplier Setup.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Supplier Setup</h2>
          <p className="mt-1 text-sm text-slate-600">
            Maintain supplier contact, address, payment, and active-status details.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Create supplier
        </button>
      </header>

      {pageError && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {pageError}
        </div>
      )}

      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-800">
          Select supplier
          <select
            value={selectedId || ""}
            onChange={(event) => setSelectedId(event.target.value || null)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"
          >
            <option value="">Select supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.supplier_name}{supplier.active === false ? " (Inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Loading suppliers…</section>
      ) : !selectedSupplier ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Select a supplier to continue.</section>
      ) : (
        <div className="space-y-4">
          <SupplierDetail supplier={selectedSupplier} saving={saving} onEdit={openEdit} onToggleActive={toggleActive} />
          <SupplierPricingPanel
            supplier={selectedSupplier}
            data={pricingData}
            form={pricingForm}
            loading={pricingLoading}
            saving={pricingSaving}
            history={pricingHistory}
            page={pricingPage}
            onPageChange={setPricingPage}
            onHistoryChange={(value) => setPricingHistory(value)}
            onFormChange={(field, value) => setPricingForm((current) => ({ ...current, [field]: value }))}
            onSubmit={handlePricingSave}
            onDeactivate={handlePricingDeactivate}
            user={user}
            importState={pricingImport}
            onImportState={setPricingImport}
            onImported={() => refreshPricing(selectedSupplier.id, pricingHistory)}
            productSearch={productSearch}
            onProductSearchChange={setProductSearch}
          />
        </div>
      )}

      {editingSupplier !== undefined && (
        <SupplierForm
          form={supplierForm}
          errors={formErrors}
          editing={Boolean(editingSupplier)}
          saving={saving}
          onChange={updateField}
          onClose={closeForm}
          onSubmit={handleSave}
        />
      )}
    </div>
  );
}


function SupplierPricingPanel({ supplier, data, form, loading, saving, history, page, onPageChange, onHistoryChange, onFormChange, onSubmit, onDeactivate, user, importState, onImportState, onImported, productSearch, onProductSearchChange }) {
  if (!supplier) return null;
  const products = data?.products || [];
  const searchTerm = String(productSearch || "").trim().toLowerCase();
  const filteredProducts = searchTerm ? products.filter((p) => `${p.product_code || ""} ${p.product_name || ""}`.toLowerCase().includes(searchTerm)) : products;
  const rows = data?.rows || [];
  const fileRef = useRef(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(Math.max(1, page || 1), totalPages);
  const pagedRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const money = (value) => Number(value || 0).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
  const margin = (row) => { const sale = Number(row.pricing_basis === "INCLUSIVE" ? row.inclusive_sale_price : row.standard_sale_price || 0); const cost = Number(row.unit_cost || 0); return sale > 0 ? ((sale - cost) / sale) * 100 : null; };
  const current = new Map(rows.filter((r) => r.active && !r.effective_to).map((r) => [`${r.product_id}|${r.pricing_basis}`, r]));
  const headers = ["Product Code","Product Name","Pricing Basis","Unit Cost","Effective From","Note"];
  const today = new Date().toISOString().slice(0,10);
  const workbookRows = () => products.flatMap((p) => ["STANDARD","INCLUSIVE"].map((basis) => { const r=current.get(`${p.id}|${basis}`); return { "Product Code":p.product_code||"", "Product Name":p.product_name||"", "Pricing Basis":basis === "STANDARD" ? "Standard" : "Inclusive", "Unit Cost":r?.unit_cost ?? "", "Effective From":r?.effective_from || today, "Note":r?.note || "" }; }));
  const download = (templateOnly=false) => { const wb=XLSX.utils.book_new(); const data=templateOnly ? workbookRows().map((r)=>({...r,"Unit Cost":"","Note":""})) : workbookRows(); const ws=XLSX.utils.json_to_sheet(data,{header:headers}); ws["!cols"]=[{wch:18},{wch:42},{wch:18},{wch:14},{wch:16},{wch:32}]; XLSX.utils.book_append_sheet(wb,ws,"Supplier Product Costs"); XLSX.writeFile(wb, `${supplier.supplier_name.replace(/[^a-z0-9]+/gi,"-")}-${templateOnly?"product-cost-template":"product-costs"}.xlsx`); };
  const parseFile = async (file) => { try { const buf=await file.arrayBuffer(); const wb=XLSX.read(buf,{type:"array",cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]]; const raw=XLSX.utils.sheet_to_json(ws,{defval:"",raw:false}); const productByCode=new Map(products.map((p)=>[String(p.product_code||"").trim().toLowerCase(),p])); const seen=new Set(); const valid=[]; const errors=[]; let unchanged=0; raw.forEach((r,i)=>{ const row=i+2; const code=String(r["Product Code"]||"").trim(); const basisRaw=String(r["Pricing Basis"]||"").trim().toUpperCase().replace(/\./g,""); const basis=basisRaw === "STANDARD" || basisRaw === "EXVAT" || basisRaw === "EX VAT" ? "STANDARD" : basisRaw === "INCLUSIVE" || basisRaw === "INCVAT" || basisRaw === "INC VAT" ? "INCLUSIVE" : ""; const costText=String(r["Unit Cost"]??"").trim(); if (!code && !costText) return; if (!code) { errors.push({row,message:"Product Code is required."}); return; } const product=productByCode.get(code.toLowerCase()); if (!product) { errors.push({row,message:`Unknown Product Code: ${code}`}); return; } if (!basis) { errors.push({row,message:"Pricing Basis must be Standard or Inclusive."}); return; } if (!costText) return; const cost=Number(costText.replace(/[,£]/g,"")); if (!Number.isFinite(cost)||cost<0) { errors.push({row,message:"Unit Cost must be zero or greater."}); return; } const key=`${product.id}|${basis}`; if(seen.has(key)){errors.push({row,message:`Duplicate ${code} / ${basis}.`});return;} seen.add(key); const dateRaw=String(r["Effective From"]||today).trim(); const iso=/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)?dateRaw:today; const old=current.get(key); if(old && Number(old.unit_cost)===cost){unchanged++;} valid.push({product_code:code,product_name:product.product_name,pricing_basis:basis,unit_cost:cost,effective_from:iso,note:String(r["Note"]||"").trim()}); }); onImportState({fileName:file.name,rows:valid,errors,unchanged,total:raw.length}); } catch(e){onImportState({fileName:file.name,rows:[],errors:[{row:"—",message:e.message||"File could not be read."}],unchanged:0,total:0});} };
  const confirmImport=async()=>{ if(!importState?.rows?.length || importState.errors?.length) return; setBulkSaving(true); try { const result=await bulkSaveSupplierProductPricing(supplier.id,importState.rows,user); onImportState({...importState,result}); await onImported(); } catch(e){onImportState({...importState,errors:[...(importState.errors||[]),{row:"Save",message:e.message||"Import failed."}]});} finally{setBulkSaving(false);} };
  return <section className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-slate-900">Product × Supplier Pricing</h3><p className="mt-1 text-xs text-slate-500">Maintain supplier-specific Standard and Inclusive unit costs. New prices create history instead of overwriting earlier costs.</p></div><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={history} onChange={(e)=>onHistoryChange(e.target.checked)}/> Show history</label></div>
    <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3"><button type="button" onClick={()=>download(false)} className="rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white">Export Product Costs</button><button type="button" onClick={()=>download(true)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold text-white">Download Import Template</button><button type="button" onClick={()=>fileRef.current?.click()} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white">Import Product Costs</button><input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e)=>{const f=e.target.files?.[0]; if(f) void parseFile(f); e.target.value="";}}/><span className="self-center text-xs text-slate-500">Match by Product Code · up to 10,000 rows per import</span></div>
    {importState && <div className={`mt-3 rounded-lg border p-3 text-xs ${importState.errors?.length?"border-red-200 bg-red-50":"border-emerald-200 bg-emerald-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong>{importState.fileName}</strong><span>Valid {importState.rows?.length||0} · Unchanged {importState.unchanged||0} · Errors {importState.errors?.length||0}</span></div>{importState.result && <p className="mt-2 font-semibold text-emerald-800">Imported: {importState.result.created||0} created · {importState.result.updated||0} updated · {importState.result.unchanged||0} unchanged.</p>}{importState.errors?.length>0 && <div className="mt-2 max-h-28 overflow-auto text-red-800">{importState.errors.slice(0,100).map((e,i)=><div key={i}>Row {e.row}: {e.message}</div>)}</div>}<div className="mt-3 flex gap-2"><button type="button" onClick={()=>onImportState(null)} className="rounded border border-slate-300 bg-white px-3 py-1.5 font-semibold">Cancel</button>{!importState.result && <button type="button" disabled={bulkSaving||!importState.rows?.length||Boolean(importState.errors?.length)} onClick={confirmImport} className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-white disabled:opacity-40">{bulkSaving?"Importing…":"Confirm Import"}</button>}</div></div>}
    <form onSubmit={onSubmit} className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2"><div className="sm:col-span-2 grid gap-2"><label className="text-xs font-semibold text-slate-700">Search product<input value={productSearch} onChange={(e)=>onProductSearchChange(e.target.value)} placeholder="Search by product code or name..." className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-700">Product<select required value={form.productId} onChange={(e)=>onFormChange("productId",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"><option value="">Select product…</option>{filteredProducts.map((p)=><option key={p.id} value={p.id}>{p.product_code?`${p.product_code} · `:""}{p.product_name}</option>)}</select><span className="mt-1 block text-[11px] font-normal text-slate-500">{filteredProducts.length} product{filteredProducts.length===1?"":"s"} shown</span></label></div><label className="text-xs font-semibold text-slate-700">Pricing basis<select value={form.pricingBasis} onChange={(e)=>onFormChange("pricingBasis",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal">{SUPPLIER_PRICING_BASES.map((b)=><option key={b.value} value={b.value}>{b.label}</option>)}</select></label><label className="text-xs font-semibold text-slate-700">Unit cost<input required min="0" step="0.0001" type="number" value={form.unitCost} onChange={(e)=>onFormChange("unitCost",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-700">Effective from<input required type="date" value={form.effectiveFrom} onChange={(e)=>onFormChange("effectiveFrom",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"/></label><label className="text-xs font-semibold text-slate-700">Note<input value={form.note} onChange={(e)=>onFormChange("note",e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"/></label><div className="sm:col-span-2"><button disabled={saving} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving?"Saving…":"Save supplier cost"}</button></div></form>
    <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="border-b bg-slate-50 text-slate-600"><tr><th className="px-2 py-2">Product</th><th className="px-2 py-2">Basis</th><th className="px-2 py-2">Cost</th><th className="px-2 py-2">Selling price</th><th className="px-2 py-2">Est. margin</th><th className="px-2 py-2">Effective</th><th className="px-2 py-2"></th></tr></thead><tbody className="divide-y">{loading?<tr><td colSpan="7" className="px-2 py-4 text-slate-500">Loading pricing…</td></tr>:rows.length===0?<tr><td colSpan="7" className="px-2 py-4 text-slate-500">No supplier-specific costs yet.</td></tr>:pagedRows.map((row)=>{const sale=row.pricing_basis==="INCLUSIVE"?row.inclusive_sale_price:row.standard_sale_price;const m=margin(row);return <tr key={row.id} className={!row.active?"text-slate-400":""}><td className="px-2 py-2"><span className="font-semibold">{row.product_name}</span><br/><span>{row.product_code}</span></td><td className="px-2 py-2">{row.pricing_basis==="INCLUSIVE"?"Inclusive":"Standard"}</td><td className="px-2 py-2 font-semibold">{money(row.unit_cost)}</td><td className="px-2 py-2">{sale==null?"—":money(sale)}</td><td className="px-2 py-2">{m==null?"—":`${m.toFixed(1)}%`}</td><td className="px-2 py-2">{row.effective_from}{row.effective_to?` → ${row.effective_to}`:""}</td><td className="px-2 py-2">{row.active&&!row.effective_to?<button type="button" disabled={saving} onClick={()=>onDeactivate(row)} className="font-semibold text-red-700 disabled:opacity-50">End</button>:"History"}</td></tr>})}</tbody></table></div>
    {rows.length>pageSize?<div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-xs text-slate-600"><span>Showing {(safePage-1)*pageSize+1}-{Math.min(safePage*pageSize,rows.length)} of {rows.length}</span><div className="flex flex-wrap items-center gap-1"><button type="button" disabled={safePage<=1} onClick={()=>onPageChange(safePage-1)} className="rounded border border-slate-300 px-2 py-1 font-semibold disabled:opacity-40">Previous</button>{Array.from({length:totalPages},(_,i)=>i+1).map((n)=><button key={n} type="button" onClick={()=>onPageChange(n)} className={`rounded px-2 py-1 font-semibold ${n===safePage?"bg-slate-900 text-white":"border border-slate-300"}`}>{n}</button>)}<button type="button" disabled={safePage>=totalPages} onClick={()=>onPageChange(safePage+1)} className="rounded border border-slate-300 px-2 py-1 font-semibold disabled:opacity-40">Next</button></div></div>:null}
  </section>;
}

function SupplierDetail({ supplier, saving, onEdit, onToggleActive }) {
  if (!supplier) {
    return (
      <aside className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        Select a supplier to view its details.
      </aside>
    );
  }

  const details = [
    ["Company / legal name", supplier.company_legal_name],
    ["Contact name", supplier.contact_name],
    ["VAT number", supplier.vat_number],
    ["VAT registered", supplier.vat_registered === false ? "No" : "Yes"],
    ["Address", displayAddress(supplier)],
    ["Phone", supplier.phone],
    ["Email", supplier.email],
    ["Payment terms", supplier.payment_terms],
    ["Default payment method", supplier.default_payment_method],
    ["Bank / payment reference", supplier.bank_payment_reference],
    ["Notes", supplier.notes],
  ];

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-slate-900">
            {supplier.supplier_name}
          </h3>
          <StatusBadge active={supplier.active !== false} />
        </div>
        <button
          type="button"
          onClick={() => onEdit(supplier)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50"
        >
          Edit
        </button>
      </div>

      <dl className="mt-4 space-y-3">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {label}
            </dt>
            <dd className="whitespace-pre-wrap text-sm text-slate-800">
              {value || "—"}
            </dd>
          </div>
        ))}
      </dl>

      <button
        type="button"
        disabled={saving}
        onClick={() => onToggleActive(supplier)}
        className="mt-5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        {supplier.active === false ? "Activate supplier" : "Deactivate supplier"}
      </button>
      <p className="mt-2 text-xs text-slate-500">
        Deactivation preserves historical references and removes the supplier from
        new-selection lists.
      </p>
    </aside>
  );
}

function SupplierForm({
  form,
  errors,
  editing,
  saving,
  onChange,
  onClose,
  onSubmit,
}) {
  const [tab, setTab] = useState("account");
  const tabButton = (key, label) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`border-b-2 px-4 py-2 text-sm font-semibold ${
        tab === key
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/40 sm:items-center sm:p-4">
      <button type="button" aria-label="Close supplier form" className="absolute inset-0" onClick={onClose} />
      <form onSubmit={onSubmit} className="relative mx-auto max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-xl font-bold text-slate-900">{editing ? "Edit supplier" : "Create a new supplier"}</h3>
            <p className="text-xs text-slate-500">Fields marked * are required.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Close</button>
        </header>

        <div className="grid gap-4 px-6 pt-5 md:grid-cols-3">
          <InputField label="Business name *" value={form.supplier_name} error={errors.supplier_name} onChange={(value) => onChange("supplier_name", value)} />
          <InputField label="Email" type="email" value={form.email} error={errors.email} onChange={(value) => onChange("email", value)} />
          <InputField label="Mobile" type="tel" value={form.mobile} onChange={(value) => onChange("mobile", value)} />
          <InputField label="Contact name" value={form.contact_name} onChange={(value) => onChange("contact_name", value)} />
          <InputField label="Reference" value={form.supplier_reference} onChange={(value) => onChange("supplier_reference", value)} />
          <InputField label="Telephone" type="tel" value={form.telephone} onChange={(value) => onChange("telephone", value)} />
        </div>

        <nav className="mt-5 flex border-b border-slate-300 px-6">
          {tabButton("account", "Account Details")}
          {tabButton("payment", "Payment Details")}
          {tabButton("notes", "Notes")}
        </nav>

        <div className="bg-slate-50 px-6 py-5">
          {tab === "account" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 text-sm font-bold text-slate-800">Address</div>
                <InputField label="Address 1" value={form.address_line_1} onChange={(value) => onChange("address_line_1", value)} />
                <InputField label="Address 2" value={form.address_line_2} onChange={(value) => onChange("address_line_2", value)} />
                <InputField label="Town / City" value={form.city} onChange={(value) => onChange("city", value)} />
                <InputField label="County" value={form.county} onChange={(value) => onChange("county", value)} />
                <InputField label="Postcode" value={form.postcode} onChange={(value) => onChange("postcode", value)} />
                <InputField label="Country" value={form.country} onChange={(value) => onChange("country", value)} />
              </section>

              <section className="grid content-start gap-3 sm:grid-cols-2">
                <InputField label="Company / legal name" value={form.company_legal_name} onChange={(value) => onChange("company_legal_name", value)} />
                <InputField label="Account default" value={form.account_default} onChange={(value) => onChange("account_default", value)} />
                <InputField label="VAT number" value={form.vat_number} onChange={(value) => onChange("vat_number", value)} />
                <label className="flex items-center gap-2 pt-6 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={!form.vat_registered} onChange={(e) => onChange("vat_registered", !e.target.checked)} /> Not VAT registered
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:col-span-2">
                  <input type="checkbox" checked={form.import_agent} onChange={(e) => onChange("import_agent", e.target.checked)} /> This supplier is an import agent
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 sm:col-span-2">
                  <input type="checkbox" checked={form.reverse_charge} onChange={(e) => onChange("reverse_charge", e.target.checked)} /> VAT Reverse Charge
                </label>
              </section>
            </div>
          )}

          {tab === "payment" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <section className="space-y-4">
                <h4 className="text-sm font-bold text-slate-800">Payment Terms</h4>
                <InputField label="Payment terms" value={form.payment_terms} onChange={(value) => onChange("payment_terms", value)} />
                <label className="text-sm font-semibold text-slate-800">
                  Default payment method
                  <select value={form.default_payment_method} onChange={(e) => onChange("default_payment_method", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
                    <option value="">No default</option>
                    {SUPPLIER_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                  </select>
                  <FieldError message={errors.default_payment_method} />
                </label>
                <InputField label="Payment reference" value={form.bank_payment_reference} onChange={(value) => onChange("bank_payment_reference", value)} />
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={Boolean(form.credit_terms_enabled)} onChange={(e) => onChange("credit_terms_enabled", e.target.checked)} /> Set credit terms
                </label>
                {form.credit_terms_enabled && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold text-slate-800">Credit terms<select value={form.credit_terms_type} onChange={(e) => onChange("credit_terms_type", e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal"><option value="DAYS_AFTER_INVOICE">Days after invoice date</option><option value="END_NEXT_MONTH">End of next month</option><option value="IMMEDIATE">Immediately</option></select></label>
                    {form.credit_terms_type === "DAYS_AFTER_INVOICE" ? <InputField label="Days" type="number" value={form.credit_terms_days} onChange={(value) => onChange("credit_terms_days", value)} /> : null}
                  </div>
                )}
                <InputField label="Credit limit (£)" type="number" value={form.credit_limit} onChange={(value) => onChange("credit_limit", value)} />
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800"><input type="checkbox" checked={Boolean(form.account_on_hold)} onChange={(e) => onChange("account_on_hold", e.target.checked)} /> Place account on hold</label>
              </section>

              <section className="space-y-3">
                <h4 className="text-sm font-bold text-slate-800">Bank Details</h4>
                <InputField label="Account name" value={form.bank_account_name} onChange={(value) => onChange("bank_account_name", value)} />
                <InputField label="Sort code" value={form.bank_sort_code} onChange={(value) => onChange("bank_sort_code", value)} />
                <InputField label="Account number" value={form.bank_account_number} onChange={(value) => onChange("bank_account_number", value)} />
                <InputField label="BIC / Swift" value={form.bank_bic_swift} onChange={(value) => onChange("bank_bic_swift", value)} />
                <InputField label="IBAN" value={form.bank_iban} onChange={(value) => onChange("bank_iban", value)} />
              </section>
            </div>
          )}

          {tab === "notes" && (
            <label className="block text-sm font-semibold text-slate-800">
              Notes
              <textarea value={form.notes} maxLength={4000} onChange={(e) => onChange("notes", e.target.value)} className="mt-2 min-h-64 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal" placeholder="Any additional information about this supplier..." />
              <span className="mt-1 flex justify-between text-xs font-normal text-slate-500"><FieldError message={errors.notes} /><span>{form.notes.length}/4000</span></span>
            </label>
          )}
        </div>

        <footer className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        </footer>
      </form>
    </div>
  );
}

function InputField({ label, value, onChange, error, type = "text" }) {
  return (
    <label className="text-sm font-semibold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={`mt-1 w-full rounded-lg border px-3 py-2 font-normal ${
          error ? "border-red-500" : "border-slate-300"
        }`}
      />
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }) {
  return message ? (
    <span className="mt-1 block text-xs font-normal text-red-700">{message}</span>
  ) : null;
}

function StatusBadge({ active }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
        active
          ? "bg-emerald-50 text-emerald-800"
          : "bg-slate-200 text-slate-700"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}
