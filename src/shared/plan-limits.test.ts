import { describe, expect, it } from 'vitest';
import {
  FREE_PLAN_MAX_ACTIVE_RULES,
  canActivateAnotherRule,
  canUseCustomFrequency,
  canUseFixedDeposit,
  evaluateRuleAgainstPlan,
} from './plan-limits';

const PAID = { status: 'paid' } as const;
const FREE = { status: 'free' } as const;
const UNAVAILABLE = { status: 'unavailable' } as const;

describe('plan-limits (depositcraft Pro gating)', () => {
  it('only a paid entitlement may use fixed-amount deposits or custom frequencies', () => {
    expect(canUseFixedDeposit(PAID)).toBe(true);
    expect(canUseFixedDeposit(FREE)).toBe(false);
    expect(canUseFixedDeposit(UNAVAILABLE)).toBe(false);
    expect(canUseCustomFrequency(PAID)).toBe(true);
    expect(canUseCustomFrequency(FREE)).toBe(false);
  });

  it('free plans may activate up to the documented limit of active rules', () => {
    expect(canActivateAnotherRule(FREE, 0)).toBe(true);
    expect(canActivateAnotherRule(FREE, FREE_PLAN_MAX_ACTIVE_RULES - 1)).toBe(true);
    expect(canActivateAnotherRule(FREE, FREE_PLAN_MAX_ACTIVE_RULES)).toBe(false);
    expect(canActivateAnotherRule(PAID, 999)).toBe(true);
  });

  it('rejects a free-plan rule using a fixed deposit', () => {
    const result = evaluateRuleAgainstPlan({ depositType: 'FIXED', enabled: true }, FREE, 0);
    expect(result).toMatchObject({ allowed: false, reason: 'FREE_FIXED_DEPOSIT' });
  });

  it('rejects a free-plan rule using a non-default installment frequency', () => {
    const result = evaluateRuleAgainstPlan(
      { depositType: 'PERCENTAGE', installmentFrequency: 'MONTHLY', enabled: true },
      FREE,
      0
    );
    expect(result).toMatchObject({ allowed: false, reason: 'FREE_CUSTOM_FREQUENCY' });
  });

  it('rejects enabling a third rule on a free plan', () => {
    const result = evaluateRuleAgainstPlan(
      { depositType: 'PERCENTAGE', installmentFrequency: 'BIWEEKLY', enabled: true },
      FREE,
      FREE_PLAN_MAX_ACTIVE_RULES
    );
    expect(result).toMatchObject({ allowed: false, reason: 'FREE_RULE_LIMIT' });
  });

  it('allows a disabled rule to be saved regardless of the active-rule count', () => {
    const result = evaluateRuleAgainstPlan(
      { depositType: 'PERCENTAGE', installmentFrequency: 'BIWEEKLY', enabled: false },
      FREE,
      FREE_PLAN_MAX_ACTIVE_RULES
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows any configuration on a paid plan', () => {
    const result = evaluateRuleAgainstPlan(
      { depositType: 'FIXED', installmentFrequency: 'WEEKLY', enabled: true },
      PAID,
      99
    );
    expect(result).toEqual({ allowed: true });
  });
});
