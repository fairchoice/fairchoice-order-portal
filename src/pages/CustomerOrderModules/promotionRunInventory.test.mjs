import assert from 'node:assert/strict';
import { buildPromotionRunRecords, summarizePromotionRunRecords, getPromotionInventoryOutstanding } from './promotionRunInventory.js';

const cart = [{
  promotionDiscountLine: true,
  promotionRuleId: 'rule-1',
  promotionName: 'Buy 10 Get 2 Free',
  promotionRuleKind: 'BULK_BUY_GET_FREE',
  promotionAudienceType: 'sales_rep',
  promotionTriggerBrand: 'Lost Mary',
  promotionTriggerSeries: 'Full Kit',
  promotionFreeBrand: 'Lost Mary',
  promotionFreeSeries: 'Refill Kit',
  promotionBuyQty: 10,
  promotionFreeQtyPerRun: 2,
  promotionPaidQtyQualified: 20,
  promotionFreeQtyEarned: 4,
  promotionFreeQtyApplied: 3,
  promotionDiscountAmount: 12,
  promotionDiscountVatAmount: 2.4,
  qty: 3,
}];

const rows = buildPromotionRunRecords({
  cart,
  orderNumber: 'ORD-1',
  customer: { id: 'c1', account_name: 'Test Shop' },
  branch: { id: 'b1', branch_name: 'Main', country: 'Wales' },
  actor: { id: 'u1', name: 'Rep One', role: 'Sales Rep' },
});
assert.equal(rows.length, 1);
assert.equal(rows[0].paid_units_qualified, 20);
assert.equal(rows[0].free_units_entitled, 4);
assert.equal(rows[0].free_units_given, 3);
assert.equal(rows[0].audience_type, 'sales_rep');
assert.deepEqual(summarizePromotionRunRecords(rows), {
  promotionRuns: 1,
  paidUnitsQualified: 20,
  freeUnitsEntitled: 4,
  freeUnitsGiven: 3,
  promotionDiscountAmount: 12,
});
assert.equal(getPromotionInventoryOutstanding(rows), 1);
console.log('promotionRunInventory tests passed');
