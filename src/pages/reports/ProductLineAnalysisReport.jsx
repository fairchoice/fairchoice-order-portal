import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { getFcSessionState } from "../../services/fcSession.js";
import { supabase } from "../../services/supabase.js";

const money = (v) => `£${Number(v || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (v) => Number(v || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 });
const pct = (v) => `${Number(v || 0).toFixed(2)}%`;
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

const tabs = [
  ["overview", "Overview"], ["profitability", "Profitability"], ["movement", "Sales Movement"],
  ["stock", "Stock Position"], ["slow", "Slow / Dead Stock"], ["returns", "Returns Impact"],
  ["supplier", "Supplier Cost"], ["products", "Product Detail"],
];

const PAGE_SIZE = 30;

function health(row) {
  const margin = Number(row.margin_pct || 0), days = Number(row.days_stock || 0), returns = Number(row.return_qty || 0), sold = Number(row.qty_sold || 0);
  const returnRate = sold ? (returns / sold) * 100 : 0;
  if (sold <= 0 && Number(row.stock_qty || 0) > 0) return "Poor";
  if (margin >= 35 && (days === 0 || days <= 45) && returnRate <= 3) return "Excellent";
  if (margin >= 20 && (days === 0 || days <= 60) && returnRate <= 6) return "Healthy";
  if (margin >= 10 && (days === 0 || days <= 90)) return "Watch";
  return "Poor";
}

function Card({ label, value, note }) {
  return <div style={{background:"#fff",border:"1px solid #d8e1eb",borderRadius:10,padding:14,minWidth:0}}><div style={{fontSize:11,color:"#48617d",textTransform:"uppercase"}}>{label}</div><div style={{fontSize:24,fontWeight:800,marginTop:4}}>{value}</div>{note && <div style={{fontSize:11,color:"#60758d",marginTop:3}}>{note}</div>}</div>;
}

function DataTable({ rows = [], columns = [], rowKey }) {
  const [columnFilters,setColumnFilters]=useState({}); const [page,setPage]=useState(1);
  const getFilterValue=(row,c)=>c.filterValue?c.filterValue(row):row?.[c.key];
  const filterOptions=useMemo(()=>Object.fromEntries(columns.map((c)=>{
    const values=[...new Set(rows.map((row)=>getFilterValue(row,c)).filter((v)=>v!==null&&v!==undefined&&String(v).trim()!=="").map((v)=>String(v)))];
    values.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
    return [c.key,values];
  })),[rows,columns]);
  const filteredRows=useMemo(()=>rows.filter((row)=>columns.every((c)=>{const selected=columnFilters[c.key]||""; if(!selected)return true; return String(getFilterValue(row,c)??"")===selected;})),[rows,columns,columnFilters]);
  const pageCount=Math.max(1,Math.ceil(filteredRows.length/PAGE_SIZE)); const currentPage=Math.min(page,pageCount); const visibleRows=filteredRows.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE);
  useEffect(()=>setPage(1),[columnFilters,rows]);
  const ts={width:"100%",borderCollapse:"collapse",fontSize:12}, hs={textAlign:"left",padding:"7px 8px",background:"#eef3f8",borderBottom:"1px solid #d5deea",whiteSpace:"nowrap",verticalAlign:"top"}, ds={padding:"9px 8px",borderBottom:"1px solid #e3e9f0",whiteSpace:"nowrap"}, fs={display:"block",width:"100%",minWidth:82,marginTop:5,padding:"4px 5px",fontSize:10,border:"1px solid #cbd5e1",borderRadius:4,background:"white"};
  return <div><div style={{overflowX:"auto"}}><table style={ts}><thead><tr>{columns.map(c=><th key={c.key} style={hs}><div>{c.label}</div><select value={columnFilters[c.key]||""} onChange={e=>setColumnFilters(o=>({...o,[c.key]:e.target.value}))} style={fs}><option value="">All</option>{(filterOptions[c.key]||[]).map((value)=><option key={value} value={value}>{value}</option>)}</select></th>)}</tr></thead><tbody>{visibleRows.map((r,i)=><tr key={rowKey?rowKey(r,i):i}>{columns.map(c=><td key={c.key} style={ds}>{c.render?c.render(r):r?.[c.key]}</td>)}</tr>)}</tbody></table></div><div style={{display:"flex",justifyContent:"space-between",padding:"10px 4px 2px",fontSize:12}}><span>Showing {filteredRows.length?((currentPage-1)*PAGE_SIZE)+1:0}-{Math.min(currentPage*PAGE_SIZE,filteredRows.length)} of {filteredRows.length} · Max {PAGE_SIZE} per page</span><div><button onClick={()=>setPage(v=>Math.max(1,v-1))} disabled={currentPage<=1}>Previous</button> {Array.from({length:pageCount},(_,i)=>i+1).map(n=><button key={n} onClick={()=>setPage(n)} style={{fontWeight:n===currentPage?800:400,marginLeft:4}}>{n}</button>)} <button onClick={()=>setPage(v=>Math.min(pageCount,v+1))} disabled={currentPage>=pageCount}>Next</button></div></div></div>;
}

export default function ProductLineAnalysisReport({ currentUser }) {
  const [filters,setFilters] = useState({dateFrom:daysAgo(30),dateTo:today(),country:"All",productLine:"All",supplier:"All",product:""});
  const [data,setData] = useState({}); const [loading,setLoading] = useState(false); const [error,setError] = useState(""); const [tab,setTab] = useState("overview");
  const rows = data?.rows || {}; const summary = data?.summary || {}; const filterData = data?.filters || {};

  async function run() {
    setLoading(true); setError("");
    try {
      const session = getFcSessionState(currentUser);
      if (!session.valid) throw new Error("A valid Fair Choice staff session is required.");
      const {data:result,error:rpcError} = await supabase.rpc("fc_product_line_analysis_v1",{
        p_username:session.username,p_session_token:session.token,p_date_from:filters.dateFrom,p_date_to:filters.dateTo,
        p_country:filters.country==="All"?null:filters.country,p_product_line:filters.productLine==="All"?null:filters.productLine,
        p_supplier:filters.supplier==="All"?null:filters.supplier,p_product:filters.product.trim()||null,
      });
      if (rpcError) throw rpcError; setData(result || {});
    } catch(e) { setError(e.message || "Could not load Product Line Analysis."); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ run(); },[]);

  const lines = rows.lines || [], products = rows.products || [], slow = rows.slow_stock || [], supplierCosts = rows.supplier_costs || [], trend = rows.trend || [];
  const lineOptions = filterData.product_lines || [], supplierOptions = filterData.suppliers || [];
  const bestLine = useMemo(()=>[...lines].sort((a,b)=>Number(b.gross_profit)-Number(a.gross_profit))[0], [lines]);

  function exportExcel() {
    if (!window.confirm("Download Product Line Analysis Excel report?")) return;
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(lines.map(r=>({"Product Line":r.product_line,Products:r.products,"Units Sold":r.qty_sold,"Net Sales":Number(r.net_sales),COGS:Number(r.cogs),"Gross Profit":Number(r.gross_profit),"Margin %":Number(r.margin_pct),Returns:r.return_qty,"Stock Qty":r.stock_qty,"Stock Value":Number(r.stock_value),"Days Stock":r.days_stock,Health:health(r)}))),"Product Lines");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(products),"Product Detail");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(slow),"Slow Dead Stock");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(supplierCosts),"Supplier Costs");
    XLSX.writeFile(wb,`FairChoice_Product_Line_Analysis_${filters.dateFrom}_${filters.dateTo}.xlsx`);
  }

  function printReport() {
    if (!window.confirm("Open printable Product Line Analysis / PDF report?")) return;
    const w=window.open("","_blank"); if(!w){alert("Please allow pop-ups for the printable report.");return;} w.opener=null;
    const body=lines.map(r=>`<tr><td>${r.product_line}</td><td>${num(r.qty_sold)}</td><td>${money(r.net_sales)}</td><td>${money(r.cogs)}</td><td>${money(r.gross_profit)}</td><td>${pct(r.margin_pct)}</td><td>${num(r.stock_qty)}</td><td>${money(r.stock_value)}</td><td>${health(r)}</td></tr>`).join("");
    w.document.write(`<!doctype html><html><head><title>Product Line Analysis</title><style>body{font-family:Arial;padding:28px;color:#172033}h1{margin:0 0 4px}small{color:#60758d}table{width:100%;border-collapse:collapse;margin-top:22px;font-size:11px}th,td{border:1px solid #ccd6e2;padding:7px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#eef3f8}.summary{display:flex;gap:24px;margin-top:18px}.summary b{font-size:18px}</style></head><body><h1>FairChoice Product Line Analysis</h1><small>${filters.dateFrom} to ${filters.dateTo} · ${filters.country}</small><div class="summary"><div>Net Sales<br><b>${money(summary.net_sales)}</b></div><div>Gross Profit<br><b>${money(summary.gross_profit)}</b></div><div>Margin<br><b>${pct(summary.margin_pct)}</b></div><div>Stock Value<br><b>${money(summary.stock_value)}</b></div></div><table><thead><tr><th>Product Line</th><th>Units</th><th>Net Sales</th><th>COGS</th><th>Profit</th><th>Margin</th><th>Stock</th><th>Stock Value</th><th>Health</th></tr></thead><tbody>${body}</tbody></table></body></html>`); w.document.close(); setTimeout(()=>{w.focus();w.print();},300);
  }

  const lineColumns=[{key:"product_line",label:"Product Line",render:r=><b>{r.product_line}</b>},{key:"products",label:"Products"},{key:"qty_sold",label:"Units Sold",render:r=>num(r.qty_sold)},{key:"net_sales",label:"Net Sales",render:r=>money(r.net_sales)},{key:"cogs",label:"COGS",render:r=>money(r.cogs)},{key:"gross_profit",label:"Gross Profit",render:r=>money(r.gross_profit)},{key:"margin_pct",label:"Margin",render:r=>pct(r.margin_pct)},{key:"return_qty",label:"Returns",render:r=>num(r.return_qty)},{key:"stock_qty",label:"Stock",render:r=>num(r.stock_qty)},{key:"stock_value",label:"Stock Value",render:r=>money(r.stock_value)},{key:"days_stock",label:"Days Stock",render:r=>r.days_stock==null?"-":num(r.days_stock)},{key:"health",label:"Health",filterValue:r=>health(r),render:r=><b>{health(r)}</b>}];
  const movementColumns=[{key:"sale_date",label:"Date"},{key:"product_line",label:"Product Line"},{key:"qty_sold",label:"Units",render:r=>num(r.qty_sold)},{key:"net_sales",label:"Net Sales",render:r=>money(r.net_sales)},{key:"cogs",label:"COGS",render:r=>money(r.cogs)},{key:"gross_profit",label:"Gross Profit",render:r=>money(r.gross_profit)}];
  const slowColumns=[{key:"product_name",label:"Product"},{key:"product_code",label:"Code"},{key:"product_line",label:"Product Line"},{key:"qty_sold",label:"Units Sold",render:r=>num(r.qty_sold)},{key:"stock_qty",label:"Stock",render:r=>num(r.stock_qty)},{key:"stock_value",label:"Stock Value",render:r=>money(r.stock_value)},{key:"days_stock",label:"Days Stock",render:r=>r.days_stock==null?"Dead":num(r.days_stock)},{key:"last_sale",label:"Last Sale"}];
  const supplierColumns=[{key:"product_name",label:"Product"},{key:"product_code",label:"Code"},{key:"product_line",label:"Product Line"},{key:"suppliers",label:"Suppliers"},{key:"min_supplier_cost",label:"Min Cost",render:r=>money(r.min_supplier_cost)},{key:"avg_supplier_cost",label:"Average Cost",render:r=>money(r.avg_supplier_cost)},{key:"max_supplier_cost",label:"Max Cost",render:r=>money(r.max_supplier_cost)}];
  const productColumns=[{key:"product_name",label:"Product"},{key:"product_code",label:"Code"},{key:"product_line",label:"Product Line"},{key:"qty_sold",label:"Units",render:r=>num(r.qty_sold)},{key:"adjusted_sales",label:"Net Sales",render:r=>money(r.adjusted_sales)},{key:"cogs",label:"COGS",render:r=>money(r.cogs)},{key:"gross_profit",label:"Profit",render:r=>money(r.gross_profit)},{key:"margin_pct",label:"Margin",render:r=>pct(r.margin_pct)},{key:"return_qty",label:"Returns",render:r=>num(r.return_qty)},{key:"stock_qty",label:"Stock",render:r=>num(r.stock_qty)},{key:"stock_value",label:"Stock Value",render:r=>money(r.stock_value)},{key:"days_stock",label:"Days Stock",render:r=>r.days_stock==null?"-":num(r.days_stock)}];
  const lineTable=(list=lines)=><DataTable rows={list} columns={lineColumns} rowKey={r=>r.product_line}/>;

  return <div style={{padding:20,background:"#f3f6fa",minHeight:"100vh",color:"#101827"}}>
    <section style={{background:"white",border:"1px solid #d8e1eb",borderRadius:12,padding:16}}><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"start",flexWrap:"wrap"}}><div><h1 style={{margin:0,fontSize:25}}>Product Line Analysis</h1><div style={{fontSize:12,color:"#536a83",marginTop:4}}>Sales, profitability, stock movement, returns and supplier-cost performance by product line.</div></div><div style={{display:"flex",gap:8}}><button onClick={exportExcel} title="Download the current Product Line Analysis as an Excel workbook." style={{padding:"9px 13px",fontWeight:700}}>Download Excel</button><button onClick={printReport} title="Open a printable report that can be saved as PDF." style={{padding:"9px 13px",fontWeight:700}}>Printable / PDF</button></div></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(130px,1fr))",gap:10,marginTop:16}}>
        <label>Date From<input type="date" value={filters.dateFrom} onChange={e=>setFilters({...filters,dateFrom:e.target.value})} style={{width:"100%"}}/></label><label>Date To<input type="date" value={filters.dateTo} onChange={e=>setFilters({...filters,dateTo:e.target.value})} style={{width:"100%"}}/></label>
        <label>Country<select value={filters.country} onChange={e=>setFilters({...filters,country:e.target.value})} style={{width:"100%"}}><option>All</option><option>England</option><option>Wales</option></select></label>
        <label>Product Line<select value={filters.productLine} onChange={e=>setFilters({...filters,productLine:e.target.value})} style={{width:"100%"}}><option>All</option>{lineOptions.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Supplier<select value={filters.supplier} onChange={e=>setFilters({...filters,supplier:e.target.value})} style={{width:"100%"}}><option>All</option>{supplierOptions.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Product<input value={filters.product} placeholder="Name or code" onChange={e=>setFilters({...filters,product:e.target.value})} style={{width:"100%"}}/></label>
      </div><div style={{marginTop:12,display:"flex",gap:8}}><button onClick={run} disabled={loading} style={{padding:"9px 15px",fontWeight:800}}>{loading?"Running...":"Run Product Line Analysis"}</button><button onClick={()=>setFilters({dateFrom:daysAgo(30),dateTo:today(),country:"All",productLine:"All",supplier:"All",product:""})}>Reset</button></div>{error&&<div style={{marginTop:12,padding:10,border:"1px solid #ef9a9a",background:"#fff1f1",color:"#a40000"}}>{error}</div>}</section>

    <div style={{display:"grid",gridTemplateColumns:"repeat(8,minmax(120px,1fr))",gap:10,marginTop:12}}><Card label="Net Sales" value={money(summary.net_sales)}/><Card label="COGS" value={money(summary.cogs)}/><Card label="Gross Profit" value={money(summary.gross_profit)} note={`${pct(summary.margin_pct)} margin`}/><Card label="Units Sold" value={num(summary.qty_sold)}/><Card label="Returns" value={num(summary.return_qty)} note={money(summary.returns_net)}/><Card label="Stock Qty" value={num(summary.stock_qty)}/><Card label="Stock Value" value={money(summary.stock_value)}/><Card label="Product Lines" value={num(summary.product_lines)} note={bestLine?`Top profit: ${bestLine.product_line}`:""}/></div>

    <div style={{display:"flex",gap:4,flexWrap:"wrap",background:"white",border:"1px solid #d8e1eb",borderRadius:10,padding:7,marginTop:12}}>{tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)} title={{overview:"Summary ranking and Product Line Health.",profitability:"Rank product lines by profit and margin.",movement:"Daily sales movement by product line.",stock:"Current stock quantity, value and stock cover.",slow:"Products holding stock with low or no movement.",returns:"Return quantity and value impact by product line.",supplier:"Current supplier cost range and supplier coverage.",products:"Drill down to individual product performance."}[k]} style={{padding:"8px 12px",fontWeight:tab===k?800:600,background:tab===k?"#13213b":"transparent",color:tab===k?"white":"#172033",borderRadius:7,border:0}}>{l}</button>)}</div>

    <section style={{background:"white",border:"1px solid #d8e1eb",borderRadius:10,marginTop:12,padding:10}}>
      {tab==="overview"&&lineTable()}
      {tab==="profitability"&&lineTable([...lines].sort((a,b)=>Number(b.gross_profit)-Number(a.gross_profit)))}
      {tab==="stock"&&lineTable([...lines].sort((a,b)=>Number(b.stock_value)-Number(a.stock_value)))}
      {tab==="returns"&&lineTable([...lines].sort((a,b)=>Number(b.returns_net)-Number(a.returns_net)))}
      {tab==="movement"&&<DataTable rows={trend} columns={movementColumns} rowKey={(r,i)=>`${r.sale_date}-${r.product_line}-${i}`}/>}
      {tab==="slow"&&<DataTable rows={slow} columns={slowColumns} rowKey={(r)=>r.product_id}/>}
      {tab==="supplier"&&<DataTable rows={supplierCosts} columns={supplierColumns} rowKey={(r)=>r.product_id}/>}
      {tab==="products"&&<DataTable rows={products} columns={productColumns} rowKey={(r)=>r.product_id}/>}
    </section>
  </div>;
}
