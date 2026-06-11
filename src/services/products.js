import { supabase } from "./supabase";

export async function getProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("status", "Active")
    .order("brand", { ascending: true })
    .order("series", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) throw error;

  return (data || []).map((p) => ({
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
  }));
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