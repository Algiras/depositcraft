import { expect, it } from 'vitest';
import { checkoutDepositMessage, deferredDiscountPercent, eligibleDepositTriggers } from './cart-evaluation';
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
