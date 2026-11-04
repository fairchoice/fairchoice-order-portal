const firstText = (...values) =>
  values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";

const normalizedText = (value) => String(value || "").trim().toLocaleLowerCase("en-GB");

const compareText = (left, right) => normalizedText(left).localeCompare(
  normalizedText(right),
  "en-GB",
  { numeric: true, sensitivity: "base" },
);

export const getWarehouseProductMainCategory = (item = {}) => firstText(
  item.mainCategory,
  item.main_category,
  item.category,
  item.productCategory,
  item.product_category,
  item.product?.mainCategory,
  item.product?.main_category,
  item.product?.category,
  item.products?.mainCategory,
  item.products?.main_category,
  item.products?.category,
);

export const getWarehouseProductSubCategory = (item = {}) => firstText(
  item.subCategory,
  item.sub_category,
  item.subcategory,
  item.productSubCategory,
  item.product_sub_category,
  item.product?.subCategory,
  item.product?.sub_category,
  item.product?.subcategory,
  item.products?.subCategory,
  item.products?.sub_category,
  item.products?.subcategory,
);

export const getWarehouseProductSeries = (item = {}) => firstText(
  item.series,
  item.productSeries,
  item.product_series,
  item.product?.series,
  item.products?.series,
);

export const getWarehouseProductName = (item = {}) => firstText(
  item.productName,
  item.product_name,
  item.name,
  item.product?.productName,
  item.product?.product_name,
  item.product?.name,
  item.products?.productName,
  item.products?.product_name,
  item.products?.name,
);

const stableProductKey = (item = {}) => String(firstText(
  item.sortKey,
  item.productId,
  item.product_id,
  item.orderItemId,
  item.order_item_id,
  item.itemKey,
  item.clientActionId,
  item.client_action_id,
  item.id,
  item.productCode,
  item.product_code,
));

export const compareWarehouseProducts = (left = {}, right = {}) => {
  const leftIsVape = normalizedText(getWarehouseProductMainCategory(left)) === "vape";
  const rightIsVape = normalizedText(getWarehouseProductMainCategory(right)) === "vape";
  const leftGroup = leftIsVape
    ? getWarehouseProductSeries(left)
    : getWarehouseProductSubCategory(left);
  const rightGroup = rightIsVape
    ? getWarehouseProductSeries(right)
    : getWarehouseProductSubCategory(right);

  const comparisons = [
    Number(!String(leftGroup).trim()) - Number(!String(rightGroup).trim()),
    Number(rightIsVape) - Number(leftIsVape),
    compareText(leftGroup, rightGroup),
    compareText(getWarehouseProductName(left), getWarehouseProductName(right)),
    compareText(stableProductKey(left), stableProductKey(right)),
  ];
  return comparisons.find((difference) => difference !== 0) || 0;
};

export const sortWarehouseProducts = (items = []) =>
  [...(items || [])].sort(compareWarehouseProducts);
