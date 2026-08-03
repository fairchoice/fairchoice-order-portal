import { supabase } from "./supabase.js";

const chunkArray = (arr, size = 50) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

export function normalizeInventoryCountry(value) {
  const key = String(value || "").trim().toUpperCase().replace(/_/g, "-");
  if (["ENGLAND", "ENG", "GB-ENG"].includes(key)) return "England";
  if (["WALES", "WLS", "GB-WLS"].includes(key)) return "Wales";
  return "";
}

export function resolveOrderInventoryCountry(order = {}) {
  return normalizeInventoryCountry(
    order.delivery_country || order.deliveryCountry ||
    order.branch_country || order.branchCountry ||
    order.customer_country || order.customerCountry ||
    order.country
  );
}

export async function getActiveStockLocations() {
  const { data, error } = await supabase.from("stock_locations").select("id, location_name, country, active").eq("active", true).order("country").order("location_name");
  if (error) throw error;
  return data || [];
}

export async function getProductLocationStock(productIds = []) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueProductIds.length) return [];
  let locationRows = [];
  for (const chunk of chunkArray(uniqueProductIds, 50)) {
    const { data, error } = await supabase.from("product_location_stock").select("id, product_id, location_id, qty, low_stock_alert, stock_locations(id, location_name, country, active)").in("product_id", chunk);
    if (error) throw error;
    locationRows = [...locationRows, ...(data || [])];
  }
  return locationRows;
}

export function buildLocationStockMap(stockRows = []) {
  return stockRows.reduce((map, row) => {
    const productId = row.product_id;
    const location = row.stock_locations || {};
    if (!productId || !row.location_id) return map;
    if (!map[productId]) map[productId] = {};
    map[productId][row.location_id] = {
      id: row.id, productId, locationId: row.location_id,
      locationName: location.location_name || "", country: normalizeInventoryCountry(location.country),
      active: location.active !== false, qty: Number(row.qty ?? 0), lowStockAlert: Number(row.low_stock_alert ?? 0),
    };
    return map;
  }, {});
}

export function getCountryLocationStock(product, country) {
  const selectedCountry = normalizeInventoryCountry(country);
  if (!selectedCountry) return null;

  const locationStocks = Object.values(product?.locationStocks || {});
  const exactStock = locationStocks.find(
    (stock) => stock.active !== false && normalizeInventoryCountry(stock.country) === selectedCountry
  );
  if (exactStock) return exactStock;

  // Controlled compatibility path for products that have never been migrated to
  // location inventory. Never use legacy stock when any location row already
  // exists, because that could duplicate stock between England and Wales.
  if (locationStocks.length === 0) {
    const availableInCountry = selectedCountry === "Wales"
      ? product?.availableInWales !== false && product?.available_in_wales !== false
      : product?.availableInEngland !== false && product?.available_in_england !== false;
    const legacyQty = Number(product?.stock);
    if (availableInCountry && Number.isFinite(legacyQty) && legacyQty >= 0) {
      return {
        id: null,
        productId: product?.id || null,
        locationId: null,
        locationName: `${selectedCountry} inventory (legacy migration pending)`,
        country: selectedCountry,
        active: true,
        qty: legacyQty,
        lowStockAlert: Number(product?.lowStockAlert ?? product?.low_stock_alert ?? 0),
        legacyFallback: true,
      };
    }
  }

  return null;
}

export function applyLocationStockToProducts(products = [], country) {
  const selectedCountry = normalizeInventoryCountry(country);
  return products.map((product) => {
    const localStock = getCountryLocationStock(product, selectedCountry);
    return {
      ...product,
      stock: localStock ? Number(localStock.qty ?? 0) : 0,
      lowStockAlert: localStock ? Number(localStock.lowStockAlert ?? 0) : 0,
      stockLocationId: localStock?.locationId || null,
      stockLocationName: localStock?.locationName || "",
      stockCountry: localStock?.country || selectedCountry,
      inventoryLocationMissing: !localStock,
      inventoryLocationBootstrapRequired: Boolean(localStock?.legacyFallback),
    };
  });
}

export async function saveProductLocationStock(productId, locationStocks = {}) {
  if (!productId) return;
  const rows = Object.entries(locationStocks).map(([locationId, stock]) => ({ product_id: productId, location_id: locationId, qty: Number(stock?.qty || 0), low_stock_alert: Number(stock?.lowStockAlert || 0), updated_at: new Date().toISOString() })).filter((row) => row.location_id);
  if (!rows.length) return;
  const { error } = await supabase.from("product_location_stock").upsert(rows, { onConflict: "product_id,location_id" });
  if (error) throw error;
}

export async function saveStockTakeCounts(locationId, counts = []) {
  if (!locationId) throw new Error("A stock location is required.");
  const rows = counts.map((count) => ({ product_id: count.productId, location_id: locationId, qty: Number(count.qty), updated_at: new Date().toISOString() })).filter((row) => row.product_id && Number.isFinite(row.qty) && row.qty >= 0);
  for (const chunk of chunkArray(rows, 100)) {
    const { error } = await supabase.from("product_location_stock").upsert(chunk, { onConflict: "product_id,location_id" });
    if (error) throw error;
  }
  return rows;
}
