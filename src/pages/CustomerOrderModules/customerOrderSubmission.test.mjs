import test from 'node:test';
import assert from 'node:assert/strict';

// Dependency-free copy of the order-submission safety contract.
const createCustomerOrderWithSessionRetry = async ({
  orderRequest,
  createOrder,
  isAuthError,
  refreshSession,
  findOrderByNumber,
  promotionRunContext = null,
  persistPromotionRun,
}) => {
  const recover = async () => {
    if (!orderRequest?.orderNumber || typeof findOrderByNumber !== 'function') return null;
    try {
      return await findOrderByNumber(orderRequest.orderNumber);
    } catch {
      return null;
    }
  };

  let createdOrder;
  try {
    createdOrder = await createOrder(orderRequest);
  } catch (error) {
    createdOrder = await recover();
    if (!createdOrder) {
      if (!isAuthError(error)) throw error;
      const refreshed = await refreshSession();
      if (refreshed?.error || !refreshed?.data?.session) throw error;
      createdOrder = await recover();
      if (!createdOrder) createdOrder = await createOrder(orderRequest);
    }
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


test('lost response recovers existing order without submitting twice', async () => {
  let creates = 0;
  let lookups = 0;
  const networkError = new Error('Failed to fetch');
  const created = await createCustomerOrderWithSessionRetry({
    orderRequest: { orderNumber: 'ORD-NETWORK-1' },
    createOrder: async () => {
      creates += 1;
      throw networkError;
    },
    isAuthError: () => false,
    refreshSession: async () => ({ data: { session: {} } }),
    findOrderByNumber: async (orderNumber) => {
      lookups += 1;
      assert.equal(orderNumber, 'ORD-NETWORK-1');
      return { orderNumber, alreadyCreated: true };
    },
  });
  assert.equal(created.orderNumber, 'ORD-NETWORK-1');
  assert.equal(creates, 1);
  assert.equal(lookups, 1);
});

test('auth retry verifies before second write', async () => {
  let creates = 0;
  let lookups = 0;
  const authError = new Error('auth');
  const created = await createCustomerOrderWithSessionRetry({
    orderRequest: { orderNumber: 'ORD-AUTH-SAFE' },
    createOrder: async () => {
      creates += 1;
      throw authError;
    },
    isAuthError: (error) => error === authError,
    refreshSession: async () => ({ data: { session: { ok: true } } }),
    findOrderByNumber: async (orderNumber) => {
      lookups += 1;
      if (lookups === 1) return null;
      return { orderNumber, alreadyCreated: true };
    },
  });
  assert.equal(created.orderNumber, 'ORD-AUTH-SAFE');
  assert.equal(creates, 1);
  assert.equal(lookups, 2);
});
