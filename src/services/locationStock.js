import { supabase } from "./supabase";

const chunkArray = (arr, size = 50) => {
  const chunks = [];

  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }

  return chunks;
};

export async function getActiveStockLocations() {
  const { data, error } = await supabase
    .from("stock_locations")
    .select("id, location_name, country, active")
    .eq("active", true)
    .order("country")
    .order("location_name");

  if (error) throw error;
  return data || [];
}

export async function getProductLocationStock(productIds = []) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueProductIds.length) return [];

  let locationRows = [];

  for (const chunk of chunkArray(uniqueProductIds, 50)) {
    const { data, error } = await supabase
      .from("product_location_stock")
      .select(
        "id, product_id, location_id, qty, low_stock_alert, stock_locations(id, location_name, country, active)"
      )
      .in("product_id", chunk);

    if (error) {
      console.error("Location stock loading error:", error);
      throw error;
    }

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
      id: row.id,
      productId,
      locationId: row.location_id,
      locationName: location.location_name || "",
      country: location.country || "",
      active: location.active !== false,
      qty: Number(row.qty || 0),
      lowStockAlert: Number(row.low_stock_alert || 0),
    };

    return map;
  }, {});
}

export function getCountryLocationStock(product, country) {
  const selectedCountry = String(country || "").trim().toLowerCase();
  const locationStocks = Object.values(product?.locationStocks || {});

  return (
    locationStocks.find(
      (stock) =>
        stock.active !== false &&
        String(stock.country || "").trim().toLowerCase() === selectedCountry
    ) || null
  );
}

export function applyLocationStockToProducts(products = [], country) {
  return products.map((product) => {
    const localStock = getCountryLocationStock(product, country);
    if (!localStock) return product;

    return {
      ...product,
      stock: Number(localStock.qty || 0),
      lowStockAlert: Number(localStock.lowStockAlert || 0),
      stockLocationId: localStock.locationId,
      stockLocationName: localStock.locationName,
      stockCountry: localStock.country,
    };
  });
}

export async function saveProductLocationStock(productId, locationStocks = {}) {
  if (!productId) return;

  const rows = Object.entries(locationStocks)
    .map(([locationId, stock]) => ({
      product_id: productId,
      location_id: locationId,
      qty: Number(stock?.qty || 0),
      low_stock_alert: Number(stock?.lowStockAlert || 0),
      updated_at: new Date().toISOString(),
    }))
    .filter((row) => row.location_id);

  if (!rows.length) return;

  const { error } = await supabase
    .from("product_location_stock")
    .upsert(rows, { onConflict: "product_id,location_id" });

  if (error) throw error;
}


export async function saveStockTakeCounts(locationId, counts = []) {
  if (!locationId) throw new Error("A stock location is required.");

  const rows = counts
    .map((count) => ({
      product_id: count.productId,
      location_id: locationId,
      qty: Number(count.qty),
      updated_at: new Date().toISOString(),
    }))
    .filter(
      (row) =>
        row.product_id &&
        Number.isFinite(row.qty) &&
        row.qty >= 0
    );

  if (!rows.length) return [];

  for (const chunk of chunkArray(rows, 100)) {
    const { error } = await supabase
      .from("product_location_stock")
      .upsert(chunk, { onConflict: "product_id,location_id" });

    if (error) throw error;
  }

  return rows;
}
