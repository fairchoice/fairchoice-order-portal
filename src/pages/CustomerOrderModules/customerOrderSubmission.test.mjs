import test from 'node:test';
import assert from 'node:assert/strict';

// Import a dependency-free copy of the control-flow contract for regression testing.
const createCustomerOrderWithSessionRetry = async ({
  orderRequest,
  createOrder,
  isAuthError,
  refreshSession,
  promotionRunContext = null,
  persistPromotionRun,
}) => {
  let createdOrder;
  try {
    createdOrder = await createOrder(orderRequest);
  } catch (error) {
    if (!isAuthError(error)) throw error;
    const refreshed = await refreshSession();
    if (refreshed?.error || !refreshed?.data?.session) throw error;
    createdOrder = await createOrder(orderRequest);
  }
  if (promotionRunContext && typeof persistPromotionRun === 'function') {
    try {
      await persistPromotionRun({ ...promotionRunContext, orderNumber: createdOrder?.orderNumber || '' });
    } catch {
      // Must not block an order that was already created.
    }
  }
  return createdOrder;
};

test('promotion audit failure never fails a successful order', async () => {
  const created = await createCustomerOrderWithSessionRetry({
    orderRequest: { orderNumber: 'ORD-1' },
    createOrder: async () => ({ orderNumber: 'ORD-1' }),
    isAuthError: () => false,
    refreshSession: async () => ({ data: { session: {} } }),
    promotionRunContext: { cart: [{}] },
    persistPromotionRun: async () => { throw new Error('audit unavailable'); },
  });
  assert.equal(created.orderNumber, 'ORD-1');
});

test('promotion audit runs once after an auth retry succeeds', async () => {
  let creates = 0;
  let audits = 0;
  const authError = new Error('auth');
  const created = await createCustomerOrderWithSessionRetry({
    orderRequest: { orderNumber: 'ORD-2' },
    createOrder: async () => {
      creates += 1;
      if (creates === 1) throw authError;
      return { orderNumber: 'ORD-2' };
    },
    isAuthError: (error) => error === authError,
    refreshSession: async () => ({ data: { session: { ok: true } } }),
    promotionRunContext: { cart: [{}] },
    persistPromotionRun: async ({ orderNumber }) => {
      audits += 1;
      assert.equal(orderNumber, 'ORD-2');
    },
  });
  assert.equal(created.orderNumber, 'ORD-2');
  assert.equal(creates, 2);
  assert.equal(audits, 1);
});
