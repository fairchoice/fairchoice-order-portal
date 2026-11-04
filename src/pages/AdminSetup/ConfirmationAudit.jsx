import { useState } from "react";

const AUDIT_SECTIONS = [
  { key: "delivery", title: "Delivery Confirmation", description: "Delivery date, received by, invoice total, invoice date and WhatsApp confirmation." },
  { key: "collection", title: "Collection Confirmation", description: "Collected amount, payment method, outstanding balance and WhatsApp confirmation." },
];

export default function ConfirmationAudit() {
  const [active, setActive] = useState("delivery");
  const selected = AUDIT_SECTIONS.find((section) => section.key === active);
  return (
    <section className="p-4 space-y-4">
      <header><h2 className="text-2xl font-bold">Confirmation Audit</h2><p className="text-sm text-slate-600">Admin review of delivery and collection WhatsApp confirmations.</p></header>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Confirmation audit type">
        {AUDIT_SECTIONS.map((section) => (
          <button key={section.key} type="button" role="tab" aria-selected={active === section.key}
            onClick={() => setActive(section.key)}
            className={`rounded-xl px-4 py-3 font-semibold ${active === section.key ? "bg-blue-800 text-white" : "bg-white border text-slate-700"}`}>
            {section.title}
          </button>
        ))}
      </div>
      <div className="bg-white border rounded-2xl p-5 space-y-2" role="tabpanel">
        <h3 className="font-bold text-lg">{selected.title}</h3>
        <p className="text-sm text-slate-600">{selected.description}</p>
        <p className="text-sm font-semibold text-amber-800">Audit records are not connected yet.</p>
        <p className="text-sm text-slate-600">Pending, staff-confirmed and admin-confirmed notifications will appear here once the persistent audit service and access controls are installed. No delivery or payment data is modified from this screen.</p>
      </div>
    </section>
  );
}
