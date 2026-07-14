const normalizeSortText = (value) =>
  String(value || "").trim().toLocaleLowerCase("en-GB");

const firstSortValue = (...values) =>
  values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
  ) || "";

export const getPrintItemSeries = (item = {}) =>
  firstSortValue(
    item.series,
    item.product_series,
    item.productSeries,
    item.products?.series,
    item.product?.series
  );

export const getPrintItemBrand = (item = {}) =>
  firstSortValue(
    item.brand,
    item.product_brand,
    item.productBrand,
    item.products?.brand,
    item.product?.brand
  );

export const getPrintItemSubCategory = (item = {}) =>
  firstSortValue(
    item.sub_category,
    item.subCategory,
    item.subcategory,
    item.product_sub_category,
    item.productSubCategory,
    item.products?.sub_category,
    item.products?.subCategory,
    item.products?.subcategory,
    item.product?.sub_category,
    item.product?.subCategory,
    item.product?.subcategory
  );

export const getPrintItemName = (item = {}) =>
  firstSortValue(
    item.product_name,
    item.productName,
    item.name,
    item.description,
    item.products?.product_name,
    item.products?.name,
    item.product?.product_name,
    item.product?.name
  );

export const getPrintItemCode = (item = {}) =>
  firstSortValue(
    item.product_code,
    item.productCode,
    item.code,
    item.sku,
    item.products?.product_code,
    item.products?.code,
    item.products?.sku,
    item.product?.product_code,
    item.product?.code,
    item.product?.sku
  );

const comparePrintText = (left, right) =>
  normalizeSortText(left).localeCompare(
    normalizeSortText(right),
    "en-GB",
    {
      numeric: true,
      sensitivity: "base",
    }
  );

export const comparePrintItems = (left = {}, right = {}) => {
  const comparisons = [
    comparePrintText(
      getPrintItemSeries(left),
      getPrintItemSeries(right)
    ),
    comparePrintText(
      getPrintItemBrand(left),
      getPrintItemBrand(right)
    ),
    comparePrintText(
      getPrintItemSubCategory(left),
      getPrintItemSubCategory(right)
    ),
    comparePrintText(
      getPrintItemName(left),
      getPrintItemName(right)
    ),
    comparePrintText(
      getPrintItemCode(left),
      getPrintItemCode(right)
    ),
  ];

  return comparisons.find((result) => result !== 0) || 0;
};

export const sortPrintItems = (items = []) =>
  [...(items || [])].sort(comparePrintItems);
