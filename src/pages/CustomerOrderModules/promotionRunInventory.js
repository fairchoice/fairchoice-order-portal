const number = (value) => Number(value || 0);
const text = (value) => String(value || "").trim();

export const PROMOTION_RUN_TYPES = {
  BULK_FREE: "BULK_BUY_GET_FREE",
  PROMOTION_PRICE: "PROMOTION_PRICE",
};

export const isPromotionAuditLine = (line = {}) =>
  line?.promotionDiscountLine === true && Boolean(line?.promotionRuleId);

export const buildPromotionRunRecords = ({
  cart = [],
  orderNumber = "",
  customer = null,
  branch = null,
  actor = null,
  audienceType = "all",
  country = "",
  createdAt = new Date().toISOString(),
} = {}) =>
  (cart || [])
    .filter(isPromotionAuditLine)
    .map((line) => {
      const kind = text(line.promotionRuleKind) ||
        (line.isPromotionPriceDiscount ? PROMOTION_RUN_TYPES.PROMOTION_PRICE : PROMOTION_RUN_TYPES.BULK_FREE);
      const freeUnits = kind === PROMOTION_RUN_TYPES.BULK_FREE
        ? number(line.promotionFreeQtyApplied ?? line.qty)
        : 0;

      return {
        order_number: text(orderNumber),
        promotion_line_key: text(line.id) || `promotion-${text(line.promotionRuleId)}-${kind}`,
        promotion_rule_id: line.promotionRuleId || null,
        promotion_name: text(line.promotionName || line.promotionDisplayLabel || line.name),
        promotion_rule_kind: kind,
        audience_type: text(line.promotionAudienceType || audienceType || "all").toLowerCase(),
        price_mode: text(line.promotionPriceMode || "ex_vat").toLowerCase(),
        customer_account_id: customer?.id || null,
        customer_name: text(customer?.account_name || customer?.company_name),
        customer_branch_id: branch?.id || null,
        branch_name: text(branch?.branch_name || branch?.shop_name),
        country: text(country || branch?.country || customer?.country),
        actor_id: actor?.staff_id || actor?.id || null,
        actor_name: text(actor?.staff_name || actor?.full_name || actor?.name || actor?.username),
        actor_role: text(actor?.role || actor?.access_level),
        trigger_brand: text(line.promotionTriggerBrand || line.brand),
        trigger_series: text(line.promotionTriggerSeries),
        trigger_flavour_mode: text(line.promotionTriggerFlavourMode || "all").toLowerCase(),
        trigger_flavours: Array.isArray(line.promotionTriggerFlavours) ? line.promotionTriggerFlavours : [],
        free_brand: text(line.promotionFreeBrand),
        free_series: text(line.promotionFreeSeries || line.series),
        free_flavour_mode: text(line.promotionFreeFlavourMode || "all").toLowerCase(),
        free_flavours: Array.isArray(line.promotionFreeFlavours) ? line.promotionFreeFlavours : [],
        buy_qty_rule: number(line.promotionBuyQty),
        free_qty_rule: number(line.promotionFreeQtyPerRun),
        paid_units_qualified: number(line.promotionPaidQtyQualified),
        free_units_entitled: number(line.promotionFreeQtyEarned),
        free_units_given: freeUnits,
        promotion_discount_amount: number(line.promotionDiscountAmount),
        promotion_discount_vat_amount: number(line.promotionDiscountVatAmount),
        created_at: createdAt,
      };
    });

export const summarizePromotionRunRecords = (records = []) =>
  (records || []).reduce(
    (summary, row) => ({
      promotionRuns: summary.promotionRuns + 1,
      paidUnitsQualified: summary.paidUnitsQualified + number(row.paid_units_qualified),
      freeUnitsEntitled: summary.freeUnitsEntitled + number(row.free_units_entitled),
      freeUnitsGiven: summary.freeUnitsGiven + number(row.free_units_given),
      promotionDiscountAmount: summary.promotionDiscountAmount + number(row.promotion_discount_amount),
    }),
    {
      promotionRuns: 0,
      paidUnitsQualified: 0,
      freeUnitsEntitled: 0,
      freeUnitsGiven: 0,
      promotionDiscountAmount: 0,
    }
  );

export const getPromotionInventoryOutstanding = (records = []) => {
  const summary = summarizePromotionRunRecords(records);
  return Math.max(0, summary.freeUnitsEntitled - summary.freeUnitsGiven);
};
