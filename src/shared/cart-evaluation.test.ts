import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getAppInstance: vi.fn() }));
vi.mock('@wix/app-management', () => ({ appInstances: api }));
const elevateSpy = vi.hoisted(() => vi.fn((fn: unknown) => fn));
vi.mock('@wix/essentials', () => ({ auth: { elevate: elevateSpy } }));

import { checkoutDepositMessage, deferredDiscountPercent, eligibleDepositTriggers, evaluateCartDepositPlans, toCheckoutLineItems } from './cart-evaluation';
import type { DepositRule } from '../types';

const rule: DepositRule = {
  id: 'plan-25',
  name: '25% Layaway',
  depositType: 'PERCENTAGE',
  depositValue: 25,
  layawayInstallments: 2,
  installmentFrequency: 'BIWEEKLY',
  scope: 'ALL_PRODUCTS',
  enabled: true,
};

it('calculates deferred discount percent for checkout pairing', () => {
  const evaluation = {
    eligible: true,
    orderSubtotal: 100,
    qualifyingSubtotal: 100,
    depositDueNow: 25,
    remainingBalance: 75,
    breakdownReasons: [],
  };
  expect(deferredDiscountPercent(evaluation)).toBe(75);
});

const eligibleEvaluation = {
  eligible: true,
  ruleId: 'plan-25',
  ruleName: '25% Layaway',
  orderSubtotal: 100,
  qualifyingSubtotal: 100,
  depositDueNow: 25,
  remainingBalance: 75,
  breakdownReasons: [],
};

it('echoes the REQUEST-scoped identifier, not our own rule id, per the SPI contract', () => {
  // Shape lifted from the docs' sample `getEligibleTriggers` request:
  // https://dev.wix.com/docs/.../custom-discount-triggers-integration-service-plugin/get-eligible-triggers.md
  const requestedTriggers = [
    { customTrigger: { _id: 'depositcraft-plan-25' }, identifier: '123' },
    { customTrigger: { _id: 'my-happy-hour-trigger' }, identifier: '234' },
  ];
  expect(eligibleDepositTriggers([rule], eligibleEvaluation, requestedTriggers)).toEqual([
    { customTriggerId: 'depositcraft-plan-25', identifier: '123' },
  ]);
});

it('omits an eligible rule that Wix did not ask about', () => {
  const requestedTriggers = [{ customTrigger: { _id: 'my-happy-hour-trigger' }, identifier: '234' }];
  expect(eligibleDepositTriggers([rule], eligibleEvaluation, requestedTriggers)).toEqual([]);
});

it('omits a requested trigger whose customTrigger id we do not recognize', () => {
  const requestedTriggers = [{ customTrigger: { _id: 'some-other-apps-trigger' }, identifier: '999' }];
  expect(eligibleDepositTriggers([rule], eligibleEvaluation, requestedTriggers)).toEqual([]);
});

it('returns nothing when the request has no triggers to filter by', () => {
  expect(eligibleDepositTriggers([rule], eligibleEvaluation, undefined)).toEqual([]);
  expect(eligibleDepositTriggers([rule], eligibleEvaluation, [])).toEqual([]);
});

it('explains checkout deposit pairing in shopper-facing copy', () => {
  const message = checkoutDepositMessage({
    eligible: true,
    ruleName: '25% Layaway',
    orderSubtotal: 100,
    qualifyingSubtotal: 100,
    depositDueNow: 25,
    remainingBalance: 75,
    layawaySchedule: { installmentsCount: 2 } as never,
    breakdownReasons: [],
  });
  expect(message).toContain('pay $25.00 today');
  expect(message).toContain('75.00% automatic discount');
});

function fakeQuery() {
  return vi.fn(() => ({
    eq: () => ({ find: async () => ({ items: [{ payload: { entries: [rule] } }] }) }),
  }));
}

beforeEach(() => {
  api.getAppInstance.mockReset().mockResolvedValue({ instance: { isFree: false } });
  elevateSpy.mockClear();
});

// evaluateCartDepositPlans is only ever called from backend/SPI plugins today
// (ecom-discounts-trigger, ecom-validations), but it stays dashboard-safe by
// default -- both the `query` and `entitlementOptions` parameters default to
// unelevated -- so it can't silently 403 a dashboard caller in the future.
it('defaults to unelevated rules and entitlement lookups (dashboard-safe)', async () => {
  const query = fakeQuery();
  await evaluateCartDepositPlans([], 'USD', query as never);
  expect(query).toHaveBeenCalled();
  expect(elevateSpy).not.toHaveBeenCalled();
});

it('elevates the entitlement lookup when a backend/SPI caller opts in', async () => {
  const query = fakeQuery();
  await evaluateCartDepositPlans([], 'USD', query as never, { elevated: true });
  expect(elevateSpy).toHaveBeenCalledWith(api.getAppInstance);
});

// ─── toCheckoutLineItems – discount price precedence ─────────────────────────
// The layaway installment base must divide the effective selling price (price),
// not the pre-discount catalogue price (originalPrice). A discounted order must
// produce installments from the discounted total, not the sticker total.

it('toCheckoutLineItems: prefers price over originalPrice (discounted item)', () => {
  const result = toCheckoutLineItems({
    lineItems: [
      { _id: 'li-1', price: { amount: '75.00' }, originalPrice: { amount: '100.00' }, quantity: 1 },
    ],
  });
  expect(result[0].price).toBe('75.00');
});

it('toCheckoutLineItems: falls back to originalPrice when price is absent', () => {
  const result = toCheckoutLineItems({
    lineItems: [
      { _id: 'li-2', originalPrice: { amount: '100.00' }, quantity: 1 },
    ],
  });
  expect(result[0].price).toBe('100.00');
});

it('toCheckoutLineItems: defaults price to "0" when both are absent', () => {
  const result = toCheckoutLineItems({
    lineItems: [{ _id: 'li-3', quantity: 1 }],
  });
  expect(result[0].price).toBe('0');
});

it('toCheckoutLineItems: maps catalogReference, productName, and quantity', () => {
  const result = toCheckoutLineItems({
    lineItems: [
      {
        _id: 'li-4',
        catalogReference: { catalogItemId: 'cat-abc' },
        productName: { original: 'Widget' },
        price: { amount: '9.99' },
        quantity: 3,
      },
    ],
  });
  expect(result[0]).toMatchObject({
    id: 'li-4',
    catalogItemId: 'cat-abc',
    catalogReference: { catalogItemId: 'cat-abc' },
    productName: 'Widget',
    quantity: 3,
    price: '9.99',
  });
});
