// Load every input used for repricing together. Raw product rows do not contain
// exact customer-code prices, and pricing_settings does not contain the codes.
export async function loadOrderPricingContext(productIds = [], { client } = {}) {
  if (!client) throw new Error("A database client is required to refresh order prices.");
  const ids = [...new Set(productIds.filter(Boolean).map(String))];
  if (!ids.length) return { products: [], settings: {} };
  async function readPages(table, configure = query => query) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await configure(client.from(table).select("*"))
        .order("id").range(offset, offset + 499);
      if (error) throw new Error(`Could not refresh ${table}: ${error.message}`);
      rows.push(...(data || []));
      if ((data || []).length < 500) return rows;
    }
  }
  const [{ data: settings, error }, codes] = await Promise.all([
    client.from("pricing_settings").select("*").eq("id", 1).maybeSingle(),
    readPages("customer_price_codes", query => query.eq("active", true)),
  ]);
  if (error || !settings) throw new Error(`Could not refresh pricing settings: ${error?.message || "settings not found"}`);
  const products = [];
  for (let index = 0; index < ids.length; index += 50) {
    const chunk = ids.slice(index, index + 50);
    const [rows, exactPrices] = await Promise.all([
      readPages("products", query => query.in("id", chunk)),
      readPages("product_price_code_prices", query => query.in("product_id", chunk).eq("active", true)),
    ]);
    const byProduct = new Map();
    for (const row of exactPrices) {
      const key = String(row.product_id);
      if (!byProduct.has(key)) byProduct.set(key, {});
      byProduct.get(key)[String(row.price_code_id)] = Number(row.price);
    }
    products.push(...rows.map(product => ({ ...product, priceCodePrices: byProduct.get(String(product.id)) || {} })));
  }
  if (products.length !== ids.length) throw new Error("A selected product is unavailable. Refresh the price review.");
  return { products, settings: { ...settings, price_codes: codes } };
}
