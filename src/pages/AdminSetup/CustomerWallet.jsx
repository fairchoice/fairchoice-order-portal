import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../../services/supabase.js";
import { getFcSessionState } from "../../services/fcSession.js";
import { formatCurrency } from "../../utils/currency";

const money = (v) => formatCurrency(Number(v || 0));
const dateTime = (v) => v ? new Date(v).toLocaleString("en-GB") : "-";

export default function CustomerWallet({ currentUser }) {
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState("");
  const [balanceFilter, setBalanceFilter] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [applyAmount, setApplyAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  const session = useMemo(() => getFcSessionState(currentUser), [currentUser]);

  const loadAccounts = useCallback(async () => {
    if (!session.valid) return;
    setLoading(true); setError("");
    try {
      const { data, error: rpcError } = await supabase.rpc("fc_list_customer_wallet_accounts_v1", {
        p_username: session.username, p_session_token: session.token,
      });
      if (rpcError) throw rpcError;
      setAccounts(Array.isArray(data) ? data : []);
    } catch (e) { setError(e.message || "Could not load customer wallets."); }
    finally { setLoading(false); }
  }, [session.valid, session.token, session.username]);

  const loadDetail = useCallback(async (customerAccountId) => {
    if (!session.valid || !customerAccountId) return;
    setError("");
    const { data, error: rpcError } = await supabase.rpc("fc_get_customer_wallet_detail_v1", {
      p_username: session.username, p_session_token: session.token,
      p_customer_account_id: customerAccountId,
    });
    if (rpcError) { setError(rpcError.message); return; }
    setDetail(data || null);
    setSelectedInvoiceId(""); setApplyAmount("");
  }, [session.valid, session.token, session.username]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);
  useEffect(() => { if (selectedId) loadDetail(selectedId); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      const matches = !q || [a.customer_name, a.customer_code, a.country].some((v) => String(v || "").toLowerCase().includes(q));
      const balance = Number(a.wallet_balance || 0);
      const balanceOk = balanceFilter === "all" || (balanceFilter === "positive" ? balance > 0 : balance <= 0);
      return matches && balanceOk;
    });
  }, [accounts, search, balanceFilter]);

  const selectedAccount = accounts.find((a) => a.customer_account_id === selectedId);
  const invoices = Array.isArray(detail?.recent_invoices) ? detail.recent_invoices : [];
  const transactions = Array.isArray(detail?.transactions) ? detail.transactions : [];

  const applyWallet = async () => {
    if (!selectedInvoiceId) return;
    setApplying(true); setError("");
    try {
      const amount = Number(applyAmount || 0);
      const { error: rpcError } = await supabase.rpc("fc_apply_customer_wallet_to_invoice_v1", {
        p_username: session.username,
        p_session_token: session.token,
        p_invoice_id: selectedInvoiceId,
        p_amount: amount > 0 ? amount : null,
      });
      if (rpcError) throw rpcError;
      await Promise.all([loadAccounts(), loadDetail(selectedId)]);
    } catch (e) { setError(e.message || "Wallet could not be applied."); }
    finally { setApplying(false); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-2xl font-black text-slate-900">Customer Wallet</h2><p className="text-sm text-slate-500">Monitor return credits and apply Wallet money to customer invoices.</p></div>
          <button onClick={loadAccounts} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Refresh</button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search customer, code or country" className="rounded-xl border border-slate-300 px-4 py-3" />
          <select value={balanceFilter} onChange={(e)=>setBalanceFilter(e.target.value)} className="rounded-xl border border-slate-300 px-3 py-3">
            <option value="all">All customers</option><option value="positive">Wallet balance &gt; £0</option><option value="zero">No available balance</option>
          </select>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-700">{error}</div>}

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b bg-slate-50 px-4 py-3 text-sm font-black text-slate-700">Customers {loading ? "· Loading..." : `· ${filtered.length}`}</div>
          <div className="max-h-[650px] overflow-auto">
            {filtered.map((a) => <button key={a.customer_account_id} onClick={()=>setSelectedId(a.customer_account_id)} className={`grid w-full grid-cols-[1fr_auto] gap-3 border-b px-4 py-3 text-left hover:bg-blue-50 ${selectedId===a.customer_account_id?"bg-blue-50":""}`}>
              <div><div className="font-extrabold text-slate-900">{a.customer_name}</div><div className="text-xs text-slate-500">{a.customer_code || "No code"} · {a.country || "-"}</div></div>
              <div className="text-right"><div className={`font-black ${Number(a.wallet_balance)>0?"text-emerald-700":"text-slate-700"}`}>{money(a.wallet_balance)}</div><div className="text-xs text-slate-400">{dateTime(a.last_wallet_activity)}</div></div>
            </button>)}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-xs font-black uppercase text-slate-500">Selected Customer</div>
            <div className="mt-1 text-xl font-black">{selectedAccount?.customer_name || "Select a customer"}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-emerald-50 p-3"><div className="text-xs font-bold text-emerald-700">Available</div><div className="font-black text-emerald-800">{money(detail?.balance)}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-slate-500">Credits</div><div className="font-black">{money(selectedAccount?.wallet_credits)}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-bold text-slate-500">Used</div><div className="font-black">{money(selectedAccount?.wallet_debits)}</div></div></div>
          </div>

          {selectedId && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-black text-slate-900">Apply Wallet to Invoice</h3><p className="mt-1 text-xs text-slate-500">If you do not choose an invoice manually, Wallet applies automatically to today&apos;s current unpaid invoice. If today&apos;s invoice is already paid, Wallet stays available for the next invoice unless you deliberately select today&apos;s paid invoice below. Applying to today&apos;s paid invoice keeps the PAID watermark.</p>
            <select value={selectedInvoiceId} onChange={(e)=>setSelectedInvoiceId(e.target.value)} className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-3">
              <option value="">Select one of the last 2 invoices</option>
              {invoices.map((i)=><option key={i.id} value={i.id}>{i.invoice_number} · Invoice {money(i.invoice_total)} · {i.is_today_paid ? "TODAY PAID · PAID watermark kept" : `Outstanding ${money(i.outstanding_amount)}`}</option>)}
            </select>
            <div className="mt-3 flex gap-2"><input type="number" min="0" step="0.01" value={applyAmount} onChange={(e)=>setApplyAmount(e.target.value)} placeholder="Amount (blank = maximum available)" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2"/><button disabled={!selectedInvoiceId || applying || Number(detail?.balance||0)<=0} onClick={applyWallet} className="rounded-xl bg-emerald-700 px-4 py-2 font-black text-white disabled:bg-slate-300">{applying?"Applying...":"Apply Return"}</button></div>
          </div>}

          {selectedId && <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black">Wallet History</h3><div className="mt-3 max-h-72 overflow-auto">{transactions.length===0?<div className="text-sm text-slate-500">No Wallet transactions.</div>:transactions.map((t)=><div key={t.id} className="flex justify-between gap-3 border-b py-2 text-sm"><div><div className="font-bold">{t.reference || t.transaction_type}</div><div className="text-xs text-slate-500">{t.notes || t.source_type} · {dateTime(t.created_at)}</div></div><div className={`font-black ${t.direction==="CREDIT"?"text-emerald-700":"text-red-700"}`}>{t.direction==="CREDIT"?"+":"-"}{money(t.amount)}</div></div>)}</div></div>}
        </div>
      </div>
    </div>
  );
}
