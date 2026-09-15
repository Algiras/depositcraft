import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  ledger: undefined as any,
  created: [] as any[],
  requestStatus: new Map<string, string>(),
  configuration: [{
    id: 'plan-25',
    name: '25% plan',
    depositType: 'PERCENTAGE',
    depositValue: 25,
    layawayInstallments: 1,
    installmentFrequency: 'MONTHLY',
    scope: 'ALL_PRODUCTS',
    enabled: true,
  }],
}));

vi.mock('@wix/data', () => ({
  items: {
    query: () => ({
      eq: () => ({
        find: async () => ({ items: [{ payload: { entries: state.configuration } }] }),
      }),
    }),
    insert: async (_: string, item: any) => {
      if (state.ledger) throw new Error('duplicate');
      state.ledger = structuredClone(item);
      return item;
    },
    get: async (_: string, id: string) => {
      if (!state.ledger || state.ledger._id !== id) throw new Error('WDE0025 not found');
      return structuredClone(state.ledger);
    },
    save: async (_: string, item: any) => {
      state.ledger = structuredClone(item);
      return item;
    },
  },
}));

vi.mock('@wix/automations', () => ({
  activations: {
    reportEvent: vi.fn(async () => ({ activationIds: [] })),
    cancelEvent: vi.fn(async () => {}),
  },
}));

vi.mock('@wix/app-management', () => ({
  appInstances: { getAppInstance: async () => ({ instance: { isFree: false } }) },
  billing: { getUrl: vi.fn() },
}));

vi.mock('@wix/ecom', () => ({
  orders: {
    getOrder: async (id: string) => ({
      _id: id,
      currency: 'USD',
      buyerInfo: { contactId: '11111111-1111-4111-8111-111111111111' },
      priceSummary: { total: { amount: '100.00' } },
      lineItems: [{
        _id: 'line-1',
        catalogReference: { catalogItemId: 'product-1' },
        quantity: 1,
        price: { amount: '100.00' },
      }],
    }),
  },
  orderPaymentRequests: {
    queryOrderPaymentRequests: () => ({
      eq: () => ({ find: async () => ({ items: [] }) }),
    }),
    createOrderPaymentRequest: async (request: any) => {
      state.created.push(request);
      const id = `request-${state.created.length}`;
      state.requestStatus.set(id, 'PENDING');
      return { _id: id };
    },
    getOrderPaymentRequestUrl: async (id: string) => ({ orderPaymentRequestUrl: `https://pay.wix.test/${id}` }),
    getOrderPaymentRequest: async (id: string) => ({ _id: id, status: state.requestStatus.get(id) ?? 'PENDING' }),
  },
}));

import {
  advancePaymentPlanForOrder,
  startPaymentPlanForOrder,
  syncPaymentPlanFromWix,
} from './payment-plan-service';

beforeEach(() => {
  state.ledger = undefined;
  state.created = [];
  state.requestStatus = new Map();
});

it('starts a payment plan and exposes the first payment link', async () => {
  const result = await startPaymentPlanForOrder('order-1', 'plan-25');
  expect(result).toMatchObject({
    orderId: 'order-1',
    amount: 25,
    currency: 'USD',
    paymentRequestUrl: 'https://pay.wix.test/request-1',
  });
});

it('syncs paid status from Wix and creates the next payment link', async () => {
  await startPaymentPlanForOrder('order-2', 'plan-25');
  state.requestStatus.set('request-1', 'PAID');
  const ledger = await syncPaymentPlanFromWix('order-2');
  expect(ledger?.installments[0].status).toBe('PAID');
  expect(ledger?.installments[1]).toMatchObject({
    installmentNumber: 1,
    status: 'PENDING',
    paymentRequestUrl: 'https://pay.wix.test/request-2',
  });
  expect(state.created).toHaveLength(2);
});

it('advances manually when the previous installment is already marked paid', async () => {
  await startPaymentPlanForOrder('order-3', 'plan-25');
  state.ledger.payload.installments[0].status = 'PAID';
  state.ledger.payload.installments[0].paymentRequestId = 'request-1';
  delete state.ledger.payload.installments[0].paymentRequestUrl;
  const result = await advancePaymentPlanForOrder('order-3');
  expect(result?.paymentRequestUrl).toBe('https://pay.wix.test/request-2');
});
