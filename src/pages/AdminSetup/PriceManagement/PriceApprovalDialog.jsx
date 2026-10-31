export default function PriceApprovalDialog({ approval, onPasswordChange, onApprove, onCancel }) {
  if (!approval) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="price-approval-title"
        onSubmit={(event) => { event.preventDefault(); onApprove(); }}
        onKeyDown={(event) => { if (event.key === "Escape" && !approval.busy) { event.preventDefault(); onCancel(); } }}
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h3 id="price-approval-title" className="text-xl font-extrabold">Approve price update</h3>
        <p className="mt-2 text-sm text-slate-600">{approval.action}</p>
        <label htmlFor="price-approval-password" className="mt-4 block text-sm font-bold">Admin password</label>
        <input id="price-approval-password" type="password" autoComplete="current-password" autoFocus
          value={approval.password} disabled={approval.busy} required
          onChange={(event) => onPasswordChange(event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-300 p-3" />
        {approval.error && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{approval.error}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={approval.busy} className="rounded-xl border px-4 py-2 font-bold">Cancel</button>
          <button type="submit" disabled={approval.busy} className="rounded-xl bg-purple-700 px-4 py-2 font-bold text-white disabled:opacity-50">
            {approval.busy ? "Checking..." : "Approve update"}
          </button>
        </div>
      </form>
    </div>
  );
}
