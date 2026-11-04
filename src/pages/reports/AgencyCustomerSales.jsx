const money = (value) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(Number(value || 0));

export default function AgencyCustomerSales({ data, loading = false, onPage }) {
  const rows = data?.rows || [];
  const page = Number(data?.page || 1);
  const pages = Number(data?.total_pages || 1);
  const total = Number(data?.total_rows || 0);
  const size = Number(data?.page_size || 10);
  return <section className="agency-section" aria-busy={loading} aria-labelledby="agency-customer-sales-title">
    <h2 id="agency-customer-sales-title">Customer sales</h2>
    <p>Sales including VAT for the selected Performance Group, dates, postcode and city. 10 customers per page. Highest sales first; customers with no sales are included.</p>
    <div className="agency-table"><table>
      <thead><tr><th>Customer</th><th>Sales amount</th><th>Invoices / orders</th></tr></thead>
      <tbody>{rows.length ? rows.map((row) => <tr key={row.customer_id}><th scope="row">{row.customer_name || "Unnamed customer"}</th><td>{money(row.sales)}</td><td>{Number(row.invoice_count || 0).toLocaleString("en-GB")}</td></tr>) : <tr><td colSpan={3}>No customers match this selection.</td></tr>}</tbody>
    </table></div>
    <div className="agency-pagination">
      <p aria-live="polite">Showing {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)} of {total} customers<br />Total sales across all pages: <strong>{money(data?.total_sales)}</strong></p>
      <nav aria-label="Customer sales pages">
        <button type="button" disabled={loading || page <= 1} onClick={() => onPage(1)}>First</button>
        <button type="button" disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {pages}</span>
        <button type="button" disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        <button type="button" disabled={loading || page >= pages} onClick={() => onPage(pages)}>Last</button>
      </nav>
    </div>
  </section>;
}
