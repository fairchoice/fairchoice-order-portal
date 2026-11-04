import { AGENCY_GROUP_PERMISSIONS, AGENCY_SHARED_PERMISSION } from "../../utils/performanceGroups.js";

export default function AgencyAccessOptions({ selectedKeys, disabled = false, onToggle }) {
  const checkbox = (key, label) => <label key={key} className="flex items-center gap-2 rounded-lg border bg-white p-3">
    <input type="checkbox" checked={disabled || selectedKeys.has(key)} disabled={disabled} onChange={() => onToggle(key)} />
    <span className="text-sm font-semibold">{label}</span>
  </label>;
  return <section className="my-4 rounded-xl border border-blue-200 bg-blue-50 p-4" aria-labelledby="agency-access-title">
    <h3 id="agency-access-title" className="font-extrabold text-slate-900">Agencies</h3>
    <p className="mb-3 text-sm text-slate-600">Choose the Performance Groups this user can view. Several users can share the same group. No group selected means no agency report data. Other application pages keep their separate permissions.</p>
    <div className="grid gap-2 md:grid-cols-2">{AGENCY_GROUP_PERMISSIONS.map(({ key, label }) => checkbox(key, label))}</div>
    <div className="mt-3 border-t border-blue-200 pt-3">
      {checkbox(AGENCY_SHARED_PERMISSION, "Shared country stock and business expenses")}
      <p className="mt-2 text-xs text-slate-600">Optional: these figures cover the country or whole business and are not allocated to individual agencies. Master Admin and Super Admin have all agency access automatically.</p>
    </div>
  </section>;
}
