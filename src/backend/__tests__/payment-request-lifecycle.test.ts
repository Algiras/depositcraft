import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ ledger: undefined as any, created: [] as any[], urls: [] as string[], isFree: false, configuration: [{ id: 'plan-25', name: '25% plan', depositType: 'PERCENTAGE', depositValue: 25, layawayInstallments: 1, installmentFrequency: 'MONTHLY', scope: 'ALL_PRODUCTS', enabled: true }, { id: 'plan-fixed', name: 'Fixed plan', depositType: 'FIXED', depositValue: 50, layawayInstallments: 1, installmentFrequency: 'MONTHLY', scope: 'ALL_PRODUCTS', enabled: true }] }));
vi.mock('@wix/data', () => ({ collections: { createDataCollection: vi.fn(async () => ({})) }, items: {
  query: () => ({ eq: () => ({ find: async () => ({ items: [{ payload: { entries: state.configuration } }] }) }) }),
  insert: async (_: string, item: any) => { if (state.ledger) throw new Error('duplicate'); state.ledger = structuredClone(item); return item; },
  get: async (_: string, id: string) => {
    if (!state.ledger || state.ledger._id !== id) throw new Error('WDE0025 not found');
    return structuredClone(state.ledger);
  },
  save: async (_: string, item: any) => { state.ledger = structuredClone(item); return item; },
} }));
vi.mock('@wix/essentials', () => ({ auth: { elevate: (fn: unknown) => fn } }));
vi.mock('@wix/app-management', () => ({ appInstances: { getAppInstance: async () => ({ instance: { isFree: state.isFree } }) }, billing: { getUrl: vi.fn() } }));
vi.mock('@wix/automations', () => ({
  activations: {
    reportEvent: vi.fn(async () => ({ activationIds: [] })),
    cancelEvent: vi.fn(async () => {}),
  },
}));
vi.mock('@wix/ecom', () => ({
  orders: { getOrder: async (id: string) => ({ _id: id, currency: 'USD', buyerInfo: { contactId: '11111111-1111-4111-8111-111111111111' }, priceSummary: { total: { amount: '100.00' } }, lineItems: [{ _id: 'line-1', catalogReference: { catalogItemId: 'product-1' }, quantity: 1, price: { amount: '100.00' } }] }) },
  orderPaymentRequests: {
    queryOrderPaymentRequests: () => ({ eq: () => ({ find: async () => ({ items: [] }) }) }),
    createOrderPaymentRequest: async (request: any) => { state.created.push(request); return { _id: `request-${state.created.length}` }; },
    getOrderPaymentRequestUrl: async (id: string) => ({ orderPaymentRequestUrl: `https://pay.wix.test/${id}` }),
    onOrderPaymentRequestPaid: () => {},
  },
}));
import { handleOrderPaymentRequestPaid, startExistingOrderPaymentPlan } from '../payment-request-lifecycle';

it('derives the schedule and currency from the saved plan and verified Wix order', async () => {
  state.ledger = undefined; state.created = [];
  const result = await startExistingOrderPaymentPlan('order-1', 'plan-25');
  expect(result).toMatchObject({ amount: 25, currency: 'USD', paymentRequestUrl: 'https://pay.wix.test/request-1' });
  expect(state.created[0].orderPaymentRequest).toMatchObject({ orderId: 'order-1', amount: { amount: '25.00' }, source: { externalId: 'depositcraft:order-1:0' } });
  await handleOrderPaymentRequestPaid('request-1', 'order-1');
  expect(state.created[1].orderPaymentRequest).toMatchObject({ orderId: 'order-1', amount: { amount: '75.00' }, source: { externalId: 'depositcraft:order-1:1' } });
});
it('returns the existing request when the order action is repeated', async () => {
  const existing = await startExistingOrderPaymentPlan('order-1', 'plan-25');
  expect(existing.paymentRequestId).toBe('request-1');
  expect(state.created).toHaveLength(2);
});
it('serializes duplicate PAID delivery so one next installment is created', async () => {
  state.ledger = undefined; state.created = [];
  await startExistingOrderPaymentPlan('order-2', 'plan-25');
  await Promise.all([handleOrderPaymentRequestPaid('request-1', 'order-2'), handleOrderPaymentRequestPaid('request-1', 'order-2')]);
  expect(state.created).toHaveLength(2);
});
it('refuses to start real payment collection for a fixed-amount plan on a free instance', async () => {
  state.ledger = undefined; state.created = []; state.isFree = true;
  try {
    await expect(startExistingOrderPaymentPlan('order-3', 'plan-fixed')).rejects.toThrow('Fixed-amount deposits need the Pro plan');
    expect(state.created).toHaveLength(0);
  } finally {
    state.isFree = false;
  }
});
