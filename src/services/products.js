import { supabase } from "./supabase";
import {
  buildLocationStockMap,
  getProductLocationStock,
} from "./locationStock";

function normalizeProduct(p, locationStocksByProduct = {}) {
  return {
    ...p,

    productCode: p.product_code,
    name: p.product_name,
    category: p.main_category,
    subCategory: p.sub_category,
    image: p.image_url,

    cashPrice: p.cash_price,
    vatPrice: p.vat_price,
    cartonSize: p.carton_size,
    lowStockAlert: p.low_stock_alert,
    vatType: p.vat_type,

    availableInEngland: p.available_in_england,
    availableInWales: p.available_in_wales,
    availableFromSupplier: p.available_from_supplier,
    costPrice: p.cost_price,
    supplierName: p.supplier_name,
    salesAccount: p.sales_account,
    purchaseAccount: p.purchase_account,

    isNew: Boolean(p.is_new),
    isPromotion: Boolean(p.is_promotion),
    isReduced: Boolean(p.is_reduced),
    comingSoon: Boolean(p.coming_soon),
    recommended: Boolean(p.recommended),
    topSeller: Boolean(p.top_seller),
    active: String(p.status || "Active").trim().toLowerCase() !== "inactive",
    locationStocks: locationStocksByProduct[p.id] || {},
  };
}

export async function getProducts() {
  const { data, error } = await supabase
    .from("products")
    .select(
      [
        "id",
        "product_code",
        "product_name",
        "main_category",
        "sub_category",
        "brand",
        "series",
        "flavour",
        "cash_price",
        "vat_price",
        "carton_size",
        "image_url",
        "stock",
        "low_stock_alert",
        "status",
        "available_in_england",
        "available_in_wales",
        "vat_type",
        "available_from_supplier",
        "cost_price",
        "supplier_name",
        "sales_account",
        "purchase_account",
        "is_new",
        "is_promotion",
        "is_reduced",
        "coming_soon",
        "recommended",
        "top_seller",
      ].join(",")
    )
    .order("brand", { ascending: true })
    .order("series", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) throw error;

  let locationStocksByProduct = {};

  try {
    const productIds = (data || []).map((product) => product.id).filter(Boolean);
    const stockRows = await getProductLocationStock(productIds);
    locationStocksByProduct = buildLocationStockMap(stockRows);
  } catch (locationStockError) {
    console.error("Location stock loading error:", locationStockError);
  }

  return (data || []).map((product) =>
    normalizeProduct(product, locationStocksByProduct)
  );
}

export async function uploadProductImage(file, productCode) {
  if (!file || !productCode) return null;

  const fileExt = file.name.split(".").pop();
  const fileName = `${productCode}.${fileExt}`;
  const filePath = fileName;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("product-images")
    .getPublicUrl(filePath);

  return data.publicUrl;
}
