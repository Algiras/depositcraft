import { beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getAppInstance: vi.fn() }));
vi.mock('@wix/app-management', () => ({ appInstances: api }));
const elevateSpy = vi.hoisted(() => vi.fn((fn: unknown) => fn));
vi.mock('@wix/essentials', () => ({ auth: { elevate: elevateSpy } }));

import { checkoutDepositMessage, deferredDiscountPercent, eligibleDepositTriggers, evaluateCartDepositPlans } from './cart-evaluation';
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

it('returns discount trigger ids only when a balance remains', () => {
  const evaluation = {
    eligible: true,
    ruleId: 'plan-25',
    ruleName: '25% Layaway',
    orderSubtotal: 100,
    qualifyingSubtotal: 100,
    depositDueNow: 25,
    remainingBalance: 75,
    breakdownReasons: [],
  };
  expect(eligibleDepositTriggers([rule], evaluation)).toEqual([
    { customTriggerId: 'depositcraft-plan-25', identifier: 'plan-25' },
  ]);
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
