export const PRODUCT_PLACEHOLDER_IMAGE = "https://placehold.co/400x300?text=Product";

const PLACEHOLDER_IMAGE_MARKERS = [
  "placehold.co",
  "placeholder",
  "text=product",
  "/product.png",
  "/product-placeholder",
  "/placeholder-product",
  "/default-product",
  "/no-image",
  "no_image",
  "no-image",
  "image-not-found",
];

export const getProductImageValue = (product = {}) =>
  product.image ??
  product.image_url ??
  product.imageUrl ??
  product.product_image ??
  product.productImage ??
  product.image_path ??
  product.imagePath ??
  product.thumbnail ??
  product.thumbnail_url ??
  product.thumbnailUrl ??
  "";

export const isPlaceholderProductImage = (value) => {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return false;
  return PLACEHOLDER_IMAGE_MARKERS.some((marker) => text.includes(marker));
};

export const hasRealProductImage = (product = {}) => {
  const image = String(getProductImageValue(product) || "").trim();
  return Boolean(image) && !isPlaceholderProductImage(image);
};

export const getDisplayProductImage = (product = {}) => {
  const image = String(getProductImageValue(product) || "").trim();
  return image && !isPlaceholderProductImage(image) ? image : PRODUCT_PLACEHOLDER_IMAGE;
};

export const getMissingProductImageReason = (product = {}) => {
  const image = String(getProductImageValue(product) || "").trim();
  if (!image) return "empty image field";
  if (isPlaceholderProductImage(image)) return `placeholder/default image: ${image}`;
  return "";
};
