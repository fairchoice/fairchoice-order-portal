const money = value => new Intl.NumberFormat("en-GB", {style:"currency",currency:"GBP"}).format(Number(value || 0));
export default function AgencyEarnings({data}) {
  if (!data) return null;
  const incomplete = Number(data.missing_cost_lines || 0) + Number(data.unmapped_invoices || 0) + Number(data.unknown_returns || 0) > 0;
  const cards = [
    ["Net sales excluding VAT", money(data.net_sales_ex_vat), "Selected dates and area, after confirmed return credits"],
    ["Estimated cost of goods", money(data.known_cost_of_goods), incomplete ? "Known costs only; cost coverage is incomplete" : "Historical weighted receipt costs, with current product cost fallback"],
    ["Return credits excluding VAT", money(data.return_credits_ex_vat), "Confirmed customer credits; reversed returns excluded"],
    ["Estimated gross profit", data.gross_profit == null ? "Unavailable" : money(data.gross_profit), "Net sales less estimated cost of goods"],
    ["Agency expenses", money(data.agency_expenses), "Posted expenses assigned to this whole Performance Group · selected dates"],
    ["Estimated earnings after expenses", data.net_earnings == null ? "Unavailable" : money(data.net_earnings), data.area_filtered ? "Clear city and postcode filters: expenses are allocated to the whole agency" : "Gross profit less agency expenses; excludes shared / unassigned expenses"],
  ];
  return <section className="agency-section" aria-labelledby="agency-earnings-title">
    <h2 id="agency-earnings-title">Profit and expenses</h2>
    <div className="agency-cards">{cards.map(([label,value,note])=><article key={label}><h3>{label}</h3><strong>{value}</strong><p>{note}</p></article>)}</div>
    {incomplete && <p role="status">Profit is unavailable until these records are resolved: {Number(data.missing_cost_lines || 0)} missing line costs, {Number(data.unmapped_invoices || 0)} invoices without usable lines and {Number(data.unknown_returns || 0)} returns without tax totals. Missing costs are not treated as profit.</p>}
    <p>{Number(data.fallback_cost_lines || 0)} lines use current product costs. These figures are estimates: returned-stock cost recovery and shared / unassigned expenses are not included. Use Expenses → Agency to allocate expenses; an expense approver can assign existing posted expenses from View.</p>
  </section>;
}
